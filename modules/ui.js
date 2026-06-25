/* Drawer UI: panels, renders, and all in-panel interactions. */
import { LOG_PREFIX, TOAST_TYPES, ICONS, escapeHtml, uid } from './constants.js';
import { getSettings, save, defaultSettings, mergeSettings } from './settings.js';
import { t, i18nApplyDom } from './i18n.js';
import { compileRegex } from './rules.js';
import { notifLog, logListeners, clearLog } from './log.js';
import { syncConsoleCapture } from './console-capture.js';
import {
    applyAppearanceCss, appearanceOptions,
    startPositionDrag, stopPositionDrag, isDragging,
} from './appearance.js';

/**
 * Initialise the drawer UI.
 * @param {object} deps - { original } where original holds the unwrapped toastr fns.
 * @returns controller { openDrawer, closeDrawer, toggleDrawer, renderMasterToggle,
 *                       syncSettingsPanel, dispose, isOpen, bumpBadge, $modal }
 */
export function initUI(deps) {
    const { original } = deps;

    // Use original toastr so our own messages are never blocked.
    function toastrSafe(type, msg, title) {
        try {
            const fn = original[type] || (typeof toastr !== 'undefined' ? toastr[type] : null);
            if (fn) fn.call(toastr, msg, title);
        } catch (e) { /* noop */ }
    }

    // -----------------------------------------------------------------
    // Modal shell
    // -----------------------------------------------------------------
    const $modal = $(`
        <div id="smart-notify-modal" class="sn-hidden">
            <div id="smart-notify-backdrop"></div>
            <div id="smart-notify-drawer">
                <div class="sn-header">
                    <div class="sn-title"><i class="fa-solid fa-bell"></i> <span data-i18n="panel.title">Smart Notify</span></div>
                    <div class="sn-header-actions">
                        <div class="sn-icon-btn" id="sn-master-toggle" data-i18n-title="panel.masterToggle" title="Enable/disable filtering"></div>
                        <div class="sn-icon-btn" id="sn-close" data-i18n-title="panel.close" title="Close"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                </div>
                <div class="sn-tabs">
                    <div class="sn-tab active" data-tab="log"><i class="fa-solid fa-list"></i> <span data-i18n="tab.log">Log</span></div>
                    <div class="sn-tab" data-tab="rules"><i class="fa-solid fa-filter"></i> <span data-i18n="tab.rules">Rules</span></div>
                    <div class="sn-tab" data-tab="appearance"><i class="fa-solid fa-palette"></i> <span data-i18n="tab.look">Look</span></div>
                    <div class="sn-tab" data-tab="more"><i class="fa-solid fa-sliders"></i> <span data-i18n="tab.more">More</span></div>
                </div>
                <div class="sn-body">
                    <div class="sn-panel" data-panel="log">
                        <div class="sn-toolbar">
                            <div class="sn-type-filters"></div>
                            <div class="sn-toolbar-actions">
                                <div class="sn-icon-btn" id="sn-dump-console" data-i18n-title="log.dumpConsole" title="Dump log to console"><i class="fa-solid fa-terminal"></i></div>
                                <div class="sn-icon-btn" id="sn-clear-log" data-i18n-title="log.clear" title="Clear log"><i class="fa-solid fa-trash"></i></div>
                            </div>
                        </div>
                        <div class="sn-search-row">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input type="text" class="text_pole" id="sn-log-search" data-i18n-placeholder="log.searchPh" placeholder="Search log..." />
                            <div class="sn-icon-btn sn-hidden" id="sn-log-search-clear" data-i18n-title="log.searchClear" title="Clear search"><i class="fa-solid fa-xmark"></i></div>
                        </div>
                        <div class="sn-log-list"></div>
                    </div>
                    <div class="sn-panel" data-panel="rules" style="display:none;">
                        <div class="sn-rule-add">
                            <input type="text" class="text_pole" id="sn-rule-pattern" data-i18n-placeholder="rules.patternPh" placeholder="Text or /regex/i to match..." />
                            <input type="text" class="text_pole sn-hidden" id="sn-rule-replacement" data-i18n-placeholder="rules.replacementPh" placeholder="Replacement text (use $1 for regex groups)..." />
                            <div class="sn-rule-add-row">
                                <select class="text_pole" id="sn-rule-type">
                                    <option value="any" data-i18n="rules.typeAny">Any type</option>
                                    <option value="success" data-i18n="rules.typeSuccess">Success</option>
                                    <option value="info" data-i18n="rules.typeInfo">Info</option>
                                    <option value="warning" data-i18n="rules.typeWarning">Warning</option>
                                    <option value="error" data-i18n="rules.typeError">Error</option>
                                </select>
                                <select class="text_pole" id="sn-rule-action">
                                    <option value="mute" data-i18n="rules.actionMute">Mute (block)</option>
                                    <option value="allow" data-i18n="rules.actionAllow">Allow (force show)</option>
                                    <option value="rewrite" data-i18n="rules.actionRewrite">Rewrite text</option>
                                </select>
                                <label class="sn-checkbox" data-i18n-title="rules.regexTitle" title="Treat pattern as regex">
                                    <input type="checkbox" id="sn-rule-regex" /> <span>.*</span>
                                </label>
                                <div class="menu_button" id="sn-rule-add-btn"><i class="fa-solid fa-plus"></i> <span data-i18n="rules.add">Add</span></div>
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
    i18nApplyDom($modal);

    const $drawer = $modal.find('#smart-notify-drawer');

    let drawerOpen = false;
    let openedAt = 0;
    let logSearch = '';

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
        stopPositionDrag();
    }
    function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }

    $modal.find('#smart-notify-backdrop').on('click', function () {
        if (Date.now() - openedAt < 300) return;
        closeDrawer();
    });
    $modal.on('click', '#sn-close', function (e) {
        e.preventDefault(); e.stopPropagation(); closeDrawer();
    });

    // ----- master toggle -----
    function renderMasterToggle() {
        const settings = getSettings();
        const $t = $('#sn-master-toggle');
        $t.html(settings.enabled
            ? '<i class="fa-solid fa-shield-halved" style="color:var(--SmartGreen,#5cb85c)"></i>'
            : '<i class="fa-solid fa-shield" style="opacity:.4"></i>');
        $t.attr('title', settings.enabled ? t('panel.masterOn') : t('panel.masterOff'));
    }
    $('#sn-master-toggle').on('click', function () {
        const settings = getSettings();
        settings.enabled = !settings.enabled;
        save();
        renderMasterToggle();
        syncSettingsPanel();
    });

    // ----- tabs -----
    $drawer.on('click', '.sn-tab', function () {
        const tab = $(this).data('tab');
        $drawer.find('.sn-tab').removeClass('active');
        $(this).addClass('active');
        $drawer.find('.sn-panel').hide();
        $drawer.find(`.sn-panel[data-panel="${tab}"]`).show();
        if (tab !== 'appearance') stopPositionDrag();
        if (tab === 'log') renderLog();
        if (tab === 'rules') renderRules();
        if (tab === 'appearance') renderAppearance();
        if (tab === 'more') renderMore();
    });

    // ----- log type filters -----
    const logTypeFilter = { success: true, info: true, warning: true, error: true, blocked: true, console: true };
    function renderTypeFilters() {
        const $c = $drawer.find('.sn-type-filters');
        $c.empty();
        const defs = [
            ['success', 'fa-circle-check'],
            ['info', 'fa-circle-info'],
            ['warning', 'fa-triangle-exclamation'],
            ['error', 'fa-circle-xmark'],
            ['blocked', 'fa-ban'],
            ['console', 'fa-terminal'],
        ];
        defs.forEach(([key, icon]) => {
            const $btn = $(`<div class="sn-filter-chip sn-chip-${key} ${logTypeFilter[key] ? 'on' : ''}" data-key="${key}" title="${escapeHtml(t('filter.' + key))}"><i class="fa-solid ${icon}"></i></div>`);
            $btn.on('click', () => {
                logTypeFilter[key] = !logTypeFilter[key];
                $btn.toggleClass('on', logTypeFilter[key]);
                renderLog();
            });
            $c.append($btn);
        });
    }

    // ----- log search -----
    $drawer.on('input', '#sn-log-search', function () {
        logSearch = this.value || '';
        $('#sn-log-search-clear').toggleClass('sn-hidden', logSearch === '');
        renderLog();
    });
    $drawer.on('click', '#sn-log-search-clear', function () {
        logSearch = '';
        $('#sn-log-search').val('');
        $(this).addClass('sn-hidden');
        renderLog();
    });

    function fmtTime(ts) {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function matchesSearch(e, q) {
        if (!q) return true;
        const needle = q.toLowerCase();
        return (e.title || '').toLowerCase().includes(needle)
            || (e.message || '').toLowerCase().includes(needle)
            || (e.text || '').toLowerCase().includes(needle);
    }

    function renderLog() {
        const $list = $drawer.find('.sn-log-list');
        $list.empty();
        const q = logSearch.trim();
        const items = notifLog.filter((e) => {
            if (!matchesSearch(e, q)) return false;
            if (e.source === 'console') return logTypeFilter.console;
            if (e.blocked) return logTypeFilter.blocked;
            return logTypeFilter[e.type];
        });
        if (items.length === 0) {
            const msg = q ? t('log.noMatches') : t('log.empty');
            $list.html(`<div class="sn-empty"><i class="fa-regular fa-bell-slash"></i><br>${escapeHtml(msg)}</div>`);
            return;
        }
        items.forEach((e) => {
            const isConsole = e.source === 'console';
            const icon = isConsole ? 'fa-terminal' : (ICONS[e.type] || 'fa-circle-info');
            const title = e.title ? `<div class="sn-log-title">${escapeHtml(e.title)}</div>` : '';
            const body = e.message ? `<div class="sn-log-msg ${isConsole ? 'sn-log-console-body' : ''}">${escapeHtml(e.message)}</div>` : '';
            const blockedBadge = e.blocked ? `<span class="sn-blocked-badge"><i class="fa-solid fa-ban"></i> ${escapeHtml(t('log.blocked'))}</span>` : '';
            const rewrittenBadge = e.rewritten ? `<span class="sn-rewritten-badge"><i class="fa-solid fa-pen"></i> ${escapeHtml(t('log.edited'))}</span>` : '';
            const countBadge = (e.count && e.count > 1)
                ? `<span class="sn-count-badge" title="${escapeHtml(t('log.repeated'))}">\u00d7${e.count}</span>`
                : '';
            const consoleBadge = isConsole
                ? `<span class="sn-console-badge"><i class="fa-solid fa-terminal"></i> console.${e.consoleLevel || 'log'}</span>`
                : '';
            const actions = isConsole
                ? `<div class="sn-icon-btn sn-quick-copy" title="${escapeHtml(t('log.copyFull'))}"><i class="fa-solid fa-copy"></i></div>`
                : `<div class="sn-icon-btn sn-quick-mute" title="${escapeHtml(t('log.muteLike'))}"><i class="fa-solid fa-volume-xmark"></i></div>`;
            const $row = $(`
                <div class="sn-log-item sn-type-${e.type} ${e.blocked ? 'sn-is-blocked' : ''} ${isConsole ? 'sn-is-console' : ''}">
                    <div class="sn-log-icon"><i class="fa-solid ${icon}"></i></div>
                    <div class="sn-log-content">
                        <div class="sn-log-head">${title}${countBadge}</div>
                        ${body}
                        <div class="sn-log-meta">${fmtTime(e.time)} ${consoleBadge} ${blockedBadge} ${rewrittenBadge}</div>
                    </div>
                    <div class="sn-log-actions">${actions}</div>
                </div>
            `);
            $row.find('.sn-quick-mute').on('click', (ev) => { ev.stopPropagation(); quickMuteFromEntry(e); });
            $row.find('.sn-quick-copy').on('click', (ev) => { ev.stopPropagation(); copyText(e.text || ''); });
            $list.append($row);
        });
    }

    function quickMuteFromEntry(e) {
        const settings = getSettings();
        const pattern = (e.text || '').trim();
        if (!pattern) { toastrSafe('warning', t('toast.cannotMuteEmpty'), t('app')); return; }
        const exists = settings.rules.find((r) => !r.isRegex && r.action === 'mute' && r.pattern === pattern && r.type === e.type);
        if (exists) { toastrSafe('info', t('toast.muteExists'), t('app')); return; }
        settings.rules.push({ id: uid(), pattern, isRegex: false, type: e.type, action: 'mute', enabled: true, hits: 0 });
        save();
        toastrSafe('success', t('toast.muted'), t('app'));
        renderRules();
    }

    function copyText(text) {
        const done = () => toastrSafe('success', t('toast.copied'), t('app'));
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(fallback);
                return;
            }
        } catch (e) { /* fall through */ }
        fallback();
        function fallback() {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                done();
            } catch (e) { toastrSafe('error', t('toast.copyFailed'), t('app')); }
        }
    }

    $drawer.on('click', '#sn-clear-log', function () { clearLog(); renderLog(); });

    $drawer.on('click', '#sn-dump-console', function () {
        const lines = notifLog.slice().reverse().map((e) => {
            const ts = new Date(e.time).toLocaleTimeString();
            const status = e.blocked ? `BLOCKED${e.ruleId ? ' (' + e.ruleId + ')' : ''}` : 'SHOWN';
            const rep = (e.count && e.count > 1) ? ` x${e.count}` : '';
            const ttl = e.title ? ` | ${e.title}` : '';
            const m = e.message ? ` | ${e.message}` : '';
            return `[${ts}] ${e.type.toUpperCase()} ${status}${rep}${ttl}${m}`;
        });
        console.log(`${LOG_PREFIX} ===== LOG DUMP (${lines.length}) =====\n` + lines.join('\n') + `\n${LOG_PREFIX} ===== END DUMP =====`);
        toastrSafe('info', t('toast.dumped', { count: lines.length }), t('app'));
    });

    // ----- rules -----
    function renderRules() {
        const settings = getSettings();
        const $list = $drawer.find('.sn-rules-list');
        $list.empty();
        if (settings.rules.length === 0) {
            $list.html(`<div class="sn-empty"><i class="fa-solid fa-filter"></i><br>${escapeHtml(t('rules.empty'))}<br><small>${escapeHtml(t('rules.emptyHint'))}</small></div>`);
            return;
        }
        settings.rules.forEach((r) => {
            const typeLabel = r.type === 'any' ? t('rules.typeAny') : r.type;
            const actionCls = r.action === 'allow' ? 'sn-rule-allow'
                            : r.action === 'rewrite' ? 'sn-rule-rewrite'
                            : 'sn-rule-mute';
            const actionIcon = r.action === 'allow' ? 'fa-eye'
                             : r.action === 'rewrite' ? 'fa-pen'
                             : 'fa-volume-xmark';
            const rewriteInfo = r.action === 'rewrite'
                ? `<div class="sn-rule-rewrite-to"><i class="fa-solid fa-arrow-right"></i> <code>${escapeHtml(r.replacement || t('rules.removed'))}</code></div>`
                : '';
            const actionLabel = r.action === 'allow' ? t('rules.actionAllow')
                              : r.action === 'rewrite' ? t('rules.actionRewrite')
                              : t('rules.actionMute');
            const $row = $(`
                <div class="sn-rule-item ${r.enabled ? '' : 'sn-rule-off'} ${actionCls}">
                    <label class="sn-switch" title="${escapeHtml(t('rules.enableTitle'))}">
                        <input type="checkbox" ${r.enabled ? 'checked' : ''} class="sn-rule-enabled" />
                        <span class="sn-slider"></span>
                    </label>
                    <div class="sn-rule-info">
                        <div class="sn-rule-pattern">
                            <i class="fa-solid ${actionIcon}"></i>
                            ${r.isRegex ? '<span class="sn-rule-regex-tag">.*</span> ' : ''}
                            <code>${escapeHtml(r.pattern || t('rules.typeOnly'))}</code>
                        </div>
                        ${rewriteInfo}
                        <div class="sn-rule-sub">${escapeHtml(typeLabel)} &middot; ${escapeHtml(actionLabel)} &middot; ${r.hits || 0} ${escapeHtml(t('rules.hits'))}</div>
                    </div>
                    <div class="sn-icon-btn sn-rule-del" title="${escapeHtml(t('rules.deleteTitle'))}"><i class="fa-solid fa-trash"></i></div>
                </div>
            `);
            $row.find('.sn-rule-enabled').on('change', function () {
                r.enabled = this.checked; save();
                $row.toggleClass('sn-rule-off', !r.enabled);
            });
            $row.find('.sn-rule-del').on('click', function () {
                const idx = settings.rules.findIndex((x) => x.id === r.id);
                if (idx >= 0) settings.rules.splice(idx, 1);
                save(); renderRules();
            });
            $list.append($row);
        });
    }

    $drawer.on('change', '#sn-rule-action', function () {
        $('#sn-rule-replacement').toggleClass('sn-hidden', this.value !== 'rewrite');
    });

    $drawer.on('click', '#sn-rule-add-btn', function () {
        const settings = getSettings();
        const pattern = $('#sn-rule-pattern').val().trim();
        const type = $('#sn-rule-type').val();
        const action = $('#sn-rule-action').val();
        const isRegex = $('#sn-rule-regex').is(':checked');
        const replacement = $('#sn-rule-replacement').val();
        if (!pattern && type === 'any') { toastrSafe('warning', t('toast.needPattern'), t('app')); return; }
        if (action === 'rewrite' && !pattern) { toastrSafe('warning', t('toast.rewriteNeedsPattern'), t('app')); return; }
        if (isRegex && pattern && !compileRegex(pattern)) { toastrSafe('error', t('toast.invalidRegex'), t('app')); return; }
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

    // ----- appearance panel -----
    function renderAppearance() {
        const a = getSettings().appearance;
        const $f = $drawer.find('.sn-appearance-form');
        $f.html(`
            <label class="sn-checkbox sn-big-toggle">
                <input type="checkbox" id="sn-ap-override" ${a.override ? 'checked' : ''} />
                <span>${escapeHtml(t('look.override'))}</span>
            </label>
            <div class="sn-ap-fields ${a.override ? '' : 'sn-disabled'}">
                <label>${escapeHtml(t('look.position'))}</label>
                <select class="text_pole" id="sn-ap-position">
                    <option value="toast-top-right">${escapeHtml(t('look.posTopRight'))}</option>
                    <option value="toast-top-left">${escapeHtml(t('look.posTopLeft'))}</option>
                    <option value="toast-top-center">${escapeHtml(t('look.posTopCenter'))}</option>
                    <option value="toast-top-full-width">${escapeHtml(t('look.posTopFull'))}</option>
                    <option value="toast-bottom-right">${escapeHtml(t('look.posBottomRight'))}</option>
                    <option value="toast-bottom-left">${escapeHtml(t('look.posBottomLeft'))}</option>
                    <option value="toast-bottom-center">${escapeHtml(t('look.posBottomCenter'))}</option>
                    <option value="toast-bottom-full-width">${escapeHtml(t('look.posBottomFull'))}</option>
                    <option value="custom">${escapeHtml(t('look.posCustom'))}</option>
                </select>
                <div class="sn-custom-pos ${a.position === 'custom' ? '' : 'sn-hidden'}">
                    <div class="sn-row2">
                        <div><label>X (px)</label><input type="number" class="text_pole" id="sn-ap-x" value="${a.customPosition ? a.customPosition.x : 20}" /></div>
                        <div><label>Y (px)</label><input type="number" class="text_pole" id="sn-ap-y" value="${a.customPosition ? a.customPosition.y : 20}" /></div>
                    </div>
                    <div class="menu_button sn-drag-btn" id="sn-ap-drag"><i class="fa-solid fa-up-down-left-right"></i> ${escapeHtml(t('look.dragBtn'))}</div>
                </div>
                <label>${escapeHtml(t('look.width'))}: <b id="sn-ap-width-val">${a.width}px</b></label>
                <input type="range" id="sn-ap-width" min="180" max="700" step="10" value="${a.width}" />
                <label>${escapeHtml(t('look.fontSize'))}: <b id="sn-ap-font-val">${a.fontSize}px</b></label>
                <input type="range" id="sn-ap-font" min="10" max="24" step="1" value="${a.fontSize}" />
                <label>${escapeHtml(t('look.duration'))}: <b id="sn-ap-dur-val">${(a.duration/1000).toFixed(1)}s</b> <small>${escapeHtml(t('look.durationHint'))}</small></label>
                <input type="range" id="sn-ap-dur" min="0" max="20000" step="500" value="${a.duration}" />
                <label>${escapeHtml(t('look.opacity'))}: <b id="sn-ap-op-val">${Math.round(a.opacity*100)}%</b></label>
                <input type="range" id="sn-ap-op" min="0.2" max="1" step="0.05" value="${a.opacity}" />

                <hr>
                <label class="sn-checkbox">
                    <input type="checkbox" id="sn-ap-color" ${a.colorOverride ? 'checked' : ''} />
                    <span>${escapeHtml(t('look.colorOverride'))}</span>
                </label>
                <div class="sn-ap-color-fields ${a.colorOverride ? '' : 'sn-disabled'}">
                    <div class="sn-row2">
                        <div><label>${escapeHtml(t('look.background'))}</label><input type="color" id="sn-ap-bg" value="${a.bgColor}" /></div>
                        <div><label>${escapeHtml(t('look.text'))}</label><input type="color" id="sn-ap-text" value="${a.textColor}" /></div>
                    </div>
                    <div class="sn-row2">
                        <div><label>${escapeHtml(t('look.border'))}</label><input type="color" id="sn-ap-border" value="${a.borderColor}" /></div>
                        <div><label>${escapeHtml(t('look.borderWidth'))}: <b id="sn-ap-bw-val">${a.borderWidth}px</b></label>
                            <input type="range" id="sn-ap-bw" min="0" max="6" step="1" value="${a.borderWidth}" /></div>
                    </div>
                    <label>${escapeHtml(t('look.cornerRadius'))}: <b id="sn-ap-br-val">${a.borderRadius}px</b></label>
                    <input type="range" id="sn-ap-br" min="0" max="24" step="1" value="${a.borderRadius}" />
                </div>

                <div class="sn-ap-buttons">
                    <div class="menu_button" id="sn-ap-test"><i class="fa-solid fa-vial"></i> ${escapeHtml(t('look.test'))}</div>
                    <div class="menu_button" id="sn-ap-reset"><i class="fa-solid fa-rotate-left"></i> ${escapeHtml(t('look.reset'))}</div>
                </div>
            </div>
        `);
        $('#sn-ap-position').val(a.position);

        const refreshDisabled = () => {
            $f.find('.sn-ap-fields').toggleClass('sn-disabled', !getSettings().appearance.override);
        };

        $('#sn-ap-override').on('change', function () {
            a.override = this.checked; applyAppearanceCss(); save(); refreshDisabled();
        });
        $('#sn-ap-position').on('change', function () {
            a.position = this.value;
            $f.find('.sn-custom-pos').toggleClass('sn-hidden', a.position !== 'custom');
            if (a.position !== 'custom') stopPositionDrag();
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
        $('#sn-ap-drag').on('click', function () {
            if (isDragging()) { stopPositionDrag(); return; }
            startPositionDrag({
                onPlaced: (pos) => {
                    $('#sn-ap-position').val('custom');
                    $f.find('.sn-custom-pos').removeClass('sn-hidden');
                    $('#sn-ap-x').val(pos.x);
                    $('#sn-ap-y').val(pos.y);
                    toastrSafe('success', t('toast.posSet', { x: pos.x, y: pos.y }), t('app'));
                },
            });
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
            const merged = Object.assign({}, appearanceOptions());
            if (original.info) original.info.call(toastr, t('look.testToast'), t('look.testTitle'), merged);
        });
        $('#sn-ap-reset').on('click', function () {
            stopPositionDrag();
            const settings = getSettings();
            settings.appearance = mergeSettings(defaultSettings.appearance, {});
            applyAppearanceCss(); save(); renderAppearance();
        });
    }

    // ----- More panel -----
    function renderMore() {
        const settings = getSettings();
        const cc = settings.consoleCapture;
        const rl = settings.rateLimit;
        const $m = $drawer.find('.sn-more-form');
        $m.html(`
            <div class="sn-section-title"><i class="fa-solid fa-terminal"></i> ${escapeHtml(t('more.captureTitle'))} <small>${escapeHtml(t('more.captureSub'))}</small></div>
            <label class="sn-checkbox sn-big-toggle">
                <input type="checkbox" id="sn-cc-enabled" ${cc.enabled ? 'checked' : ''} />
                <span>${escapeHtml(t('more.captureToggle'))}</span>
            </label>
            <small class="sn-hint">${escapeHtml(t('more.captureHint'))}</small>
            <div class="sn-cc-fields ${cc.enabled ? '' : 'sn-disabled'}">
                <label>${escapeHtml(t('more.captureLevels'))}</label>
                <div class="sn-cc-levels">
                    <label class="sn-checkbox"><input type="checkbox" class="sn-cc-lvl" data-lvl="error" ${cc.levels.error ? 'checked' : ''} /> <span>error</span></label>
                    <label class="sn-checkbox"><input type="checkbox" class="sn-cc-lvl" data-lvl="warn" ${cc.levels.warn ? 'checked' : ''} /> <span>warn</span></label>
                    <label class="sn-checkbox"><input type="checkbox" class="sn-cc-lvl" data-lvl="info" ${cc.levels.info ? 'checked' : ''} /> <span>info</span></label>
                    <label class="sn-checkbox"><input type="checkbox" class="sn-cc-lvl" data-lvl="log" ${cc.levels.log ? 'checked' : ''} /> <span>log</span></label>
                    <label class="sn-checkbox"><input type="checkbox" class="sn-cc-lvl" data-lvl="debug" ${cc.levels.debug ? 'checked' : ''} /> <span>debug</span></label>
                </div>
            </div>

            <hr>
            <div class="sn-section-title"><i class="fa-solid fa-gauge-high"></i> ${escapeHtml(t('more.spamTitle'))}</div>
            <label class="sn-checkbox">
                <input type="checkbox" id="sn-rl-dedupe" ${rl.dedupeBurst ? 'checked' : ''} />
                <span>${escapeHtml(t('more.spamDedupe'))}</span>
            </label>
            <div class="sn-rl-fields ${rl.dedupeBurst ? '' : 'sn-disabled'}">
                <label class="sn-checkbox">
                    <input type="checkbox" id="sn-rl-group" ${rl.groupRepeats ? 'checked' : ''} />
                    <span>${escapeHtml(t('more.spamGroup'))}</span>
                </label>
                <small class="sn-hint">${escapeHtml(t('more.spamGroupHint'))}</small>
                <label>${escapeHtml(t('more.spamDedupeWindow'))}: <b id="sn-rl-dw-val">${(rl.dedupeWindow/1000).toFixed(1)}s</b></label>
                <input type="range" id="sn-rl-dw" min="500" max="15000" step="500" value="${rl.dedupeWindow}" />
            </div>
            <label class="sn-checkbox">
                <input type="checkbox" id="sn-rl-throttle" ${rl.throttle ? 'checked' : ''} />
                <span>${escapeHtml(t('more.spamThrottle'))}</span>
            </label>
            <div class="sn-rlt-fields ${rl.throttle ? '' : 'sn-disabled'}">
                <label>${escapeHtml(t('more.spamMax'))}: <b id="sn-rl-max-val">${rl.throttleMax}</b> ${escapeHtml(t('more.spamMaxToasts'))} <b id="sn-rl-tw-val">${(rl.throttleWindow/1000).toFixed(1)}s</b></label>
                <input type="range" id="sn-rl-max" min="1" max="20" step="1" value="${rl.throttleMax}" />
                <input type="range" id="sn-rl-tw" min="1000" max="30000" step="500" value="${rl.throttleWindow}" />
            </div>

            <hr>
            <div class="sn-section-title"><i class="fa-solid fa-file-arrow-down"></i> ${escapeHtml(t('more.backupTitle'))}</div>
            <small class="sn-hint">${escapeHtml(t('more.backupHint'))}</small>
            <div class="sn-ap-buttons">
                <div class="menu_button" id="sn-export"><i class="fa-solid fa-download"></i> ${escapeHtml(t('more.export'))}</div>
                <div class="menu_button" id="sn-import"><i class="fa-solid fa-upload"></i> ${escapeHtml(t('more.import'))}</div>
            </div>
            <input type="file" id="sn-import-file" accept="application/json,.json" class="sn-hidden" />
        `);

        const refreshCcDisabled = () => $m.find('.sn-cc-fields').toggleClass('sn-disabled', !cc.enabled);
        $('#sn-cc-enabled').on('change', function () {
            cc.enabled = this.checked; save(); syncConsoleCapture(); refreshCcDisabled(); syncSettingsPanel();
        });
        $m.find('.sn-cc-lvl').on('change', function () {
            cc.levels[this.dataset.lvl] = this.checked; save();
        });

        $('#sn-rl-dedupe').on('change', function () {
            rl.dedupeBurst = this.checked; save();
            $m.find('.sn-rl-fields').toggleClass('sn-disabled', !rl.dedupeBurst);
        });
        $('#sn-rl-group').on('change', function () { rl.groupRepeats = this.checked; save(); });
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
            version: 2,
            exportedAt: new Date().toISOString(),
            settings: JSON.parse(JSON.stringify(getSettings())),
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
        toastrSafe('success', t('toast.exported'), t('app'));
    }

    function importConfig(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result));
                const incoming = data && data.settings ? data.settings : data;
                if (!incoming || typeof incoming !== 'object') throw new Error('bad file');
                const merged = mergeSettings(defaultSettings, incoming);
                const settings = getSettings();
                Object.keys(merged).forEach((k) => { settings[k] = merged[k]; });
                save();
                applyAppearanceCss();
                syncConsoleCapture();
                renderMasterToggle();
                renderLog();
                renderRules();
                renderAppearance();
                renderMore();
                syncSettingsPanel();
                toastrSafe('success', t('toast.imported'), t('app'));
            } catch (e) {
                console.error(`${LOG_PREFIX} import failed:`, e);
                toastrSafe('error', t('toast.importFailed'), t('app'));
            }
        };
        reader.readAsText(file);
    }

    // ----- badge -----
    let unseen = 0;
    function updateBadge(reset) {
        if (reset) unseen = 0;
        const $b = $('#smart_notify_wand_badge');
        if (unseen > 0) { $b.text(unseen > 99 ? '99+' : unseen).show(); }
        else $b.hide();
    }
    function bumpBadge() { unseen++; updateBadge(false); }

    // ----- Extensions settings panel sync -----
    function syncSettingsPanel() {
        const settings = getSettings();
        $('#smart_notify_enabled').prop('checked', settings.enabled);
        $('#smart_notify_autoopen').prop('checked', settings.autoOpenOnNew);
        $('#smart_notify_console_capture').prop('checked', settings.consoleCapture.enabled);
        TOAST_TYPES.forEach((ty) => {
            $(`#smart_notify_mute_${ty}`).prop('checked', settings.muteTypes[ty]);
        });
    }

    // ----- react to new log entries -----
    const onLog = () => {
        if (!drawerOpen) { bumpBadge(); return; }
        const activeTab = $drawer.find('.sn-tab.active').data('tab');
        if (activeTab === 'log') renderLog();
        if (activeTab === 'rules') renderRules();
    };
    logListeners.add(onLog);

    // init
    renderTypeFilters();
    renderMasterToggle();
    renderLog();

    function dispose() {
        logListeners.delete(onLog);
        stopPositionDrag();
        $modal.remove();
    }

    return {
        openDrawer, closeDrawer, toggleDrawer,
        renderMasterToggle, syncSettingsPanel,
        bumpBadge, isOpen: () => drawerOpen,
        dispose, $modal,
    };
}
