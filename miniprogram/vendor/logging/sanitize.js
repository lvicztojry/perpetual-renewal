/* Generated from src/lib/logging/sanitize.ts; run node scripts/prepare-miniprogram.mjs. */
/* eslint-disable -- generated TypeScript output */
/* eslint no-warning-comments: off */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeLogValue = safeLogValue;
exports.sanitizeLogText = sanitizeLogText;
const secretPatterns = [
    [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
    [
        /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g,
        "[redacted-jwt]"
    ],
    [/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "sk-[redacted]"],
    [
        /\b(postgresql|postgres|mysql|mongodb):\/\/[^\s'"<>]+/gi,
        "$1://[redacted]"
    ],
    [
        /\b([a-z][a-z0-9+.-]*:\/\/)([^\/\s:@]+):([^@\s/]+)@/gi,
        "$1[redacted]@"
    ],
    [
        /\b(LLM_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|VOICE_API_KEY|DATABASE_URL|USER_KEY_VAULT_SECRET|SESSION_COOKIE_SECRET|PROACTIVE_CRON_SECRET)\s*=\s*["']?[^"',\s]+/gi,
        "$1=[redacted]"
    ],
    [
        /\b(api[_-]?key|token|secret|password|pwd|key)(["']?\s*[:=]\s*)["']?[^"',\s}]+/gi,
        "$1$2[redacted]"
    ]
];
function safeLogValue(value) {
    if (value instanceof Error) {
        return sanitizeLogText(`${value.name}: ${value.message}`);
    }
    if (typeof value === "string") {
        return sanitizeLogText(value);
    }
    if (value === null || value === undefined) {
        return value;
    }
    try {
        return sanitizeLogText(JSON.stringify(value));
    }
    catch (_a) {
        return sanitizeLogText(String(value));
    }
}
function sanitizeLogText(value) {
    return secretPatterns.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}
