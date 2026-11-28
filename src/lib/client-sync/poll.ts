export type PollHost = {
  visible: () => boolean;
  subscribe: (refresh: () => void) => () => void;
  schedule: (run: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

/** One request at a time; events during a request coalesce into one fresh read. */
export function startForegroundPoll(host: PollHost, run: (signal: AbortSignal) => Promise<void>, intervalMs = 7000) {
  let stopped = false, queued = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (timer !== undefined) host.cancel(timer);
    if (!stopped) timer = host.schedule(() => { timer = undefined; void refresh(); }, delay);
  };
  async function refresh() {
    if (stopped || !host.visible()) return;
    if (controller) { queued = true; return; }
    if (timer !== undefined) { host.cancel(timer); timer = undefined; }
    const active = new AbortController(); controller = active;
    const deadline = host.schedule(() => active.abort(), 20000);
    try { await run(active.signal); }
    catch { /* The caller owns safe error state; keep retrying after transport errors. */ }
    finally {
      host.cancel(deadline); controller = null;
      if (!stopped) { const immediate = queued; queued = false; schedule(immediate ? 0 : intervalMs); }
    }
  }
  const unsubscribe = host.subscribe(() => { if (host.visible()) void refresh(); });
  schedule(0);
  return () => { stopped = true; if (timer !== undefined) host.cancel(timer); controller?.abort(); unsubscribe(); };
}
