/* Generated from src/lib/http/response-safety.ts; run node scripts/prepare-miniprogram.mjs. */
/* eslint-disable -- generated TypeScript output */
/* eslint no-warning-comments: off */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSensitiveResponseText = redactSensitiveResponseText;
const sanitize_1 = require("../logging/sanitize");
const responseTextPatterns = [
    [
        /\b(LLM_BASE_URL|VOICE_BASE_URL|OPENAI_BASE_URL|ANTHROPIC_BASE_URL|GEMINI_BASE_URL)\s*=\s*["']?[^"',\s]+/gi,
        "$1=[redacted]"
    ],
    [
        /\b(base[_-]?url|endpoint(?:[_-]?url)?)(["']?\s*[:=]\s*)["']?https?:\/\/[^\s"',;<>}]+/gi,
        "[redacted-url]"
    ],
    [
        /https?:\/\/[^\s"',;<>]*(?:\/v1|\/v1beta|\/chat\/completions|\/audio\/(?:speech|transcriptions))[^\s"',;<>]*/gi,
        "[redacted-provider-endpoint]"
    ],
    [
        /https?:\/\/[^\s"',;<>]*(?:gateway|provider|tryanotherone|openai|anthropic|gemini|api\.)[^\s"',;<>]*/gi,
        "[redacted-provider-endpoint]"
    ],
    [
        /\b(prompt|rawPayload|raw_payload|stack|authorization)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"',;<>}\n]+)/gi,
        "[redacted-debug-field]"
    ],
    [
        /\b(raw\s+payload)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"',;<>}\n]+)/gi,
        "[redacted-debug-field]"
    ],
    [
        /\bat\s+[A-Za-z0-9_.$<>]+\s*\([^)"']+\)/g,
        "[redacted-stack]"
    ]
];
function redactSensitiveResponseText(value) {
    if (!value)
        return value;
    return responseTextPatterns.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), (0, sanitize_1.sanitizeLogText)(value));
}
