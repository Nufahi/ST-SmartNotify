/* Shared constants for Smart Notify. */
export const MODULE_NAME = 'ST-SmartNotify';
export const LOG_PREFIX = '[Smart Notify]';
export const EXT_PATH = `scripts/extensions/third-party/${MODULE_NAME}`;

export const TOAST_TYPES = ['success', 'info', 'warning', 'error'];

export const ICONS = {
    success: 'fa-circle-check',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation',
    error: 'fa-circle-xmark',
};

// HTML escaping for safe rendering in the panel.
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function uid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Strip HTML tags from a toastr message to get plain text for matching/log.
export function toPlainText(msg) {
    if (msg == null) return '';
    const s = String(msg);
    if (s.indexOf('<') === -1) return s;
    const tmp = document.createElement('div');
    tmp.innerHTML = s;
    return (tmp.textContent || tmp.innerText || '').trim();
}
