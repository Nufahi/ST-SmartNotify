/* Appearance: toastr CSS overrides, options, and drag-to-position. */
import { LOG_PREFIX } from './constants.js';
import { getSettings, save } from './settings.js';
import { t } from './i18n.js';

const styleEl = document.createElement('style');
styleEl.id = 'smart-notify-toast-style';
document.head.appendChild(styleEl);

export function applyAppearanceCss() {
    const a = getSettings().appearance;
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

export function appearanceOptions() {
    const a = getSettings().appearance;
    if (!a.override) return {};
    const opts = {
        timeOut: a.duration,
        extendedTimeOut: a.extendedDuration,
    };
    opts.positionClass = a.position === 'custom' ? 'toast-smartnotify-custom' : a.position;
    return opts;
}

// ---------------------------------------------------------------------
// Drag-to-position: show a draggable ghost the user can place anywhere.
// On drop we store {x, y} into appearance.customPosition and switch the
// position to "custom". Works with mouse and touch.
// ---------------------------------------------------------------------
let ghostEl = null;
let dragCleanup = null;

export function isDragging() {
    return !!ghostEl;
}

/**
 * Begin drag-to-position mode.
 * @param {object} cbs - { onPlaced(pos), onCancel() }
 */
export function startPositionDrag(cbs = {}) {
    stopPositionDrag(); // ensure single instance
    const a = getSettings().appearance;

    ghostEl = document.createElement('div');
    ghostEl.id = 'sn-drag-ghost';
    ghostEl.innerHTML =
        `<i class="fa-solid fa-up-down-left-right"></i> <span>${t('look.dragHint')}</span>`;
    // initial position: current custom pos, else a sensible default
    const start = (a.position === 'custom' && a.customPosition)
        ? { x: a.customPosition.x, y: a.customPosition.y }
        : { x: Math.round(window.innerWidth / 2 - 110), y: 80 };
    ghostEl.style.left = start.x + 'px';
    ghostEl.style.top = start.y + 'px';
    document.body.appendChild(ghostEl);

    let dragging = false;
    let offX = 0, offY = 0;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const point = (e) => {
        const tp = e.touches && e.touches[0];
        return tp ? { x: tp.clientX, y: tp.clientY } : { x: e.clientX, y: e.clientY };
    };

    const onDown = (e) => {
        dragging = true;
        const p = point(e);
        const rect = ghostEl.getBoundingClientRect();
        offX = p.x - rect.left;
        offY = p.y - rect.top;
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragging) return;
        const p = point(e);
        const w = ghostEl.offsetWidth, h = ghostEl.offsetHeight;
        const x = clamp(p.x - offX, 0, window.innerWidth - w);
        const y = clamp(p.y - offY, 0, window.innerHeight - h);
        ghostEl.style.left = x + 'px';
        ghostEl.style.top = y + 'px';
        e.preventDefault();
    };
    const onUp = () => { dragging = false; };

    const onKey = (e) => {
        if (e.key === 'Escape') { stopPositionDrag(); cbs.onCancel && cbs.onCancel(); }
        else if (e.key === 'Enter') { place(); }
    };

    const place = () => {
        const rect = ghostEl.getBoundingClientRect();
        const pos = { x: Math.round(rect.left), y: Math.round(rect.top) };
        const s = getSettings().appearance;
        s.position = 'custom';
        s.customPosition = pos;
        save();
        applyAppearanceCss();
        stopPositionDrag();
        cbs.onPlaced && cbs.onPlaced(pos);
    };

    // a little confirm button inside the ghost
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'sn-drag-confirm';
    confirmBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${t('look.dragPlace')}`;
    confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); place(); });
    ghostEl.appendChild(confirmBtn);

    ghostEl.addEventListener('mousedown', onDown);
    ghostEl.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('keydown', onKey);

    dragCleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('keydown', onKey);
    };
}

export function stopPositionDrag() {
    if (dragCleanup) { try { dragCleanup(); } catch (e) { /* noop */ } dragCleanup = null; }
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
}

export function disposeAppearance() {
    stopPositionDrag();
    try { styleEl.remove(); } catch (e) { /* noop */ }
}
