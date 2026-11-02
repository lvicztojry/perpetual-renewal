"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, LoaderCircle, LogOut, Mail, ShieldCheck } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { UserProfile } from "@/lib/users/profile";
import styles from "./personal-account.module.css";

export function PersonalAccount({ initialUser, passwordAccount }: { initialUser: UserProfile; passwordAccount: boolean }) {
  const [user, setUser] = useState(initialUser);
  const [nickname, setNickname] = useState(initialUser.nickname);
  const [timezone, setTimezone] = useState(initialUser.timezone);
  const [language, setLanguage] = useState(initialUser.language);
  const [busy, setBusy] = useState<"save" | "reset" | "logout" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function perform(action: NonNullable<typeof busy>, operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action); setNotice(""); setError("");
    try { await operation(); }
    catch { setError(action === "save" ? "资料未能保存，请稍后重试。" : action === "reset" ? "重置邮件暂未发送，请稍后重试。" : "暂时无法退出，请重试。"); }
    finally { inFlight.current = false; setBusy(null); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform("save", async () => {
      const response = await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim(), timezone: timezone.trim(), language: language.trim() }) });
      if (!response.ok) throw new Error("save_failed");
      const payload = await response.json() as { user?: UserProfile };
      if (!payload.user) throw new Error("invalid_response");
      setUser(payload.user); setNickname(payload.user.nickname); setTimezone(payload.user.timezone); setLanguage(payload.user.language);
      setNotice("个人资料已保存。");
    });
  }

  function requestReset() {
    void perform("reset", async () => {
      const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }) });
      if (!response.ok) throw new Error("reset_failed");
      setNotice("如果该邮箱可用于恢复账号，你会收到密码重置邮件，请留意收件箱。完成重置后请重新登录。");
    });
  }

  function logout() {
    void perform("logout", async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout_failed");
      window.location.replace("/login");
    });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.secondaryButton} href="/"><ArrowLeft size={17} aria-hidden="true" />返回聊天</Link>
        <p className={styles.eyebrow}>生生不息 / 我的账号</p>
        <h1 className={styles.title}>我的账号</h1>
        <p className={styles.subtitle}>给每一次相遇，留下你的称呼。</p>
      </header>
      <div className={styles.layout}>
        <aside className={styles.identity} aria-label="账号概览">
          <div className={styles.avatar} aria-hidden="true">{user.nickname.trim().slice(0, 1) || "我"}</div>
          <h2 className={styles.nickname}>{user.nickname}</h2>
          <p className={styles.email}>{user.email}</p>
          <p className={styles.session}><Check size={14} aria-hidden="true" />已登录</p>
          <nav className={styles.navigation} aria-label="账号分区">
            <a href="#personal-profile">个人资料</a><a href="#personal-security">账号安全</a><a href="#personal-privacy">数据与隐私</a>
            <Link href="/settings">应用设置<ArrowUpRight size={14} aria-hidden="true" /></Link>
          </nav>
        </aside>
        <div className={styles.content}>
          <section className={styles.section} id="personal-profile" aria-labelledby="personal-profile-title">
            <h2 className={styles.sectionHeading} id="personal-profile-title">个人资料</h2>
            <p className={styles.sectionDescription}>这些信息用于保存你的称呼和偏好。</p>
            <form className={styles.form} onSubmit={save}>
              <label className={styles.field}>昵称<input autoComplete="nickname" required maxLength={40} value={nickname} disabled={busy !== null} onChange={(event) => setNickname(event.target.value)} /></label>
              <div className={styles.emailRow}><span>登录邮箱</span><span>{user.email}</span></div>
              <div className={styles.fields}>
                <label className={styles.field}>时区<input required maxLength={64} value={timezone} list="personal-timezones" disabled={busy !== null} onChange={(event) => setTimezone(event.target.value)} />
                  <datalist id="personal-timezones"><option value="Asia/Shanghai" /><option value="Asia/Singapore" /><option value="Asia/Tokyo" /><option value="Europe/London" /><option value="America/New_York" /><option value="UTC" /></datalist>
                </label>
                <label className={styles.field}>语言<input required minLength={2} maxLength={16} value={language} list="personal-languages" disabled={busy !== null} onChange={(event) => setLanguage(event.target.value)} />
                  <datalist id="personal-languages"><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option></datalist>
                </label>
              </div>
              <div className={styles.actions}><button className={styles.primaryButton} type="submit" disabled={busy !== null}>
                {busy === "save" ? <LoaderCircle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{busy === "save" ? "正在保存…" : "保存个人资料"}
              </button></div>
            </form>
          </section>
          <section className={styles.section} id="personal-security" aria-labelledby="personal-security-title">
            <h2 className={styles.sectionHeading} id="personal-security-title">账号安全</h2>
            <div className={styles.securityRow}><div><ShieldCheck size={18} className={styles.icon} aria-hidden="true" /><strong>登录方式</strong><p className={styles.sectionDescription}>{passwordAccount ? "邮箱与密码" : "本机体验会话"}</p></div></div>
            <div className={styles.securityRow}><div><Mail size={18} className={styles.icon} aria-hidden="true" /><strong>密码重置</strong><p className={styles.sectionDescription}>发送重置链接到登录邮箱。完成重置后，旧会话将失效。</p></div>
              <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={requestReset}>{busy === "reset" ? "正在发送…" : "发送密码重置邮件"}</button>
            </div>
          </section>
          <section className={styles.section} id="personal-privacy" aria-labelledby="personal-privacy-title">
            <h2 className={styles.sectionHeading} id="personal-privacy-title">数据与隐私</h2>
            <p className={styles.sectionDescription}>在应用设置中导出自己的记录，或管理账号删除。</p>
            <Link className={styles.linkRow} href="/settings#account-privacy">管理我的数据<ArrowUpRight size={16} aria-hidden="true" /></Link>
          </section>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.actions}><button className={styles.dangerButton} type="button" disabled={busy !== null} onClick={logout}><LogOut size={17} aria-hidden="true" />{busy === "logout" ? "正在退出…" : "退出登录"}</button></div>
        </div>
      </div>
    </main>
  );
}
