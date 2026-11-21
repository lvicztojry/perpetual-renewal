"use client";

import styles from "./sync-access-notice.module.css";

export function SyncAccessNotice({ reason }: { reason: "signed-out" | "account-changed" }) {
  return <main className="empty" style={{ maxWidth: 540, margin: "15vh auto", padding: 32 }}>
    <h1>{reason === "signed-out" ? "登录已过期" : "账号已切换"}</h1>
    <p>{reason === "signed-out" ? "请在新页面重新登录。当前输入暂存在此页，回到原账号后可以继续。" : "为了不把这段对话带入其他账号，请切回原账号继续，或重新进入当前账号。"}</p>
    <a className="text-button" href="/login" target="_blank" rel="noopener noreferrer">重新登录</a>
    {reason === "account-changed" && <button type="button" className="text-button" onClick={() => window.location.reload()}>重新进入当前账号</button>}
  </main>;
}

export function UnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className={`${styles.badge} unread-badge`} aria-label={`${count} 条未读`}>{count > 99 ? "99+" : count}</span> : null;
}
