"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Check,
  Download,
  KeyRound,
  Languages,
  LogOut,
  Wifi,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type UserProfile = {
  id: string;
  email: string;
  nickname: string;
  timezone: string;
  language: string;
  proactiveMessagesEnabled: boolean;
  proactiveFrequencyHours: number;
  updatedAt: string;
};

type FormState = {
  nickname: string;
  timezone: string;
  language: string;
  proactiveMessagesEnabled: boolean;
  proactiveFrequencyHours: number;
};

type LlmCredentialStatus = {
  configured: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  keyPreview: string | null;
  keyFingerprint: string | null;
  credentialSource: "user-vault" | "server-env";
  updatedAt: string | null;
};

type CredentialFormState = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type LlmModelListItem = {
  id: string;
  ownedBy?: string;
};

type LlmModelListResponse = {
  provider?: string;
  credentialSource?: "user-vault" | "server-env";
  models?: LlmModelListItem[];
  error?: string;
};

type LlmConnectionTestResponse = {
  ok: boolean;
  provider?: string;
  model?: string | null;
  credentialSource?: "user-vault" | "server-env" | "none";
  latencyMs?: number;
  errorType?: string;
  error?: string;
  retryable?: boolean;
};

type ConfigReadinessItem = {
  id: string;
  label: string;
  status: "ready" | "warning" | "missing";
  description: string;
  nextStep: string;
};

type ConfigReadinessSnapshot = {
  checkedAt: string;
  summary: {
    readyCount: number;
    warningCount: number;
    missingCount: number;
    productionReady: boolean;
  };
  items: ConfigReadinessItem[];
};

type DeleteAccountResponse = {
  deleted?: boolean;
  sessionCleared?: boolean;
  persistence?: "prisma" | "memory";
  counts?: Record<string, number>;
  confirmationRequired?: string;
  error?: string;
};

const timezoneOptions = ["Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York"];
const languageOptions = [
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" },
  { label: "日本語", value: "ja-JP" }
];
const providerOptions = [
  { label: "兼容中转站", value: "compatible" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Gemini", value: "gemini" },
  { label: "OpenAI Responses", value: "openai-responses" }
];
const defaultCompatibleBaseUrl = "https://api.tryanotherone.com/v1";

export function UserSettings() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [credential, setCredential] = useState<LlmCredentialStatus | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigReadinessSnapshot | null>(null);
  const [credentialForm, setCredentialForm] = useState<CredentialFormState>({
    provider: "compatible",
    baseUrl: readDefaultBaseUrl("compatible"),
    model: "",
    apiKey: ""
  });
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">(
    "loading"
  );
  const [credentialStatus, setCredentialStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("loading");
  const [models, setModels] = useState<LlmModelListItem[]>([]);
  const [modelListMeta, setModelListMeta] = useState<{
    provider: string;
    credentialSource: "user-vault" | "server-env";
  } | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [connectionTestStatus, setConnectionTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [connectionTestResult, setConnectionTestResult] =
    useState<LlmConnectionTestResponse | null>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "success" | "error">(
    "idle"
  );
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting" | "success" | "error">(
    "idle"
  );
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [exportFileName, setExportFileName] = useState("");
  const [error, setError] = useState("");
  const [credentialError, setCredentialError] = useState("");
  const [exportError, setExportError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadProfile() {
      setStatus("loading");
      setError("");

      try {
        const [response, credentialResponse, configResponse] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/me/llm-credential", { cache: "no-store" }),
          fetch("/api/me/config-status", { cache: "no-store" })
        ]);

        if (!response.ok || !credentialResponse.ok || !configResponse.ok) {
          throw new Error("读取用户资料失败");
        }

        const payload: { user: UserProfile } = await response.json();
        const credentialPayload: { credential: LlmCredentialStatus } =
          await credentialResponse.json();
        const configPayload: { configStatus: ConfigReadinessSnapshot } =
          await configResponse.json();

        if (ignore) return;

        setProfile(payload.user);
        setForm(toFormState(payload.user));
        setCredential(credentialPayload.credential);
        setConfigStatus(configPayload.configStatus);
        const savedProvider = credentialPayload.credential.provider ?? "compatible";
        setCredentialForm((current) => ({
          ...current,
          provider: savedProvider,
          baseUrl: credentialPayload.credential.baseUrl ?? readDefaultBaseUrl(savedProvider),
          model: credentialPayload.credential.model ?? "",
          apiKey: ""
        }));
        setStatus("idle");
        setCredentialStatus("idle");
      } catch (loadError) {
        if (ignore) return;

        setError(loadError instanceof Error ? loadError.message : "读取用户资料失败");
        setStatus("error");
        setCredentialStatus("error");
      }
    }

    void loadProfile();

    return () => {
      ignore = true;
    };
  }, []);

  const hasChanges = useMemo(() => {
    if (!profile || !form) return false;

    return (
      profile.nickname !== form.nickname ||
      profile.timezone !== form.timezone ||
      profile.language !== form.language ||
      profile.proactiveMessagesEnabled !== form.proactiveMessagesEnabled ||
      profile.proactiveFrequencyHours !== form.proactiveFrequencyHours
    );
  }, [form, profile]);

  const credentialHasSavedKey = credential?.configured === true;
  const isCompatibleProvider =
    credentialForm.provider === "compatible" || credentialForm.provider === "openai-compatible";
  const hasCredentialConfigChanges = useMemo(() => {
    if (!credential) return false;

    return (
      (credential.provider ?? "compatible") !== credentialForm.provider ||
      (credential.baseUrl ?? readDefaultBaseUrl(credential.provider ?? "compatible")) !==
        credentialForm.baseUrl.trim() ||
      (credential.model ?? "") !== credentialForm.model.trim() ||
      Boolean(credentialForm.apiKey.trim())
    );
  }, [credential, credentialForm]);
  const canSaveCredential =
    Boolean(credentialForm.provider) &&
    (credentialHasSavedKey || Boolean(credentialForm.apiKey.trim())) &&
    (!isCompatibleProvider || Boolean(credentialForm.baseUrl.trim()));
  const voiceSharedLlmHint = isCompatibleProvider
    ? "语音输入和朗读会共用这组兼容中转站配置；未单独设置 VOICE_STT_MODEL/VOICE_TTS_MODEL 时使用当前模型，失败会自动回落到 mock。"
    : "当前文本供应商不是兼容中转站；语音会优先使用服务端 VOICE/LLM 环境变量，缺配置或失败时自动回落到 mock。";

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setStatus("saving");
    setError("");

    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload: { user?: UserProfile; error?: string } = await response.json();

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "保存用户资料失败");
      }

      setProfile(payload.user);
      setForm(toFormState(payload.user));
      setStatus("saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存用户资料失败");
      setStatus("error");
    }
  }

  async function logout() {
    setStatus("saving");
    setError("");

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("退出失败");
      router.push("/login");
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "退出失败");
      setStatus("error");
    }
  }

  async function saveCredential() {
    try {
      await persistCredential();
    } catch {
      // persistCredential already updates the visible error state.
    }
  }

  async function deleteCredential() {
    setCredentialStatus("saving");
    setCredentialError("");

    try {
      const response = await fetch("/api/me/llm-credential", { method: "DELETE" });
      const payload: { credential?: LlmCredentialStatus; error?: string } = await response.json();

      if (!response.ok || !payload.credential) {
        throw new Error(payload.error ?? "删除模型密钥失败");
      }

      setCredential(payload.credential);
      setCredentialForm({
        provider: "compatible",
        baseUrl: readDefaultBaseUrl("compatible"),
        model: "",
        apiKey: ""
      });
      setModels([]);
      setModelListMeta(null);
      setConnectionTestResult(null);
      setConnectionTestStatus("idle");
      void reloadConfigStatus();
      setCredentialStatus("saved");
    } catch (credentialDeleteError) {
      setCredentialError(
        credentialDeleteError instanceof Error ? credentialDeleteError.message : "删除模型密钥失败"
      );
      setCredentialStatus("error");
    }
  }

  async function loadModels() {
    setIsLoadingModels(true);
    setCredentialError("");

    try {
      if (!isCompatibleProvider) {
        throw new Error("当前自动读取模型列表仅支持兼容中转站；其他供应商可手动填写模型名。");
      }

      if (credentialForm.apiKey.trim() || (credentialHasSavedKey && hasCredentialConfigChanges)) {
        await persistCredential({ quiet: true });
      }

      const response = await fetch("/api/me/llm-models", { cache: "no-store" });
      const payload: LlmModelListResponse = await response.json();

      if (!response.ok || !payload.models) {
        throw new Error(payload.error ?? "读取模型列表失败");
      }

      setModels(payload.models);
      setModelListMeta({
        provider: payload.provider ?? "compatible",
        credentialSource: payload.credentialSource ?? "server-env"
      });
    } catch (modelLoadError) {
      setCredentialError(
        modelLoadError instanceof Error ? modelLoadError.message : "读取模型列表失败"
      );
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function testConnection() {
    setConnectionTestStatus("testing");
    setConnectionTestResult(null);
    setCredentialError("");

    try {
      const response = await fetch("/api/me/llm-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: credentialForm.provider,
          baseUrl: credentialForm.baseUrl.trim(),
          model: credentialForm.model.trim()
        })
      });
      const payload: LlmConnectionTestResponse = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "连接测试失败");
      }

      setConnectionTestResult(payload);
      setConnectionTestStatus(payload.ok ? "success" : "error");
    } catch (testError) {
      setConnectionTestResult({
        ok: false,
        provider: credentialForm.provider,
        model: credentialForm.model.trim() || null,
        credentialSource: "none",
        errorType: "network",
        error: testError instanceof Error ? testError.message : "连接测试失败",
        retryable: true
      });
      setConnectionTestStatus("error");
    }
  }

  async function exportUserData() {
    setExportStatus("exporting");
    setExportFileName("");
    setExportError("");

    try {
      const response = await fetch("/api/me/export", { cache: "no-store" });
      const snapshot = await response.json();

      if (!response.ok) {
        throw new Error(snapshot?.error ?? "导出数据失败");
      }

      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeDate = new Date().toISOString().slice(0, 10);
      const fileName = `perpetual-renewal-export-${safeDate}.json`;
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportFileName(fileName);
      setExportStatus("success");
    } catch (exportFailure) {
      setExportError(toFriendlyExportError(exportFailure));
      setExportStatus("error");
    }
  }

  async function deleteAccount() {
    setDeleteStatus("deleting");
    setDeleteError("");

    try {
      const response = await fetch("/api/me/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation })
      });
      const payload: DeleteAccountResponse = await response.json();

      if (!response.ok || !payload.deleted) {
        throw new Error(payload.error ?? "删除账号失败");
      }

      setDeleteStatus("success");
      router.push("/login");
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : "删除账号没有成功，请重新输入确认文字后再试。"
      );
      setDeleteStatus("error");
    }
  }

  async function persistCredential(options: { quiet?: boolean } = {}) {
    if (!canSaveCredential) {
      const message =
        credentialHasSavedKey
          ? "请先填写供应商和 Base URL。"
          : "请先输入 API Key；保存后可读取模型列表。";
      setCredentialError(message);
      setCredentialStatus("error");
      throw new Error(message);
    }

    if (!options.quiet) {
      setCredentialStatus("saving");
      setCredentialError("");
    }

    const requestBody = {
      provider: credentialForm.provider,
      baseUrl: credentialForm.baseUrl.trim(),
      model: credentialForm.model.trim(),
      ...(credentialForm.apiKey.trim() ? { apiKey: credentialForm.apiKey.trim() } : {})
    };

    try {
      const response = await fetch("/api/me/llm-credential", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload: { credential?: LlmCredentialStatus; error?: string } = await response.json();

      if (!response.ok || !payload.credential) {
        throw new Error(payload.error ?? "保存模型连接配置失败");
      }

      setCredential(payload.credential);
      setCredentialForm((current) => ({
        ...current,
        provider: payload.credential?.provider ?? current.provider,
        baseUrl: payload.credential?.baseUrl ?? current.baseUrl,
        model: payload.credential?.model ?? current.model,
        apiKey: ""
      }));
      setConnectionTestResult(null);
      setConnectionTestStatus("idle");
      void reloadConfigStatus();
      setCredentialStatus("saved");
      return payload.credential;
    } catch (credentialSaveError) {
      const message =
        credentialSaveError instanceof Error ? credentialSaveError.message : "保存模型连接配置失败";
      setCredentialError(message);
      setCredentialStatus("error");
      throw credentialSaveError;
    }
  }

  function updateCredentialProvider(provider: string) {
    setCredentialForm((current) => ({
      ...current,
      provider,
      baseUrl:
        (provider === "compatible" || provider === "openai-compatible") && !current.baseUrl.trim()
          ? readDefaultBaseUrl(provider)
          : current.baseUrl === defaultCompatibleBaseUrl
            ? readDefaultBaseUrl(provider)
          : current.baseUrl
    }));
    setModels([]);
    setModelListMeta(null);
    setConnectionTestResult(null);
    setConnectionTestStatus("idle");
  }

  function updateCredentialField(field: keyof CredentialFormState, value: string) {
    setCredentialForm((current) => ({ ...current, [field]: value }));
    setConnectionTestResult(null);
    setConnectionTestStatus("idle");
  }

  async function reloadConfigStatus() {
    try {
      const response = await fetch("/api/me/config-status", { cache: "no-store" });
      const payload: { configStatus?: ConfigReadinessSnapshot } = await response.json();
      if (response.ok && payload.configStatus) {
        setConfigStatus(payload.configStatus);
      }
    } catch {
      // Config status is advisory; keep the last visible snapshot if refresh fails.
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <Link className="text-button" href="/">
          <ArrowLeft size={17} />
          返回工作台
        </Link>
        <div className="settings-heading">
          <div className="brand-mark">
            <UserRound size={22} />
          </div>
          <div>
            <h1>账号与资料</h1>
            <p>这些偏好会影响称呼、语言和主动回响的频率。</p>
          </div>
        </div>
      </header>

      <form className="settings-grid" onSubmit={saveProfile}>
        <section className="settings-section">
          <div className="panel-title">
            <h2>基础资料</h2>
            {profile ? <span className="pill">{profile.email}</span> : null}
          </div>

          {form ? (
            <div className="form-grid">
              <label className="field">
                <span>昵称</span>
                <input
                  maxLength={40}
                  onChange={(event) => setForm({ ...form, nickname: event.target.value })}
                  value={form.nickname}
                />
              </label>
              <label className="field">
                <span>时区</span>
                <select
                  onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                  value={form.timezone}
                >
                  {timezoneOptions.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>语言</span>
                <select
                  onChange={(event) => setForm({ ...form, language: event.target.value })}
                  value={form.language}
                >
                  {languageOptions.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="empty">正在读取资料</div>
          )}
        </section>

        <section className="settings-section">
          <div className="panel-title">
            <h2>沟通偏好</h2>
            <span className="pill teal">
              <Languages size={14} />
              MVP
            </span>
          </div>

          {form ? (
            <div className="form-grid">
              <label className="toggle-row">
                <span>
                  <Bell size={17} />
                  接受主动消息
                </span>
                <input
                  checked={form.proactiveMessagesEnabled}
                  onChange={(event) =>
                    setForm({ ...form, proactiveMessagesEnabled: event.target.checked })
                  }
                  type="checkbox"
                />
              </label>
              <label className="field">
                <span>主动消息频率（小时）</span>
                <input
                  max={168}
                  min={1}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      proactiveFrequencyHours: Number(event.target.value)
                    })
                  }
                  type="number"
                  value={form.proactiveFrequencyHours}
                />
              </label>
            </div>
          ) : (
            <div className="empty">正在读取偏好</div>
          )}
        </section>

        <section className="settings-section">
          <div className="panel-title">
            <h2>模型供应商</h2>
            <span className="pill teal">
              <KeyRound size={14} />
              {credential?.configured ? "用户密钥" : "环境变量"}
            </span>
          </div>

          <div className="form-grid">
            {credential?.configured ? (
              <div className="status-box">
                已保存 {credential.provider}/{credential.model ?? "未选择模型"} · key{" "}
                {credential.keyPreview ?? "已加密"}
              </div>
            ) : (
              <div className="status-box">未保存用户密钥，将使用服务端环境变量或 mock。</div>
            )}
            <div className="status-box">{voiceSharedLlmHint}</div>
            <label className="field">
              <span>供应商</span>
              <select
                onChange={(event) => updateCredentialProvider(event.target.value)}
                value={credentialForm.provider}
              >
                {providerOptions.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Base URL</span>
              <input
                onChange={(event) =>
                  updateCredentialField("baseUrl", event.target.value)
                }
                placeholder="https://provider.example.com/v1"
                value={credentialForm.baseUrl}
              />
            </label>
            <label className="field">
              <span>模型</span>
              <input
                onChange={(event) =>
                  updateCredentialField("model", event.target.value)
                }
                list={models.length ? "llm-model-options" : undefined}
                placeholder="provider-model-name"
                value={credentialForm.model}
              />
              {models.length ? (
                <datalist id="llm-model-options">
                  {models.map((model) => (
                    <option key={model.id} value={model.id} />
                  ))}
                </datalist>
              ) : null}
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                onChange={(event) =>
                  updateCredentialField("apiKey", event.target.value)
                }
                placeholder={credentialHasSavedKey ? "留空则继续使用已保存 key" : "粘贴你的 key"}
                type="password"
                value={credentialForm.apiKey}
              />
            </label>
            {credentialError ? <span className="error-state">{credentialError}</span> : null}
            <div className="settings-actions">
              {credentialStatus === "saved" ? (
                <span className="save-state">
                  <Check size={16} />
                  已保存连接配置
                </span>
              ) : null}
              {credential?.configured ? (
                <button
                  className="text-button"
                  disabled={credentialStatus === "saving"}
                  onClick={deleteCredential}
                  type="button"
                >
                  <Trash2 size={17} />
                  删除密钥
                </button>
              ) : null}
              <button
                className="text-button"
                disabled={connectionTestStatus === "testing"}
                onClick={testConnection}
                type="button"
              >
                <Wifi size={17} />
                {connectionTestStatus === "testing" ? "测试中" : "测试连接"}
              </button>
              <button
                className="primary-button"
                disabled={credentialStatus === "saving" || !canSaveCredential}
                onClick={saveCredential}
                type="button"
              >
                <Save size={17} />
                {credentialStatus === "saving" ? "保存中" : "保存连接配置"}
              </button>
            </div>
            <button
              className="text-button"
              disabled={isLoadingModels}
              onClick={loadModels}
              type="button"
            >
              <RefreshCw size={17} />
              {isLoadingModels ? "读取中" : "读取模型列表"}
            </button>
            {models.length ? (
              <>
                {modelListMeta ? (
                  <div className="status-box">
                    已读取 {models.length} 个模型 · {modelListMeta.provider} ·{" "}
                    {modelListMeta.credentialSource === "user-vault" ? "用户 vault" : "服务端环境变量"}
                  </div>
                ) : null}
              <div className="memory-list">
                {models.slice(0, 12).map((model) => (
                  <button
                    className="relationship-type-card"
                    key={model.id}
                    onClick={() => updateCredentialField("model", model.id)}
                    type="button"
                  >
                    <strong>{model.id}</strong>
                    {model.ownedBy ? <span>{model.ownedBy}</span> : null}
                  </button>
                ))}
              </div>
              </>
            ) : null}
            {connectionTestResult ? (
              <div
                aria-live="polite"
                className={connectionTestResult.ok ? "status-box" : "error-state"}
              >
                {connectionTestResult.ok
                  ? `连接成功 · ${connectionTestResult.provider ?? credentialForm.provider}/${connectionTestResult.model ?? "未选择模型"} · ${connectionTestResult.latencyMs ?? 0}ms`
                  : `连接失败 · ${connectionTestResult.errorType ?? "unknown"} · ${
                      connectionTestResult.error ?? "请稍后再试"
                    }`}
              </div>
            ) : null}
          </div>
        </section>

        <section className="settings-section">
          <div className="panel-title">
            <h2>数据与隐私</h2>
            <span className="pill teal">
              <Download size={14} />
              JSON
            </span>
          </div>

          <div className="form-grid">
            <div className="status-box">
              导出当前账号的关系、消息、记忆、主动回响和脱敏审计记录；不会包含 API key、Base URL 或 vault 密文。
            </div>
            <div aria-live="polite">
              {exportStatus === "exporting" ? (
                <span className="save-state">
                  <RefreshCw size={16} />
                  正在准备导出文件
                </span>
              ) : null}
              {exportStatus === "success" ? (
                <span className="save-state">
                  <Check size={16} />
                  已下载 {exportFileName}
                </span>
              ) : null}
              {exportError ? <span className="error-state">{exportError}</span> : null}
            </div>
            <div className="settings-actions">
              <button
                className="text-button"
                disabled={exportStatus === "exporting"}
                onClick={exportUserData}
                type="button"
              >
                <Download size={17} />
                {exportStatus === "exporting" ? "导出中" : "导出数据"}
              </button>
            </div>
            <div className="status-box">
              删除账号会清除当前账号下的关系对象、对话、记忆、主动回响草稿、模型调用日志、安全事件和已保存模型密钥。建议先导出数据。
            </div>
            <label className="field">
              <span>删除确认</span>
              <input
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder="输入：删除我的账号"
                value={deleteConfirmation}
              />
            </label>
            <div aria-live="polite">
              {deleteError ? <span className="error-state">{deleteError}</span> : null}
              {deleteStatus === "success" ? (
                <span className="save-state">
                  <Check size={16} />
                  账号已删除
                </span>
              ) : null}
            </div>
            <div className="settings-actions">
              <button
                className="text-button"
                disabled={deleteStatus === "deleting" || deleteConfirmation !== "删除我的账号"}
                onClick={deleteAccount}
                type="button"
              >
                <Trash2 size={17} />
                {deleteStatus === "deleting" ? "删除中" : "删除账号"}
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="panel-title">
            <h2>配置状态</h2>
            <span className="pill teal">
              <ShieldCheck size={14} />
              只读
            </span>
          </div>

          {configStatus ? (
            <div className="form-grid">
              <div className="status-box">
                已就绪 {configStatus.summary.readyCount} 项 · 需处理{" "}
                {configStatus.summary.missingCount} 项 · 提醒{" "}
                {configStatus.summary.warningCount} 项
              </div>
              <div className="memory-list">
                {configStatus.items.map((item) => (
                  <article className="memory-item" key={item.id}>
                    <div className="memory-meta">
                      <span className={`pill ${item.status === "ready" ? "teal" : ""}`}>
                        {formatConfigStatus(item.status)}
                      </span>
                      <strong>{item.label}</strong>
                    </div>
                    <p>{item.description}</p>
                    <span>{item.nextStep}</span>
                  </article>
                ))}
              </div>
              <button className="text-button" onClick={reloadConfigStatus} type="button">
                <RefreshCw size={17} />
                重新检查
              </button>
            </div>
          ) : (
            <div className="empty">正在检查配置状态</div>
          )}
        </section>

        <footer className="settings-actions">
          {status === "saved" ? (
            <span className="save-state">
              <Check size={16} />
              已保存
            </span>
          ) : null}
          {error ? <span className="error-state">{error}</span> : null}
          <button className="text-button" onClick={logout} type="button">
            <LogOut size={17} />
            退出
          </button>
          <button className="primary-button" disabled={!form || !hasChanges || status === "saving"} type="submit">
            <Save size={17} />
            {status === "saving" ? "保存中" : "保存"}
          </button>
        </footer>
      </form>
    </main>
  );
}

function toFormState(profile: UserProfile): FormState {
  return {
    nickname: profile.nickname,
    timezone: profile.timezone,
    language: profile.language,
    proactiveMessagesEnabled: profile.proactiveMessagesEnabled,
    proactiveFrequencyHours: profile.proactiveFrequencyHours
  };
}

function readDefaultBaseUrl(provider: string) {
  return provider === "compatible" || provider === "openai-compatible" ? defaultCompatibleBaseUrl : "";
}

function toFriendlyExportError(error: unknown) {
  if (error instanceof SyntaxError) {
    return "导出服务返回了无法识别的数据，请稍后重试。";
  }

  if (error instanceof Error && error.message.includes("401")) {
    return "登录状态可能已过期，请重新登录后再导出。";
  }

  return "这次导出没有成功，请稍后重试；如果仍失败，请重新登录后再试。";
}

function formatConfigStatus(status: ConfigReadinessItem["status"]) {
  if (status === "ready") return "已就绪";
  if (status === "warning") return "提醒";
  return "缺失";
}
