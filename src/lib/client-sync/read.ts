type ReadOptions = {
  messageIds: string[];
  acknowledged: Set<string>;
  signal: AbortSignal;
  canRead: () => boolean;
  post: (messageIds: string[]) => Promise<{ markedCount: number }>;
  updated: () => void;
};

/** Keep exact-ID receipts retryable, and refresh the inbox after each attempt. */
export async function acknowledgeReadMessages({ messageIds, acknowledged, signal, canRead, post, updated }: ReadOptions) {
  const pending = [...new Set(messageIds)].filter(id => !acknowledged.has(id));
  for (let start = 0; start < pending.length; start += 200) {
    if (signal.aborted || !canRead()) break;
    const batch = pending.slice(start, start + 200);
    try {
      const result = await post(batch);
      if (signal.aborted || !Number.isInteger(result.markedCount) || result.markedCount < 0 || result.markedCount > batch.length) break;
      // Zero is valid: another client may have already acknowledged these IDs.
      for (const id of batch) acknowledged.add(id);
    } catch { break; }
    finally {
      // A cancelled/lost response may still have committed on the server. Also
      // publish successful partial batches before a later batch can be cancelled.
      updated();
    }
  }
}
