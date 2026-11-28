"use client";

import { Fragment, useCallback, useId, useEffect, useMemo, useState } from "react";
import { getCourse } from "@/lib/journey/courses";
import type { CourseProgress } from "@/lib/journey/types";
import type { GuideController } from "./use-guide-controller";
import styles from "./journey-directory.module.css";

const resultLabels: Record<string, string> = {
  learned: "已了解", practiced: "已完成", reused: "已复用", deferred: "稍后继续", skipped: "已跳过"
};

function statusOf(progress: CourseProgress | undefined) {
  if (!progress) return "未开始";
  if (progress.result) return resultLabels[progress.result] ?? "进行中";
  return "进行中";
}

/** The lamp-lit path list: keep walking, look at this place, every road, replay the story. */
export function JourneyDirectory({ guide, context, forceOpen = false }: {
  guide: GuideController;
  context: { companionId?: string; groupId?: string; pageCourse?: string };
  /** A step that walks her through the list itself shows it without a click. */
  forceOpen?: boolean;
}) {
  const titleId = useId();
  const [confirmReplay, setConfirmReplay] = useState(false);
  const [busy, setBusy] = useState(false);
  const journey = guide.journey;
  const active = journey?.activeCourse ?? null;
  const courses = useMemo(() => ["main", "people", "chat", "memory", "material-import", "chat-character", "dream", "groups", "group-memory", "voice", "proactive", "model", "preferences", "account-data"].map(getCourse).filter(Boolean), []);

  const start = useCallback(async (courseId: string, mode?: "first" | "review") => {
    setBusy(true);
    try { await guide.start(courseId, { mode, context }); } finally { setBusy(false); }
  }, [guide, context]);

  useEffect(() => {
    if (forceOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") guide.closeDirectory(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [guide, forceOpen]);

  if (!guide.directoryOpen && !forceOpen) return null;
  const dismiss = forceOpen ? undefined : guide.closeDirectory;

  return <div className={styles.backdrop} data-journey-overlay role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={event => { if (dismiss && event.target === event.currentTarget) dismiss(); }}>
    <div className={styles.panel} data-guide="course-directory">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>生生不息 · 一盏归灯</p>
          <h2 id={titleId}>主线与支线</h2>
          <p className={styles.hint}>{forceOpen ? "这一页会带你认路。看完点卡片上的「知道了」，继续主线。" : "主线是初醒到收尾的一整程；支线是随时能单独进去的功能，想重看哪段都可以。"}</p>
        </div>
        {dismiss ? <button className={styles.close} type="button" aria-label="关闭主线与支线" onClick={dismiss}>×</button> : null}
      </header>
      {guide.error ? <p className={styles.error} role="alert">{guide.error}</p> : null}
      <div className={styles.actions}>
        {active ? <button className={styles.primary} type="button" disabled={busy || forceOpen} onClick={() => guide.closeDirectory()}>继续：{getCourse(active.id)?.title}</button> : null}
        {/* Legacy or fresh accounts have no main progress yet; the main line still starts. */}
        {!active && journey ? <button className={styles.primary} type="button" disabled={busy} onClick={() => void start("main")}>
          {journey.courses.main?.checkpoint ? "继续主线" : "开始主线"}
        </button> : null}
        {context.pageCourse ? <button type="button" disabled={busy} onClick={() => void start(context.pageCourse!, "review")}>当前页面的支线</button> : null}
        {confirmReplay ? <>
          <span className={styles.hint}>重看主线只重新讲一遍剧情，不会动你的人物、消息，也不会清除已完成的记录。</span>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void start("main", "review")}>确认重看</button>
          <button type="button" onClick={() => setConfirmReplay(false)}>取消</button>
        </> : <button type="button" disabled={busy} onClick={() => setConfirmReplay(true)}>重看主线</button>}
        {journey?.deferredCourses.length ? <span className={styles.badge}>稍后继续：{journey.deferredCourses.map(id => getCourse(id)?.title ?? id).join("、")}</span> : null}
      </div>
      <ul className={styles.list}>
        {courses.map(course => {
          if (!course) return null;
          const progress = journey?.courses[course.id];
          const result = progress?.result;
          const isMain = course.id === "main";
          return <Fragment key={course.id}>
            {course.id === "people" ? <li className={styles.groupTitle} aria-hidden="true">支线</li> : null}
            <li className={`${styles.item} ${active?.id === course.id ? styles.current : ""}`}>
              <div className={styles.itemHead}>
                <strong>{course.title}</strong>
                <span className={styles.tag}>{isMain ? "主线" : "支线"}</span>
                <span className={styles.status} data-result={result ?? "none"}>{statusOf(progress)}</span>
              </div>
              <p className={styles.prerequisite}>{course.prerequisite}</p>
              <p className={styles.hint}>{course.fallbackCopy}</p>
              <div className={styles.itemActions}>
                <button type="button" disabled={busy || active?.id === course.id} onClick={() => void start(course.id, result ? "review" : "first")}>
                  {result ? "重看" : progress?.checkpoint ? "继续" : "开始"}
                </button>
                {result ? <span className={styles.hint}>上次：{resultLabels[result]}{progress?.reused ? " · 用了现有人物" : ""}{progress?.milestones.length ? ` · 已完成 ${progress.milestones.length} 步` : ""}</span> : null}
              </div>
            </li>
          </Fragment>;
        })}
      </ul>
    </div>
  </div>;
}
