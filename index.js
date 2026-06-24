const MODULE_NAME = 'ST-SmartNotify';
const LOG_PREFIX = '[Smart Notify]';

jQuery(async function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Prevent double initialization
    // ---------------------------------------------------------------------
    if (window.__smartNotifyInitialized) {
        console.warn(`${LOG_PREFIX} Already initialized, disposing previous instance.`);
        if (typeof window.__smartNotifyDispose === 'function') {
            try { window.__smartNotifyDispose(); } catch (e) { console.error(`${LOG_PREFIX} Dispose error:`, e); }
        }
    }
    window.__smartNotifyInitialized = true;

    const context = SillyTavern.getContext();
    const extensionSettings = context.extensionSettings;
    const saveSettingsDebounced = context.saveSettingsDebounced;

    // ---------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------
    const TOAST_TYPES = ['success', 'info', 'warning', 'error'];

    const defaultSettings = {
        enabled: true,
        // global mute by type
        muteTypes: { success: false, info: false, warning: false, error: false },
        // rules: [{ id, pattern, isRegex, type, action ('mute'|'allow'|'rewrite'), replacement, enabled, hits }]
        rules: [],
        // appearance
        appearance: {
            override: false,
            position: 'toast-top-right', // toastr position class
            customPosition: null,        // {x, y} px from top-left when position === 'custom'
            width: 320,                  // px
            fontSize: 14,                // px
            duration: 5000,             // ms (timeOut)
            extendedDuration: 1000,     // ms (extendedTimeOut, hover)
            opacity: 1,
            // color/theme override
            colorOverride: false,
            bgColor: '#1e1e26',
            textColor: '#e8e8ea',
            borderColor: '#6c8cff',
            borderWidth: 1,             // px
            borderRadius: 8,            // px
        },
        // anti-spam
        rateLimit: {
            dedupeBurst: true,          // drop identical toast fired again within window
            dedupeWindow: 3000,         // ms
            throttle: false,            // cap total toasts within a window
            throttleMax: 5,             // max toasts...
            throttleWindow: 5000,       // ...per this many ms
        },
        // console mirroring (devtools / Termux)
        console: {
            mirror: false,              // mirror toasts to console
            level: 'all',               // 'shown' | 'blocked' | 'all'
            includeBlocked: true,       // (kept for forward-compat)
        },
        // log
        logLimit: 200,
        // UI
        autoOpenOnNew: false,
    };

    function mergeSettings(defaults, saved) {
        const out = Array.isArray(defaults) ? [] : {};
        for (const k in defaults) {
            if (!Object.prototype.hasOwnProperty.call(defaults, k)) continue;
            const dv = defaults[k];
            const sv = saved ? saved[k] : undefined;
            if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
                out[k] = mergeSettings(dv, (sv && typeof sv === 'object') ? sv : {});
            } else {
                out[k] = (sv !== undefined) ? sv : dv;
            }
        }
        // keep any extra saved keys (forward-compat) for top-level objects
        if (saved && typeof saved === 'object' && !Array.isArray(saved) && !Array.isArray(defaults)) {
            for (const k in saved) {
                if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = saved[k];
            }
        }
        return out;
    }

    function getSettings() {
        extensionSettings[MODULE_NAME] = mergeSettings(defaultSettings, extensionSettings[MODULE_NAME]);
        return extensionSettings[MODULE_NAME];
    }

    function save() {
        saveSettingsDebounced();
    }

    const settings = getSettings();

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function uid() {
        return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // Strip HTML tags from a toastr message to get plain text for matching/log.
    function toPlainText(msg) {
        if (msg == null) return '';
        const s = String(msg);
        if (s.indexOf('<') === -1) return s;
        const tmp = document.createElement('div');
        tmp.innerHTML = s;
        return (tmp.textContent || tmp.innerText || '').trim();
    }

    // ---------------------------------------------------------------------
    // Notification log
    // ---------------------------------------------------------------------
    // entry: { id, type, title, message, text, time, blocked, ruleId }
    const notifLog = [];
    const logListeners = new Set();

    function pushLog(entry) {
        notifLog.unshift(entry);
        const limit = Math.max(10, settings.logLimit | 0);
        if (notifLog.length > limit) notifLog.length = limit;
        logListeners.forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
    }

    // ---------------------------------------------------------------------
    // Rule engine
    // ---------------------------------------------------------------------
    function compileRegex(pattern) {
        try {
            // allow /.../flags syntax
            const m = /^\/(.*)\/([a-z]*)$/i.exec(pattern);
            if (m) return new RegExp(m[1], m[2]);
            return new RegExp(pattern, 'i');
        } catch (e) {
            console.warn(`${LOG_PREFIX} Invalid regex:`, pattern, e);
            return null;
        }
    }

    function ruleMatches(rule, type, text) {
        if (!rule.enabled) return false;
        if (rule.type && rule.type !== 'any' && rule.type !== type) return false;
        const pat = rule.pattern || '';
        if (pat === '') return rule.type && rule.type !== 'any'; // empty pattern => match by type only
        if (rule.isRegex) {
            const re = compileRegex(pat);
            return re ? re.test(text) : false;
        }
        return text.toLowerCase().includes(pat.toLowerCase());
    }

    // Apply a rewrite rule to a message string, returning the new string.
    function applyRewrite(rule, str) {
        if (str == null) return str;
        const repl = rule.replacement != null ? rule.replacement : '';
        const pat = rule.pattern || '';
        if (pat === '') return str;
        try {
            if (rule.isRegex) {
                const m = /^\/(.*)\/([a-z]*)$/i.exec(pat);
                const re = m ? new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g')
                             : new RegExp(pat, 'gi');
                return String(str).replace(re, repl);
            }
            // plain text: replace all occurrences (case-insensitive)
            const esc = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return String(str).replace(new RegExp(esc, 'gi'), repl);
        } catch (e) {
            console.warn(`${LOG_PREFIX} rewrite failed:`, e);
            return str;
        }
    }

    // Evaluate all rules + global mutes against a notification.
    // Returns { blocked: false|ruleId|string, rewriteRules: [rule,...] }
    function evaluate(type, text) {
        const result = { blocked: false, rewriteRules: [] };
        if (!settings.enabled) return result;

        let blockedByRule = false;
        let matchedRuleId = null;
        for (const rule of settings.rules) {
            if (!ruleMatches(rule, type, text)) continue;
            if (rule.action === 'allow') {
                rule.hits = (rule.hits || 0) + 1;
                // allow wins over mutes, but rewrites still apply
                result.blocked = false;
                result.forceAllow = true;
            } else if (rule.action === 'mute') {
                if (!result.forceAllow) {
                    blockedByRule = true;
                    matchedRuleId = rule.id;
                }
            } else if (rule.action === 'rewrite') {
                rule.hits = (rule.hits || 0) + 1;
                result.rewriteRules.push(rule);
            }
        }

        if (result.forceAllow) return result;

        if (blockedByRule) {
            const r = settings.rules.find((x) => x.id === matchedRuleId);
            if (r) r.hits = (r.hits || 0) + 1;
            result.blocked = matchedRuleId;
            return result;
        }

        // global type mute
        if (settings.muteTypes[type]) result.blocked = 'type:' + type;
        return result;
    }

    // ---------------------------------------------------------------------
    // Anti-spam: burst dedupe + throttle
    // ---------------------------------------------------------------------
    const recentToasts = [];      // {key, time} for dedupe
    const throttleTimes = [];     // timestamps of shown toasts for throttling

    // Returns a string reason if the toast should be dropped by anti-spam, else false.
    function antiSpamBlock(type, text) {
        const rl = settings.rateLimit;
        const now = Date.now();

        if (rl.dedupeBurst) {
            const key = type + '\u0000' + text;
            // purge old
            while (recentToasts.length && now - recentToasts[0].time > rl.dedupeWindow) {
                recentToasts.shift();
            }
            if (recentToasts.some((e) => e.key === key)) {
                recentToasts.push({ key, time: now });
                return 'spam:dup';
            }
            recentToasts.push({ key, time: now });
        }

        if (rl.throttle) {
            while (throttleTimes.length && now - throttleTimes[0] > rl.throttleWindow) {
                throttleTimes.shift();
            }
            if (throttleTimes.length >= Math.max(1, rl.throttleMax | 0)) {
                return 'spam:throttle';
            }
            throttleTimes.push(now);
        }
        return false;
    }

    // ---------------------------------------------------------------------
    // Console mirroring (devtools on PC, Termux on phone)
    // ---------------------------------------------------------------------
    function mirrorToConsole(entry) {
        const c = settings.console;
        if (!c.mirror) return;
        if (c.level === 'shown' && entry.blocked) return;
        if (c.level === 'blocked' && !entry.blocked) return;

        const ts = new Date(entry.time).toLocaleTimeString();
        const status = entry.blocked
            ? `BLOCKED${entry.ruleId ? ' (' + entry.ruleId + ')' : ''}`
            : 'SHOWN';
        const head = `${LOG_PREFIX} [${ts}] ${entry.type.toUpperCase()} ${status}`;
        const full = [
            head,
            entry.title ? `  title:   ${entry.title}` : null,
            entry.message ? `  message: ${entry.message}` : null,
        ].filter(Boolean).join('\n');

        const fn = entry.type === 'error' ? console.error
                 : entry.type === 'warning' ? console.warn
                 : console.log;
        try { fn.call(console, full); } catch (e) { console.log(full); }
    }

    // ---------------------------------------------------------------------
    // Appearance: build toastr options + inject CSS
    // ---------------------------------------------------------------------
    const styleEl = document.createElement('style');
    styleEl.id = 'smart-notify-toast-style';
    document.head.appendChild(styleEl);

    function applyAppearanceCss() {
        const a = settings.appearance;
        if (!a.override) { styleEl.textContent = ''; return; }
        let css = `
#toast-container > div {
    width: ${a.width}px !important;
    font-size: ${a.fontSize}px !important;
    opacity: ${a.opacity} !important;
}
#toast-container > div .toast-message,
#toast-container > div .toast-title {
    font-size: ${a.fontSize}px !important;
}`;
        if (a.colorOverride) {
            css += `
#toast-container > div {
    background-color: ${a.bgColor} !important;
    background-image: none !important;
    color: ${a.textColor} !important;
    border: ${a.borderWidth}px solid ${a.borderColor} !important;
    border-radius: ${a.borderRadius}px !important;
    box-shadow: 0 4px 18px rgba(0,0,0,.4) !important;
}
#toast-container > div .toast-message,
#toast-container > div .toast-title { color: ${a.textColor} !important; }
#toast-container > div .toast-close-button { color: ${a.textColor} !important; }`;
        }
        if (a.position === 'custom' && a.customPosition) {
            css += `
#toast-container.toast-smartnotify-custom {
    position: fixed !important;
    top: ${a.customPosition.y}px !important;
    left: ${a.customPosition.x}px !important;
    right: auto !important;
    bottom: auto !important;
}
#toast-container.toast-smartnotify-custom > div { position: relative; }`;
        }
        styleEl.textContent = css;
    }

    function appearanceOptions() {
        const a = settings.appearance;
        if (!a.override) return {};
        const opts = {
            timeOut: a.duration,
            extendedTimeOut: a.extendedDuration,
        };
        if (a.position === 'custom') {
            opts.positionClass = 'toast-smartnotify-custom';
        } else {
            opts.positionClass = a.position;
        }
        return opts;
    }

    // ---------------------------------------------------------------------
    // toastr interception
    // ---------------------------------------------------------------------
    if (typeof toastr === 'undefined') {
        console.error(`${LOG_PREFIX} toastr is not available; interception disabled.`);
    }

    const original = {};
    function wrapType(type) {
        const orig = toastr[type];
        if (typeof orig !== 'function') return;
        original[type] = orig;
        toastr[type] = function (message, title, optionsOverride) {
            try {
                let outMessage = message;
                let outTitle = title;
                const text = toPlainText(message) || toPlainText(title);

                const evalResult = evaluate(type, text);
                let blockResult = evalResult.blocked;

                // apply rewrite rules (to both message and title) when not forced-allowed away
                let rewritten = false;
                if (evalResult.rewriteRules.length) {
                    for (const r of evalResult.rewriteRules) {
                        const nm = applyRewrite(r, outMessage);
                        const nt = applyRewrite(r, outTitle);
                        if (nm !== outMessage || nt !== outTitle) rewritten = true;
                        outMessage = nm;
                        outTitle = nt;
                    }
                }

                // anti-spam (only for toasts that would actually show)
                if (!blockResult) {
                    const spam = antiSpamBlock(type, toPlainText(outMessage) || toPlainText(outTitle));
                    if (spam) blockResult = spam;
                }

                const entry = {
                    id: uid(),
                    type,
                    title: toPlainText(outTitle),
                    message: toPlainText(outMessage),
                    text: toPlainText(outMessage) || toPlainText(outTitle),
                    time: Date.now(),
                    blocked: !!blockResult,
                    ruleId: (typeof blockResult === 'string') ? blockResult : null,
                    rewritten,
                };
                pushLog(entry);
                mirrorToConsole(entry);

                if (blockResult) {
                    return null; // swallow
                }

                const merged = Object.assign({}, appearanceOptions(), optionsOverride || {});
                if (settings.autoOpenOnNew) openDrawer();
                return original[type].call(this, outMessage, outTitle, merged);
            } catch (e) {
                console.error(`${LOG_PREFIX} interceptor error:`, e);
                return original[type].call(this, message, title, optionsOverride);
            }
        };
    }

    if (typeof toastr !== 'undefined') {
        TOAST_TYPES.forEach(wrapType);
    }

    function restoreToastr() {
        if (typeof toastr === 'undefined') return;
        for (const t of TOAST_TYPES) {
            if (original[t]) toastr[t] = original[t];
        }
    }

    // ---------------------------------------------------------------------
    // Drawer UI
    // ---------------------------------------------------------------------
    const ICONS = {
        success: 'fa-circle-check',
        info: 'fa-circle-info',
        warning: 'fa-triangle-exclamation',
        error: 'fa-circle-xmark',
    };

    // Modal-shell layout (display-toggle via .sn-hidden) — robust on mobile,
    // never gets stuck off-screen like a pure transform drawer can.
    const $modal = $(`
        <div id="smart-notify-modal" class="sn-hidden">
            <div id="smart-notify-backdrop"></div>
            <div id="smart-notify-drawer">
                <div class="sn-header">
                    <div class="sn-title"><i class="fa-solid fa-bell"></i> Smart Notify</div>
                    <div class="sn-header-actions">
                        <div class="sn-icon-btn" id="sn-master-toggle" title="Enable/disable filtering"></div>
                        <div class="sn-icon-btn" id="sn-close" title="Close"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                </div>
                <div class="sn-tabs">
                    <div class="sn-tab active" data-tab="log"><i class="fa-solid fa-list"></i> Log</div>
                    <div class="sn-tab" data-tab="rules"><i class="fa-solid fa-filter"></i> Rules</div>
                    <div class="sn-tab" data-tab="appearance"><i class="fa-solid fa-palette"></i> Look</div>
                    <div class="sn-tab" data-tab="more"><i class="fa-solid fa-sliders"></i> More</div>
                </div>
                <div class="sn-body">
                    <div class="sn-panel" data-panel="log">
                        <div class="sn-toolbar">
                            <div class="sn-type-filters"></div>
                            <div class="sn-toolbar-actions">
                                <div class="sn-icon-btn" id="sn-dump-console" title="Dump log to console"><i class="fa-solid fa-terminal"></i></div>
                                <div class="sn-icon-btn" id="sn-clear-log" title="Clear log"><i class="fa-solid fa-trash"></i></div>
                            </div>
                        </div>
                        <div class="sn-log-list"></div>
                    </div>
                    <div class="sn-panel" data-panel="rules" style="display:none;">
                        <div class="sn-rule-add">
                            <input type="text" class="text_pole" id="sn-rule-pattern" placeholder="Text or /regex/i to match..." />
                            <input type="text" class="text_pole sn-hidden" id="sn-rule-replacement" placeholder="Replacement text (use $1 for regex groups)..." />
                            <div class="sn-rule-add-row">
                                <select class="text_pole" id="sn-rule-type">
                                    <option value="any">Any type</option>
                                    <option value="success">Success</option>
                                    <option value="info">Info</option>
                                    <option value="warning">Warning</option>
                                    <option value="error">Error</option>
                                </select>
                                <select class="text_pole" id="sn-rule-action">
                                    <option value="mute">Mute (block)</option>
                                    <option value="allow">Allow (force show)</option>
                                    <option value="rewrite">Rewrite text</option>
                                </select>
                                <label class="sn-checkbox" title="Treat pattern as regex">
                                    <input type="checkbox" id="sn-rule-regex" /> <span>.*</span>
                                </label>
                                <div class="menu_button" id="sn-rule-add-btn"><i class="fa-solid fa-plus"></i> Add</div>
                            </div>
                        </div>
                        <div class="sn-rules-list"></div>
                    </div>
                    <div class="sn-panel" data-panel="appearance" style="display:none;">
                        <div class="sn-appearance-form"></div>
                    </div>
                    <div class="sn-panel" data-panel="more" style="display:none;">
                        <div class="sn-more-form"></div>
                    </div>
                </div>
            </div>
        </div>
    `);
    $('body').append($modal);

    const $drawer = $modal.find('#smart-notify-drawer');

    let drawerOpen = false;
    let openedAt = 0;
    function openDrawer() {
        drawerOpen = true;
        openedAt = Date.now();
        $modal.removeClass('sn-hidden');
        document.body.classList.add('sn-modal-open');
        renderLog();
        updateBadge(true);
    }
    function closeDrawer() {
        drawerOpen = false;
        $modal.addClass('sn-hidden');
        document.body.classList.remove('sn-modal-open');
    }
    function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }

    // Ignore the synthetic tap that opened the modal (prevents instant close on touch)
    $modal.find('#smart-notify-backdrop').on('click', function () {
        if (Date.now() - openedAt < 300) return;
        closeDrawer();
    });
    $modal.on('click', '#sn-close', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeDrawer();
    });

    // ----- wand menu button (entry point) -----
    function closeExtensionsMenu() {
        try { $('#extensionsMenu').fadeOut?.(150); } catch (e) { /* noop */ }
        const menu = document.getElementById('extensionsMenu');
        if (menu) menu.style.display = 'none';
    }

    function addWandButton() {
        const container = document.getElementById('extensionsMenu')
            || document.getElementById('gallery_wand_container');
        if (!(container instanceof HTMLElement)) return false;
        if (document.getElementById('smart_notify_wand_button')) return true;

        const btn = document.createElement('div');
        btn.id = 'smart_notify_wand_button';
        btn.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
        btn.tabIndex = 0;
        btn.setAttribute('role', 'button');
        btn.style.cursor = 'pointer';
        btn.title = 'Smart Notify';

        const icon = document.createElement('div');
        icon.classList.add('fa-solid', 'fa-bell', 'extensionsMenuExtensionButton');
        const text = document.createElement('span');
        text.textContent = 'Smart Notify';
        const badge = document.createElement('span');
        badge.id = 'smart_notify_wand_badge';
        badge.className = 'sn-wand-badge';
        badge.style.display = 'none';

        btn.appendChild(icon);
        btn.appendChild(text);
        btn.appendChild(badge);

        let lastFire = 0;
        const activate = (e) => {
            e.preventDefault();
            const now = Date.now();
            if (now - lastFire < 400) return;
            lastFire = now;
            openDrawer();
            closeExtensionsMenu();
        };
        btn.addEventListener('click', activate);
        btn.addEventListener('touchend', activate, { passive: false });

        container.appendChild(btn);
        return true;
    }
    // The wand container may not exist yet at load — retry a few times.
    let wandTries = 0;
    const wandTimer = setInterval(() => {
        if (addWandButton() || ++wandTries > 40) clearInterval(wandTimer);
    }, 500);

    // ----- badge (unseen count, shown on the wand entry) -----
    let unseen = 0;
    function updateBadge(reset) {
        if (reset) unseen = 0;
        const $b = $('#smart_notify_wand_badge');
        if (unseen > 0) { $b.text(unseen > 99 ? '99+' : unseen).show(); }
        else $b.hide();
    }

    // ----- master toggle -----
    function renderMasterToggle() {
        const $t = $('#sn-master-toggle');
        $t.html(settings.enabled
            ? '<i class="fa-solid fa-shield-halved" style="color:var(--SmartGreen,#5cb85c)"></i>'
            : '<i class="fa-solid fa-shield" style="opacity:.4"></i>');
        $t.attr('title', settings.enabled ? 'Filtering ON (click to disable)' : 'Filtering OFF (click to enable)');
    }
    $('#sn-master-toggle').on('click', function () {
        settings.enabled = !settings.enabled;
        save();
        renderMasterToggle();
        syncSettingsPanel();
    });
    renderMasterToggle();

    // ----- tabs -----
    $drawer.on('click', '.sn-tab', function () {
        const tab = $(this).data('tab');
        $drawer.find('.sn-tab').removeClass('active');
        $(this).addClass('active');
        $drawer.find('.sn-panel').hide();
        $drawer.find(`.sn-panel[data-panel="${tab}"]`).show();
        if (tab === 'log') renderLog();
        if (tab === 'rules') renderRules();
        if (tab === 'appearance') renderAppearance();
        if (tab === 'more') renderMore();
    });

    // ----- log type filters -----
    const logTypeFilter = { success: true, info: true, warning: true, error: true, blocked: true };
    function renderTypeFilters() {
        const $c = $drawer.find('.sn-type-filters');
        $c.empty();
        const defs = [
            ['success', 'fa-circle-check'],
            ['info', 'fa-circle-info'],
            ['warning', 'fa-triangle-exclamation'],
            ['error', 'fa-circle-xmark'],
            ['blocked', 'fa-ban'],
        ];
        defs.forEach(([key, icon]) => {
            const $btn = $(`<div class="sn-filter-chip sn-chip-${key} ${logTypeFilter[key] ? 'on' : ''}" data-key="${key}" title="${key}"><i class="fa-solid ${icon}"></i></div>`);
            $btn.on('click', () => {
                logTypeFilter[key] = !logTypeFilter[key];
                $btn.toggleClass('on', logTypeFilter[key]);
                renderLog();
            });
            $c.append($btn);
        });
    }

    function fmtTime(ts) {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function renderLog() {
        const $list = $drawer.find('.sn-log-list');
        $list.empty();
        const items = notifLog.filter((e) => {
            if (e.blocked) return logTypeFilter.blocked;
            return logTypeFilter[e.type];
        });
        if (items.length === 0) {
            $list.html('<div class="sn-empty"><i class="fa-regular fa-bell-slash"></i><br>No notifications</div>');
            return;
        }
        items.forEach((e) => {
            const icon = ICONS[e.type] || 'fa-circle-info';
            const title = e.title ? `<div class="sn-log-title">${escapeHtml(e.title)}</div>` : '';
            const body = e.message ? `<div class="sn-log-msg">${escapeHtml(e.message)}</div>` : '';
            const blockedBadge = e.blocked ? '<span class="sn-blocked-badge"><i class="fa-solid fa-ban"></i> blocked</span>' : '';
            const rewrittenBadge = e.rewritten ? '<span class="sn-rewritten-badge"><i class="fa-solid fa-pen"></i> edited</span>' : '';
            const $row = $(`
                <div class="sn-log-item sn-type-${e.type} ${e.blocked ? 'sn-is-blocked' : ''}">
                    <div class="sn-log-icon"><i class="fa-solid ${icon}"></i></div>
                    <div class="sn-log-content">
                        ${title}${body}
                        <div class="sn-log-meta">${fmtTime(e.time)} ${blockedBadge} ${rewrittenBadge}</div>
                    </div>
                    <div class="sn-log-actions">
                        <div class="sn-icon-btn sn-quick-mute" title="Mute notifications like this"><i class="fa-solid fa-volume-xmark"></i></div>
                    </div>
                </div>
            `);
            $row.find('.sn-quick-mute').on('click', (ev) => {
                ev.stopPropagation();
                quickMuteFromEntry(e);
            });
            $list.append($row);
        });
    }

    // Create a mute rule from a log entry (uses its text)
    function quickMuteFromEntry(e) {
        const pattern = (e.text || '').trim();
        if (!pattern) {
            toastrSafe('warning', 'Cannot mute: empty notification text.', 'Smart Notify');
            return;
        }
        // avoid duplicates
        const exists = settings.rules.find((r) => !r.isRegex && r.action === 'mute' && r.pattern === pattern && r.type === e.type);
        if (exists) {
            toastrSafe('info', 'A matching mute rule already exists.', 'Smart Notify');
            return;
        }
        settings.rules.push({
            id: uid(),
            pattern,
            isRegex: false,
            type: e.type,
            action: 'mute',
            enabled: true,
            hits: 0,
        });
        save();
        toastrSafe('success', 'Muted. Future matches will be hidden.', 'Smart Notify');
        renderRules();
    }

    // Use original toastr so our own messages are never blocked
    function toastrSafe(type, msg, title) {
        try {
            const fn = original[type] || (typeof toastr !== 'undefined' ? toastr[type] : null);
            if (fn) fn.call(toastr, msg, title);
        } catch (e) { /* noop */ }
    }

    $drawer.on('click', '#sn-clear-log', function () {
        notifLog.length = 0;
        renderLog();
    });

    // Dump the whole log to console (handy for copying out of Termux).
    $drawer.on('click', '#sn-dump-console', function () {
        const lines = notifLog.slice().reverse().map((e) => {
            const ts = new Date(e.time).toLocaleTimeString();
            const status = e.blocked ? `BLOCKED${e.ruleId ? ' (' + e.ruleId + ')' : ''}` : 'SHOWN';
            const t = e.title ? ` | ${e.title}` : '';
            const m = e.message ? ` | ${e.message}` : '';
            return `[${ts}] ${e.type.toUpperCase()} ${status}${t}${m}`;
        });
        console.log(`${LOG_PREFIX} ===== LOG DUMP (${lines.length}) =====\n` + lines.join('\n') + `\n${LOG_PREFIX} ===== END DUMP =====`);
        toastrSafe('info', `Dumped ${lines.length} entries to console.`, 'Smart Notify');
    });

    // ----- rules -----
    function renderRules() {
        const $list = $drawer.find('.sn-rules-list');
        $list.empty();
        if (settings.rules.length === 0) {
            $list.html('<div class="sn-empty"><i class="fa-solid fa-filter"></i><br>No rules yet.<br><small>Add a rule above or use the mute button in the log.</small></div>');
            return;
        }
        settings.rules.forEach((r) => {
            const typeLabel = r.type === 'any' ? 'any' : r.type;
            const actionCls = r.action === 'allow' ? 'sn-rule-allow'
                            : r.action === 'rewrite' ? 'sn-rule-rewrite'
                            : 'sn-rule-mute';
            const actionIcon = r.action === 'allow' ? 'fa-eye'
                             : r.action === 'rewrite' ? 'fa-pen'
                             : 'fa-volume-xmark';
            const rewriteInfo = r.action === 'rewrite'
                ? `<div class="sn-rule-rewrite-to"><i class="fa-solid fa-arrow-right"></i> <code>${escapeHtml(r.replacement || '(removed)')}</code></div>`
                : '';
            const $row = $(`
                <div class="sn-rule-item ${r.enabled ? '' : 'sn-rule-off'} ${actionCls}">
                    <label class="sn-switch" title="Enable/disable rule">
                        <input type="checkbox" ${r.enabled ? 'checked' : ''} class="sn-rule-enabled" />
                        <span class="sn-slider"></span>
                    </label>
                    <div class="sn-rule-info">
                        <div class="sn-rule-pattern">
                            <i class="fa-solid ${actionIcon}"></i>
                            ${r.isRegex ? '<span class="sn-rule-regex-tag">.*</span> ' : ''}
                            <code>${escapeHtml(r.pattern || '(type only)')}</code>
                        </div>
                        ${rewriteInfo}
                        <div class="sn-rule-sub">${typeLabel} &middot; ${r.action} &middot; ${r.hits || 0} hits</div>
                    </div>
                    <div class="sn-icon-btn sn-rule-del" title="Delete rule"><i class="fa-solid fa-trash"></i></div>
                </div>
            `);
            $row.find('.sn-rule-enabled').on('change', function () {
                r.enabled = this.checked;
                save();
                $row.toggleClass('sn-rule-off', !r.enabled);
            });
            $row.find('.sn-rule-del').on('click', function () {
                const idx = settings.rules.findIndex((x) => x.id === r.id);
                if (idx >= 0) settings.rules.splice(idx, 1);
                save();
                renderRules();
            });
            $list.append($row);
        });
    }

    // show/hide the replacement field based on action
    $drawer.on('change', '#sn-rule-action', function () {
        $('#sn-rule-replacement').toggleClass('sn-hidden', this.value !== 'rewrite');
    });

    $drawer.on('click', '#sn-rule-add-btn', function () {
        const pattern = $('#sn-rule-pattern').val().trim();
        const type = $('#sn-rule-type').val();
        const action = $('#sn-rule-action').val();
        const isRegex = $('#sn-rule-regex').is(':checked');
        const replacement = $('#sn-rule-replacement').val();
        if (!pattern && type === 'any') {
            toastrSafe('warning', 'Enter a pattern or pick a specific type.', 'Smart Notify');
            return;
        }
        if (action === 'rewrite' && !pattern) {
            toastrSafe('warning', 'Rewrite rules need a pattern to match.', 'Smart Notify');
            return;
        }
        if (isRegex && pattern && !compileRegex(pattern)) {
            toastrSafe('error', 'Invalid regular expression.', 'Smart Notify');
            return;
        }
        settings.rules.push({ id: uid(), pattern, isRegex, type, action, replacement, enabled: true, hits: 0 });
        save();
        $('#sn-rule-pattern').val('');
        $('#sn-rule-replacement').val('');
        $('#sn-rule-regex').prop('checked', false);
        renderRules();
    });
    $drawer.on('keydown', '#sn-rule-pattern, #sn-rule-replacement', function (ev) {
        if (ev.key === 'Enter') $('#sn-rule-add-btn').trigger('click');
    });

    // ----- appearance panel (inside drawer) -----
    function renderAppearance() {
        const a = settings.appearance;
        const $f = $drawer.find('.sn-appearance-form');
        $f.html(`
            <label class="sn-checkbox sn-big-toggle">
                <input type="checkbox" id="sn-ap-override" ${a.override ? 'checked' : ''} />
                <span>Override toast appearance</span>
            </label>
            <div class="sn-ap-fields ${a.override ? '' : 'sn-disabled'}">
                <label>Position</label>
                <select class="text_pole" id="sn-ap-position">
                    <option value="toast-top-right">Top right</option>
                    <option value="toast-top-left">Top left</option>
                    <option value="toast-top-center">Top center</option>
                    <option value="toast-top-full-width">Top full width</option>
                    <option value="toast-bottom-right">Bottom right</option>
                    <option value="toast-bottom-left">Bottom left</option>
                    <option value="toast-bottom-center">Bottom center</option>
                    <option value="toast-bottom-full-width">Bottom full width</option>
                    <option value="custom">Custom (X / Y)</option>
                </select>
                <div class="sn-custom-pos ${a.position === 'custom' ? '' : 'sn-hidden'}">
                    <div class="sn-row2">
                        <div><label>X (px)</label><input type="number" class="text_pole" id="sn-ap-x" value="${a.customPosition ? a.customPosition.x : 20}" /></div>
                        <div><label>Y (px)</label><input type="number" class="text_pole" id="sn-ap-y" value="${a.customPosition ? a.customPosition.y : 20}" /></div>
                    </div>
                </div>
                <label>Width: <b id="sn-ap-width-val">${a.width}px</b></label>
                <input type="range" id="sn-ap-width" min="180" max="700" step="10" value="${a.width}" />
                <label>Font size: <b id="sn-ap-font-val">${a.fontSize}px</b></label>
                <input type="range" id="sn-ap-font" min="10" max="24" step="1" value="${a.fontSize}" />
                <label>Duration: <b id="sn-ap-dur-val">${(a.duration/1000).toFixed(1)}s</b> <small>(0 = sticky)</small></label>
                <input type="range" id="sn-ap-dur" min="0" max="20000" step="500" value="${a.duration}" />
                <label>Opacity: <b id="sn-ap-op-val">${Math.round(a.opacity*100)}%</b></label>
                <input type="range" id="sn-ap-op" min="0.2" max="1" step="0.05" value="${a.opacity}" />

                <hr>
                <label class="sn-checkbox">
                    <input type="checkbox" id="sn-ap-color" ${a.colorOverride ? 'checked' : ''} />
                    <span>Override colors / theme</span>
                </label>
                <div class="sn-ap-color-fields ${a.colorOverride ? '' : 'sn-disabled'}">
                    <div class="sn-row2">
                        <div><label>Background</label><input type="color" id="sn-ap-bg" value="${a.bgColor}" /></div>
                        <div><label>Text</label><input type="color" id="sn-ap-text" value="${a.textColor}" /></div>
                    </div>
                    <div class="sn-row2">
                        <div><label>Border</label><input type="color" id="sn-ap-border" value="${a.borderColor}" /></div>
                        <div><label>Border width: <b id="sn-ap-bw-val">${a.borderWidth}px</b></label>
                            <input type="range" id="sn-ap-bw" min="0" max="6" step="1" value="${a.borderWidth}" /></div>
                    </div>
                    <label>Corner radius: <b id="sn-ap-br-val">${a.borderRadius}px</b></label>
                    <input type="range" id="sn-ap-br" min="0" max="24" step="1" value="${a.borderRadius}" />
                </div>

                <div class="sn-ap-buttons">
                    <div class="menu_button" id="sn-ap-test"><i class="fa-solid fa-vial"></i> Test toast</div>
                    <div class="menu_button" id="sn-ap-reset"><i class="fa-solid fa-rotate-left"></i> Reset</div>
                </div>
            </div>
        `);
        $('#sn-ap-position').val(a.position);

        const refreshDisabled = () => {
            $f.find('.sn-ap-fields').toggleClass('sn-disabled', !settings.appearance.override);
        };

        $('#sn-ap-override').on('change', function () {
            a.override = this.checked;
            applyAppearanceCss(); save(); refreshDisabled();
        });
        $('#sn-ap-position').on('change', function () {
            a.position = this.value;
            $f.find('.sn-custom-pos').toggleClass('sn-hidden', a.position !== 'custom');
            applyAppearanceCss(); save();
        });
        $('#sn-ap-x').on('input', function () {
            a.customPosition = a.customPosition || { x: 20, y: 20 };
            a.customPosition.x = parseInt(this.value) || 0; applyAppearanceCss(); save();
        });
        $('#sn-ap-y').on('input', function () {
            a.customPosition = a.customPosition || { x: 20, y: 20 };
            a.customPosition.y = parseInt(this.value) || 0; applyAppearanceCss(); save();
        });
        $('#sn-ap-width').on('input', function () {
            a.width = parseInt(this.value); $('#sn-ap-width-val').text(a.width + 'px'); applyAppearanceCss(); save();
        });
        $('#sn-ap-font').on('input', function () {
            a.fontSize = parseInt(this.value); $('#sn-ap-font-val').text(a.fontSize + 'px'); applyAppearanceCss(); save();
        });
        $('#sn-ap-dur').on('input', function () {
            a.duration = parseInt(this.value); $('#sn-ap-dur-val').text((a.duration/1000).toFixed(1) + 's'); save();
        });
        $('#sn-ap-op').on('input', function () {
            a.opacity = parseFloat(this.value); $('#sn-ap-op-val').text(Math.round(a.opacity*100) + '%'); applyAppearanceCss(); save();
        });
        const refreshColorDisabled = () => {
            $f.find('.sn-ap-color-fields').toggleClass('sn-disabled', !a.colorOverride);
        };
        $('#sn-ap-color').on('change', function () {
            a.colorOverride = this.checked; applyAppearanceCss(); save(); refreshColorDisabled();
        });
        $('#sn-ap-bg').on('input', function () { a.bgColor = this.value; applyAppearanceCss(); save(); });
        $('#sn-ap-text').on('input', function () { a.textColor = this.value; applyAppearanceCss(); save(); });
        $('#sn-ap-border').on('input', function () { a.borderColor = this.value; applyAppearanceCss(); save(); });
        $('#sn-ap-bw').on('input', function () {
            a.borderWidth = parseInt(this.value); $('#sn-ap-bw-val').text(a.borderWidth + 'px'); applyAppearanceCss(); save();
        });
        $('#sn-ap-br').on('input', function () {
            a.borderRadius = parseInt(this.value); $('#sn-ap-br-val').text(a.borderRadius + 'px'); applyAppearanceCss(); save();
        });
        $('#sn-ap-test').on('click', function () {
            // bypass blocking; show with current appearance
            const merged = Object.assign({}, appearanceOptions());
            if (original.info) original.info.call(toastr, 'This is a Smart Notify test toast.', 'Preview', merged);
        });
        $('#sn-ap-reset').on('click', function () {
            settings.appearance = mergeSettings(defaultSettings.appearance, {});
            applyAppearanceCss(); save(); renderAppearance();
        });
    }

    // ----- More panel (console mirror, anti-spam, import/export) -----
    function renderMore() {
        const c = settings.console;
        const rl = settings.rateLimit;
        const $m = $drawer.find('.sn-more-form');
        $m.html(`
            <div class="sn-section-title"><i class="fa-solid fa-terminal"></i> Console mirror <small>(devtools / Termux)</small></div>
            <label class="sn-checkbox sn-big-toggle">
                <input type="checkbox" id="sn-con-mirror" ${c.mirror ? 'checked' : ''} />
                <span>Mirror notifications to console (full text)</span>
            </label>
            <div class="sn-con-fields ${c.mirror ? '' : 'sn-disabled'}">
                <label>Which to log</label>
                <select class="text_pole" id="sn-con-level">
                    <option value="all">All (shown + blocked)</option>
                    <option value="shown">Only shown</option>
                    <option value="blocked">Only blocked</option>
                </select>
                <small class="sn-hint">On PC this is the browser console; on phone it's the Termux/server log.</small>
            </div>

            <hr>
            <div class="sn-section-title"><i class="fa-solid fa-gauge-high"></i> Anti-spam</div>
            <label class="sn-checkbox">
                <input type="checkbox" id="sn-rl-dedupe" ${rl.dedupeBurst ? 'checked' : ''} />
                <span>Drop identical toasts fired in a burst</span>
            </label>
            <div class="sn-rl-fields ${rl.dedupeBurst ? '' : 'sn-disabled'}">
                <label>Dedupe window: <b id="sn-rl-dw-val">${(rl.dedupeWindow/1000).toFixed(1)}s</b></label>
                <input type="range" id="sn-rl-dw" min="500" max="15000" step="500" value="${rl.dedupeWindow}" />
            </div>
            <label class="sn-checkbox">
                <input type="checkbox" id="sn-rl-throttle" ${rl.throttle ? 'checked' : ''} />
                <span>Throttle total toast rate</span>
            </label>
            <div class="sn-rlt-fields ${rl.throttle ? '' : 'sn-disabled'}">
                <label>Max: <b id="sn-rl-max-val">${rl.throttleMax}</b> toast(s) per <b id="sn-rl-tw-val">${(rl.throttleWindow/1000).toFixed(1)}s</b></label>
                <input type="range" id="sn-rl-max" min="1" max="20" step="1" value="${rl.throttleMax}" />
                <input type="range" id="sn-rl-tw" min="1000" max="30000" step="500" value="${rl.throttleWindow}" />
            </div>

            <hr>
            <div class="sn-section-title"><i class="fa-solid fa-file-arrow-down"></i> Backup</div>
            <small class="sn-hint">Export/import rules + all settings as JSON.</small>
            <div class="sn-ap-buttons">
                <div class="menu_button" id="sn-export"><i class="fa-solid fa-download"></i> Export</div>
                <div class="menu_button" id="sn-import"><i class="fa-solid fa-upload"></i> Import</div>
            </div>
            <input type="file" id="sn-import-file" accept="application/json,.json" class="sn-hidden" />
        `);
        $('#sn-con-level').val(c.level);

        const refreshConDisabled = () => $m.find('.sn-con-fields').toggleClass('sn-disabled', !c.mirror);
        $('#sn-con-mirror').on('change', function () { c.mirror = this.checked; save(); refreshConDisabled(); });
        $('#sn-con-level').on('change', function () { c.level = this.value; save(); });

        $('#sn-rl-dedupe').on('change', function () {
            rl.dedupeBurst = this.checked; save();
            $m.find('.sn-rl-fields').toggleClass('sn-disabled', !rl.dedupeBurst);
        });
        $('#sn-rl-dw').on('input', function () {
            rl.dedupeWindow = parseInt(this.value) || 3000; $('#sn-rl-dw-val').text((rl.dedupeWindow/1000).toFixed(1)+'s'); save();
        });
        $('#sn-rl-throttle').on('change', function () {
            rl.throttle = this.checked; save();
            $m.find('.sn-rlt-fields').toggleClass('sn-disabled', !rl.throttle);
        });
        $('#sn-rl-max').on('input', function () {
            rl.throttleMax = parseInt(this.value) || 5; $('#sn-rl-max-val').text(rl.throttleMax); save();
        });
        $('#sn-rl-tw').on('input', function () {
            rl.throttleWindow = parseInt(this.value) || 5000; $('#sn-rl-tw-val').text((rl.throttleWindow/1000).toFixed(1)+'s'); save();
        });

        $('#sn-export').on('click', exportConfig);
        $('#sn-import').on('click', () => $('#sn-import-file').trigger('click'));
        $('#sn-import-file').on('change', function () {
            const file = this.files && this.files[0];
            if (file) importConfig(file);
            this.value = '';
        });
    }

    // ----- Export / import -----
    function exportConfig() {
        const data = {
            __smartNotify: true,
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: JSON.parse(JSON.stringify(settings)),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `smart-notify-config-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toastrSafe('success', 'Config exported.', 'Smart Notify');
    }

    function importConfig(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result));
                const incoming = data && data.settings ? data.settings : data;
                if (!incoming || typeof incoming !== 'object') throw new Error('bad file');
                const merged = mergeSettings(defaultSettings, incoming);
                Object.keys(merged).forEach((k) => { settings[k] = merged[k]; });
                save();
                applyAppearanceCss();
                renderMasterToggle();
                renderLog();
                renderRules();
                renderAppearance();
                renderMore();
                syncSettingsPanel();
                toastrSafe('success', 'Config imported.', 'Smart Notify');
            } catch (e) {
                console.error(`${LOG_PREFIX} import failed:`, e);
                toastrSafe('error', 'Import failed: invalid file.', 'Smart Notify');
            }
        };
        reader.readAsText(file);
    }

    // Keep the (optional) Extensions settings panel in sync
    function syncSettingsPanel() {
        $('#smart_notify_enabled').prop('checked', settings.enabled);
        $('#smart_notify_autoopen').prop('checked', settings.autoOpenOnNew);
        $('#smart_notify_console_mirror').prop('checked', settings.console.mirror);
        TOAST_TYPES.forEach((t) => {
            $(`#smart_notify_mute_${t}`).prop('checked', settings.muteTypes[t]);
        });
    }

    // ---------------------------------------------------------------------
    // New-notification reactions (badge + auto open)
    // ---------------------------------------------------------------------
    logListeners.add(() => {
        if (!drawerOpen) { unseen++; updateBadge(false); }
        if (drawerOpen) {
            // re-render the visible panel that depends on the log
            const activeTab = $drawer.find('.sn-tab.active').data('tab');
            if (activeTab === 'log') renderLog();
            if (activeTab === 'rules') renderRules(); // hit counts may change
        }
    });

    // ---------------------------------------------------------------------
    // Extensions settings panel wiring (settings.html injected by ST)
    // ---------------------------------------------------------------------
    function wireSettingsPanel() {
        const $enabled = $('#smart_notify_enabled');
        if ($enabled.length === 0) return false; // not injected yet
        $enabled.prop('checked', settings.enabled).off('change.sn').on('change.sn', function () {
            settings.enabled = this.checked; save(); renderMasterToggle();
        });
        TOAST_TYPES.forEach((t) => {
            const $c = $(`#smart_notify_mute_${t}`);
            $c.prop('checked', settings.muteTypes[t]).off('change.sn').on('change.sn', function () {
                settings.muteTypes[t] = this.checked; save();
            });
        });
        $('#smart_notify_open_drawer').off('click.sn').on('click.sn', openDrawer);
        $('#smart_notify_autoopen').prop('checked', settings.autoOpenOnNew).off('change.sn').on('change.sn', function () {
            settings.autoOpenOnNew = this.checked; save();
        });
        $('#smart_notify_console_mirror').prop('checked', settings.console.mirror).off('change.sn').on('change.sn', function () {
            settings.console.mirror = this.checked; save();
        });
        return true;
    }

    // Inject settings.html into the Extensions settings panel, then wire it up.
    const extPath = 'scripts/extensions/third-party/' + MODULE_NAME;
    let wireTimer = null;
    (async function injectSettings() {
        let html = '';
        try { html = await $.get(extPath + '/settings.html'); } catch (e) { html = ''; }
        if (html) {
            const rp = $('#extensions_settings2');
            const lp = $('#extensions_settings');
            if (rp.length) rp.append(html);
            else if (lp.length) lp.append(html);
        }
        // The panel may still be settling; retry wiring briefly.
        let tries = 0;
        wireTimer = setInterval(() => {
            if (wireSettingsPanel() || ++tries > 20) clearInterval(wireTimer);
        }, 300);
    })();

    // ---------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------
    renderTypeFilters();
    renderMasterToggle();
    applyAppearanceCss();
    renderLog();

    console.log(`${LOG_PREFIX} initialized.`);

    // ---------------------------------------------------------------------
    // Dispose (for hot-reload)
    // ---------------------------------------------------------------------
    window.__smartNotifyDispose = function () {
        try { restoreToastr(); } catch (e) { /* noop */ }
        clearInterval(wireTimer);
        clearInterval(wandTimer);
        $('#smart-notify-modal, #smart-notify-toast-style, #smart_notify_wand_button').remove();
        $('.smart-notify-settings').remove();
        document.body.classList.remove('sn-modal-open');
        window.__smartNotifyInitialized = false;
    };
});
