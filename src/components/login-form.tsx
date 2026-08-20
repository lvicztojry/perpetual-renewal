"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogIn, Sparkles } from "lucide-react";
import { FormEvent, useState, useSyncExternalStore } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("demo-user@perpetual-renewal.local");
  const [nickname, setNickname] = useState("开发用户");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");
  const isHydrated = useIsHydrated();

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, nickname })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "登录失败");
      }

      router.push("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
      setStatus("error");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <Link className="text-button" href="/">
          <ArrowLeft size={17} />
          返回工作台
        </Link>

        <div className="settings-heading">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>进入生生不息</h1>
            <p>使用本地 email session，把关系对象和记忆隔离到当前用户。</p>
          </div>
        </div>

        <form className="settings-section" onSubmit={login}>
          <div className="form-grid">
            <label className="field">
              <span>邮箱</span>
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
            <label className="field">
              <span>昵称</span>
              <input
                autoComplete="nickname"
                maxLength={40}
                onChange={(event) => setNickname(event.target.value)}
                value={nickname}
              />
            </label>
            {error ? <span className="error-state">{error}</span> : null}
            <button
              className="primary-button wide"
              disabled={!isHydrated || status === "submitting"}
              type="submit"
            >
              <LogIn size={17} />
              {status === "submitting" ? "进入中" : "进入"}
            </button>
          </div>
        </form>
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
