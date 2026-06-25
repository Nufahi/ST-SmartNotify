/* Rule engine: regex compile, matching, rewrite, and evaluation. */
import { LOG_PREFIX } from './constants.js';

export function compileRegex(pattern) {
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

export function ruleMatches(rule, type, text) {
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
export function applyRewrite(rule, str) {
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

/**
 * Evaluate all rules + global mutes against a notification.
 *
 * Two-pass design so the outcome no longer depends on rule order:
 *   1. Scan once to find: any matching allow rule, the first matching mute
 *      rule, and all matching rewrite rules.
 *   2. allow always wins over mute. Hits are counted exactly once per matching
 *      rule, consistently for every action type.
 *
 * Returns { blocked: false|ruleId|string, rewriteRules: [rule,...], forceAllow }
 */
export function evaluate(settings, type, text) {
    const result = { blocked: false, rewriteRules: [], forceAllow: false };
    if (!settings.enabled) return result;

    let firstMuteRule = null;
    let allowRule = null;

    for (const rule of settings.rules) {
        if (!ruleMatches(rule, type, text)) continue;
        // count the hit once, here, for every matching rule regardless of action
        rule.hits = (rule.hits || 0) + 1;
        if (rule.action === 'allow') {
            if (!allowRule) allowRule = rule;
        } else if (rule.action === 'mute') {
            if (!firstMuteRule) firstMuteRule = rule;
        } else if (rule.action === 'rewrite') {
            result.rewriteRules.push(rule);
        }
    }

    if (allowRule) {
        // allow wins over mutes, but rewrites still apply
        result.forceAllow = true;
        result.blocked = false;
        return result;
    }

    if (firstMuteRule) {
        result.blocked = firstMuteRule.id;
        return result;
    }

    // global type mute
    if (settings.muteTypes[type]) result.blocked = 'type:' + type;
    return result;
}
