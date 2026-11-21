import clientPackage from "../../package.json";
import { useEffect, useState, type FormEvent } from "react";
import { RenewalWorkspace } from "@/components/renewal-workspace";
import { GroupWorkspace } from "@/components/group-workspace";
import { DreamWorkspace } from "@/components/dream-workspace";
import { UserSettings } from "@/components/user-settings";
import { PersonalAccount } from "@/components/personal-account";
import { EchoesGallery } from "@/components/echoes-gallery";
import { ChatCharacterCreatePage } from "@/components/chat-character-create-page";
import StoryPage from "../../../src/app/story/page";
import { BellIntro } from "@/components/bell-intro";
import { getUserProfile, type UserProfile } from "@/lib/users/profile";
import { clearLocalSession, exclusive, localSession, loginLocalAccount, recoverLocalAccount, registerLocalAccount } from "../runtime/account";
import { createBackup, listBackups, restoreBackup } from "../runtime/database";
import { navigate } from "./navigation";

function LocalLogin({ onUnlock }: { onUnlock: () => void }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [issued, setIssued] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      await exclusive(async () => {
        if (mode === "recover") {
          await recoverLocalAccount(email, recovery, password);
          setMode("login"); setNotice("密码已更新，请使用新密码解锁原数据。");
        } else if (mode === "register") {
          const code = await registerLocalAccount(email, password);
          setIssued(code);
        } else { await loginLocalAccount(email, password); onUnlock(); }
      });
    } catch (error) { setNotice(error instanceof Error ? error.message : "本地账户未能解锁。"); }
    finally { setBusy(false); setPassword(""); }
  }
  return <main className="local-login"><div className="local-card">
    <p className="local-kicker">生生不息 · 本地测试</p><h1>{issued ? "保管你的恢复码" : mode === "register" ? "创建本地账户" : mode === "recover" ? "恢复原账户" : "回到你的旧城"}</h1>
    {issued ? <><p>忘记密码时，凭恢复码解锁原数据。恢复码仅在此显示，请单独妥善保存。</p><textarea readOnly aria-label="恢复码" value={issued}/><button onClick={() => { setIssued(""); onUnlock(); }}>我已保存，进入应用</button></> : <>
      <p>人物、聊天和个人 Key 保存在此设备。邮箱用于区分本地账户，不发送验证邮件。</p>
      <form onSubmit={submit}><label>邮箱标识<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="username"/></label>
      {mode === "recover" && <label>恢复码<input value={recovery} onChange={event => setRecovery(event.target.value)} required autoComplete="off"/></label>}
      <label>{mode === "recover" ? "新密码" : "密码"}<input type="password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"}/></label>
      <button disabled={busy}>{busy ? "正在解锁…" : mode === "register" ? "创建账户" : mode === "recover" ? "保留数据并重设密码" : "解锁"}</button></form>
      <div className="local-actions">{[ ["login", "登录"], ["register", "创建账户"], ["recover", "忘记密码"] ].map(([value, label]) => <button key={value} disabled={busy} onClick={() => { setMode(value); setNotice(""); }}>{label}</button>)}</div>
    </>}{notice && <p role="status">{notice}</p>}
  </div></main>;
}

export function App() {
  const [locking, setLocking] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [notice, setNotice] = useState("");
  const [backups, setBackups] = useState<string[] | null>(null);
  const [backupName, setBackupName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const session = localSession();
  const userId = session?.userId;
  const path = (window.location.hash.slice(1) || "/").split("?")[0];
  const refresh = () => setEpoch(value => value + 1);
  useEffect(() => {
    window.addEventListener("hashchange", refresh); window.addEventListener("native-navigation", refresh);
    return () => { window.removeEventListener("hashchange", refresh); window.removeEventListener("native-navigation", refresh); };
  }, []);
  useEffect(() => {
    const failed = () => setNotice("文件未保存，请重新选择保存位置。");
    window.addEventListener("native-file-save-error", failed);
    return () => window.removeEventListener("native-file-save-error", failed);
  }, []);
  useEffect(() => {
    const resize = () => document.documentElement.style.setProperty("--native-content-height", `${Math.max(180, (window.visualViewport?.height ?? window.innerHeight) - 38)}px`);
    resize(); window.visualViewport?.addEventListener("resize", resize); window.addEventListener("resize", resize);
    return () => { window.visualViewport?.removeEventListener("resize", resize); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    if (userId) void getUserProfile(userId).then(setProfile);
  }, [userId, epoch]);
  useEffect(() => {
    let running = false;
    async function tick() {
      if (!localSession() || (/Android|iPhone|iPad/.test(navigator.userAgent) && document.visibilityState === "hidden") || running) return;
      running = true;
      try {
        await fetch("/api/proactive/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: false }) });
        await fetch("/api/local/groups/run", { method: "POST" });
      } catch { /* Resume on the next foreground opportunity. No unbounded catch-up loop. */ }
      finally { running = false; }
    }
    const interval = window.setInterval(tick, 60000);
    const resume = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", resume);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", resume); };
  }, []);
  if (locking) return <main className="local-login"><p>正在保存并锁定本地账户…</p></main>;
  if (!session) return <LocalLogin onUnlock={() => { navigate("/"); refresh(); }}/>;
  let content;
  if (path === "/settings") content = <UserSettings/>;
  else if (path === "/account" && profile?.id === session.userId) content = <PersonalAccount initialUser={profile} passwordAccount={false} onSignedOut={refresh}/>;
  else if (path === "/echoes") content = <EchoesGallery/>;
  else if (path === "/story") content = <StoryPage/>;
  else if (path === "/create-from-chat") content = <ChatCharacterCreatePage/>;
  else if (path.startsWith("/dream/")) content = <DreamWorkspace companionId={decodeURIComponent(path.slice(7))}/>;
  else if (path === "/groups" || path.startsWith("/groups/")) content = <GroupWorkspace key={path} userId={session.userId} groupId={path.startsWith("/groups/") ? decodeURIComponent(path.slice(8)) : undefined}/>;
  else content = <RenewalWorkspace userId={session.userId} signedIn/>;
  return <><div className="local-toolbar"><span data-native-version={clientPackage.version}>本地测试 {clientPackage.version} · {session.email}</span>
    <button onClick={async () => { try { const name = await exclusive(createBackup); setNotice(`备份已保存：${name}`); } catch { setNotice("备份未完成，请保留原数据重试。"); } }}>备份数据</button>
    <button onClick={async () => { try { const names = await exclusive(listBackups); setBackups(names); setBackupName(names[0] ?? ""); setConfirmation(""); } catch { setNotice("未能读取备份，请保留原数据。"); } }}>恢复</button>
    <button onClick={() => { setLocking(true); void exclusive(async () => { clearLocalSession(); setProfile(null); refresh(); setLocking(false); }); }}>锁定</button></div>
    {notice && <div className="local-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>关闭</button></div>}
    {backups && <div className="local-restore" role="dialog" aria-modal="true" aria-label="恢复本地备份"><div className="local-card"><h2>恢复本地备份</h2><p>这会将此设备的所有本地账户恢复到所选备份。恢复前会保存当前数据库，完成后需要重新登录。</p>
      <label>选择备份<select value={backupName} onChange={event => setBackupName(event.target.value)}>{backups.map(name => <option key={name}>{name}</option>)}</select></label>
      {!backups.length && <p>暂无可恢复的原生备份。</p>}
      <label>输入“恢复备份”确认<input value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
      <button disabled={!backupName || confirmation !== "恢复备份"} onClick={async () => { try { await exclusive(() => restoreBackup(backupName, confirmation)); window.location.reload(); } catch { setNotice("备份未能恢复，当前数据与恢复前备份仍需保留。"); } }}>恢复并重新登录</button>
      <button onClick={() => setBackups(null)}>取消</button></div></div>}
    <div className="local-content" key={session.userId}>{content}</div><BellIntro/>
  </>;
}
