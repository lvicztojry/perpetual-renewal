"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookHeart, MessageCircle, Plus, Send, Settings, Users, X } from "lucide-react";
import type { GroupAction, GroupMember, GroupMessage, GroupResult, GroupState, GroupSummary } from "@/lib/groups/types";
import type { CompanionProfile } from "@/lib/renewal/types";
import { RenewalEmblem } from "./renewal-emblem";
import { StarterPackEntry } from "./starter-pack-entry";
import { JourneyEntry } from "./journey-entry";
import { useForegroundPoll } from "./use-foreground-poll";
import { useChatViewport, useFollowLatestOnResize } from "./use-chat-viewport";
import { useInboxSync, useReadMessages } from "./use-inbox-sync";
import { SyncAccessNotice, UnreadBadge } from "./sync-access-notice";
import { createClientId } from "@/lib/client-sync/id";
import { reportJourneyEvidence } from "@/lib/journey/events";
import styles from "./group-workspace.module.css";

type Delivery = { message: GroupMessage; mentionIds: string[]; status: "sending" | "failed" | "sent"; error?: string };
type ReplyPlan = { turn: number; speakers: string[]; epoch: number };
const skippedNotices = new Map<string, string>([
  ["disabled", "主动聊天未开启，请检查账号和本群的主动消息开关。"],
  ["frequency", "尚未到设定的主动聊天间隔，请稍后再试。"],
  ["quiet-time", "当前处于安静时段，请在安静时段结束后再试。"],
  ["max-auto-rounds", "本轮自动聊天已停止或达到轮数上限，请发送新消息开始下一轮。"],
  ["pending-replies", "当前还有待完成的回复，请等待本轮回复结束。"],
  ["no-speakers", "没有可主动发言的成员，请检查群成员的“允许主动发言”开关。"],
  ["conversation-settled", "这段话已自然收尾，发送新消息后会继续。"],
  ["reply-in-progress", "已有成员正在回复，请等待当前回复完成。"],
  ["reply-attempts-exhausted", "本轮回复已达到重试上限，请发送新消息开始下一轮。"],
  ["plan-changed", "回复计划已变更，请读取最新群聊或发送新消息。"],
]);
class GroupUiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

// Only locally authored error messages reach the UI. Never render response bodies or exceptions.
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init }); }
  catch { throw new GroupUiError("网络连接中断，请检查连接后重试。"); }
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: "内容未能通过校验，请检查填写内容后重试。", 401: "登录已过期，请重新登录。",
      403: "当前账号无权操作这个群聊。", 404: "群聊或成员已不存在，请返回列表刷新。",
      409: "群聊已更新。请重新读取最新内容，再提交修改。", 429: "操作过于频繁，请稍后重试。",
      502: "回复生成未完成，请检查模型配置或稍后发送新消息。",
    };
    throw new GroupUiError(messages[response.status] ?? "服务暂时无法完成操作，请稍后重试。", response.status);
  }
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new GroupUiError("未能读取服务结果，请重新读取群聊确认状态。"); }
}
function failureText(error: unknown) { return error instanceof GroupUiError ? error.message : "操作未完成，请稍后重试。"; }
function summary(group: GroupState): GroupSummary { return { ...group, lastMessage: group.messages.at(-1) ?? null }; }
function calendarDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function messageDate(value: string, today: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "unknown", label: "日期未知", time: "时间未知", full: "时间未知", dateTime: undefined };
  const day = calendarDate(date);
  const yesterday = new Date(today.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  const label = day === calendarDate(today) ? "今天" : day === calendarDate(yesterday) ? "昨天" : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const full = date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short" });
  return { day, label, time: `${day} ${time}`, full, dateTime: date.toISOString() };
}

export function GroupWorkspace({ groupId, userId }: { groupId?: string; userId?: string }) {
  const inbox = useInboxSync(userId);
  const groupsRevision = useRef(0);
  const [atLatest, setAtLatest] = useState(true);
  const viewportRef = useChatViewport();
  const router = useRouter();
  const [groups, setGroupsState] = useState<GroupSummary[]>([]);
  function setGroups(value: SetStateAction<GroupSummary[]>) { groupsRevision.current++; setGroupsState(value); }
  const [companions, setCompanions] = useState<CompanionProfile[]>([]);
  const [group, setGroup] = useState<GroupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncError, setSyncError] = useState("");
  const [panel, setPanel] = useState<"settings" | "memories" | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [background, setBackground] = useState("");
  const [companionIds, setCompanionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<GroupState | null>(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [replyFailure, setReplyFailure] = useState<ReplyPlan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [knownBy, setKnownBy] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reload, setReload] = useState(0);
  const current = useRef<GroupState | null>(null);
  const live = useRef(false);
  const epoch = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const messageQueue = useRef<Promise<unknown>>(Promise.resolve());
  const replyQueues = useRef(new Map<number, Promise<void>>());
  const editLock = useRef(false);
  const outstanding = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const createDialog = useRef<HTMLDialogElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const panelReturnFocus = useRef<HTMLElement | null>(null);
  const mentionButton = useRef<HTMLButtonElement>(null);
  const mentionChoices = useRef<HTMLFieldSetElement>(null);
  const api = `/api/groups/${encodeURIComponent(groupId ?? "")}`;
  useFollowLatestOnResize(log, follow, group?.id);
  useReadMessages(userId, "group", group?.id, (group?.messages ?? []).filter(message => message.speakerId !== null).map(message => message.id),
    inbox.state === "ready" && atLatest && !panel, () => Boolean(log.current?.getClientRects().length));
  const person = (id: string) => companions.find((item) => item.id === id)?.name ?? "已移除的成员";

  function accept(next: GroupState) {
    if (!live.current || next.id !== groupId || (current.current && next.revision < current.current.revision)) return;
    current.current = next; setGroup(next);
    setGroups((items) => [summary(next), ...items.filter((item) => item.id !== next.id)]);
    const acknowledged = new Set(next.messages.map((item) => item.clientId).filter(Boolean));
    // A GET can confirm persistence without returning the reply plan. Keep failed
    // delivery receipts until an explicit retry obtains the idempotent POST result.
    setDeliveries((items) => items.filter((item) => item.status === "failed" || !acknowledged.has(item.message.clientId)));
  }

  // Management operations stay ordered; message commits and per-turn replies
  // have independent lanes so an old generation cannot hold up the new turn.
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.current.then(operation, operation);
    queue.current = next.catch(() => undefined);
    return next;
  }
  function post(action: GroupAction) {
    return request<GroupResult>(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  }

  function enqueueReply(plan: ReplyPlan, speakerId: string) {
    async function submit() {
      if (!live.current || epoch.current !== plan.epoch) return null;
      return post({ action: "reply", turn: plan.turn, speakerId });
    }
    const next = (replyQueues.current.get(plan.turn) ?? Promise.resolve()).then(submit, submit);
    const settled = next.then(() => undefined, () => undefined);
    replyQueues.current.set(plan.turn, settled);
    void settled.then(() => {
      if (replyQueues.current.get(plan.turn) === settled) replyQueues.current.delete(plan.turn);
    });
    return next;
  }

  function enqueueMessage(action: Extract<GroupAction, { action: "message" }>) {
    async function submit() {
      for (let attempt = 0; ; attempt++) {
        try { return await post(action); }
        catch (failure) {
          // Only the idempotent message commit may retry CAS conflicts. Keep the
          // exact payload/clientId and never retry a reply or model invocation.
          if (!(failure instanceof GroupUiError) || failure.status !== 409 || attempt >= 2) throw failure;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }
    const next = messageQueue.current.then(submit, submit);
    messageQueue.current = next.catch(() => undefined);
    return next;
  }

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      setLoading(true); setLoadError("");
      if (!current.current || current.current.id !== groupId) {
        follow.current = true; setAtLatest(true);
      }
      const results = await Promise.allSettled([
        request<{ userId?: string; groups: GroupSummary[] }>("/api/groups", { signal: controller.signal }),
        request<{ userId?: string; companions: CompanionProfile[] }>("/api/companions", { signal: controller.signal }),
        groupId ? request<{ group: GroupState }>(api, { signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      const [list, people, detail] = results;
      if (list.status === "fulfilled" && (!list.value.userId || list.value.userId === userId)) setGroups(list.value.groups);
      if (people.status === "fulfilled" && (!people.value.userId || people.value.userId === userId)) setCompanions(people.value.companions);
      if (detail.status === "fulfilled" && detail.value) accept(detail.value.group);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") setLoadError(failureText(failed.reason));
      setLoading(false);
    });
    return () => { live.current = false; controller.abort(); };
    // Route identity owns the workspace; reload never replaces unsent composer text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, reload]);

  useEffect(() => {
    if (!groupId) return;
    let controller: AbortController | null = null;
    async function refresh() {
      if (controller || !current.current || editLock.current || outstanding.current || typing || document.visibilityState !== "visible") return;
      const token = epoch.current;
      controller = new AbortController();
      try {
        const result = await request<{ group: GroupState }>(api, { signal: controller.signal });
        if (!controller.signal.aborted && live.current && token === epoch.current) { accept(result.group); setSyncError(""); }
      } catch (failure) {
        if (!controller.signal.aborted && live.current && token === epoch.current) setSyncError(`群聊刷新中断：${failureText(failure)}`);
      } finally { controller = null; }
    }
    const timer = window.setInterval(() => void refresh(), 7000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); controller?.abort(); };
    // Refresh only saved state. Composer, selected memories and settings drafts stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, typing]);

  useForegroundPoll(userId ? `group-list:${userId}` : null, async signal => {
    if (loading || inbox.state === "signed-out" || inbox.state === "account-changed") return;
    const revision = groupsRevision.current;
    try {
      const result = await request<{ userId?: string; groups: GroupSummary[] }>("/api/groups", { signal });
      if (result.userId && result.userId !== userId) return;
      if (!signal.aborted && live.current && revision === groupsRevision.current) setGroups(result.groups);
    } catch { /* Existing detail and inbox states own safe connection feedback. */ }
  }, 15000);

  useEffect(() => {
    if (creating) createDialog.current?.showModal();
    else createDialog.current?.close();
  }, [creating]);

  useEffect(() => {
    if (!panel) return;
    inspector.current?.focus({ preventScroll: true });
  }, [panel]);

  useEffect(() => {
    if (mentionOpen) mentionChoices.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [mentionOpen]);

  function closePanel() {
    setPanel(null);
    const trigger = panelReturnFocus.current;
    trigger?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [group?.messages.length, deliveries.length, typing]);

  async function runPlan(plan: ReplyPlan) {
    for (let index = 0; index < plan.speakers.length; index++) {
      if (!live.current || epoch.current !== plan.epoch) return;
      const speakerId = plan.speakers[index];
      setTyping(speakerId);
      try {
        const result = await enqueueReply(plan, speakerId);
        if (!live.current || epoch.current !== plan.epoch) return;
        if (!result) return;
        accept(result.group);
        if (result.skipped) { setNotice(skippedNotices.get(result.skipped) ?? "本轮回复已结束或被新消息打断。"); break; }
      } catch (failure) {
        if (live.current && epoch.current === plan.epoch) {
          setError(`回复未完成：${failureText(failure)}`);
          if (failure instanceof GroupUiError && failure.status === 502) setNotice("本次回复生成失败，未自动重试。可以发送新消息开始下一轮。");
          else setReplyFailure({ ...plan, speakers: plan.speakers.slice(index) });
        }
        break;
      }
    }
    if (live.current && epoch.current === plan.epoch) setTyping(null);
  }

  function stopPlan() {
    epoch.current++; setTyping(null); setReplyFailure(null);
    return epoch.current;
  }

  async function send(delivery: Delivery) {
    const token = stopPlan();
    outstanding.current++; follow.current = true;
    setDeliveries((items) => [...items.filter((item) => item.message.clientId !== delivery.message.clientId), { ...delivery, status: "sending", error: undefined }]);
    setError(""); setNotice("");
    try {
      const result = await enqueueMessage({ action: "message", content: delivery.message.content, clientId: delivery.message.clientId!, mentionIds: delivery.mentionIds });
      if (!live.current) return;
      setDeliveries((items) => items.map((item) => item.message.clientId === delivery.message.clientId ? { ...item, status: "sent" } : item));
      if (epoch.current !== token) return;
      accept(result.group);
      const lastUser = result.group.messages.findLast((message) => message.speakerId === null);
      if (lastUser?.clientId === delivery.message.clientId) {
        reportJourneyEvidence({ kind: "group-message-sent", groupId: result.group.id, resourceId: result.group.id });
        const start = result.group.messages.findIndex((message) => message.clientId === delivery.message.clientId);
        const replied = new Set(result.group.messages.slice(start + 1).map((message) => message.speakerId));
        const speakers = (result.speakers ?? []).filter((id) => !replied.has(id));
        if (speakers.length) await runPlan({ turn: result.group.turn, speakers, epoch: token });
      }
    } catch (failure) {
      if (live.current) setDeliveries((items) => items.map((item) => item.message.clientId === delivery.message.clientId ? { ...item, status: "failed", error: failureText(failure) } : item));
    } finally { outstanding.current--; }
  }

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !group || editLock.current) return;
    const clientId = createClientId();
    const delivery: Delivery = { message: { id: `local-${clientId}`, clientId, speakerId: null, content: text.trim(), createdAt: new Date().toISOString(), proactive: false }, mentionIds: mentions, status: "sending" };
    setText(""); setMentions([]); setMentionOpen(false);
    void send(delivery); composer.current?.focus();
  }

  async function proactive(manual = false) {
    if (!current.current || editLock.current || outstanding.current || typing || replyFailure || document.visibilityState !== "visible") return;
    const token = epoch.current;
    outstanding.current++;
    try {
      const result = await enqueue(async () => epoch.current === token ? post({ action: "proactive" }) : null);
      if (!live.current || epoch.current !== token || !result) return;
      accept(result.group);
      if (result.skipped) {
        if (manual) setNotice(skippedNotices.get(result.skipped) ?? "当前暂时无法发起主动聊天，请稍后重试。");
      } else if (result.speakers?.length) await runPlan({ turn: result.group.turn, speakers: result.speakers, epoch: token });
      else if (manual) setNotice("当前没有待发起的群聊话题，请稍后重试。");
    } catch (failure) { if (live.current && epoch.current === token) setError(`主动聊天未完成：${failureText(failure)}`); }
    finally { outstanding.current--; }
  }

  async function mutate(build: (latest: GroupState) => GroupAction) {
    if (editLock.current || !current.current) return false;
    editLock.current = true; setBusy(true); setError(""); stopPlan();
    try {
      const result = await enqueue(() => post(build(current.current!)));
      if (!live.current) return false;
      accept(result.group); setNotice("已保存。");
      return true;
    } catch (failure) { if (live.current) setError(failureText(failure)); return false; }
    finally { editLock.current = false; if (live.current) setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); if (editLock.current) return;
    editLock.current = true; setBusy(true); setError("");
    try {
      const result = await request<{ group: GroupState }>("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), background: background.trim(), companionIds }) });
      if (live.current) {
        reportJourneyEvidence({ kind: "group-created", groupId: result.group.id, resourceId: result.group.id });
        router.push(`/groups/${encodeURIComponent(result.group.id)}`);
      }
    } catch (failure) { if (live.current) setError(failureText(failure)); }
    finally { editLock.current = false; if (live.current) setBusy(false); }
  }

  async function removeGroup() {
    if (editLock.current) return;
    editLock.current = true; setBusy(true); setError(""); stopPlan();
    try { await enqueue(() => request(api, { method: "DELETE" })); if (live.current) router.push("/groups"); }
    catch (failure) { if (live.current) setError(failureText(failure)); }
    finally { editLock.current = false; if (live.current) setBusy(false); }
  }

  function editMember(id: string, patch: Partial<GroupMember>) { setDraft((value) => value ? { ...value, members: value.members.map((item) => item.companionId === id ? { ...item, ...patch } : item) } : value); }
  function toggle(values: string[], id: string) { return values.includes(id) ? values.filter((item) => item !== id) : [...values, id]; }
  const messages = [...(group?.messages ?? []), ...deliveries.filter((item) => !group?.messages.some((message) => message.clientId === item.message.clientId)).map((item) => item.message)];
  const today = new Date();
  const messageDates = messages.map((message) => messageDate(message.createdAt, today));

  if (inbox.state === "signed-out" || inbox.state === "account-changed") return <SyncAccessNotice reason={inbox.state} />;

  return <main ref={viewportRef} className={`${styles.page} ${groupId ? styles.detailPage : ""}`}>
    <aside className={`${styles.rail} ${groupId ? styles.detailRail : ""}`} aria-label="群聊列表">
      <Link className={styles.back} data-guide="group-to-create" href="/"><ArrowLeft size={16} /> 返回私聊<UnreadBadge count={inbox.total("private")} /></Link>
      <div className={styles.brand}><RenewalEmblem width={38} height={44} /><div><h1>围坐</h1><p>旧城灯下，故人同席</p></div></div>
      <div className={styles.row}><span className={styles.eyebrow}>相聚的地方 · {groups.length}</span><button className={styles.icon} data-guide="group-create" aria-label="创建群聊" onClick={() => { setCreating(true); setError(""); }}><Plus size={19} /></button></div>
      <JourneyEntry className={styles.secondary} />
      <StarterPackEntry guideAnchor="lanterns-pack" />
      <nav className={styles.groupList}>{groups.map((item) => <Link key={item.id} href={`/groups/${encodeURIComponent(item.id)}`} className={styles.groupLink} aria-current={item.id === groupId ? "page" : undefined}><span className={styles.avatar}><Users size={20} /></span><span><strong>{item.name}<UnreadBadge count={inbox.count("group", item.id)} /></strong><small>{item.lastMessage?.content ?? `${item.members.length} 位成员 · 等你开口`}</small></span></Link>)}</nav>
      {!loading && !groups.length && !loadError && <p className={styles.hint}>还没有群聊。邀几位想见的人，在这里围坐。</p>}
      <p className={styles.railNote}>一盏灯，一张桌。<br />把想说的话，留给同席的人。</p>
    </aside>

    <section className={styles.main} aria-label="群聊工作区">
      <header className={styles.header}><div><Link className={styles.back} href="/groups"><ArrowLeft size={15} /> 全部群聊</Link><h2 title={group?.name}>{group?.name ?? "故人同席"}</h2>{!group && <p>让不同的声音，在同一盏灯下相遇。</p>}
        {group && <details className={styles.groupDetails}><summary>{group.members.length} 位成员 · 群简介</summary><div><p>{group.members.map(member => person(member.companionId)).join("、")}</p>{group.background && <p>{group.background}</p>}</div></details>}</div>
        <div className={styles.actions}>{group ? <><button className={styles.secondary} data-guide="group-memory" aria-label="群记忆" title="群记忆" aria-pressed={panel === "memories"} aria-expanded={panel === "memories"} aria-controls="group-inspector" onClick={(event) => { if (panel === "memories") closePanel(); else { panelReturnFocus.current = event.currentTarget; setPanel("memories"); } }}><BookHeart size={16} /><span className={styles.actionText}>群记忆</span></button><button className={styles.secondary} data-guide="group-settings" aria-label="成员与设置" title="成员与设置" aria-pressed={panel === "settings"} aria-expanded={panel === "settings"} aria-controls="group-inspector" onClick={(event) => { if (panel === "settings") closePanel(); else { panelReturnFocus.current = event.currentTarget; setDraft(structuredClone(group)); setConfirmDelete(false); setPanel("settings"); } }}><Settings size={16} /><span className={styles.actionText}>成员与设置</span></button></> : <button className={styles.primary} data-guide="group-create-empty" onClick={() => setCreating(true)}><Plus size={16} /> 创建群聊</button>}</div>
      </header>
      {loadError && <div className={styles.error} role="alert">{loadError} <button className={styles.secondary} onClick={() => setReload((value) => value + 1)}>重新读取</button></div>}
      {error && <div className={styles.error} role="alert">{error} <button className={styles.secondary} onClick={() => { stopPlan(); setReload((value) => value + 1); }}>读取最新群聊</button></div>}
      <p className={styles.notice} role="status">{loading ? "正在点亮灯火，读取群聊…" : notice}</p>
      {syncError && <p className={styles.error} role="status">{syncError} 页面会继续尝试刷新。</p>}
      {inbox.state === "offline" && <p className={styles.notice} role="status">未读状态暂时未能同步，恢复连接后会继续。</p>}
      {group ? <>
        <div className={styles.conversation} aria-label="群聊天记录" data-guide="group-log" ref={log} onScroll={() => { const node = log.current; if (node) { const latest = node.scrollHeight - node.scrollTop - node.clientHeight < 100; follow.current = latest; setAtLatest(latest); } }}>
          {!messages.length && <div className={styles.empty}><MessageCircle size={32} /><h3>人已到齐，话从这里开始</h3><p>说声你好，或 @ 一位成员。</p></div>}
          <ol className={styles.messages}>{messages.map((message, index) => {
            const delivery = deliveries.find((item) => item.message.clientId === message.clientId && item.status !== "sent");
            const timestamp = messageDates[index];
            return <Fragment key={message.id}>
              {(index === 0 || timestamp.day !== messageDates[index - 1].day) && <li className={styles.dayDivider}><time dateTime={timestamp.dateTime ? timestamp.day : undefined}>{timestamp.label}</time></li>}
              <li className={`${styles.message} ${message.speakerId === null ? styles.own : ""}`}>
              <div className={styles.messageMeta}><strong>{message.speakerId ? person(message.speakerId) : "我"}</strong><time title={timestamp.full} aria-label={timestamp.full} dateTime={timestamp.dateTime}>{timestamp.time}</time>{message.proactive && <span>主动发言</span>}</div>
              <div className={styles.bubble}>{message.content}</div>
              <div className={styles.messageTools}>{!message.id.startsWith("local-") && <label className={styles.check}><input type="checkbox" checked={selected.includes(message.id)} onChange={(event) => { panelReturnFocus.current = event.currentTarget; setSelected(toggle(selected, message.id)); setPanel("memories"); }} /> 选作群记忆</label>}
                {delivery?.status === "sending" && <span role="status">发送中</span>}{delivery?.status === "failed" && <span className={styles.deliveryError} role="alert">{delivery.error}<button className={styles.secondary} disabled={busy} onClick={() => void send(delivery)}>重试发送</button></span>}</div>
            </li></Fragment>;
          })}</ol>
          <div role="status" className={styles.typing}>{typing ? `${person(typing)} 正在输入…` : ""}</div>
          {replyFailure && <button className={styles.secondary} disabled={busy} onClick={() => { const plan = replyFailure; setReplyFailure(null); setError(""); void runPlan(plan); }}>重试剩余回复</button>}
        </div>
        <form className={styles.composer} onSubmit={submitMessage}>
          <div className={`${styles.row} ${styles.composerActions}`}><button ref={mentionButton} data-guide="group-mention" type="button" className={styles.secondary} aria-expanded={mentionOpen} aria-controls="group-mention-members" onClick={() => setMentionOpen(!mentionOpen)}>＠ 选择成员</button><button type="button" data-guide="group-invite" className={styles.secondary} disabled={busy || Boolean(typing)} onClick={() => void proactive(true)}>邀请主动发言</button></div>
          {mentionOpen && <fieldset ref={mentionChoices} id="group-mention-members" className={styles.mentions} onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionOpen(false); mentionButton.current?.focus(); }
            else if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "checkbox") { event.preventDefault(); event.target.click(); }
          }}><legend>本条消息邀请谁回应</legend>{group.members.map((member) => <label key={member.companionId} className={styles.check}><input type="checkbox" checked={mentions.includes(member.companionId)} onChange={() => setMentions(toggle(mentions, member.companionId))} />@{person(member.companionId)}</label>)}<button type="button" className={styles.secondary} onClick={() => { setMentionOpen(false); composer.current?.focus(); }}>完成选择</button></fieldset>}
          {mentions.length > 0 && <p className={styles.hint}>邀请：{mentions.map((id) => `@${person(id)}`).join(" ")}</p>}
          <label className={styles.srOnly} htmlFor="group-message">群聊消息</label><textarea ref={composer} data-guide="group-input" id="group-message" value={text} maxLength={8000} rows={2} placeholder="说点什么，让灯下热闹起来…" onChange={(event) => setText(event.target.value)} disabled={busy} />
          <div className={`${styles.row} ${styles.sendRow}`}><small>新消息会打断尚未开始的旧回复。</small><button type="submit" data-guide="group-send" className={styles.primary} disabled={busy || !text.trim()}><Send size={16} /> 发送</button></div>
        </form>
      </> : !loading && <div className={styles.empty}><Users size={44} /><h3>{groupId ? "暂时无法进入这场相聚" : "空一张桌，等故人来"}</h3><p>{groupId ? "请重新读取，或从列表选择其他群聊。" : "选择已有群聊，或邀请人物创建新的群聊。"}</p></div>}
    </section>

    {group && panel && <button type="button" className={styles.panelBackdrop} tabIndex={-1} aria-label="关闭群聊侧栏" onClick={closePanel} />}
    {group && panel && <aside ref={inspector} id="group-inspector" tabIndex={-1} className={styles.inspector} data-guide="group-memory-panel" aria-label={panel === "settings" ? "成员与群设置" : "群记忆"} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePanel(); } }}>
      <div className={styles.row}><h2>{panel === "settings" ? "同席的人与约定" : "共同记得的事"}</h2><button className={styles.icon} aria-label="关闭面板" onClick={closePanel}><X size={19} /></button></div>
      {panel === "settings" && draft && <form onSubmit={async (event) => { event.preventDefault(); if (await mutate(() => ({ action: "update", revision: draft.revision, name: draft.name.trim(), background: draft.background.trim(), members: draft.members, settings: draft.settings }))) closePanel(); }}>
        {draft.revision !== group.revision && <div className={styles.hint}>群聊已有更新，当前填写内容已保留。<button type="button" className={styles.secondary} disabled={busy} onClick={() => setDraft(structuredClone(group))}>用最新资料替换表单</button></div>}
        <fieldset disabled={busy} className={styles.fieldset}>
          <label className={styles.field}>群名称<input value={draft.name} required maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className={styles.field}>群背景<textarea rows={3} value={draft.background} maxLength={4000} onChange={(event) => setDraft({ ...draft, background: event.target.value })} /></label>
          <h3>群成员</h3><p className={styles.hint}>“允许主动发言”只控制本群，独立于人物的私聊主动消息开关；“允许使用与我的私聊记忆”单独控制记忆读取。</p>{draft.members.map((member) => <section className={styles.member} key={member.companionId}><div className={styles.row}><strong>{person(member.companionId)}</strong><button type="button" className={styles.danger} onClick={() => setDraft({ ...draft, members: draft.members.filter((item) => item.companionId !== member.companionId) })}>移出</button></div><label className={styles.field}>群内关系<input value={member.relationship} maxLength={500} placeholder="例如：多年好友" onChange={(event) => editMember(member.companionId, { relationship: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={member.allowPrivateMemories} onChange={(event) => editMember(member.companionId, { allowPrivateMemories: event.target.checked })} />允许使用与我的私聊记忆</label><label className={styles.check}><input type="checkbox" checked={member.proactiveEnabled} onChange={(event) => editMember(member.companionId, { proactiveEnabled: event.target.checked })} />允许主动发言</label></section>)}
          <label className={styles.field}>新增成员<select value="" onChange={(event) => { const id = event.target.value; if (id) setDraft({ ...draft, members: [...draft.members, { companionId: id, joinedAt: new Date().toISOString(), allowPrivateMemories: false, proactiveEnabled: false, relationship: "" }] }); }}><option value="">选择人物</option>{companions.filter((item) => !draft.members.some((member) => member.companionId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <h3>聊天节奏</h3><label className={styles.check}><input type="checkbox" checked={draft.settings.proactiveEnabled} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, proactiveEnabled: event.target.checked } })} />开启群主动聊天</label>
          <label className={styles.field}>自定义间隔（分钟）<input type="number" required min={1} max={10080} step={1} value={draft.settings.intervalMinutes} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, intervalMinutes: Number(event.target.value) } })} /></label>
          <label className={styles.field}>每次最多回复数<input type="number" required min={1} max={12} step={1} value={draft.settings.maxReplies} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, maxReplies: Number(event.target.value) } })} /></label>
          <div className={styles.twoFields}><label className={styles.field}>安静时段开始<input type="time" required value={draft.settings.quietStart} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, quietStart: event.target.value } })} /></label><label className={styles.field}>安静时段结束<input type="time" required value={draft.settings.quietEnd} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, quietEnd: event.target.value } })} /></label></div>
          <label className={styles.check}><input type="checkbox" checked={draft.settings.autoChat} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, autoChat: event.target.checked } })} />允许成员自动接话</label>
          <label className={styles.field}>自动接话最多轮数<input type="number" required min={1} max={20} step={1} value={draft.settings.maxAutoRounds} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, maxAutoRounds: Number(event.target.value) } })} /></label>
          <p className={styles.hint}>后台按群设置安排主动聊天，关闭页面也可接收。安静时段按账号时区生效，开始与结束相同时全天不静音。</p>
          <button type="submit" className={styles.primary} disabled={!draft.name.trim() || !draft.members.length || draft.members.length > 12}>保存成员与设置</button>
        </fieldset>
        <section className={styles.deleteSection}>{confirmDelete ? <><p>删除「{group.name}」及其消息和群记忆？此操作无法撤销。</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button><button type="button" className={styles.danger} disabled={busy} onClick={() => void removeGroup()}>确认删除群聊</button></div></> : <button type="button" className={styles.danger} onClick={() => setConfirmDelete(true)}>删除群聊</button>}</section>
      </form>}
      {panel === "memories" && <>
        <p className={styles.hint}>从消息旁勾选来源，再确认内容与知情成员。</p>
        <form onSubmit={async (event) => { event.preventDefault(); if (await mutate((latest) => ({ action: "remember", revision: latest.revision, content: memoryText.trim(), sourceMessageIds: selected, knownBy }))) { setSelected([]); setMemoryText(""); setKnownBy([]); reportJourneyEvidence({ kind: "memory-confirmed", groupId: groupId ?? undefined, resourceId: groupId ?? undefined }); } }}>
          <fieldset disabled={busy} className={styles.fieldset}><p className={styles.hint}>已选 {selected.length} / 30 条消息 <button type="button" className={styles.secondary} onClick={() => { setSelected([]); setMemoryText(""); }}>清空</button></p>
          {selected.length > 0 && <><blockquote className={styles.source}>{group.messages.filter((message) => selected.includes(message.id)).map((message) => <p key={message.id}>{message.speakerId ? person(message.speakerId) : "我"}：{message.content}</p>)}</blockquote><button type="button" className={styles.secondary} onClick={() => setMemoryText(group.messages.filter((message) => selected.includes(message.id)).map((message) => message.content).join("\n"))}>将所选消息填入记忆</button></>}
          <label className={styles.field}>确认要记住的内容<textarea value={memoryText} required maxLength={2000} rows={4} onChange={(event) => setMemoryText(event.target.value)} /></label>
          <fieldset className={styles.mentions}><legend>哪些成员知情</legend>{group.members.map((member) => <label className={styles.check} key={member.companionId}><input type="checkbox" checked={knownBy.includes(member.companionId)} onChange={() => setKnownBy(toggle(knownBy, member.companionId))} />{person(member.companionId)}</label>)}</fieldset>
          <button type="submit" data-guide="group-memory-submit" className={styles.primary} disabled={!memoryText.trim() || !selected.length || selected.length > 30 || !knownBy.length}>确认群记忆</button></fieldset>
        </form>
        <h3>已保存 · {group.memories.length}</h3>{!group.memories.length && <p className={styles.hint}>共同的记忆，会从这里慢慢积累。</p>}{group.memories.map((memory) => <article className={styles.memory} key={memory.id}><p>{memory.content}</p><small>知情：{memory.knownBy.map(person).join("、") || "未指定"} · {memory.sourceMessageIds.length} 条来源</small><button type="button" disabled={busy} className={styles.danger} onClick={() => void mutate((latest) => ({ action: "forget", revision: latest.revision, memoryId: memory.id }))}>忘记这条记忆</button></article>)}
      </>}
    </aside>}

    <dialog ref={createDialog} data-guide-expected className={styles.modal} aria-labelledby="create-group-title" onCancel={(event) => { event.preventDefault(); if (!busy) setCreating(false); }}><div className={styles.row}><h2 id="create-group-title">邀故人围坐</h2><button className={styles.icon} disabled={busy} aria-label="关闭创建群聊" onClick={() => setCreating(false)}><X size={20} /></button></div>
      <form onSubmit={create}><fieldset disabled={busy} className={styles.fieldset}><label className={styles.field}>群名称<input autoFocus required value={name} maxLength={80} placeholder="例如：旧城茶馆" onChange={(event) => setName(event.target.value)} /></label><label className={styles.field}>群背景<textarea value={background} rows={3} maxLength={4000} placeholder="大家为何相聚，有哪些共同的故事？" onChange={(event) => setBackground(event.target.value)} /></label><fieldset className={styles.mentions}><legend>邀请人物 · 已选 {companionIds.length} / 12 位</legend>{companions.map((item) => <label key={item.id} className={styles.check}><input type="checkbox" checked={companionIds.includes(item.id)} onChange={() => setCompanionIds(toggle(companionIds, item.id))} />{item.name}</label>)}{!companions.length && <p className={styles.hint}>尚无可邀请人物。<Link href="/">前往私聊创建人物</Link></p>}</fieldset>{error && <p className={styles.error} role="alert">{error}</p>}<button type="submit" className={styles.primary} disabled={loading || !name.trim() || !companionIds.length || companionIds.length > 12}>{busy ? "正在创建…" : "创建群聊"}</button></fieldset></form>
    </dialog>
  </main>;
}
