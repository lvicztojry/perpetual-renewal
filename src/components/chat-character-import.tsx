"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { parseTranscript } from "@/lib/import/transcript";
import type { CharacterDraft, CharacterImportAnalysis, CharacterPreviewMessage } from "@/lib/import/character-types";
import { relationshipKindLabels, type CompanionProfile } from "@/lib/renewal/types";
import styles from "./chat-character-import.module.css";

const MAX_BYTES = 1024 * 1024;
const MAX_CHARS = 200000;
const steps = ["选择记录", "核对设定", "临时试聊", "确认创建"];
type Transcript = ReturnType<typeof parseTranscript>;
type Operation = "file" | "analyze" | "preview" | "create";
type PreviewTurn = CharacterPreviewMessage & { source?: "model" | "local" };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validDraft(value: unknown): value is CharacterDraft {
  if (!record(value)) return false;
  return ["name", "customKind", "userAddress", "speakingStyle", "background"].every((key) => typeof value[key] === "string")
    && typeof value.relationshipKind === "string"
    && Object.hasOwn(relationshipKindLabels, value.relationshipKind)
    && ["personality", "toneExamples", "sharedMemories"].every((key) => Array.isArray(value[key]) && value[key].every((item: unknown) => typeof item === "string"));
}

function cleanDraft(draft: CharacterDraft): CharacterDraft {
  const lines = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
  return { ...draft, name: draft.name.trim(), customKind: draft.customKind.trim(), userAddress: draft.userAddress.trim(), speakingStyle: draft.speakingStyle.trim(), background: draft.background.trim(), personality: lines(draft.personality), toneExamples: lines(draft.toneExamples), sharedMemories: lines(draft.sharedMemories) };
}

// Keep previews bounded, even when a single imported message is very long.
function samplesFor(transcript: Transcript, speaker: string): string[] {
  return transcript.messages.filter((message) => message.speaker === speaker).slice(0, 3).map((message) => {
    const content = message.content;
    return content.length > 360 ? `${content.slice(0, 360)}…` : content;
  });
}

export function ChatCharacterImport({ onCreated, onCancel }: {
  onCreated: (companion: CompanionProfile) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [targetSpeaker, setTargetSpeaker] = useState("");
  const [selfSpeaker, setSelfSpeaker] = useState("");
  const [analysis, setAnalysis] = useState<CharacterImportAnalysis | null>(null);
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [history, setHistory] = useState<PreviewTurn[]>([]);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { chatEnd.current?.scrollIntoView?.({ block: "nearest" }); }, [history]);

  function resetPreview() {
    setHistory([]); setMessage(""); setVerified(false); setConfirmed(false);
  }

  function resetDerived() {
    setAnalysis(null); setDraft(null); resetPreview();
  }

  function changeText(value: string) {
    if (lock.current) return;
    setText(value); setTranscript(null); setTargetSpeaker(""); setSelfSpeaker("");
    setError(""); setStatus(""); resetDerived();
  }

  function parseLocal(value: string) {
    if (!value.trim()) { setError("请先粘贴聊天记录或选择文件。"); return; }
    if (value.length > MAX_CHARS) { setError("记录超过 200,000 字符，请缩短后重新导入。"); return; }
    try {
      const parsed = parseTranscript(value);
      setTranscript(parsed);
      setTargetSpeaker(""); setSelfSpeaker(""); resetDerived();
      if (parsed.participants.length < 2) {
        setError("未识别到至少两位说话者，请检查记录格式后重试。");
        setStatus("");
      } else {
        setError(""); setStatus("已识别聊天记录。请选择目标说话者和你自己。");
      }
    } catch {
      setTranscript(null); setError("无法解析这份记录，请检查 TXT、JSON 或 JSONL 内容后重试。"); setStatus("");
    }
  }

  async function readFile(file: File | undefined) {
    if (!file || lock.current) return;
    setError(""); setStatus("");
    if (!/\.(txt|json|jsonl)$/i.test(file.name)) { setError("请选择 TXT、JSON 或 JSONL 文件。"); return; }
    if (file.size > MAX_BYTES) { setError("文件超过 1 MiB，请缩小后重试。"); return; }
    lock.current = true; setBusy("file");
    try {
      const value = await file.text();
      if (!mounted.current) return;
      // Validate before calling the parser. Never silently truncate a transcript.
      if (value.length > MAX_CHARS) { setError("记录超过 200,000 字符，请缩短后重新导入。"); return; }
      setText(value); setTranscript(null); setTargetSpeaker(""); setSelfSpeaker(""); resetDerived();
      parseLocal(value);
    } catch {
      if (mounted.current) setError("无法读取文件，请重新选择或粘贴聊天记录。");
    } finally {
      if (mounted.current) { lock.current = false; setBusy(null); }
    }
  }

  async function request(body: object): Promise<unknown> {
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 60000);
    try {
      const response = await fetch("/api/character-import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal,
      });
      if (!response.ok) throw new Error("request failed");
      return await response.json();
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
    }
  }

  function begin(operation: Operation): boolean {
    if (lock.current) return false;
    lock.current = true; setBusy(operation); setError(""); setStatus(""); return true;
  }
  function end() {
    if (mounted.current) { lock.current = false; setBusy(null); }
  }

  const validSpeakers = Boolean(transcript && targetSpeaker && selfSpeaker && targetSpeaker !== selfSpeaker);
  const draftReady = Boolean(draft && draft.name.trim() && draft.name.length <= 80
    && draft.speakingStyle.trim() && draft.speakingStyle.length <= 1600
    && draft.customKind.length <= 80 && draft.userAddress.length <= 80 && draft.background.length <= 3000
    && (draft.relationshipKind !== "CUSTOM" || draft.customKind.trim())
    && ([[draft.personality, 8, 40], [draft.toneExamples, 8, 300], [draft.sharedMemories, 12, 500]] as const)
      .every(([items, maxItems, maxChars]) => {
        const lines = items.map((item) => item.trim()).filter(Boolean);
        return lines.length <= maxItems && lines.every((item) => item.length <= maxChars);
      }));

  async function analyze() {
    if (!validSpeakers || !begin("analyze")) return;
    try {
      const result = await request({ action: "analyze", text, targetSpeaker, selfSpeaker });
      if (!mounted.current) return;
      if (!record(result) || !validDraft(result.draft) || !["model", "local"].includes(String(result.source)) || !Array.isArray(result.warnings) || !result.warnings.every((warning) => typeof warning === "string")
        || !record(result.stats) || !Number.isFinite(result.stats.totalMessages) || !Number.isFinite(result.stats.sampledMessages)) throw new Error("invalid response");
      setAnalysis(result as CharacterImportAnalysis); setDraft(result.draft); resetPreview(); setStep(1);
      setStatus(result.source === "model" ? "已生成待核对的人物设定。" : "已生成本地基础草稿，尚未通过模型提炼。");
    } catch {
      if (mounted.current) setError("暂时无法提炼人物，记录和选择已保留，请重试。");
    } finally { end(); }
  }

  function editDraft<K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) {
    if (lock.current || !draft) return;
    setDraft({ ...draft, [key]: value }); resetPreview(); setError(""); setStatus("设定已修改，请重新试聊验证。");
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draftReady || !message.trim() || !begin("preview")) return;
    const content = message.trim();
    try {
      const result = await request({ action: "preview", draft: cleanDraft(draft), message: content, history: history.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 2000) })) });
      if (!mounted.current) return;
      if (!record(result) || typeof result.reply !== "string" || !result.reply.trim() || !["model", "local", "mock"].includes(String(result.source))) throw new Error("invalid response");
      const source = result.source === "model" ? "model" : "local";
      setHistory((previous) => [...previous, { role: "user", content }, { role: "assistant", content: result.reply as string, source }]);
      setMessage(""); setVerified(true);
      setStatus(source === "model" ? "已完成一次模型试聊，可继续对话或确认创建。" : "已完成一次本地模拟预览；这不是模型学习或模型试聊。");
    } catch {
      if (mounted.current) setError("暂时无法获得试聊回复，设定和输入已保留，请重试。");
    } finally { end(); }
  }

  async function create() {
    if (!draft || !draftReady || !verified || !confirmed || !begin("create")) return;
    let companion: CompanionProfile | null = null;
    try {
      const result = await request({ action: "create", draft: cleanDraft(draft) });
      if (!mounted.current) return;
      if (!record(result) || !record(result.companion) || typeof result.companion.id !== "string" || typeof result.companion.name !== "string") throw new Error("invalid response");
      companion = result.companion as CompanionProfile;
      setCreated(true); setStatus("人物已创建，正在返回聊天。");
    } catch {
      if (mounted.current) setError("暂时无法确认创建结果，设定已保留。请检查人物列表后再重试。");
    } finally {
      // A successful create stays locked while the parent navigates away.
      if (!companion) end();
    }
    if (companion) onCreated(companion);
  }

  function go(next: number) {
    if (lock.current) return;
    setStep(next); setError(""); setStatus("");
  }

  function draftSummary() {
    if (!draft) return null;
    const value = cleanDraft(draft);
    const entries = [
      ["关系", relationshipKindLabels[value.relationshipKind] + (value.relationshipKind === "CUSTOM" ? ` · ${value.customKind}` : "")],
      ["对你的称呼", value.userAddress], ["性格", value.personality.join("、")], ["说话方式", value.speakingStyle],
      ["背景", value.background], ["语气示例", value.toneExamples.join("\n")], ["共同回忆", value.sharedMemories.join("\n")],
    ];
    return <section className={styles.summary} aria-label="人物设定预览"><h3>{value.name || "尚未命名"}</h3><dl>{entries.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content || "未填写"}</dd></div>)}</dl></section>;
  }

  return (
    <main className={styles.main} aria-labelledby={`${id}-title`} aria-busy={Boolean(busy)}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <button type="button" className={styles.back} disabled={Boolean(busy)} onClick={() => { if (!lock.current) onCancel(); }}>← 返回聊天</button>
          <span className={styles.eyebrow}>人物 · 从记录开始</span>
          <h1 id={`${id}-title`}>从聊天记录创建人物</h1>
          <p>整理熟悉的语气与相处片段，先核对，再试聊。</p>
        </header>
        <ol className={styles.steps} aria-label="创建进度">{steps.map((label, index) => <li key={label} className={index === step ? styles.currentStep : index < step ? styles.doneStep : ""} aria-current={index === step ? "step" : undefined}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{label}</li>)}</ol>
        <div className={styles.status} role="status" aria-live="polite">{busy ? ({ file: "正在本地读取记录…", analyze: "正在提炼人物设定…", preview: "正在生成临时试聊回复…", create: created ? "人物已创建，正在返回聊天…" : "正在创建人物，请勿重复操作…" }[busy]) : status}</div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <section className={styles.panel}>
          <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
          <fieldset className={styles.fields} disabled={Boolean(busy)}>
            <legend className={styles.srOnly}>{steps[step]}</legend>
            {step === 0 && <>
              <p className={styles.hint}>支持带说话者的 TXT、JSON、JSONL。文件最多 1 MiB，聊天内容最多 200,000 字符。</p>
              <label className={styles.field}>选择聊天记录文件<input type="file" accept=".txt,.json,.jsonl" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void readFile(file); }} /></label>
              <label className={styles.field}>或粘贴聊天记录<textarea rows={9} value={text} onChange={(event) => changeText(event.target.value)} placeholder={"例如：\n小林：今天过得怎么样？\n我：刚刚下班。"} spellCheck={false} aria-describedby={`${id}-limit`} /></label>
              <div className={styles.inline}><span id={`${id}-limit`} className={styles.hint}>{text.length.toLocaleString()} / 200,000 字符</span><button className={styles.secondary} type="button" disabled={!text.trim() || text.length > MAX_CHARS} onClick={() => { if (!lock.current) parseLocal(text); }}>本地解析记录</button></div>
              {transcript && <>
                <p className={styles.hint}>共 {transcript.totalMessages} 条消息 · {transcript.participants.length} 位说话者</p>
                {transcript.warnings.length > 0 && <details className={styles.details}><summary>解析提示（{transcript.warnings.length}）</summary><ul>{transcript.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
                <div className={styles.grid}>{(["target", "self"] as const).map((kind) => <label key={kind} className={styles.field}>{kind === "target" ? "要创建的人物（目标说话者）" : "我在记录中的说话者"}<select value={kind === "target" ? targetSpeaker : selfSpeaker} onChange={(event) => {
                  if (lock.current) return;
                  if (kind === "target") setTargetSpeaker(event.target.value); else setSelfSpeaker(event.target.value);
                  resetDerived(); setError(""); setStatus("");
                }}><option value="">请选择说话者</option>{transcript.participants.map(({ name, count }) => <option key={name} value={name} disabled={name === (kind === "target" ? selfSpeaker : targetSpeaker)}>{name}（{count} 条）</option>)}</select></label>)}</div>
                <div className={styles.grid}>{[targetSpeaker, selfSpeaker].map((speaker, index) => <section className={styles.samples} key={index}><h3>{index === 0 ? "目标人物的样本" : "我的样本"}</h3>{speaker ? <><p className={styles.hint}>{speaker} · {transcript.participants.find((participant) => participant.name === speaker)?.count ?? 0} 条，展示前 3 条</p>{samplesFor(transcript, speaker).map((sample, sampleIndex) => <blockquote key={sampleIndex}>{sample}</blockquote>)}</> : <p className={styles.hint}>选择说话者后显示样本。</p>}</section>)}</div>
              </>}
              <aside className={styles.notice}>选择与预览记录时，内容留在你的设备上。点击「提炼人物」后，才会将选中双方的样本发送给你配置的模型；不会保存原始文件。</aside>
              <div className={styles.actions}>{draft ? <button className={styles.secondary} type="button" onClick={() => go(1)}>继续核对已有设定</button> : null}<button className={styles.primary} type="button" disabled={!validSpeakers} onClick={() => void analyze()}>提炼人物 →</button></div>
            </>}
            {step === 1 && draft && <>
              <aside className={styles.notice}>{analysis?.source === "model" ? "以下内容由模型推断，可能不准确，请逐项核对。" : "以下是本地基础草稿，并非模型学习结果，请自行补充和核对。"} 背景、共同回忆和语气示例都需要你确认。</aside>
              {analysis && <p className={styles.hint}>选中双方共 {analysis.stats.totalMessages} 条消息 · 本次选取 {analysis.stats.sampledMessages} 条</p>}
              {analysis && analysis.warnings.length > 0 && <details className={styles.details}><summary>提炼提示（{analysis.warnings.length}）</summary><ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
              <div className={styles.grid}>
                <label className={styles.field}>人物名字（必填，最多 80 字）<input value={draft.name} maxLength={80} required onChange={(event) => editDraft("name", event.target.value)} /></label>
                <label className={styles.field}>关系类型<select value={draft.relationshipKind} onChange={(event) => editDraft("relationshipKind", event.target.value as CharacterDraft["relationshipKind"])}>{Object.entries(relationshipKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className={styles.field}>自定义关系{draft.relationshipKind === "CUSTOM" ? "（必填）" : "（选填）"}<input value={draft.customKind} maxLength={80} required={draft.relationshipKind === "CUSTOM"} onChange={(event) => editDraft("customKind", event.target.value)} /></label>
                <label className={styles.field}>对你的称呼<input value={draft.userAddress} maxLength={80} onChange={(event) => editDraft("userAddress", event.target.value)} /></label>
              </div>
              <label className={styles.field}>性格（每行一项，最多 8 项，每项 40 字）<textarea rows={3} value={draft.personality.join("\n")} onChange={(event) => editDraft("personality", event.target.value.split("\n"))} /></label>
              <label className={styles.field}>说话方式（必填，最多 1,600 字）<textarea rows={3} value={draft.speakingStyle} maxLength={1600} required onChange={(event) => editDraft("speakingStyle", event.target.value)} /></label>
              <label className={styles.field}>人物背景（最多 3,000 字）<textarea rows={4} value={draft.background} maxLength={3000} onChange={(event) => editDraft("background", event.target.value)} /></label>
              <label className={styles.field}>语气示例（每行一项，最多 8 项，每项 300 字）<textarea rows={4} value={draft.toneExamples.join("\n")} onChange={(event) => editDraft("toneExamples", event.target.value.split("\n"))} /></label>
              <label className={styles.field}>共同回忆（每行一项，最多 12 项，每项 500 字）<textarea rows={4} value={draft.sharedMemories.join("\n")} onChange={(event) => editDraft("sharedMemories", event.target.value.split("\n"))} /></label>
              <details className={styles.details}><summary>预览当前人物设定</summary>{draftSummary()}</details>
              {!draftReady && <p className={styles.hint}>请填写人物名字、说话方式和自定义关系（如适用），并核对各字段的字数与条目上限。称呼和自定义关系最多 80 字。</p>}
              <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => go(0)}>← 上一步</button><button className={styles.primary} type="button" disabled={!draftReady} onClick={() => go(2)}>去试聊 →</button></div>
            </>}
            {step === 2 && draft && <>
              <p className={styles.hint}>试着聊一句，看看语气是否合适。当前设定和最近 6 轮试聊（每条最多 2,000 字）会发给模型。试聊临时保留，离开即清除，不进入正式聊天记录；修改设定后需要重新试聊。</p>
              <div className={styles.chat} role="log" aria-label="临时试聊记录" aria-live="polite" aria-relevant="additions">
                {history.length === 0 && <p className={styles.empty}>还没有试聊消息。可以从一句日常问候开始。</p>}
                {history.map((turn, index) => <article key={index} className={turn.role === "user" ? styles.userMessage : styles.assistantMessage}><span className={styles.messageLabel}>{turn.role === "user" ? "我" : `${draft.name} · ${turn.source === "model" ? "模型试聊" : "本地模拟预览，非模型学习"}`}</span><p>{turn.content}</p></article>)}
                <div ref={chatEnd} />
              </div>
              <form className={styles.composer} onSubmit={(event) => void preview(event)}><label className={styles.field}>试聊消息（最多 2,000 字）<textarea rows={3} value={message} maxLength={2000} onChange={(event) => setMessage(event.target.value)} placeholder="今天过得怎么样？" /></label><button className={styles.primary} type="submit" disabled={!message.trim() || !draftReady}>发送试聊</button></form>
              {!verified && <p className={styles.hint}>至少成功获得一次试聊回复，才能继续创建。本地模拟回复会明确标注来源。</p>}
              <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => go(1)}>← 返回修改设定</button><button className={styles.primary} type="button" disabled={!verified} onClick={() => go(3)}>确认设定 →</button></div>
            </>}
            {step === 3 && draft && <>
              <p className={styles.hint}>最后核对一次。只有点击「确认创建人物」才会保存人物设定。</p>
              {draftSummary()}
              <aside className={styles.notice}>{history.some((turn) => turn.source === "model") ? "已完成模型试聊。" : "已完成本地模拟预览，尚未验证真实模型的回复效果。"} 人物是基于记录整理的模拟设定，不代表原人物本人；提炼内容可能包含推断。</aside>
              <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对设定和试聊结果，确认保存当前人物设定。原始文件和临时试聊不保存。</span></label>
              <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => go(2)}>← 返回试聊</button><button className={styles.primary} type="button" disabled={!verified || !confirmed || !draftReady} onClick={() => void create()}>确认创建人物</button></div>
            </>}
          </fieldset>
        </section>
        <p className={styles.footer}>记录与未确认的设定临时保留，离开即清除。只有确认创建后才会保存人物。</p>
      </div>
    </main>
  );
}
