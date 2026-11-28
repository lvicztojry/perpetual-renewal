export type TranscriptMessage = { speaker: string; content: string; timestamp?: string };

export const transcriptLimits = { maxChars: 200_000, maxMessages: 4000 };
export const transcriptIdentityLimits = { maxSpeakerChars: 100, maxParticipants: 100 };

const datePart = String.raw`\d{4}(?:[-/.]\d{1,2}[-/.]\d{1,2}|年\d{1,2}月\d{1,2}日)`;
const timePart = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const stampPart = `${datePart}(?:[ T]+${timePart})?`;
const datedHeader = new RegExp(`^(?:\\[(${stampPart})\\]|(${stampPart})(?=\\s|$))\\s*(.*)$`);
const systemName = /^(?:system|系统|系统消息|系统通知|通知|消息助手)$/i;
const attachment = /^(?:\[(?:图片|动画表情|表情|语音|视频|文件|附件|位置|名片|红包|转账|image|photo|sticker|audio|voice|video|file|attachment)(?:消息)?\]|<(?:附件|图片|视频|语音|media omitted|attached:.*)>|(?:图片|视频|语音|文件|附件)已省略|\[(?:图片|视频|语音|文件|附件)已省略\])$/i;
const systemContent = /^(?:.*撤回了一条消息|你已添加了.*|以上是打招呼的内容|以下为新消息|消息已发出，但被对方拒收了。?)$/;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function usableName(value: string): boolean {
  return Boolean(value) && !/^(?:https?|ftp|file|mailto|data|www|\d+)$/i.test(value)
    && !/[\[\]{}"<>\x00-\x1f]/.test(value)
    && !/^(?:https?:\/\/|\d{1,2}:\d{2}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i.test(value)
    && !value.includes(":") && !value.includes("：") && !value.includes("/");
}

function colonHeader(line: string): { speaker: string; content: string } | undefined {
  if (/^(?:上午|下午|早上|晚上|凌晨|中午|AM\s*|PM\s*)?\d{1,2}:\d{2}(?::\d{2})?(?:\s|$)/i.test(line)) return;
  const match = /^([^:：]+)[:：](.*)$/.exec(line);
  if (!match) return;
  const speaker = normalizeName(match[1]);
  if (!usableName(speaker) || match[2].startsWith("//")) return;
  return { speaker, content: match[2].trim() };
}

function stripAccount(name: string): string {
  return name.replace(/\s*[(（](?:\d+|[^()（）\s]+@[^()（）\s]+)[)）]\s*$/, "").trim();
}

function stringField(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
}

/** Parse text exports only. Unknown records never acquire an invented speaker. */
export function parseTranscript(text: string): {
  messages: TranscriptMessage[];
  participants: { name: string; count: number }[];
  warnings: string[];
  totalMessages: number;
} {
  if (typeof text !== "string") throw new Error("聊天记录必须是文本，请导出为 TXT、JSON 或 JSONL。");
  if (text.length > transcriptLimits.maxChars) {
    throw new Error(`聊天记录超过 ${transcriptLimits.maxChars.toLocaleString("en-US")} 字符上限，请拆分后导入。`);
  }
  const messages: TranscriptMessage[] = [];
  const counts = new Map<string, number>();
  const warnings: string[] = [];
  let ignored = 0;
  let unit = "行";
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  function add(speaker: string, content: string, timestamp?: string): boolean {
    speaker = normalizeName(speaker);
    content = content.trim();
    if (!speaker || !content || systemName.test(speaker) || attachment.test(content) || systemContent.test(content)) return false;
    if (speaker.length > transcriptIdentityLimits.maxSpeakerChars) {
      throw new Error("说话者姓名超过 100 字符上限，请修正记录后导入。");
    }
    if (!counts.has(speaker) && counts.size >= transcriptIdentityLimits.maxParticipants) {
      throw new Error("聊天记录参与者超过 100 人上限，请拆分后导入。");
    }
    if (messages.length >= transcriptLimits.maxMessages) {
      throw new Error("聊天记录超过 4000 条消息上限，请拆分后导入。");
    }
    messages.push({ speaker, content, ...(timestamp ? { timestamp } : {}) });
    counts.set(speaker, (counts.get(speaker) ?? 0) + 1);
    return true;
  }

  function record(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const speaker = stringField(row, ["speaker", "sender", "name", "from"])
      ?? (row.role === "user" || row.role === "assistant" ? row.role : undefined);
    const content = stringField(row, ["content", "text", "message"]);
    if (!speaker || !content) return false;
    return add(speaker, content, stringField(row, ["timestamp", "time", "date"]));
  }

  function finish() {
    if (ignored) warnings.push(`已忽略 ${ignored} ${unit}无法识别、缺少说话者、空白或系统/附件内容。`);
    if (!messages.length) warnings.push("未识别到可导入的聊天消息，请检查文本格式和说话者标记。");
    return { messages, participants: Array.from(counts, ([name, count]) => ({ name, count })), warnings, totalMessages: messages.length };
  }

  if (!source.trim()) {
    warnings.push("聊天记录为空。");
    return finish();
  }
  if (/SQLite format 3|^PK\x03\x04|\x00|[\x01-\x08\x0e-\x1f]/.test(source)) {
    warnings.push("不支持（unsupported）二进制微信/QQ 数据库或压缩文件，请先导出 TXT、JSON 或 JSONL 文本。");
    return finish();
  }

  const trimmed = source.trim();
  // A bracketed timestamp is a text header, not the start of a JSON array.
  const jsonLike = /^[{[]/.test(trimmed) && !datedHeader.test(trimmed.split("\n", 1)[0])
    && !attachment.test(trimmed.split("\n", 1)[0]);
  if (jsonLike) {
    let parsed: unknown;
    let validJson = false;
    try {
      parsed = JSON.parse(trimmed);
      validJson = true;
    } catch {
      // JSONL is handled below; never reinterpret JSON keys as speaker names.
    }
    if (validJson) {
      unit = "条记录";
      const rows = Array.isArray(parsed) ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).messages)
          ? (parsed as { messages: unknown[] }).messages : [parsed];
      for (const row of rows) if (!record(row)) ignored++;
      return finish();
    }
    let malformedLines = 0;
    for (const line of source.split("\n")) {
      if (!line.trim()) continue;
      let row: unknown;
      try { row = JSON.parse(line); } catch { ignored++; malformedLines++; continue; }
      if (!record(row)) ignored++;
    }
    if (malformedLines) warnings.push(`JSON/JSONL 中有 ${malformedLines} 行格式错误，已忽略，请检查导出内容。`);
    return finish();
  }

  type Pending = { speaker: string; lines: string[]; timestamp?: string; sourceLines: number };
  let pending: Pending | undefined;
  function flush() {
    if (pending && !add(pending.speaker, pending.lines.join("\n"), pending.timestamp)) ignored += pending.sourceLines;
    pending = undefined;
  }
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (pending) pending.lines.push("");
      continue;
    }
    const dated = datedHeader.exec(line);
    if (dated) {
      flush();
      const timestamp = dated[1] ?? dated[2];
      const rest = dated[3].trim();
      const header = colonHeader(rest);
      const account = /^(.+?\s*[(（](?:\d+|[^()（）\s]+@[^()（）\s]+)[)）])(?:\s+(.*))?$/.exec(rest);
      const spaced = /^(\S+)\s+(.+)$/.exec(rest);
      const speaker = header ? stripAccount(header.speaker) : account ? stripAccount(account[1]) : spaced?.[1] ?? rest;
      if (usableName(speaker)) {
        const content = header ? header.content : account ? account[2] ?? "" : spaced?.[2] ?? "";
        pending = { speaker, lines: [content], timestamp, sourceLines: 1 };
      } else if (!rest) {
        // Date on its own, followed by a name and then the body.
        const next = lines[i + 1]?.trim();
        if (next && usableName(stripAccount(next))) {
          pending = { speaker: stripAccount(next), lines: [], timestamp, sourceLines: 2 };
          i++;
        } else ignored++;
      } else ignored++;
      continue;
    }
    // JSON fragments and system notices are boundaries, not continuation text.
    if ((/^[{[]/.test(line) && !attachment.test(line)) || systemContent.test(line)) {
      flush();
      ignored++;
      continue;
    }
    if (attachment.test(line)) {
      ignored++;
      continue;
    }
    const header = colonHeader(line);
    if (header) {
      flush();
      pending = { speaker: header.speaker, lines: [header.content], sourceLines: 1 };
    } else if (pending) {
      pending.lines.push(lines[i].trimEnd());
      pending.sourceLines++;
    } else ignored++;
  }
  flush();
  return finish();
}
