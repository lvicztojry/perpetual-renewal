import { sanitizeLogText } from "@/lib/logging/sanitize";

const responseTextPatterns: Array<[RegExp, string]> = [
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

export function redactSensitiveResponseText(value: string | undefined) {
  if (!value) return value;

  return responseTextPatterns.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    sanitizeLogText(value)
  );
}
