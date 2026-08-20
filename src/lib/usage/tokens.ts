export function estimateTokenCount(text: string) {
  const normalized = text.trim();
  if (!normalized) return 0;

  const asciiLike = normalized.replace(/[^\x00-\x7F]/g, "");
  const nonAsciiCount = normalized.length - asciiLike.length;
  const asciiTokenEstimate = Math.ceil(asciiLike.length / 4);
  const nonAsciiTokenEstimate = Math.ceil(nonAsciiCount / 1.8);

  return Math.max(1, asciiTokenEstimate + nonAsciiTokenEstimate);
}

