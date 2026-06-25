/* Anti-spam: burst dedupe (with optional repeat-grouping) + throttle. */

const recentToasts = [];   // {key, time} for dedupe
const throttleTimes = [];  // timestamps of shown toasts for throttling

export function resetAntiSpam() {
    recentToasts.length = 0;
    throttleTimes.length = 0;
}

/**
 * Decide what anti-spam should do with a toast that would otherwise show.
 *
 * Returns one of:
 *   false              -> allow it through
 *   'spam:dup'         -> drop as a burst duplicate (grouping disabled)
 *   'spam:group'       -> swallow the toast, but the log entry should be
 *                         collapsed into the previous one (×N counter)
 *   'spam:throttle'    -> drop because the rate cap was hit
 */
export function antiSpamBlock(settings, type, text) {
    const rl = settings.rateLimit;
    const now = Date.now();

    if (rl.dedupeBurst) {
        const key = type + '\u0000' + text;
        // purge old
        while (recentToasts.length && now - recentToasts[0].time > rl.dedupeWindow) {
            recentToasts.shift();
        }
        const isDup = recentToasts.some((e) => e.key === key);
        recentToasts.push({ key, time: now });
        if (isDup) {
            return rl.groupRepeats ? 'spam:group' : 'spam:dup';
        }
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
