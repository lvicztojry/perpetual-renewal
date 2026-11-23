import { useEffect, useRef, useState } from "react";
import { MessageSquareText, X } from "lucide-react";
import releases from "../../../src/lib/release-notes.json";

const seenKey = "renewal.release-notice.seen";
let seenInProcess = "";

export function ReleaseNotice({ login = false }: { login?: boolean }) {
  const [open, setOpen] = useState(() => {
    let seen = seenInProcess;
    try { seen = localStorage.getItem(seenKey) ?? seen; } catch { /* Keep a process-local fallback when storage is unavailable. */ }
    return seen !== releases[0].id;
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      // Record actual display, so even exiting before dismissing does not repeat it.
      seenInProcess = releases[0].id;
      try { localStorage.setItem(seenKey, releases[0].id); } catch { /* Manual viewing remains available. */ }
    } else if (!open && node.open) node.close();
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <>
    <button ref={trigger} className={`release-message-button${login ? " release-message-login" : ""}`} aria-label="消息与更新公告" title="消息与更新公告" onClick={() => setOpen(true)} type="button"><MessageSquareText size={17}/><span>消息</span></button>
    <dialog ref={dialog} className="release-notice" aria-labelledby="release-notice-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}>
      <header className="release-notice-header"><div><p>生生不息 · 版本动态</p><h2 id="release-notice-title">更新公告</h2></div><button type="button" aria-label="关闭更新公告" onClick={close} autoFocus><X size={20}/></button></header>
      <div className="release-notice-scroll">
        {releases.map((release, index) => <article key={release.id} className="release-notice-entry"><p className="release-notice-meta">{index === 0 ? "当前版本 · " : "历史更新 · "}{release.version} · <time dateTime={release.date}>{release.date}</time></p><h3>{release.title}</h3>{release.sections.map(section => <section key={section.title}><h4>{section.title}</h4><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</article>)}
      </div>
      <footer><p>新版本仅自动展示一次，之后可从右上角“消息”再次查看。</p><button type="button" onClick={close}>我知道了</button></footer>
    </dialog>
  </>;
}
