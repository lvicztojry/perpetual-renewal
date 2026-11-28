export type GroupReplyQualityIssue = {
  kind: "copied-fragment" | "near-duplicate" | "repeated-opening";
  sourceMessageId?: string;
};

type Message = { id: string; speakerId: string | null; content: string };

// Code points, rather than UTF-16 units, keep supplementary Han characters intact.
function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function significant(value: string): boolean {
  const han = value.match(/\p{Script=Han}/gu)?.length ?? 0;
  const otherLetters = value.match(/(?!\p{Script=Han})\p{L}/gu)?.length ?? 0;
  return han >= 8 || otherLetters >= 20;
}

function sentences(value: string): string[] {
  return value.split(/[。！？!?；;\n\r]+|\.(?=\s|$)/u).map(normalize).filter(Boolean);
}

function substantive(value: string): boolean {
  // These additions alone do not turn a quotation into an original reaction.
  const remainder = normalize(value).replace(
    /^(?:(?:嗯|啊|哦|好|哈|对|呀|呢|吧|是的|没错|确实|我也觉得|我也这么觉得|yes|yeah|ok|haha|indeed|exactly|iagree))+/u,
    "",
  );
  return significant(remainder);
}

function withoutReactedQuotes(value: string): string {
  // Only paired explicit quotations followed by substantial original text qualify.
  const quotes = /“[^”\n]+”|「[^」\n]+」|『[^』\n]+』|"[^"\n]+"|‘[^’\n]+’|'[^'\n]+'/gu;
  const matches = [...value.matchAll(quotes)];
  if (!matches.length) return value;
  const last = matches[matches.length - 1];
  if (!substantive(value.slice(last.index! + last[0].length))) return value;
  return value.replace(quotes, "");
}

function nearDuplicate(left: string, right: string): boolean {
  if (left === right) return true;
  const a = Array.from(left), b = Array.from(right);
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.88) return false;
  // A single edit disrupts several trigrams in short Chinese replies. Check a
  // narrow edit band too, with bounded work even for unusually large inputs.
  if (Math.max(a.length, b.length) <= 512) {
    const limit = Math.floor(Math.max(a.length, b.length) * 0.1);
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = Array<number>(b.length + 1).fill(limit + 1);
      current[0] = i;
      let minimum = current[0];
      for (let j = Math.max(1, i - limit); j <= Math.min(b.length, i + limit); j++) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        minimum = Math.min(minimum, current[j]);
      }
      previous = current;
      if (minimum > limit) break;
      if (i === a.length && current[b.length] <= limit) return true;
    }
  }
  // Multiset trigrams require overwhelmingly shared local wording. Linear space/time.
  const grams = new Map<string, number>();
  for (let i = 0; i + 2 < a.length; i++) {
    const gram = a.slice(i, i + 3).join("");
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i + 2 < b.length; i++) {
    const gram = b.slice(i, i + 3).join("");
    const count = grams.get(gram) ?? 0;
    if (count) { shared++; grams.set(gram, count - 1); }
  }
  return (2 * shared) / (a.length + b.length - 4) >= 0.9;
}

/** History is authorized by the caller and ordered oldest to newest. Never edits the reply. */
export function assessGroupReply(
  content: string,
  history: Array<Message>,
  speakerId: string,
  options: { proactive?: boolean; allowEcho?: boolean } = {},
): GroupReplyQualityIssue | null {
  if (options.allowEcho) return null;
  const recent = history.slice(-12).filter(message => message.speakerId !== null);
  const normalized = normalize(content);
  if (!normalized) return null;
  const comparison = normalize(withoutReactedQuotes(content));

  // Normal short acknowledgments are conversationally useful; proactive exact repeats aren't.
  for (const message of [...recent].reverse()) {
    const previous = normalize(message.content);
    if (options.proactive && normalized === previous) {
      return { kind: "near-duplicate", sourceMessageId: message.id };
    }
    if (significant(comparison) && significant(previous) && nearDuplicate(comparison, previous)) {
      return { kind: "near-duplicate", sourceMessageId: message.id };
    }
    // Even a legitimate quote cannot excuse repeating an entire earlier reply.
    if (significant(normalized) && normalized === previous) {
      return { kind: "near-duplicate", sourceMessageId: message.id };
    }
  }

  const peer = [...recent].reverse().find(message => message.speakerId !== speakerId);
  if (peer) {
    const tail = sentences(peer.content).reverse().find(significant);
    if (tail && comparison.includes(tail)) {
      return { kind: "copied-fragment", sourceMessageId: peer.id };
    }
  }

  // Require the same substantial opening in at least two previous self messages.
  const opening = sentences(content.split(/[，,：:]/u)[0])[0];
  if (opening) {
    const matches = recent.filter(message => {
      if (message.speakerId !== speakerId) return false;
      const priorOpening = sentences(message.content.split(/[，,：:]/u)[0])[0];
      if (!priorOpening) return false;
      const shorter = Array.from(opening).length < Array.from(priorOpening).length ? opening : priorOpening;
      return significant(shorter) && opening.startsWith(shorter) && priorOpening.startsWith(shorter);
    });
    if (matches.length > 1) {
      return { kind: "repeated-opening", sourceMessageId: matches[matches.length - 1].id };
    }
  }
  return null;
}
