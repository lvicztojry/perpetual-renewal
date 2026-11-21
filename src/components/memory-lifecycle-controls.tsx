"use client";

import { useEffect, useRef, useState } from "react";
import type { MemoryRecord } from "@/lib/renewal/types";
import type { MemoryRevisionRecord } from "@/lib/memory/lifecycle";

type Props = { memory: MemoryRecord; memories: MemoryRecord[]; onChanged: (memories: MemoryRecord[]) => void };
type Page = { items: MemoryRevisionRecord[]; nextCursor: string | null };
const kinds = { edit: "内容纠正", status: "状态变更", superseded: "旧事实归档", accepted: "新事实生效" };
const statuses = { pending: "待确认", active: "生效中", archived: "已归档", deleted: "已遗忘" };
const failure = (status: number) => status === 409 ? "记忆已在别处更新，请重新读取人物资料后核对。" : status === 401 ? "请重新登录。" : status === 404 ? "记忆已不存在或不可访问。" : "操作暂时无法完成，请稍后重试。";

export function MemoryLifecycleControls({ memory, memories, onChanged }: Props) {
  const [history, setHistory] = useState<Page>({ items: [], nextCursor: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const live = useRef(true);
  const endpoint = `/api/memories/${encodeURIComponent(memory.id)}/history`;
  const candidates = memories.filter(item => item.id !== memory.id && item.userId === memory.userId && item.companionId === memory.companionId && item.status !== "deleted");
  const candidate = candidates.find(item => item.id === selected);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; request.current?.abort(); };
  }, []);

  async function load(more = false) {
    if (lock.current || (more && !history.nextCursor)) return;
    lock.current = true; setBusy(true); setError("");
    const version = ++generation.current;
    request.current?.abort(); request.current = new AbortController();
    try {
      const response = await fetch(endpoint + (more ? `?before=${encodeURIComponent(history.nextCursor!)}` : ""), { cache: "no-store", signal: request.current.signal });
      if (!response.ok) { if (live.current && version === generation.current) setError(failure(response.status)); return; }
      const data = await response.json() as Page;
      if (!Array.isArray(data.items) || !(data.nextCursor === null || typeof data.nextCursor === "string")) throw new Error();
      if (live.current && version === generation.current) {
        setHistory(previous => ({ items: more ? [...new Map([...previous.items, ...data.items].map(item => [item.id, item])).values()] : data.items, nextCursor: data.nextCursor }));
        setLoaded(true);
      }
    } catch { if (live.current && version === generation.current) setError("历史读取失败，请稍后重试。"); }
    finally { lock.current = false; if (live.current && version === generation.current) setBusy(false); }
  }
  async function replace() {
    if (lock.current || !candidate || memory.status !== "active") return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "supersede", replacementId: candidate.id, expectedUpdatedAt: memory.updatedAt, replacementUpdatedAt: candidate.updatedAt }) });
      if (!live.current) return;
      if (!response.ok) { setError(failure(response.status)); return; }
      const data = await response.json() as { memories: MemoryRecord[] };
      if (!Array.isArray(data.memories) || !data.memories.every(item => item.companionId === memory.companionId)) throw new Error();
      if (live.current) { onChanged(data.memories); setSelected(""); setLoaded(false); setHistory({ items: [], nextCursor: null }); }
    } catch { if (live.current) setError("暂时无法确认替代结果，请重新读取人物资料后核对。"); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  return <div>
    {memory.supersededById && <p className="memory-meta">已由后续事实替代。重新生效需再次核对替代关系。</p>}
    {memory.status === "active" && <details><summary>用另一条记忆更新这个事实</summary>
      <label className="field"><span>选择已核对的新事实</span><select aria-label="替代记忆" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="">选择同一人物的记忆</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.content.slice(0, 60)}</option>)}</select></label>
      {candidate && <div className="status-box"><p>将归档：{memory.content}</p><p>将生效：{candidate.content}</p><p>原始来源与旧事实会保留在记忆历史中。</p><button type="button" className="text-button" disabled={busy} onClick={() => void replace()}>确认新事实生效</button></div>}
    </details>}
    <details onToggle={event => { if (event.currentTarget.open && !loaded) void load(); }}><summary>记忆变更历史</summary>
      <button type="button" className="text-button" disabled={busy} onClick={() => void load()}>刷新历史</button>
      {loaded && !history.items.length && <p className="memory-meta">暂无变更记录。</p>}
      {history.items.map(item => <article key={item.id} className="status-box"><div className="memory-meta">{kinds[item.kind]} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div><p>之前（{statuses[item.before.status]}）：{item.before.content}</p><p>之后（{statuses[item.after.status]}）：{item.after.content}</p></article>)}
      {history.nextCursor && <button type="button" className="text-button" disabled={busy} onClick={() => void load(true)}>加载更早记录</button>}
    </details>
    {busy && <p role="status" className="memory-meta">正在处理记忆…</p>}{error && <p role="alert" className="status-box">{error}</p>}
  </div>;
}
