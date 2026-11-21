"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { Users, X } from "lucide-react";
import { STARTER_CHARACTERS } from "@/lib/starters/catalog";
import styles from "./starter-pack-entry.module.css";

export function StarterPackEntry() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function install() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/starters", { method: "POST" });
      if (!response.ok) {
        setError(response.status === 401 ? "请先登录，再来认识他们。" : "暂时未能添加，请稍后重试。");
        return;
      }
      const result = await response.json() as { groupId: string };
      dialog.current?.close();
      router.push(("/groups/" + encodeURIComponent(result.groupId)) as Route);
      router.refresh();
    } catch { setError("连接中断了，可以再试一次。"); }
    finally { setBusy(false); }
  }
  return <div className={styles.entry}>
    <button className="text-button" type="button" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
      <Users size={17} /> 认识留灯会
    </button>
    <dialog ref={dialog} className={styles.preview} aria-labelledby={titleId} onClose={() => setOpen(false)}>
      <div className={styles.heading}><h3 id={titleId}>留灯会</h3>
        <button type="button" aria-label="关闭人物介绍" onClick={() => dialog.current?.close()}><X size={20} /></button>
      </div>
      <p>六位性格不同、彼此熟悉的朋友。可以先和他们聊聊，再慢慢创建你想见的人。</p>
      <ul>{STARTER_CHARACTERS.map(person => <li key={person.key}>
        <strong>{person.name} · {person.age}岁</strong><span>{person.tagline}</span>
      </li>)}</ul>
      <p>添加六位联系人和一个群聊，随时可以修改人物。已有的内容会保留。</p>
      <button className={styles.install} disabled={busy} type="button" onClick={() => void install()}>
        {busy ? "正在添加…" : "添加人物，进入留灯会"}
      </button>
      <p><Link href="/story">故事背景</Link></p>
      {error && <p role="alert">{error}</p>}
    </dialog>
  </div>;
}
