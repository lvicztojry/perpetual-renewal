"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Moon } from "lucide-react";
import { RenewalEmblem } from "./renewal-emblem";
import { playAbilityIntro } from "@/lib/ability-events";
import styles from "./echoes-gallery.module.css";

export function EchoesGallery() {
  const [short, setShort] = useState(false);
  return <main className={styles.page}>
    <Link className={styles.back} href="/"><ArrowLeft size={15} />返回聊天</Link>
    <header className={styles.header}><RenewalEmblem width={48} height={58} /><p>生生不息 / 回响录</p><h1>念念不忘，必有回响。</h1><span>钟声响起之时，一个名字便有了回应。</span></header>
    <div className={styles.abilities}>
      <article className={styles.ability}>
        <div className={`${styles.art} ${styles.birth}`} aria-hidden="true"><div /></div>
        <div className={styles.content}><span className={styles.kicker}>激荡 / 初见</span><h2>生生不息</h2><p>以想念为形，让一个身影从光中浮现。姓名、关系与最初的印象，成为这次相遇的起点。</p><blockquote>我看到了【生生不息】的激荡</blockquote><button type="button" onClick={() => playAbilityIntro({ kind: "renewal", companionName: "想见的人", short, autoPlay: true })}><Bell size={17} />发动生生不息</button></div>
      </article>
      <article className={styles.ability}>
        <div className={`${styles.art} ${styles.dream}`} aria-hidden="true"><div /></div>
        <div className={styles.content}><span className={styles.kicker}>回响 / 入梦</span><h2>入梦</h2><p>沿着余响进入人物的梦境。在一句句交谈与纠正中，拾起语气、性情和表达的细节。</p><blockquote>我听到了【入梦】的回响</blockquote><button type="button" onClick={() => playAbilityIntro({ kind: "dream", companionName: "梦中之人", short, autoPlay: true })}><Moon size={17} />发动入梦</button></div>
      </article>
    </div>
    <label className={styles.short}><input type="checkbox" checked={short} onChange={(event) => setShort(event.target.checked)} />使用短版演示</label>
    <section className={styles.notes} aria-labelledby="echoes-notes"><h2 id="echoes-notes">此地的故事</h2><p>本项目是一份基于《十日终焉》意象的二创：以「生生不息」创造初形，以「入梦」完善人物。钟与屏幕见证能力发动，用户确认的细节留存在人物设定中。</p><p>“入梦补齐设定”、光团显影、梦境门与记忆碎片，是本项目的二创演绎。入梦练习单独保存，只有“保存并醒来”才会应用到正式人物。</p><a href="https://fanqienovel.com/page/7143038691944959011" target="_blank" rel="noreferrer">阅读《十日终焉》原作 ↗</a><p className={styles.hint}>此页仅演示动画，不创建人物、不调用模型。动画中可静音、跳过；系统减少动态效果设置同样生效。</p></section>
  </main>;
}
