export function normalizeAssistantReplyContent(content: string) {
  return stripMarkdownConversationArtifacts(content).trim();
}

function stripMarkdownConversationArtifacts(content: string) {
  let text = content.replace(/\r\n?/g, "\n");

  text = text.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, "$1");
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/\[([^\]\n]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, "");

  for (let index = 0; index < 3; index += 1) {
    text = stripDelimitedFormatting(text, "***");
    text = stripDelimitedFormatting(text, "**");
    text = stripDelimitedFormatting(text, "__");
    text = stripDelimitedFormatting(text, "*");
    text = stripDelimitedFormatting(text, "_");
  }

  return text
    .replace(/\\([*_`])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function stripDelimitedFormatting(text: string, marker: string) {
  const escaped = escapeRegExp(marker);
  const boundary = String.raw`(^|[\s([{「『“‘，。！？；：、])`;
  const closeBoundary = String.raw`(?=$|[\s)\]}」』”’，。！？；：、])`;
  const pattern = new RegExp(
    `${boundary}${escaped}([^\\n${escapeForCharacterClass(marker)}](?:[\\s\\S]*?[^\\n${escapeForCharacterClass(
      marker
    )}])?)${escaped}${closeBoundary}`,
    "g"
  );

  return text.replace(pattern, "$1$2");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForCharacterClass(value: string) {
  return value.replace(/[-\\\]^]/g, "\\$&");
}
