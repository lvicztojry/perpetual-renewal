import WebSocket from "ws";
import {
  VoiceProviderError,
  type VoiceProvider,
  type VoiceSynthesis,
  type VoiceSynthesisFormat,
  type VoiceSynthesisOptions,
  type VoiceTranscription
} from "./types";

/**
 * Microsoft Edge "Read Aloud" TTS。
 *
 * 该服务对个人使用免费、无需 API key，走 WebSocket + SSML，而不是 OpenAI 的
 * /audio/speech。它只提供合成，没有转写能力；STT 仍由 shared-llm 或 mock 承担。
 *
 * 这不是微软承诺 SLA 的正式公开 API，正式商用前应改用 Azure Speech 或
 * 硅基流动等有合同、有额度的服务。
 */

const trustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const synthesizerUrl =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const secMsGecVersion = "2-143.0.3650.96";
const edgeCopyright = "Copyright (C) Microsoft Corporation. All rights reserved.";
const audioDelimiter = Buffer.from("Path:audio\r\n");

const defaultEdgeVoice = "zh-CN-XiaoxiaoNeural";
const defaultTimeoutMs = 30_000;
const maxTextChars = 4_000;

/** 前端传的是自定义音色名（如 warm），这里映射到 Edge 的中文神经音色。 */
const voiceAliases: Record<string, string> = {
  warm: "zh-CN-XiaoxiaoNeural",
  soft: "zh-CN-XiaoyiNeural",
  calm: "zh-CN-YunxiNeural",
  deep: "zh-CN-YunjianNeural",
  bright: "zh-CN-XiaoxiaoNeural"
};

const neuralVoicePattern = /^[a-z]{2,3}-[A-Z]{2,}-[A-Za-z]+Neural$/;

type EdgeOutput = { format: string; mimeType: string };

const mp3Output: EdgeOutput = {
  format: "audio-24khz-48kbitrate-mono-mp3",
  mimeType: "audio/mpeg"
};

// Edge 只开放 mp3 与 webm-opus；ogg 请求按 webm 交付，响应 MIME 相应改为 webm。
const webmOutput: EdgeOutput = {
  format: "webm-24khz-16bit-mono-opus",
  mimeType: "audio/webm"
};

type EdgeTtsVoiceProviderConfig = {
  defaultVoice?: string;
  timeoutMs?: number;
  /** 仅用于本地测试替身；默认指向 Edge 朗读端点。 */
  endpoint?: string;
};

export class EdgeTtsVoiceProvider implements VoiceProvider {
  readonly name = "edge" as const;

  private readonly defaultVoice: string;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(config: EdgeTtsVoiceProviderConfig = {}) {
    this.defaultVoice = resolveEdgeVoice(config.defaultVoice) ?? defaultEdgeVoice;
    this.timeoutMs = config.timeoutMs ?? defaultTimeoutMs;
    this.endpoint = config.endpoint ?? synthesizerUrl;
  }

  async transcribe(): Promise<VoiceTranscription> {
    throw new VoiceProviderError("Edge TTS does not support speech transcription.", {
      kind: "configuration",
      provider: this.name,
      retryable: false
    });
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesis> {
    const text = options.text.trim();
    const voice = resolveEdgeVoice(options.voice) ?? this.defaultVoice;
    const output = resolveOutput(options.format);
    const model = `edge:${voice}`;

    if (!text) {
      throw new VoiceProviderError("Text is required for voice synthesis.", {
        kind: "configuration",
        provider: this.name,
        model,
        retryable: false
      });
    }

    const audio = await this.requestAudio({
      text: text.slice(0, maxTextChars),
      voice,
      output,
      rate: toEdgeRate(options.speed),
      signal: options.signal,
      clockOffsetMs: 0,
      retriedClockSkew: false
    });

    if (audio.byteLength === 0) {
      throw new VoiceProviderError("Edge TTS returned empty audio.", {
        kind: "provider_response",
        provider: this.name,
        model,
        retryable: true
      });
    }

    return {
      audioBase64: audio.toString("base64"),
      mimeType: output.mimeType,
      provider: this.name,
      model,
      voice,
      retryable: true,
      raw: {
        responseType: "edge.readaloud",
        format: output.format,
        bytes: audio.byteLength
      }
    };
  }

  private requestAudio(input: {
    text: string;
    voice: string;
    output: EdgeOutput;
    rate: string;
    signal?: AbortSignal;
    clockOffsetMs: number;
    retriedClockSkew: boolean;
  }): Promise<Buffer> {
    const { text, voice, output, rate, signal, clockOffsetMs, retriedClockSkew } = input;

    if (signal?.aborted) return Promise.reject(this.abortError(voice));

    return new Promise<Buffer>((resolve, reject) => {
      const requestId = randomRequestId();
      const chunks: Buffer[] = [];
      let settled = false;
      let socket: WebSocket | undefined;

      const timer = setTimeout(() => {
        fail(new VoiceProviderError("Edge TTS request timed out.", {
          kind: "timeout",
          provider: this.name,
          model: `edge:${voice}`,
          retryable: true
        }));
      }, this.timeoutMs);

      const onAbort = () => fail(this.abortError(voice));

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (socket) {
          // 先摘除监听再关闭，否则 terminate 抛出的错误会变成未处理的 error 事件。
          socket.removeAllListeners();
          socket.on("error", () => {});
          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.terminate();
          }
        }
      };

      const succeed = (audio: Buffer) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(audio);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      void signSecMsGec(clockOffsetMs).then(
        (signature) => {
          if (settled) return;

          const url =
            `${this.endpoint}?TrustedClientToken=${trustedClientToken}` +
            `&Sec-MS-GEC=${signature}&Sec-MS-GEC-Version=${secMsGecVersion}` +
            `&ConnectionId=${requestId}`;

          socket = new WebSocket(url, { headers: edgeHeaders() });

          socket.on("open", () => {
            try {
              socket?.send(speechConfigMessage(output.format));
              socket?.send(ssmlMessage(requestId, voice, text, rate));
            } catch (error) {
              fail(toEdgeError(error, voice));
            }
          });

          socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
            if (settled) return;

            if (!isBinary) {
              if (data.toString().includes("Path:turn.end")) succeed(Buffer.concat(chunks));
              return;
            }

            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            const index = buffer.indexOf(audioDelimiter);
            if (index >= 0) chunks.push(buffer.subarray(index + audioDelimiter.length));
          });

          socket.on("unexpected-response", (_request, response) => {
            // 系统时钟偏差会让 Sec-MS-GEC 失效并返回 403；用服务器时间重试一次。
            const serverDate = response.headers.date;
            const skew = typeof serverDate === "string" ? Date.parse(serverDate) - Date.now() : NaN;

            if (!retriedClockSkew && response.statusCode === 403 && Number.isFinite(skew)) {
              settled = true;
              cleanup();
              this.requestAudio({ ...input, clockOffsetMs: skew, retriedClockSkew: true }).then(
                resolve,
                reject
              );
              return;
            }

            fail(new VoiceProviderError("Edge TTS server rejected the request.", {
              kind: response.statusCode === 403 ? "authentication" : "provider_response",
              provider: this.name,
              model: `edge:${voice}`,
              status: response.statusCode,
              retryable: response.statusCode !== 403
            }));
          });

          socket.on("error", (error: Error) => fail(toEdgeError(error, voice)));
          socket.on("close", () => {
            if (settled) return;
            fail(new VoiceProviderError("Edge TTS connection closed before synthesis finished.", {
              kind: "network",
              provider: this.name,
              model: `edge:${voice}`,
              retryable: true
            }));
          });
        },
        (error) => fail(toEdgeError(error, voice))
      );
    });
  }

  private abortError(voice: string) {
    return new VoiceProviderError("Edge TTS request was aborted.", {
      kind: "timeout",
      provider: this.name,
      model: `edge:${voice}`,
      retryable: true
    });
  }
}

export function resolveEdgeVoice(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (neuralVoicePattern.test(trimmed)) return trimmed;

  return voiceAliases[trimmed.toLowerCase()];
}

function resolveOutput(format: VoiceSynthesisFormat | undefined): EdgeOutput {
  return format === "ogg" ? webmOutput : mp3Output;
}

/** Edge 的 prosody rate 是相对百分比；speed=1 对应 +0%。 */
function toEdgeRate(speed: number | undefined) {
  const clamped = Math.min(Math.max(speed ?? 1, 0.5), 2);
  const percent = Math.round((clamped - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

function edgeHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
  };
}

function speechConfigMessage(outputFormat: string) {
  return (
    `X-Timestamp:${new Date().toISOString()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
            outputFormat
          }
        }
      }
    })
  );
}

function ssmlMessage(requestId: string, voice: string, text: string, rate: string) {
  const locale = voice.split("-").slice(0, 2).join("-");
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${voice}">` +
    `<prosody pitch="+0Hz" rate="${rate}" volume="+0%">${escapeSsml(text)}</prosody>` +
    `</voice></speak>`;

  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
}

function escapeSsml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function randomRequestId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function toEdgeError(error: unknown, voice: string) {
  if (error instanceof VoiceProviderError) return error;

  return new VoiceProviderError("Edge TTS network request failed.", {
    kind: "network",
    provider: "edge",
    model: `edge:${voice}`,
    retryable: true,
    cause: error
  });
}

const swapFirstWord = { swappedWord: 0xef0569fb, swappedSum: 0x76f50f34, swappedProduct: 0xc3efea97 };
const swapSecondWord = { swappedWord: 0xc31713db, swappedSum: 0x1881ce3c, swappedProduct: 0x35bd1ec9 };
const mixFirstWord = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const mixSecondWord = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

/**
 * Sec-MS-GEC 是 Edge 的防滥用签名：时间片 + 客户端 token 的 SHA-256，再与一段
 * CS64 校验和拼成 `<checksum>-<sha256>`。算法与社区公开实现一致。
 */
async function signSecMsGec(clockOffsetMs: number) {
  const ticks = Math.floor((Date.now() + clockOffsetMs) / 1000) + 11_644_473_600;
  const windowTicks = (ticks - (ticks % 300)) * 10_000_000;
  const message = new TextEncoder().encode(
    `${edgeCopyright}${windowTicks}${trustedClientToken}`
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", message));
  const view = new DataView(digest.buffer);
  const firstKey = (view.getUint32(0, true) | 1) >>> 0;
  const secondKey = (view.getUint32(4, true) | 1) >>> 0;

  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
  padded.set(message);
  const words = new DataView(padded.buffer);

  let swapSum = 0;
  let lastSwap = 0;
  let mix = 0;
  let mixSum = 0;

  for (let offset = 0; offset < padded.length; offset += 8) {
    const first = words.getUint32(offset, true);
    const second = words.getUint32(offset + 4, true);
    const firstSwap = swapTerm(first, firstKey, swapFirstWord);
    lastSwap = swapTerm(second, secondKey, swapSecondWord);
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + first, firstKey), mixFirstWord);
    mixSum = (mixSum + mix) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + second, secondKey), mixSecondWord);
    mixSum = (mixSum + mix) >>> 0;
  }

  const checksum = new Uint8Array(8);
  const checksumView = new DataView(checksum.buffer);
  checksumView.setUint32(0, lastSwap ^ mix, true);
  checksumView.setUint32(4, swapSum ^ mixSum, true);

  return `${toUpperHex(checksum)}-${toUpperHex(digest)}`;
}

function swapTerm(
  word: number,
  key: number,
  multipliers: { swappedWord: number; swappedSum: number; swappedProduct: number }
) {
  const sum = Math.imul(word, key) + Math.imul(swapHalves(word), multipliers.swappedWord);
  const product = Math.imul(swapHalves(sum), multipliers.swappedSum) >>> 0;
  return (Math.imul(swapHalves(product), multipliers.swappedProduct) + product) >>> 0;
}

function swapAndMultiply(value: number, multipliers: number[]) {
  let current = value;
  for (const multiplier of multipliers) {
    current = Math.imul(swapHalves(current), multiplier) >>> 0;
  }
  return current;
}

function swapHalves(value: number) {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function toUpperHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
