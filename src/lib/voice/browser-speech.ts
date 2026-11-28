/**
 * 浏览器内置语音识别（Web Speech API）。
 *
 * Chrome / Edge 会直接把麦克风音频送到浏览器厂商的识别服务，不经过本应用
 * 服务端，因此不需要 API key，也不受中转站是否提供 STT 通道的限制。
 * Firefox 没有实现该 API，Safari 行为不统一，调用前先用
 * `isBrowserSpeechSupported()` 判断并回退到服务端转写。
 */

export type BrowserSpeechErrorCode =
  | "not-allowed"
  | "service-not-allowed"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "language-not-supported"
  | "unknown";

export type BrowserSpeechCallbacks = {
  lang?: string;
  /** 边说边出的临时结果；同一次识别会多次回调。 */
  onInterim?: (text: string) => void;
  /** 一句说完的最终结果；可能多次回调。 */
  onFinal?: (text: string) => void;
  onError?: (code: BrowserSpeechErrorCode) => void;
  onEnd?: () => void;
};

export type BrowserSpeechHandle = {
  /** 停止录音并等待最后一段识别结果。 */
  stop: () => void;
  /** 立即放弃，不再回调结果。 */
  abort: () => void;
};

type SpeechResultLike = {
  isFinal: boolean;
  [index: number]: { transcript?: string; confidence?: number } | undefined;
};

type SpeechResultListLike = {
  length: number;
  [index: number]: SpeechResultLike | undefined;
};

type SpeechResultEventLike = {
  resultIndex: number;
  results: SpeechResultListLike;
};

type SpeechErrorEventLike = { error?: string };

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function readConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as SpeechWindow;
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

export function isBrowserSpeechSupported() {
  return readConstructor() !== null;
}

const errorCodeMap: Record<string, BrowserSpeechErrorCode> = {
  "not-allowed": "not-allowed",
  "service-not-allowed": "service-not-allowed",
  "no-speech": "no-speech",
  "audio-capture": "audio-capture",
  network: "network",
  aborted: "aborted",
  "language-not-supported": "language-not-supported"
};

/**
 * 启动一次识别。返回 null 表示当前浏览器不支持，调用方应回退到录音上传。
 * 注意：多数浏览器要求页面处于安全上下文（HTTPS 或 localhost）。
 */
export function startBrowserSpeech(callbacks: BrowserSpeechCallbacks = {}): BrowserSpeechHandle | null {
  const Constructor = readConstructor();
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.lang = callbacks.lang ?? "zh-CN";
  // 一句话结束就触发 final 结果，避免长时间挂起。
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let settled = false;
  let aborted = false;

  recognition.onresult = (event) => {
    if (aborted) return;

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result) continue;
      const transcript = result[0]?.transcript?.trim() ?? "";
      if (!transcript) continue;

      if (result.isFinal) {
        callbacks.onFinal?.(transcript);
      } else {
        callbacks.onInterim?.(transcript);
      }
    }
  };

  recognition.onerror = (event) => {
    if (aborted) return;
    settled = true;
    const raw = event.error ?? "unknown";
    callbacks.onError?.(errorCodeMap[raw] ?? "unknown");
  };

  recognition.onend = () => {
    if (aborted) return;
    if (!settled) settled = true;
    callbacks.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    // 重复 start 或权限已拒绝时会抛错；交给调用方按失败处理。
    callbacks.onError?.("unknown");
    return { stop: () => {}, abort: () => {} };
  }

  return {
    stop: () => {
      if (settled) return;
      try {
        recognition.stop();
      } catch {
        // 已经在停止过程中，忽略。
      }
    },
    abort: () => {
      aborted = true;
      settled = true;
      try {
        recognition.abort();
      } catch {
        // 已经结束，忽略。
      }
    }
  };
}

/** 把识别错误码映射成 UI 文案；与 docs/ERROR_COPY.md 保持一致。 */
export function describeBrowserSpeechError(code: BrowserSpeechErrorCode) {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
    return "没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。";
  }

  if (code === "no-speech") {
    return "没有听到声音，可以再说一次，或改用文字输入。";
  }

  if (code === "aborted") {
    return "";
  }

  return "这段语音没有识别出来，可以再录一次，或改用文字。";
}
