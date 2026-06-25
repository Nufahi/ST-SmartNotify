/* ============================================================
 * Smart Notify — entry point.
 * Loaded by SillyTavern as an ES module. Wires together the modules in
 * ./modules and intercepts toastr.
 * ============================================================ */
import { LOG_PREFIX, EXT_PATH, TOAST_TYPES, uid, toPlainText } from './modules/constants.js';
import { i18nLoad, t, i18nApplyDom } from './modules/i18n.js';
import { initSettings, getSettings, save } from './modules/settings.js';
import { evaluate, applyRewrite } from './modules/rules.js';
import { antiSpamBlock, resetAntiSpam } from './modules/antispam.js';
import { pushLog } from './modules/log.js';
import { syncConsoleCapture, disposeConsole } from './modules/console-capture.js';
import { applyAppearanceCss, appearanceOptions, disposeAppearance } from './modules/appearance.js';
import { initUI } from './modules/ui.js';

jQuery(async function () {
    'use strict';

    await i18nLoad();

    // Prevent double initialization (e.g. hot-reload)
    if (window.__smartNotifyInitialized) {
        console.warn(`${LOG_PREFIX} Already initialized, disposing previous instance.`);
        if (typeof window.__smartNotifyDispose === 'function') {
            try { window.__smartNotifyDispose(); } catch (e) { console.error(`${LOG_PREFIX} Dispose error:`, e); }
        }
    }
    window.__smartNotifyInitialized = true;

    const context = SillyTavern.getContext();
    const settings = initSettings(context);

    // -----------------------------------------------------------------
    // toastr interception
    // -----------------------------------------------------------------
    if (typeof toastr === 'undefined') {
        console.error(`${LOG_PREFIX} toastr is not available; interception disabled.`);
    }

    const original = {};

    // The UI needs the original (unwrapped) toastr fns for its own toasts.
    const ui = initUI({ original });

    function wrapType(type) {
        const orig = toastr[type];
        if (typeof orig !== 'function') return;
        original[type] = orig;
        toastr[type] = function (message, title, optionsOverride) {
            try {
                let outMessage = message;
                let outTitle = title;
                const text = toPlainText(message) || toPlainText(title);

                const evalResult = evaluate(settings, type, text);
                let blockResult = evalResult.blocked;

                // apply rewrite rules to message + title (unless force-allowed away)
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
                let grouped = false;
                if (!blockResult) {
                    const spam = antiSpamBlock(settings, type, toPlainText(outMessage) || toPlainText(outTitle));
                    if (spam === 'spam:group') {
                        // collapse into the existing log row, swallow the toast
                        grouped = true;
                        blockResult = 'spam:group';
                    } else if (spam) {
                        blockResult = spam;
                    }
                }

                const entry = {
                    id: uid(),
                    type,
                    title: toPlainText(outTitle),
                    message: toPlainText(outMessage),
                    text: toPlainText(outMessage) || toPlainText(outTitle),
                    time: Date.now(),
                    // a grouped repeat is swallowed but NOT shown as "blocked" in the log
                    blocked: !!blockResult && !grouped,
                    ruleId: (typeof blockResult === 'string' && !grouped) ? blockResult : null,
                    rewritten,
                };

                // When grouping, push with a window so identical repeats bump ×N.
                const groupWindow = settings.rateLimit.groupRepeats ? settings.rateLimit.dedupeWindow : 0;
                const didGroup = pushLog(entry, { groupWindow });

                // If anti-spam wanted to group but the log didn't actually collapse
                // (e.g. the matching entry fell outside the window), don't silently
                // drop the toast — let it through instead.
                if (grouped && !didGroup) {
                    blockResult = false;
                }

                if (blockResult) {
                    return null; // swallow (blocked or grouped repeat)
                }

                const merged = Object.assign({}, appearanceOptions(), optionsOverride || {});
                if (settings.autoOpenOnNew) ui.openDrawer();
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
        for (const ty of TOAST_TYPES) {
            if (original[ty]) toastr[ty] = original[ty];
        }
    }

    // -----------------------------------------------------------------
    // Wand-menu entry point
    // -----------------------------------------------------------------
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
        btn.title = t('app');

        const icon = document.createElement('div');
        icon.classList.add('fa-solid', 'fa-bell', 'extensionsMenuExtensionButton');
        const text = document.createElement('span');
        text.textContent = t('app');
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
            ui.openDrawer();
            closeExtensionsMenu();
        };
        btn.addEventListener('click', activate);
        btn.addEventListener('touchend', activate, { passive: false });

        container.appendChild(btn);
        return true;
    }
    let wandTries = 0;
    const wandTimer = setInterval(() => {
        if (addWandButton() || ++wandTries > 40) clearInterval(wandTimer);
    }, 500);

    // -----------------------------------------------------------------
    // Extensions settings panel (settings.html)
    // -----------------------------------------------------------------
    function wireSettingsPanel() {
        const $enabled = $('#smart_notify_enabled');
        if ($enabled.length === 0) return false; // not injected yet
        $enabled.prop('checked', settings.enabled).off('change.sn').on('change.sn', function () {
            settings.enabled = this.checked; save(); ui.renderMasterToggle();
        });
        TOAST_TYPES.forEach((ty) => {
            const $c = $(`#smart_notify_mute_${ty}`);
            $c.prop('checked', settings.muteTypes[ty]).off('change.sn').on('change.sn', function () {
                settings.muteTypes[ty] = this.checked; save();
            });
        });
        $('#smart_notify_open_drawer').off('click.sn').on('click.sn', ui.openDrawer);
        $('#smart_notify_autoopen').prop('checked', settings.autoOpenOnNew).off('change.sn').on('change.sn', function () {
            settings.autoOpenOnNew = this.checked; save();
        });
        $('#smart_notify_console_capture').prop('checked', settings.consoleCapture.enabled).off('change.sn').on('change.sn', function () {
            settings.consoleCapture.enabled = this.checked; save(); syncConsoleCapture();
        });
        return true;
    }

    let wireTimer = null;
    (async function injectSettings() {
        let html = '';
        try { html = await $.get('/' + EXT_PATH + '/settings.html'); } catch (e) { html = ''; }
        if (html) {
            const $html = $(html);
            i18nApplyDom($html);
            const rp = $('#extensions_settings2');
            const lp = $('#extensions_settings');
            if (rp.length) rp.append($html);
            else if (lp.length) lp.append($html);
        }
        let tries = 0;
        wireTimer = setInterval(() => {
            if (wireSettingsPanel() || ++tries > 20) clearInterval(wireTimer);
        }, 300);
    })();

    // -----------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------
    applyAppearanceCss();
    syncConsoleCapture();

    console.log(`${LOG_PREFIX} initialized.`);

    // -----------------------------------------------------------------
    // Dispose (for hot-reload)
    // -----------------------------------------------------------------
    window.__smartNotifyDispose = function () {
        try { restoreToastr(); } catch (e) { /* noop */ }
        try { disposeConsole(); } catch (e) { /* noop */ }
        try { disposeAppearance(); } catch (e) { /* noop */ }
        try { ui.dispose(); } catch (e) { /* noop */ }
        try { resetAntiSpam(); } catch (e) { /* noop */ }
        clearInterval(wireTimer);
        clearInterval(wandTimer);
        $('#smart_notify_wand_button').remove();
        $('.smart-notify-settings').remove();
        document.body.classList.remove('sn-modal-open');
        window.__smartNotifyInitialized = false;
    };
});
