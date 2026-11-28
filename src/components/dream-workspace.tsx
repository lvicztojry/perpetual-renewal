"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Moon, RotateCcw } from "lucide-react";
import { RenewalEmblem } from "./renewal-emblem";
import { JourneyEntry } from "./journey-entry";
import { playAbilityIntro } from "@/lib/ability-events";
import { reportJourneyEvidence } from "@/lib/journey/events";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";
import type { CompanionProfile } from "@/lib/renewal/types";
import type { DreamAction, DreamFragment, DreamGetResponse, DreamPostResponse, DreamProfile, DreamScope, DreamState, DreamVersion } from "@/lib/dream/types";
import styles from "./dream-workspace.module.css";

const scopes: Record<DreamScope, string> = { always: "平时就是这样", context: "只在类似情境中", occasional: "偶尔这样表达" };
const questions = ["我今天有点累。", "这件事，我和你的想法不一样。", "刚才一直在忙，没回消息。", "突然想起以前的事情了。", "今天发生了一件挺开心的小事。"];
const maxRounds = 20;
type Review = { kind: "apply"; state: DreamState } | { kind: "restore"; state: DreamState; version: DreamVersion } | { kind: "discard"; state: DreamState } | { kind: "rebase"; state: DreamState; expectedCompanionUpdatedAt: string };
class DreamUiError extends Error {}

export function DreamWorkspace({ companionId }: { companionId: string }) {
  const [companion, setCompanion] = useState<CompanionProfile | null>(null);
  const [dream, setDream] = useState<DreamState | null>(null);
  const [profile, setProfile] = useState<DreamProfile>({ personality: [], speakingStyle: "" });
  const [fragments, setFragments] = useState<DreamFragment[]>([]);
  const [mode, setMode] = useState<"compare" | "free">("compare");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<{ roundId: string; choiceId?: string } | null>(null);
  const [correction, setCorrection] = useState("");
  const [recoveredCorrection, setRecoveredCorrection] = useState("");
  const [scope, setScope] = useState<DreamScope>("context");
  const [busy, setBusy] = useState<DreamAction["action"] | "load" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const latestRound = useRef<HTMLElement | null>(null);
  const situationInput = useRef<HTMLTextAreaElement | null>(null);
  const focusNextSituation = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const api = `/api/companions/${encodeURIComponent(companionId)}/dream`;
  const dirty = Boolean(dream && (JSON.stringify(profile) !== JSON.stringify(dream.draftProfile) || JSON.stringify(fragments) !== JSON.stringify(dream.fragments)));
  const active = dream?.status === "draft";
  const unsent = Boolean(message.trim() || feedback || correction.trim());
  const needsRebase = Boolean(dream && companion && dream.baseCompanionUpdatedAt !== companion.updatedAt);

  function accept(state: DreamState) {
    setDream(state); setProfile(structuredClone(state.draftProfile)); setFragments(structuredClone(state.fragments));
  }

  async function load(signal: AbortSignal, preserveConversation = false) {
    lock.current = true;
    setBusy("load"); setError("");
    try {
      const response = await fetch(api, { cache: "no-store", signal });
      if (!response.ok) throw new DreamUiError(response.status === 404 ? "没有找到这个人物，或你无权访问。" : response.status === 401 ? "请先登录后再进入梦境。" : "暂时无法读取梦境，请稍后重试。");
      const data = await response.json() as DreamGetResponse;
      if (!data.companion?.id || data.companion.id !== companionId) throw new DreamUiError("梦境资料暂时无法读取。");
      if (!mounted.current || signal.aborted) return;
      setCompanion(data.companion);
      if (data.state) accept(data.state); else { setDream(null); setProfile({ personality: data.companion.personality, speakingStyle: data.companion.speakingStyle }); setFragments([]); }
      setConflict(false);
      if (!preserveConversation) { setFeedback(null); setCorrection(""); }
      else if (feedback) {
        const round = data.state?.rounds.find((round) => round.id === feedback.roundId);
        if (!round || round.feedback) {
          setRecoveredCorrection(correction); setFeedback(null); setCorrection("");
          setNotice("这一轮已在别处更新。未提交的纠正原文已保留，请核对后再使用。");
        }
      }
    } catch (failure) {
      if (mounted.current && !signal.aborted) setError(failure instanceof DreamUiError ? failure.message : "暂时无法读取梦境，请稍后重试。");
    } finally {
      if (requestRef.current?.signal === signal) {
        lock.current = false;
        if (mounted.current && !signal.aborted) setBusy(null);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); requestRef.current = controller;
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    return () => { mounted.current = false; controller.abort(); requestRef.current?.abort(); };
    // One owned workspace per route; actions re-fetch explicitly on conflict.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionId]);

  useEffect(() => {
    if (!dirty && !unsent) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, unsent]);

  useEffect(() => {
    if (review) { returnFocus.current = document.activeElement as HTMLElement; dialog.current?.showModal(); }
    else { dialog.current?.close(); returnFocus.current?.focus(); }
  }, [review]);

  useEffect(() => {
    if (!busy && focusNextSituation.current) {
      focusNextSituation.current = false;
      situationInput.current?.focus();
    }
  }, [busy, feedback]);

  // Own the lock across draft saving AND the follow-up request / preview.
  async function runAction<T>(kind: DreamAction["action"], task: () => Promise<T>): Promise<T | null> {
    if (lock.current || busy || conflict) return null;
    lock.current = true; setBusy(kind); setError(""); setNotice("");
    try { return await task(); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  }

  async function postAction(action: DreamAction, success: string) {
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), signal: controller.signal });
      if (!response.ok) {
        if (response.status === 409) { setConflict(true); throw new DreamUiError("梦境或人物设定已在别处更新。请重新读取已保存的梦境，再核对本次修改。"); }
        if (response.status === 401) throw new DreamUiError("登录已失效，请重新登录。当前填写内容仍保留在页面上。");
        if (response.status === 404) throw new DreamUiError("没有找到这个人物，或你无权访问。");
        if (response.status === 400) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new DreamUiError(typeof body.error === "string" ? redactSensitiveResponseText(body.error)?.slice(0, 300) : "请检查填写内容后重试。");
        }
        throw new DreamUiError("暂时无法完成，请保留当前内容并稍后重试。请核对保存结果后再继续。");
      }
      const data = await response.json() as DreamPostResponse;
      if (!data.state || data.state.companionId !== companionId) throw new DreamUiError("未能确认保存结果，请重新读取后核对，避免重复操作。");
      if (!mounted.current || controller.signal.aborted) return null;
      accept(data.state); if (data.companion) setCompanion(data.companion);
      if (action.action === "start") {
        window.dispatchEvent(new CustomEvent("renewal:journey-observe", { detail: { kind: "dream-started", companionId } }));
        reportJourneyEvidence({ kind: "dream-started", companionId, resourceId: companionId });
      }
      if (action.action === "generate") reportJourneyEvidence({ kind: "dream-generated", companionId, resourceId: companionId });
      if (action.action === "feedback") reportJourneyEvidence({ kind: "dream-feedback-recorded", companionId, resourceId: companionId });
      if (action.action === "apply") reportJourneyEvidence({ kind: "dream-applied", companionId, resourceId: companionId });
      setNotice(success); setConflict(false);
      return data;
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure instanceof DreamUiError ? failure.message : "暂时无法确认保存结果，请重新读取后核对，避免重复操作。");
      return null;
    }
  }

  async function act(action: DreamAction, success: string) {
    return runAction(action.action, () => postAction(action, success));
  }

  function enterDream() {
    if (busy || lock.current || conflict || active || !companion) return;
    playAbilityIntro({ kind: "dream", companionName: companion.name, short: Boolean(dream), autoPlay: true });
    void act({ action: "start" }, "梦境已展开。试着说一句能让你认出 TA 的话。");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!dream || !active || !message.trim() || feedback || correction.trim() || dream.rounds.length >= maxRounds) return;
    await runAction("generate", async () => {
      const saved = dirty ? (await persistDraft(dream))?.state : dream;
      if (!saved) return;
      const data = await postAction({ action: "generate", revision: saved.revision, message: message.trim(), mode }, "回声已出现。选出更像 TA 的一句，也可以亲手纠正。");
      if (data) { setMessage(""); setFeedback(null); setCorrection(""); requestAnimationFrame(() => latestRound.current?.scrollIntoView({ block: "nearest", behavior: "instant" })); }
    });
  }

  async function recordFeedback(event: FormEvent) {
    event.preventDefault();
    if (!dream || !active || !feedback || (!feedback.choiceId && !correction.trim())) return;
    await runAction("feedback", async () => {
      const saved = dirty ? (await persistDraft(dream))?.state : dream;
      if (!saved) return;
      const data = await postAction({ action: "feedback", revision: saved.revision, ...feedback, correction: correction.trim(), scope }, saved.rounds.length >= maxRounds
        ? "反馈已记录。本次已达 20 轮上限；可继续核对片段，或点击“结束入梦”预览并确认应用。"
        : "反馈已记录，梦境仍在继续。请填写下一轮情境，再点击“听听回响”；也可先核对拾起的片段。准备好时可点击“结束入梦”。");
      if (data) { setFeedback(null); setCorrection(""); setRecoveredCorrection(""); focusNextSituation.current = true; }
    });
  }

  async function persistDraft(state: DreamState) {
    return postAction({ action: "edit", revision: state.revision, draftProfile: profile, fragments }, "梦境草稿已保存，正式人物尚未改变。");
  }

  async function saveDraft() {
    if (!dream) return null;
    return runAction("edit", () => persistDraft(dream));
  }

  async function prepareApply() {
    if (!dream || busy || !active) return;
    await runAction("edit", async () => {
      const saved = dirty ? (await persistDraft(dream))?.state : dream;
      if (saved) setReview({ kind: "apply", state: saved });
    });
  }

  async function confirmReview() {
    if (!review || busy || lock.current || conflict) return;
    const action: DreamAction = review.kind === "rebase" ? { action: "rebase", revision: review.state.revision, expectedCompanionUpdatedAt: review.expectedCompanionUpdatedAt } : review.kind === "restore" ? { action: "restore", revision: review.state.revision, versionId: review.version.id }
      : { action: review.kind === "apply" ? "apply" : "discard", revision: review.state.revision };
    const data = await act(action, review.kind === "rebase" ? "已核对最新人物资料，梦境草稿保留。请再次预览并确认应用。" : review.kind === "apply" ? "已保存并醒来。新设定将在接下来的聊天中生效。" : review.kind === "restore" ? "已恢复这个版本，原有聊天与记忆保持不变。" : "本次梦境草稿已舍弃，正式设定保持不变。");
    if (data) { setReview(null); if (review.kind !== "rebase") { setFeedback(null); setCorrection(""); setMessage(""); } }
    else setReview(null);
  }

  function updateFragment(id: string, patch: Partial<DreamFragment>) { setFragments((current) => current.map((fragment) => fragment.id === id ? { ...fragment, ...patch } : fragment)); }
  function reloadDream() {
    if (busy || lock.current) return;
    if (dirty && !window.confirm("重新读取会替换未保存的底稿和片段；情境与纠正原文会保留。确定继续吗？")) return;
    const controller = new AbortController(); requestRef.current = controller;
    void load(controller.signal, true);
  }
  const reviewProfile = review?.kind === "restore" ? review.version.profile : review?.state.previewProfile;
  const paused = Boolean(busy) || conflict;

  return <main className={styles.page} aria-busy={Boolean(busy)}>
    <header className={styles.header}>
      <div className={styles.brand}><RenewalEmblem /><div><p className={styles.eyebrow}>生生不息 / 入梦</p><h1>入梦</h1><small>{companion ? `${companion.name}的意识空间` : "沿着回响，走近那个想念的人。"}</small></div></div>
      <div className={styles.headerActions}>
        <JourneyEntry className={styles.secondary} />
        <a className={styles.back} href={`/?companion=${encodeURIComponent(companionId)}`} onClick={(event) => { if ((dirty || unsent) && !window.confirm("还有未提交的梦境内容，确定离开吗？")) event.preventDefault(); }}><ArrowLeft size={15} />返回聊天</a>
        {active ? <button type="button" data-guide="dream-review" className={styles.primary} disabled={paused || needsRebase} onClick={() => void prepareApply()}>结束入梦</button> : null}
      </div>
    </header>
    <div className={styles.shell}>
      <section className={styles.dream} aria-label="梦中对话">
        <div className={styles.scene} data-settled={fragments.some((fragment) => fragment.confirmed)}>
          <div className={styles.door} aria-hidden="true"><div className={styles.silhouette} /></div>
          <div className={styles.sceneText}><h2>{active ? "形已生，念未全。" : "沿着回声，走入梦中。"}</h2><p>{active ? "一句话，一个细节，让模糊的身影渐渐清晰。" : "在交谈与纠正中，拾起属于 TA 的语气和性情。"}</p>
            {active ? <p className={styles.hint}>梦境进行中 · 每轮记录后可继续，准备好时点击“结束入梦”</p> : <button type="button" data-guide="dream-start" className={styles.secondary} disabled={paused || !companion} onClick={enterDream}><Moon size={16} />进入梦境</button>}
          </div>
        </div>
        <div className={styles.status} role="status" aria-live="polite">{busy === "load" ? "正在寻找梦境…" : busy === "generate" ? "正在听取梦中的回声…" : busy === "feedback" ? "正在整理这次纠正…" : busy ? "正在保存，请稍候…" : notice}</div>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {conflict ? <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={reloadDream}><RotateCcw size={15} />重新读取梦境</button> : !companion && !busy ? <div className={styles.actions}><Link className={styles.secondary} href="/login">前往登录</Link><button className={styles.secondary} onClick={reloadDream}>重新读取</button></div> : null}
        {needsRebase && !conflict && dream && companion ? <div className={styles.error}><p>人物设定在其他页面有过更新。请先核对新的基准；当前梦境草稿会保留。</p><button className={styles.secondary} type="button" disabled={Boolean(busy) || dirty} onClick={() => setReview({ kind: "rebase", state: dream, expectedCompanionUpdatedAt: companion.updatedAt })}>核对更新后的设定</button></div> : null}
        {recoveredCorrection ? <label className={styles.field}>保留的纠正原文<textarea aria-label="保留的纠正原文" readOnly rows={3} value={recoveredCorrection} /><span className={styles.hint}>该轮已更新，请复制原文或在新的片段中继续纠正。</span></label> : null}
        {dirty ? <p className={styles.hint}>片段或底稿尚未保存。下次听取回响、记录反馈或结束入梦时会先自动保存草稿；正式人物仍需预览并确认应用。</p> : null}
        {dream?.rounds.length ? <div className={styles.rounds}>{dream.rounds.map((round, index) => <article className={styles.round} key={round.id} ref={index === dream.rounds.length - 1 ? latestRound : undefined} aria-label={`梦中片段 ${index + 1}`}>
          <div className={styles.roundHeader}><span>梦中片段 {String(index + 1).padStart(2, "0")}</span><span>{round.source === "local" ? "本地演示 · 尚未使用真实模型" : round.mode === "free" ? "自由试聊" : "三种回声"}</span></div>
          <h3>{round.message}</h3>
          <div className={`${styles.choices} ${round.choices.length === 1 ? styles.singleChoice : ""}`}>{round.choices.map((choice, choiceIndex) => <button type="button" key={choice.id} aria-label={`选择回声 ${choiceIndex + 1}`} aria-pressed={round.feedback?.choiceId === choice.id || (feedback?.roundId === round.id && feedback.choiceId === choice.id)} className={styles.choice} disabled={paused || !active || Boolean(round.feedback)} onClick={() => setFeedback({ roundId: round.id, choiceId: choice.id })}><span>{String(choiceIndex + 1).padStart(2, "0")}</span>{choice.content}<span>{round.feedback?.choiceId === choice.id ? "已选择这句回声" : "这句更像 TA"}</span></button>)}</div>
          {round.feedback ? <p className={styles.feedbackSummary}>已记录 · {scopes[round.feedback.scope]}{round.feedback.correction ? `\n你的纠正：${round.feedback.correction}` : ""}</p> : active ? <button className={styles.remove} disabled={paused} type="button" onClick={() => setFeedback({ roundId: round.id })}>都不像</button> : null}
          {feedback?.roundId === round.id ? <form className={styles.feedback} onSubmit={recordFeedback}>
            <label className={styles.field}>纠正这句回响<textarea aria-label="纠正这句回响" rows={3} maxLength={500} disabled={paused} value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="例如：他会先让我吃饭，关心很直接，不会连续追问。也可以直接写出 TA 会说的话。" /></label>
            <label className={styles.field}>适用范围<select aria-label="适用范围" value={scope} disabled={paused} onChange={(event) => setScope(event.target.value as DreamScope)}>{Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {!feedback.choiceId ? <p>说说哪里不像，或直接改一句，再记录这次反馈。</p> : <p>可直接记录选择；补充原因能让人物的表达规律更清晰。</p>}
            <div className={styles.actions}><button type="button" className={styles.secondary} disabled={paused} onClick={() => { setFeedback(null); setCorrection(""); }}>取消</button><button className={styles.primary} data-guide="dream-feedback-submit" disabled={paused || (!feedback.choiceId && !correction.trim())}>记录反馈</button></div>
          </form> : null}
        </article>)}</div> : <div className={styles.empty}><strong>先从一句熟悉的话开始。</strong>这里的练习与正式聊天分开；只有确认应用，才会更新人物。</div>}
        {active ? <form onSubmit={generate}>
          <div className={styles.modeRow}><div className={styles.modes} aria-label="入梦模式"><button type="button" aria-pressed={mode === "compare"} disabled={paused} onClick={() => setMode("compare")}>对比选择</button><button type="button" aria-pressed={mode === "free"} disabled={paused} onClick={() => setMode("free")}>自由试聊</button></div><span className={styles.hint}>{dream.rounds.length} / {maxRounds} 轮 · 本次入梦容量</span></div>
          <p className={styles.hint}>{dream.rounds.length >= maxRounds ? "本次已达到 20 轮上限，无法再听取新回响，梦境不会自动结束。仍可补录已有回响的反馈、整理片段；点击“结束入梦”预览并确认应用后，可再次进入新的梦境。" : "每次入梦最多 20 轮。记录后可继续填写情境；只有点击“听听回响”才会生成下一轮。"}</p>
          <div className={styles.questions}>{questions.map((question) => <button className={styles.question} key={question} type="button" disabled={paused} onClick={() => setMessage(question)}>{question}</button>)}</div>
          <label className={styles.field} data-guide="dream-situation">梦中情境<textarea ref={situationInput} aria-label="梦中情境" rows={3} value={message} maxLength={2000} disabled={paused} onChange={(event) => setMessage(event.target.value)} placeholder="说一句话，看看 TA 会如何回应。" /></label>
          <div className={styles.actions}><button className={styles.primary} data-guide="dream-generate" disabled={paused || Boolean(feedback) || Boolean(correction.trim()) || !message.trim() || dream.rounds.length >= maxRounds}>听听回响</button></div>
        </form> : dream ? <div className={styles.actions}><a className={styles.primary} href={`/?companion=${encodeURIComponent(companionId)}`}>返回聊天，见见 TA</a></div> : null}
      </section>
      <aside className={styles.aside} aria-label="梦境设定">
        <section className={styles.asideSection} data-guide="dream-fragments"><h2>拾起的片段</h2><p className={styles.hint}>这些是表达习惯的草稿。核对并勾选后，才会随本次应用带回人物。</p>
          {!fragments.length ? <p className={styles.hint}>还没有确认的片段。在梦中选择或纠正一句回复，开始了解 TA。</p> : null}
          {fragments.map((fragment, index) => <div className={styles.fragment} key={fragment.id}>
            <label className={styles.field}>片段内容 {index + 1}<textarea aria-label={`片段内容 ${index + 1}`} rows={3} maxLength={500} disabled={paused || !active} value={fragment.text} onChange={(event) => updateFragment(fragment.id, { text: event.target.value })} /></label>
            <div className={styles.fragmentMeta}><span>{scopes[fragment.scope]} · {fragment.origin === "user" ? "来自你的纠正" : "模型归纳，待核对"}</span><span>源片段 {Math.max(1, (dream?.rounds.findIndex((round) => round.id === fragment.roundId) ?? 0) + 1)}</span></div>
            <label className={styles.check}><input type="checkbox" aria-label={`确认片段 ${index + 1}`} disabled={paused || !active} checked={fragment.confirmed} onChange={(event) => updateFragment(fragment.id, { confirmed: event.target.checked })} />确认这个特点</label>
            <button type="button" className={styles.remove} disabled={paused || !active} aria-label={`删除片段 ${index + 1}`} onClick={() => setFragments((current) => current.filter((item) => item.id !== fragment.id))}>删除这个片段</button>
          </div>)}
        </section>
        <section className={styles.asideSection}><h2>人物底稿</h2>
          <label className={styles.field}>性格关键词<input aria-label="性格关键词" disabled={paused || !active} value={profile.personality.join("、")} maxLength={328} onChange={(event) => setProfile((current) => ({ ...current, personality: event.target.value.split(/[、,，]/).slice(0, 8) }))} /></label>
          <label className={styles.field}>基础说话方式<textarea aria-label="基础说话方式" rows={6} maxLength={4000} disabled={paused || !active} value={profile.speakingStyle} onChange={(event) => setProfile((current) => ({ ...current, speakingStyle: event.target.value }))} /></label>
          {active ? <button type="button" className={styles.secondary} disabled={paused || !dirty || !profile.speakingStyle.trim()} onClick={() => void saveDraft()}>保存梦境草稿</button> : null}
          <p className={styles.hint}>{dirty ? "页面中有未保存修改" : dream ? "已保存至梦境草稿" : "进入梦境后可以编辑"}</p>
          {active ? <button type="button" className={styles.danger} disabled={paused} onClick={() => setReview({ kind: "discard", state: dream })}>舍弃本次梦境</button> : null}
        </section>
        <section data-guide="dream-history"><h2>醒来的痕迹</h2><p className={styles.hint}>应用前后保留设定版本，可核对并恢复。</p>
          {dream?.versions.length ? [...dream.versions].reverse().map((version) => <div className={styles.version} key={version.id}><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}</time><p>{version.kind === "initial" ? "最初的设定" : version.kind === "restore" ? "恢复后的设定" : "一次醒来"}</p><details><summary className={styles.hint}>查看这一版</summary><p>{version.profile.personality.join("、")}</p><p>{version.profile.speakingStyle}</p></details><button type="button" className={styles.secondary} disabled={paused || dirty || needsRebase} onClick={() => setReview({ kind: "restore", state: dream, version })}>恢复这一版</button></div>) : <p className={styles.hint}>第一次结束入梦并确认应用后，版本会留在这里。</p>}
        </section>
      </aside>
    </div>
    <dialog className={styles.dialog} ref={dialog} data-guide-expected data-guide="dream-review" aria-label={review?.kind === "rebase" ? "确认最新人物基准" : review?.kind === "restore" ? "确认恢复版本" : review?.kind === "discard" ? "确认舍弃梦境" : "确认人物变化"} onCancel={(event) => { event.preventDefault(); if (!busy) setReview(null); }}>
      <h2>{review?.kind === "rebase" ? "核对梦境与最新的 TA" : review?.kind === "restore" ? "回到这一刻的 TA" : review?.kind === "discard" ? "舍弃这次梦境？" : "将这些细节带回人物"}</h2>
      {review?.kind === "discard" ? <p>本次未应用的练习、片段与草稿会被清空。正式人物和已保存的历史版本保留。</p> : <><p>{review?.kind === "rebase" ? "确认以最新人物资料继续，现有梦境草稿保留。本次不会修改正式人物；之后应用时仍需核对变化。" : "本次将更新人物的性格和说话方式。"}</p><div className={styles.diff}><section><h3>当前设定</h3><p>{companion?.personality.join("、") || "未填写性格"}</p><p>{companion?.speakingStyle}</p></section><section><h3>{review?.kind === "rebase" ? "保留的梦境草稿" : review?.kind === "restore" ? "恢复后的设定" : "确认后的设定"}</h3><p>{reviewProfile?.personality.join("、") || "未填写性格"}</p><p>{reviewProfile?.speakingStyle}</p></section></div>{review?.kind === "apply" ? <p>{review.state.fragments.filter((fragment) => fragment.confirmed).length} 条确认片段将被应用；未确认片段不参与本次人物更新。</p> : null}<p className={styles.hint}>聊天记录、背景、主动回响频率与长期记忆保留。</p></>}
      {unsent && review?.kind !== "rebase" ? <p className={styles.hint}>尚未提交的情境或反馈不会随本次操作保存，可以继续核对并先提交。</p> : null}
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => setReview(null)}>继续核对</button><button type="button" data-guide="dream-apply-confirm" className={review?.kind === "discard" ? styles.danger : styles.primary} disabled={Boolean(busy)} onClick={() => void confirmReview()}>{busy ? "正在保存…" : review?.kind === "rebase" ? "确认最新基准" : review?.kind === "restore" ? "确认恢复" : review?.kind === "discard" ? "确认舍弃" : "确认应用并醒来"}</button></div>
    </dialog>
  </main>;
}
