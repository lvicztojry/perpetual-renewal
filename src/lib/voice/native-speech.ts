/** Android system recognition and TTS through the inline renewal-speech plugin. */
type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriScope = {
  __TAURI_INTERNALS__?: unknown;
  navigator?: { userAgent?: string };
};
type NativeSpeechFailure = { ok: false; error: string; errorType: string };
export type NativeSpeechResult = { ok: true; text: string } | NativeSpeechFailure;
export type NativeTtsResult = { ok: true } | NativeSpeechFailure;
export type NativeSpeechOptions = { lang?: string; timeoutMs?: number };
export type NativeTtsOptions = NativeSpeechOptions & {
  rate?: number;
  /** IPC dispatch notification; the native bridge has no audio-start event. */
  onStart?: () => void;
  onEnd?: () => void;
};
export type NativeSpeechHandle = {
  /** End capture; final text arrives in done. */
  stop: () => void;
  /** Discard this recognition without changing the caller's draft. */
  cancel: () => void;
  done: Promise<NativeSpeechResult>;
};
export type NativeSpeechPlaybackHandle = { stop: () => void; done: Promise<NativeTtsResult> };
export type NativeTtsAvailability = { available: boolean; error?: string; errorType?: string };
const commandPrefix = "plugin:renewal-speech|";
const fallbackMessage = "这段语音没有识别出来，可以再录一次，或改用文字。";
function readScope(): TauriScope | null {
  return typeof window === "undefined" ? null : window as unknown as TauriScope;
}
export function canUseNativeSpeech(scope: TauriScope | null = readScope()) {
  const userAgent = scope?.navigator?.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return Boolean(scope?.__TAURI_INTERNALS__ && /Android/i.test(userAgent));
}
async function loadInvoke(scope: TauriScope | null): Promise<InvokeFn | null> {
  // Same implementation as installed @tauri-apps/api/core, without an
  // unresolvable bare import in the production WebView. Scope is injectable.
  const internals = scope?.__TAURI_INTERNALS__ as { invoke?: InvokeFn } | undefined;
  return typeof internals?.invoke === "function" ? internals.invoke.bind(internals) : null;
}
export async function isNativeSpeechAvailable(
  scope: TauriScope | null = readScope()
): Promise<boolean> {
  if (!canUseNativeSpeech(scope)) return false;
  const invoke = await loadInvoke(scope);
  if (!invoke) return false;
  try {
    const result = await invoke<{ available?: boolean }>(`${commandPrefix}speech_is_available`);
    return result?.available === true;
  } catch { return false; }
}
/** Initializes the system TTS engine and checks the requested language, without speaking. */
export async function getNativeTtsAvailability(
  options: NativeSpeechOptions = {}, scope: TauriScope | null = readScope()
): Promise<NativeTtsAvailability> {
  const unavailable = { available: false, error: "设备朗读服务不可用。", errorType: "unavailable" };
  if (!canUseNativeSpeech(scope)) return unavailable;
  const invoke = await loadInvoke(scope);
  if (!invoke) return unavailable;
  try {
    return await invoke<NativeTtsAvailability>(`${commandPrefix}speech_is_speech_available`, {
      options: { lang: options.lang ?? "zh-CN" }
    });
  } catch (error) {
    const result = failure(error, "设备朗读服务不可用。");
    return { available: false, error: result.error, errorType: result.errorType };
  }
}
function failure(value: unknown, message = fallbackMessage): NativeSpeechFailure {
  const outcome = (value && typeof value === "object" ? value : {}) as {
    error?: unknown; errorType?: unknown; code?: unknown;
  };
  const errorType = typeof outcome.errorType === "string" ? outcome.errorType :
    typeof outcome.code === "string" ? outcome.code : "unknown";
  return {
    ok: false,
    error: errorType === "cancelled" ? "" :
      typeof outcome.error === "string" && outcome.error.trim() ? outcome.error.trim() : message,
    errorType
  };
}
function normalize(value: unknown): NativeSpeechResult {
  const outcome = value as { ok?: boolean; text?: unknown } | null;
  if (outcome?.ok === true && typeof outcome.text === "string" && outcome.text.trim()) {
    return { ok: true, text: outcome.text.trim() };
  }
  return failure(value);
}
/** Bounded IPC; cancellation settles locally even when native IPC hangs. */
function operation<T extends { ok: true } | NativeSpeechFailure>(
  scope: TauriScope | null, command: string, args: Record<string, unknown>,
  cleanupCommand: string, normalizeResult: (value: unknown) => T, options: NativeTtsOptions
) {
  let settled = false;
  let started = false;
  let stopping = false;
  let invoke: InvokeFn | null = null;
  let resolveDone!: (value: T | NativeSpeechFailure) => void;
  const done = new Promise<T | NativeSpeechFailure>((resolve) => { resolveDone = resolve; });
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0
    ? options.timeoutMs! : 60_000;
  const timer = setTimeout(() => {
    cleanup(cleanupCommand);
    settle(failure({ errorType: "timeout", error: command === "speech_speak"
      ? "设备朗读响应超时，可以稍后重试。" : "语音识别响应超时，可以重试或改用文字输入。" }));
  }, timeoutMs);
  function settle(result: T | NativeSpeechFailure) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(result);
    try { options.onEnd?.(); } catch { /* Consumer callbacks cannot strand IPC. */ }
  }
  function cleanup(name: string) {
    if (!started || !invoke) return;
    try { void invoke(`${commandPrefix}${name}`).catch(() => undefined); } catch { /* best effort */ }
  }
  void loadInvoke(scope).then((loaded) => {
    // cancel/stop may run during this await. Never start a settled operation.
    if (settled) return;
    invoke = loaded;
    if (!invoke) {
      settle(failure({ errorType: "unavailable", error: command === "speech_speak"
        ? "设备朗读服务没有加载成功，可以继续使用文字。" : "本地语音识别没有加载成功，可以改用文字输入。" }));
      return;
    }
    started = true;
    try {
      const pending = invoke<unknown>(`${commandPrefix}${command}`, args);
      Promise.resolve(pending).then(
        (value) => { if (!settled) settle(normalizeResult(value)); },
        (error: unknown) => { if (!settled) settle(failure(error)); }
      );
      try { options.onStart?.(); } catch { /* Consumer callback only. */ }
    } catch (error) { settle(failure(error)); }
  }).catch((error: unknown) => settle(failure(error)));
  return {
    done,
    cancel() {
      if (settled) return;
      cleanup(cleanupCommand);
      settle(failure({ errorType: "cancelled" }));
    },
    stop() {
      if (settled || stopping) return;
      stopping = true;
      if (!started) { settle(failure({ errorType: "no-speech" })); return; }
      // stop acknowledges end of capture; final text resolves recognize.
      try {
        void invoke!(`${commandPrefix}speech_stop`).catch((error: unknown) => {
          if (settled) return;
          cleanup(cleanupCommand);
          settle(failure(error));
        });
      } catch (error) { cleanup(cleanupCommand); settle(failure(error)); }
    }
  };
}
export function startNativeSpeech(
  options: NativeSpeechOptions = {}, scope: TauriScope | null = readScope()
): NativeSpeechHandle | null {
  if (!canUseNativeSpeech(scope)) return null;
  return operation(scope, "speech_recognize", {
    options: { lang: options.lang ?? "zh-CN" }
  }, "speech_cancel", normalize, options);
}
/** done resolves on native playback completion, failure, cancellation or timeout. */
export function speakNativeText(
  text: string, options: NativeTtsOptions = {}, scope: TauriScope | null = readScope()
): NativeSpeechPlaybackHandle | null {
  if (!canUseNativeSpeech(scope) || !text.trim()) return null;
  const rate = Number.isFinite(options.rate) ? Math.min(2, Math.max(0.5, options.rate!)) : 1;
  const handle = operation<NativeTtsResult>(scope, "speech_speak", {
    options: { text: text.trim(), lang: options.lang ?? "zh-CN", rate }
  }, "speech_cancel_speech", (value) => {
    return (value as { ok?: boolean } | null)?.ok === true ? { ok: true } :
      failure(value, "设备朗读没有完成，可以稍后再试。");
  }, options);
  return { stop: handle.cancel, done: handle.done };
}
export function describeNativeSpeechError(result: NativeSpeechResult | NativeTtsResult) {
  if (result.ok || result.errorType === "cancelled") return "";
  if (result.errorType === "not-allowed" || result.errorType === "denied") {
    return "没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。";
  }
  if (result.errorType === "no-speech") {
    return "没有听到声音，可以再说一次，或改用文字输入。";
  }
  if (result.errorType === "network") {
    return "语音识别需要联网，现在没有连上。可以稍后再试，或改用文字输入。";
  }
  if (result.errorType === "unavailable") {
    return "这台设备没有可用的语音识别服务，可以改用文字输入。";
  }
  return result.error || fallbackMessage;
}
