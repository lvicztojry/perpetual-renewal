"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, LogIn, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";

type Mode = "local" | "login" | "register" | "forgot" | "reset" | "verify";
type FieldName = "email" | "nickname" | "password" | "confirmation";
type FieldErrors = Partial<Record<FieldName, string>>;

const copy: Record<Mode, { title: string; description: string; submit: string }> = {
  local: {
    title: "进入生生不息",
    description: "本地测试模式：使用邮箱和昵称进入。",
    submit: "进入"
  },
  login: {
    title: "进入生生不息",
    description: "用邮箱和密码登录，继续你的关系与记忆。",
    submit: "登录"
  },
  register: {
    title: "创建账号",
    description: "留一个称呼，为关系与记忆安放一个位置。",
    submit: "注册"
  },
  forgot: {
    title: "找回密码",
    description: "填写注册邮箱，我们会发送重置密码的说明。",
    submit: "发送重置邮件"
  },
  reset: {
    title: "设置新密码",
    description: "设置新的密码，然后重新登录。",
    submit: "重置密码"
  },
  verify: {
    title: "验证邮箱",
    description: "确认这个邮箱属于你，完成后即可登录。",
    submit: "验证邮箱"
  }
};

export function LoginForm({
  allowLocalEmail = false,
  initialMode
}: {
  allowLocalEmail?: boolean;
  initialMode?: Exclude<Mode, "local">;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode ?? (allowLocalEmail ? "local" : "login"));
  const [email, setEmail] = useState(mode === "local" ? "demo-user@perpetual-renewal.local" : "");
  const [nickname, setNickname] = useState(mode === "local" ? "开发用户" : "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "success">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [token, setToken] = useState<string | null>();
  const didReadToken = useRef(false);
  const inFlight = useRef(false);
  const isHydrated = useIsHydrated();
  const busy = status === "submitting";
  const hasPassword = mode === "login" || mode === "register" || mode === "reset";
  const hasConfirmation = mode === "register" || mode === "reset";
  const needsToken = mode === "reset" || mode === "verify";
  const tokenInvalid = needsToken && token === null;
  const tokenPending = needsToken && token === undefined;

  useEffect(() => {
    if (!needsToken || didReadToken.current) return;
    didReadToken.current = true;
    const url = new URL(window.location.href);
    const fragments = new URLSearchParams(url.hash.slice(1)).getAll("token");
    // Email links carry tokens in the fragment, which is never sent to the server.
    // Remove all URL parameters without a request; keep the token in memory only.
    window.history.replaceState(window.history.state, "", url.pathname);
    const value = !url.searchParams.has("token") && fragments.length === 1
      && /^[A-Za-z0-9_-]{16,512}$/.test(fragments[0]) ? fragments[0] : null;
    // Synchronize the external browser URL once, after hydration.
    setToken(value);
  }, [needsToken]);

  function switchMode(nextMode: Mode) {
    if (inFlight.current || (nextMode === "local" && !allowLocalEmail)) return;
    if (mode === "local" || nextMode === "local") {
      setEmail(nextMode === "local" ? "demo-user@perpetual-renewal.local" : "");
      setNickname(nextMode === "local" ? "开发用户" : "");
    }
    setMode(nextMode);
    setPassword("");
    setConfirmation("");
    setRevealPassword(false);
    setStatus("idle");
    setError("");
    setMessage("");
    setFieldErrors({});
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!needsToken && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "请输入有效的邮箱地址。";
    }
    if ((mode === "register" || mode === "local") && !nickname.trim()) {
      errors.nickname = "请输入昵称。";
    }
    if (hasPassword && !password) {
      errors.password = "请输入密码。";
    } else if (hasConfirmation && (password.length < 12 || password.length > 128)) {
      errors.password = "密码需为 12–128 个字符。";
    }
    if (hasConfirmation && confirmation !== password) {
      errors.confirmation = "两次输入的密码不一致。";
    }
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || tokenInvalid || tokenPending) return;
    const errors = validate();
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) {
      setStatus("error");
      const field = event.currentTarget.elements.namedItem(Object.keys(errors)[0]);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    inFlight.current = true;
    setStatus("submitting");
    const endpoint = mode === "local" ? "login" : mode === "forgot" ? "forgot-password"
      : mode === "reset" ? "reset-password" : mode === "verify" ? "verify-email" : mode;
    const body = mode === "verify" ? { token } : mode === "reset" ? { token, password }
      : mode === "forgot" ? { email: email.trim() }
        : mode === "local" ? { email: email.trim(), nickname: nickname.trim() }
          : mode === "register" ? { email: email.trim(), password, nickname: nickname.trim() }
            : { email: email.trim(), password };

    try {
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(body)
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object") {
        setError("服务暂时不可用，请稍后重试。");
        setStatus("error");
        return;
      }
      const result = payload as { error?: unknown; message?: unknown };
      if (!response.ok || typeof result.error === "string") {
        setError(typeof result.error === "string" && result.error ? result.error : "操作失败，请稍后重试。");
        setStatus("error");
        return;
      }
      setPassword("");
      setConfirmation("");
      setRevealPassword(false);
      if (mode === "local" || mode === "login") {
        router.replace("/");
        router.refresh();
        return;
      }
      if (needsToken) setToken(null);
      setMessage(typeof result.message === "string" && result.message ? result.message
        : mode === "forgot" ? "如果此邮箱已注册，你会收到重置密码的邮件，请检查收件箱和垃圾邮件。"
          : mode === "register" ? "注册请求已完成。请查收验证邮件，验证邮箱后再登录。"
            : mode === "verify" ? "邮箱已验证，请使用邮箱和密码登录。"
              : "密码已重置，请使用新密码登录。");
      setStatus("success");
    } catch {
      setError("暂时无法连接，请检查网络后重试。");
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }

  const errorProps = (name: FieldName) => ({
    "aria-invalid": Boolean(fieldErrors[name]),
    "aria-describedby": fieldErrors[name] ? `auth-${name}-error` : undefined
  });
  const fieldError = (name: FieldName) => fieldErrors[name] ? (
    <span className="error-state" id={`auth-${name}-error`}>{fieldErrors[name]}</span>
  ) : null;

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <Link className="text-button" href={needsToken ? "/login?mode=password" : "/"} prefetch={false}>
          <ArrowLeft size={17} aria-hidden="true" />
          {needsToken ? "返回登录" : "返回工作台"}
        </Link>
        <div className="settings-heading">
          <div className="brand-mark"><Sparkles size={22} aria-hidden="true" /></div>
          <div>
            <h1 id="auth-title">{copy[mode].title}</h1>
            <p>{copy[mode].description}</p>
          </div>
        </div>

        {status === "success" ? (
          <div className="form-grid">
            <p role="status">{message}</p>
            {needsToken ? (
              <Link className="primary-button wide" href="/login?mode=password" prefetch={false}>使用密码登录</Link>
            ) : (
              <button className="primary-button wide" type="button" onClick={() => switchMode("login")}>返回登录</button>
            )}
          </div>
        ) : tokenInvalid ? (
          <div className="form-grid">
            <p className="error-state" role="alert">{mode === "verify" ? "验证链接无效或已失效，请检查邮件中的链接。" : "重置链接无效或已失效，请重新申请。"}</p>
            {mode === "reset" ? <Link className="text-button" href="/login?mode=forgot" prefetch={false}>重新申请重置链接</Link> : null}
          </div>
        ) : (
          <form className="settings-section" onSubmit={submit} noValidate aria-busy={busy}>
            <div className="form-grid">
              {!needsToken ? (
                <div className="field">
                  <label htmlFor="auth-email"><span>邮箱</span></label>
                  <input id="auth-email" name="email" autoComplete="email" autoCapitalize="none"
                    spellCheck={false} type="email" required maxLength={254} disabled={busy}
                    value={email} onChange={(event) => setEmail(event.target.value)} {...errorProps("email")} />
                  {fieldError("email")}
                </div>
              ) : null}
              {mode === "local" || mode === "register" ? (
                <div className="field">
                  <label htmlFor="auth-nickname"><span>昵称</span></label>
                  <input id="auth-nickname" name="nickname" autoComplete="nickname" maxLength={40}
                    required disabled={busy} value={nickname} onChange={(event) => setNickname(event.target.value)}
                    {...errorProps("nickname")} />
                  {fieldError("nickname")}
                </div>
              ) : null}
              {hasPassword ? (
                <div className="field">
                  <label htmlFor="auth-password"><span>{mode === "reset" ? "新密码" : "密码"}</span></label>
                  <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                    <input id="auth-password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
                      type={revealPassword ? "text" : "password"} required disabled={busy || tokenPending}
                      minLength={hasConfirmation ? 12 : undefined} maxLength={hasConfirmation ? 128 : undefined}
                      style={{ minWidth: 0, flex: 1 }} value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      {...errorProps("password")} aria-describedby={fieldErrors.password ? "auth-password-error" : hasConfirmation ? "auth-password-hint" : undefined} />
                    <button className="icon-button" type="button" style={{ flexShrink: 0 }}
                      title={revealPassword ? "隐藏密码" : "显示密码"} aria-label={revealPassword ? "隐藏密码" : "显示密码"}
                      aria-pressed={revealPassword} aria-controls="auth-password" disabled={busy || tokenPending}
                      onClick={() => setRevealPassword(!revealPassword)}>
                      {revealPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                    </button>
                  </div>
                  {hasConfirmation ? <small id="auth-password-hint">使用 12–128 个字符，建议使用独立的长密码。</small> : null}
                  {fieldError("password")}
                </div>
              ) : null}
              {hasConfirmation ? (
                <div className="field">
                  <label htmlFor="auth-confirmation"><span>确认密码</span></label>
                  <input id="auth-confirmation" name="confirmation" autoComplete="new-password" type="password"
                    required maxLength={128} disabled={busy || tokenPending} value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)} {...errorProps("confirmation")} />
                  {fieldError("confirmation")}
                </div>
              ) : null}
              {error ? <p className="error-state" role="alert">{error}</p> : null}
              {tokenPending ? <p role="status">正在读取邮件链接…</p> : null}
              <button className="primary-button wide" disabled={!isHydrated || busy || tokenPending} type="submit">
                {busy ? <LoaderCircle size={17} aria-hidden="true" /> : <LogIn size={17} aria-hidden="true" />}
                {busy ? "请稍候…" : copy[mode].submit}
              </button>
            </div>
          </form>
        )}

        {!needsToken && status !== "success" ? (
          <nav className="topbar-actions" aria-label="账号操作">
            {mode === "login" ? <>
              <button className="text-button" type="button" disabled={busy} onClick={() => switchMode("register")}>注册账号</button>
              <button className="text-button" type="button" disabled={busy} onClick={() => switchMode("forgot")}>忘记密码</button>
            </> : <button className="text-button" type="button" disabled={busy} onClick={() => switchMode("login")}>
              {mode === "local" ? "使用密码登录" : "返回登录"}
            </button>}
            {allowLocalEmail && mode === "login" ? (
              <button className="text-button" type="button" disabled={busy} onClick={() => switchMode("local")}>本地测试入口</button>
            ) : null}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function useIsHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
