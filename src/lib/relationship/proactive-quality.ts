const feedback = {
  empty: "消息为空，请生成一条自然的主动消息。",
  short: "消息过短，请补充有意义的内容。",
  long: "消息超出长度上限，请精简后重写。",
  repeat: "消息与近期内容重复，请换一个具体切入点。",
  generic: "消息包含空泛的成套安慰，请围绕具体话题自然表达。",
  ending: "近期反复使用相似的安慰收尾，请换一种自然表达。"
} as const;

// Comparison work is bounded independently of caller-supplied length ranges.
const comparisonLimit = 4096;

function plainText(text: string): string {
  return text.normalize("NFKC")
    .replace(/```[^\n`]*\n?/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

function normalize(text: string): string {
  return plainText(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function grams(text: string): Set<string> {
  const chars = Array.from(text);
  const result = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) result.add(chars[i] + chars[i + 1]);
  return result;
}

function dice(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return 2 * shared / (a.size + b.size);
}

// Local phrase families, deliberately not a general semantic classifier. Remove
// matched scaffolding to distinguish topic-bearing empathy from generic comfort.
const families = {
  reflection: /(?:我)?(?:还|也|又|仍然|仍|一直)?(?:在)?(?:想起|惦记着?|想着|想|记得|挂念着?|记挂着?)(?:你)?(?:刚刚|刚才|之前|上次|先前|那天|昨天)?(?:说过的?|提过的?|提到的?|说的)?(?:那些|那件|那点|这件|一些)?(?:事情|事儿|事|话|心事)?/g,
  permission: /(?:如果|要是|倘若)?(?:你)?(?:现在|暂时|今天|这会儿)?(?:还)?不(?:太)?想(?:说话|说|聊|开口|回复|回)(?:的话|也)?(?:都)?(?:没关系|没事|不要紧|可以|不用勉强|不必勉强)?|(?:你)?(?:不用|不必|无需)(?:急着|勉强自己?|勉强)?(?:回复|回我|说话|开口)|(?:等你|等到你)(?:愿意|想)(?:说|聊)(?:的时候)?(?:再说|再聊)?/g,
  presence: /(?:我)?(?:会)?(?:始终|一直|永远|都|也|还|仍然)?(?:会)?(?:安静地|静静地|默默地)?(?:在这里|在这儿|在你身边|在这|陪着你|陪你|等着你|等你)(?:安静地|静静地|默默地)?(?:陪着你|陪你|听你说|等着你|等你)?/g,
  affection: /(?:有点|突然|好)?想你(?:了|啦|呀)?|(?:给你|送你|想给你)?(?:一个)?(?:抱抱|拥抱)/g,
  care: /(?:今天也|今天|也)?(?:要|记得|别忘了)?(?:好好)?(?:照顾好自己|照顾自己|休息|早点休息)(?:哦|呀|啊)?/g,
  checkin: /(?:准备|进展|感觉|过得|睡得|吃得)(?:得)?(?:还|都|是否)?(?:怎么样|如何|好吗|顺利吗|好不好)|(?:还|都)?顺利吗/g
};

type Family = keyof typeof families;

function profile(text: string) {
  let topic = text;
  const found = new Set<Family>();
  // Match complete permission/affection phrases before the shorter 想 family.
  for (const name of ["permission", "presence", "affection", "reflection", "care", "checkin"] as const) {
    topic = topic.replace(families[name], () => {
      found.add(name);
      return "";
    });
  }
  topic = topic.replace(/(?:我|你)(?:刚刚|刚才|之前|上次|先前|那天|昨天)?(?:提到|说起|说过|提过|说)的?|(?:今天|现在|这会儿|最近|今晚|明天)|(?:慢慢来|别勉强自己|按自己的节奏|随时都可以|不用着急|不用急|没关系|没事|不要紧|无论如何|不管怎样|愿意的话)|(?:那件事|这件事|那些话|刚刚|刚才|之前|上次|一点|一些|有点|的|了|呢|呀|啊|啦|吧|哦|嘛|也|还|就|都|会|我|你|在|和|着|是|有|很|好)/g, "");
  return { found, topic: normalize(topic) };
}

function genericPair(found: Set<Family>): boolean {
  // Reflection alone and affection alone are ordinary relational language.
  return (found.has("presence") && (found.has("permission") || found.has("reflection"))) ||
    (found.has("permission") && found.has("reflection"));
}

function comfortEnding(text: string): Set<Family> {
  const ending = text.split(/[。！？!?；;，,\n]+/).filter((part) => part.trim()).at(-1) ?? "";
  const { found, topic } = profile(ending);
  return topic.length < 2
    ? new Set([...found].filter((name) => name === "presence" || name === "permission" || name === "care"))
    : new Set();
}

/** Pure, local retry feedback. Never return excerpts from candidate or history. */
export function evaluateProactiveQuality(
  text: string,
  previousTexts: string[],
  range: { minChars: number; maxChars: number }
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const plain = plainText(typeof text === "string" ? text : "");
  const normalized = normalize(plain.slice(0, comparisonLimit));
  if (!normalized) return { ok: false, issues: [feedback.empty] };
  const length = Array.from(plain).length;
  if (length > range.maxChars) issues.push(feedback.long);
  // Keep short phrases natural while preserving meaningful medium/long targets.
  const effectiveMin = range.minChars < 10 ? Math.min(3, range.minChars) : Math.ceil(range.minChars * 0.6);
  if (Array.from(normalized).length < effectiveMin) issues.push(feedback.short);

  const recent = (Array.isArray(previousTexts) ? previousTexts.slice(-12) : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => plainText(item.slice(0, comparisonLimit)))
    .filter(Boolean);
  const candidate = profile(plain.slice(0, comparisonLimit));
  if (candidate.topic.length < 2 && genericPair(candidate.found)) issues.push(feedback.generic);

  const repeated = recent.some((previous) => {
    const other = normalize(previous);
    if (normalized === other) return true;
    const ratio = Math.min(normalized.length, other.length) / Math.max(normalized.length, other.length);
    // Short greetings and shared substrings in much longer messages are not
    // enough evidence. Dice alone can overrate repeated characters, hence ratio.
    if (Math.min(normalized.length, other.length) < 8 || ratio < 0.65) return false;
    if (dice(normalized, other) >= 0.72) return true;
    const prior = profile(previous);
    const shared = [...candidate.found].filter((name) => prior.found.has(name)).length;
    const topicRatio = Math.min(candidate.topic.length, prior.topic.length) /
      Math.max(candidate.topic.length, prior.topic.length, 1);
    return shared >= 1 && candidate.topic.length >= 2 && prior.topic.length >= 2 &&
      topicRatio >= 0.65 && dice(candidate.topic, prior.topic) >= 0.7;
  });
  if (repeated) issues.push(feedback.repeat);

  const ending = comfortEnding(plain.slice(0, comparisonLimit));
  if ([...ending].some((name) => recent.filter((previous) => comfortEnding(previous).has(name)).length >= 2)) {
    issues.push(feedback.ending);
  }
  return { ok: issues.length === 0, issues };
}
