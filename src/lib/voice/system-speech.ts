/**
 * 设备本地语音合成（Web Speech Synthesis）。
 *
 * 安卓原生客户端运行在 Tauri 的 Android WebView 里：WebView 不支持
 * `SpeechRecognition`，而 Edge TTS 需要自定义 WebSocket 头与 wss 连接，
 * 这两点 WebView 都做不到。但 `speechSynthesis` 可用——它直接调用系统
 * TTS 引擎（Android 上的 Google TTS 等），免费、可离线、无需 key。
 *
 * 代价是音色不可控、停顿处理比 Edge 粗糙，因此只在原生客户端启用，
 * 浏览器端仍走 Edge TTS。
 */

export type SystemSpeechOptions = {
  lang?: string;
  /** 语速倍率，1 为正常。 */
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
};

type SpeechSynthesisVoiceLike = {
  lang: string;
  name: string;
  default?: boolean;
};

type SpeechSynthesisUtteranceLike = {
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechSynthesisVoiceLike | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

type SpeechSynthesisLike = {
  speaking: boolean;
  pending: boolean;
  cancel: () => void;
  speak: (utterance: SpeechSynthesisUtteranceLike) => void;
  getVoices: () => SpeechSynthesisVoiceLike[];
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type UtteranceConstructor = new (text: string) => SpeechSynthesisUtteranceLike;

type SpeechScope = {
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: UtteranceConstructor;
  __TAURI_INTERNALS__?: unknown;
  navigator?: { userAgent?: string };
};

function readScope(): SpeechScope | null {
  if (typeof window === "undefined") return null;
  // DOM 的 SpeechSynthesis 类型比这里用到的表面更宽，直接按结构断言。
  return window as unknown as SpeechScope;
}

function readUserAgent(scope: SpeechScope | null) {
  if (scope?.navigator?.userAgent) return scope.navigator.userAgent;
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}

/**
 * 原生安卓壳里判定为可用。浏览器（含手机浏览器）不启用这条路径，
 * 以免抢掉 Web 端已有的 Edge TTS。
 */
export function isNativeAndroidShell(scope: SpeechScope | null = readScope()) {
  if (!scope) return false;
  if (!scope.__TAURI_INTERNALS__) return false;

  return /Android/i.test(readUserAgent(scope));
}

export function isSystemSpeechSupported(scope: SpeechScope | null = readScope()) {
  if (!scope) return false;
  return Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
}

/** 设备朗读是否应该接管「朗读最近回复」。 */
export function shouldUseSystemSpeech(scope: SpeechScope | null = readScope()) {
  return isNativeAndroidShell(scope) && isSystemSpeechSupported(scope);
}

/** 在可用音色里挑中文音色，优先系统默认。 */
export function pickChineseVoice(
  voices: SpeechSynthesisVoiceLike[],
  lang = "zh-CN"
): SpeechSynthesisVoiceLike | null {
  const primary = lang.split("-")[0].toLowerCase();
  const chinese = voices.filter((voice) => voice.lang.toLowerCase().startsWith(primary));
  if (!chinese.length) return null;

  return (
    chinese.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
    chinese.find((voice) => voice.default) ??
    chinese[0]
  );
}

export type SystemSpeechHandle = {
  /** 停止朗读。 */
  stop: () => void;
  /** 朗读结束（自然结束或被打断）时兑现。 */
  done: Promise<void>;
};

const defaultTimeoutMs = 60_000;

/**
 * 开始朗读。返回 null 表示当前环境不可用，调用方应回退到其它合成路径。
 */
export function speakWithSystemVoice(
  text: string,
  options: SystemSpeechOptions = {},
  scope: SpeechScope | null = readScope()
): SystemSpeechHandle | null {
  if (!scope || !shouldUseSystemSpeech(scope)) return null;

  const content = text.trim();
  if (!content) return null;

  const synthesis = scope.speechSynthesis!;
  const Utterance = scope.SpeechSynthesisUtterance!;
  // 上一次朗读可能还在排队，先清空再说话。
  synthesis.cancel();

  const utterance = new Utterance(content);
  utterance.lang = options.lang ?? "zh-CN";
  utterance.rate = Math.min(Math.max(options.rate ?? 1, 0.5), 2);
  utterance.pitch = 1;
  utterance.volume = 1;

  const voice = pickChineseVoice(synthesis.getVoices(), utterance.lang);
  if (voice) utterance.voice = voice;

  let settled = false;
  let resolveDone: () => void = () => {};

  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // 某些 WebView 在静音或引擎缺失时不触发 end；超时兜底避免一直转圈。
  const timer = setTimeout(() => settle(), defaultTimeoutMs);

  function settle() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone();
  }

  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => {
    options.onEnd?.();
    settle();
  };
  utterance.onerror = () => settle();

  synthesis.speak(utterance);

  return {
    stop: () => {
      try {
        synthesis.cancel();
      } catch {
        // 引擎已经停止，忽略。
      }
      settle();
    },
    done
  };
}
