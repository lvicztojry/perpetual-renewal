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
    .replace(/[＊*]+/g, "")
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

/** Remove explicit stage directions, preserving ordinary emphasis and reported daily life. */
export function normalizeSocialChatReplyContent(content: string) {
  const action = /^(?:轻轻|慢慢|缓缓|默默|微微|笑着|温柔地|认真地|有些|朝你|向你)?(?:微笑|点头|摇头|叹气|沉默|拍拍|拍了拍|摸摸|摸了摸|抱住|抱抱|拥抱|伸手|抬头|低头|看着你|看向|走到|递给|坐下|眨眼|笑了|笑出|smiles?\b|nods?\b|sighs?\b|hugs?\b|pats?\b|looks?\s+at\s+you\b)/i;
  const text = content.replace(/\*([^*\n]{1,160})\*|（([^）\n]{1,160})）|\(([^)\n]{1,160})\)/g, (whole, stars, wide, narrow) => {
    const inner = (stars ?? wide ?? narrow).trim();
    return action.test(inner) ? "" : whole;
  });
  return normalizeAssistantReplyContent(text);
}
