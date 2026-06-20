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
        // rules: [{ id, pattern, isRegex, type ('any'|success|...), action ('mute'|'allow'), enabled, hits }]
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

    // Returns true if the notification should be BLOCKED (not shown).
    function shouldBlock(type, text) {
        if (!settings.enabled) return false;

        // explicit allow rules win over everything else
        let blockedByRule = false;
        let matchedRuleId = null;
        for (const rule of settings.rules) {
            if (ruleMatches(rule, type, text)) {
                if (rule.action === 'allow') {
                    rule.hits = (rule.hits || 0) + 1;
                    return false; // force allow
                }
                if (rule.action === 'mute') {
                    blockedByRule = true;
                    matchedRuleId = rule.id;
                }
            }
        }
        if (blockedByRule) {
            const r = settings.rules.find((x) => x.id === matchedRuleId);
            if (r) r.hits = (r.hits || 0) + 1;
            return matchedRuleId;
        }

        // global type mute
        if (settings.muteTypes[type]) return 'type:' + type;

        return false;
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
                const text = toPlainText(message) || toPlainText(title);
                const blockResult = shouldBlock(type, text);
                const entry = {
                    id: uid(),
                    type,
                    title: toPlainText(title),
                    message: toPlainText(message),
                    text,
                    time: Date.now(),
                    blocked: !!blockResult,
                    ruleId: (typeof blockResult === 'string') ? blockResult : null,
                };
                pushLog(entry);

                if (blockResult) {
                    if (settings.autoOpenOnNew) { /* still don't open for blocked */ }
                    return null; // swallow
                }

                const merged = Object.assign({}, appearanceOptions(), optionsOverride || {});
                if (settings.autoOpenOnNew) openDrawer();
                return original[type].call(this, message, title, merged);
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

    // Trigger button (floating action button)
    const $fab = $(`
        <div id="smart-notify-fab" title="Smart Notify">
            <i class="fa-solid fa-bell"></i>
            <span class="sn-fab-badge" style="display:none;">0</span>
        </div>
    `);
    $('body').append($fab);

    const $overlay = $('<div id="smart-notify-overlay"></div>');
    $('body').append($overlay);

    const $drawer = $(`
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
            </div>
            <div class="sn-body">
                <div class="sn-panel" data-panel="log">
                    <div class="sn-toolbar">
                        <div class="sn-type-filters"></div>
                        <div class="sn-icon-btn" id="sn-clear-log" title="Clear log"><i class="fa-solid fa-trash"></i></div>
                    </div>
                    <div class="sn-log-list"></div>
                </div>
                <div class="sn-panel" data-panel="rules" style="display:none;">
                    <div class="sn-rule-add">
                        <input type="text" class="text_pole" id="sn-rule-pattern" placeholder="Text or /regex/i to match..." />
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
            </div>
        </div>
    `);
    $('body').append($drawer);

    let drawerOpen = false;
    function openDrawer() {
        drawerOpen = true;
        $drawer.addClass('open');
        $overlay.addClass('show');
        renderLog();
        updateBadge(true);
    }
    function closeDrawer() {
        drawerOpen = false;
        $drawer.removeClass('open');
        $overlay.removeClass('show');
    }
    function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }

    $fab.on('click', toggleDrawer);
    $overlay.on('click', closeDrawer);
    $drawer.on('click', '#sn-close', closeDrawer);

    // ----- badge (unseen count) -----
    let unseen = 0;
    function updateBadge(reset) {
        if (reset) unseen = 0;
        const $b = $fab.find('.sn-fab-badge');
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
            const $row = $(`
                <div class="sn-log-item sn-type-${e.type} ${e.blocked ? 'sn-is-blocked' : ''}">
                    <div class="sn-log-icon"><i class="fa-solid ${icon}"></i></div>
                    <div class="sn-log-content">
                        ${title}${body}
                        <div class="sn-log-meta">${fmtTime(e.time)} ${blockedBadge}</div>
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
            const actionCls = r.action === 'allow' ? 'sn-rule-allow' : 'sn-rule-mute';
            const actionIcon = r.action === 'allow' ? 'fa-eye' : 'fa-volume-xmark';
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

    $drawer.on('click', '#sn-rule-add-btn', function () {
        const pattern = $('#sn-rule-pattern').val().trim();
        const type = $('#sn-rule-type').val();
        const action = $('#sn-rule-action').val();
        const isRegex = $('#sn-rule-regex').is(':checked');
        if (!pattern && type === 'any') {
            toastrSafe('warning', 'Enter a pattern or pick a specific type.', 'Smart Notify');
            return;
        }
        if (isRegex && pattern && !compileRegex(pattern)) {
            toastrSafe('error', 'Invalid regular expression.', 'Smart Notify');
            return;
        }
        settings.rules.push({ id: uid(), pattern, isRegex, type, action, enabled: true, hits: 0 });
        save();
        $('#sn-rule-pattern').val('');
        $('#sn-rule-regex').prop('checked', false);
        renderRules();
    });
    $drawer.on('keydown', '#sn-rule-pattern', function (ev) {
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

    // Keep the (optional) Extensions settings panel in sync
    function syncSettingsPanel() {
        $('#smart_notify_enabled').prop('checked', settings.enabled);
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
        $('#smart-notify-fab, #smart-notify-drawer, #smart-notify-overlay, #smart-notify-toast-style').remove();
        $('.smart-notify-settings').remove();
        window.__smartNotifyInitialized = false;
    };
});
