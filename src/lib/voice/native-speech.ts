/**
 * 安卓原生语音识别（Tauri 插件 `renewal-speech`）。
 *
 * WebView 不实现 Web Speech API，所以安卓壳里浏览器那条识别路径永远不可用。
 * 这里通过 Tauri 命令调用系统 SpeechRecognizer：识别文本回传，音频由系统识别
 * 服务处理，不经过本应用。
 *
 * 非 Android 平台命令同样存在，但会返回 `available: false`，调用方据此回退。
 */

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriScope = {
  __TAURI_INTERNALS__?: unknown;
  navigator?: { userAgent?: string };
};

export type NativeSpeechResult =
  | { ok: true; text: string }
  | { ok: false; error: string; errorType: string };

export type NativeSpeechOptions = {
  lang?: string;
};

export type NativeSpeechHandle = {
  /** 停止识别并丢弃结果。 */
  cancel: () => void;
  /** 识别结束（成功、失败或取消）时兑现。 */
  done: Promise<NativeSpeechResult>;
};

const commandPrefix = "plugin:renewal-speech|";

function readScope(): TauriScope | null {
  if (typeof window === "undefined") return null;
  return window as unknown as TauriScope;
}

function readUserAgent(scope: TauriScope | null) {
  if (scope?.navigator?.userAgent) return scope.navigator.userAgent;
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}

/** 只有在原生壳的 Android 上才值得尝试，浏览器里直接跳过。 */
export function canUseNativeSpeech(scope: TauriScope | null = readScope()) {
  if (!scope?.__TAURI_INTERNALS__) return false;
  return /Android/i.test(readUserAgent(scope));
}

async function loadInvoke(): Promise<InvokeFn | null> {
  try {
    // 只在原生壳里加载：Web 构建没有 @tauri-apps/api，用变量绕开静态解析。
    const moduleName = "@tauri-apps/api/core";
    const api = (await import(/* webpackIgnore: true */ moduleName)) as {
      invoke?: InvokeFn;
    };
    return api.invoke ?? null;
  } catch {
    return null;
  }
}

/**
 * 探测设备是否装了可用的识别服务（很多精简 ROM 没有）。
 * 结果只反映当前设备，调用方应缓存本次会话的结果。
 */
export async function isNativeSpeechAvailable(
  scope: TauriScope | null = readScope()
): Promise<boolean> {
  if (!canUseNativeSpeech(scope)) return false;

  const invoke = await loadInvoke();
  if (!invoke) return false;

  try {
    const result = await invoke<{ available?: boolean }>(`${commandPrefix}speech_is_available`);
    return result?.available === true;
  } catch {
    return false;
  }
}

function normalize(
  value: unknown,
  fallbackMessage = "这段语音没有识别出来，可以再录一次，或改用文字。"
): NativeSpeechResult {
  const outcome = (value ?? {}) as {
    ok?: boolean;
    text?: string;
    error?: string;
    errorType?: string;
  };

  if (outcome.ok === true && typeof outcome.text === "string" && outcome.text.trim()) {
    return { ok: true, text: outcome.text.trim() };
  }

  return {
    ok: false,
    error: outcome.error?.trim() || fallbackMessage,
    errorType: outcome.errorType ?? "unknown"
  };
}

/**
 * 开始一次识别。返回 null 表示当前环境不该走原生路径。
 *
 * 与浏览器识别不同，这里是一次性调用：中途不能拿到临时结果，
 * 结束时一次性给出文字。
 */
export function startNativeSpeech(
  options: NativeSpeechOptions = {},
  scope: TauriScope | null = readScope()
): NativeSpeechHandle | null {
  if (!canUseNativeSpeech(scope)) return null;

  let cancelled = false;
  let settled = false;

  const done = (async (): Promise<NativeSpeechResult> => {
    const invoke = await loadInvoke();
    if (!invoke) {
      return {
        ok: false,
        error: "本地语音识别没有加载成功，可以改用文字输入。",
        errorType: "unavailable"
      };
    }

    try {
      const value = await invoke<unknown>(`${commandPrefix}speech_recognize`, {
        options: { lang: options.lang ?? "zh-CN" }
      });
      settled = true;

      if (cancelled) return { ok: false, error: "", errorType: "cancelled" };
      return normalize(value, "这段语音没有识别出来，可以再录一次，或改用文字。");
    } catch {
      settled = true;
      if (cancelled) return { ok: false, error: "", errorType: "cancelled" };
      return {
        ok: false,
        error: "这段语音没有识别出来，可以再录一次，或改用文字。",
        errorType: "unknown"
      };
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      if (settled) return;
      void loadInvoke().then((invoke) => {
        // 取消失败可以忽略：下一次识别会丢弃旧会话。
        void invoke?.(`${commandPrefix}speech_cancel`).catch(() => undefined);
      });
    },
    done
  };
}

/** 把 errorType 映射成可展示的提示；与 docs/ERROR_COPY.md 一致。 */
export function describeNativeSpeechError(result: NativeSpeechResult) {
  if (result.ok) return "";
  if (result.errorType === "cancelled") return "";

  if (result.errorType === "not-allowed") {
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

  return result.error || "这段语音没有识别出来，可以再录一次，或改用文字。";
}
