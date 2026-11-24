import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import vm from "node:vm";
import * as ts from "typescript";
import WebSocket, { WebSocketServer } from "ws";

const VOICE_TYPES_PATH = new URL("../src/lib/voice/types.ts", import.meta.url);
const EDGE_PROVIDER_PATH = new URL("../src/lib/voice/edge-tts-provider.ts", import.meta.url);

const errors = [];

await testSynthesizesWithEdgeProtocol();
await testEscapesSsmlAndMapsVoiceAliases();
await testRejectsEmptyAudio();
await testReportsServerRejection();

if (errors.length > 0) {
  console.error("Edge TTS smoke failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Edge TTS smoke passed: WebSocket protocol, SSML escaping, voice aliases, empty audio and rejection mapping."
);

async function testSynthesizesWithEdgeProtocol() {
  const fixture = await startFakeEdge();
  try {
    const provider = await createProvider(fixture.url);
    const result = await provider.synthesize({ text: "今天也很想你。", voice: "warm", format: "mp3" });

    assert.equal(result.provider, "edge", "edge provider should identify itself");
    assert.equal(result.voice, "zh-CN-XiaoxiaoNeural", "warm alias should map to Xiaoxiao");
    assert.equal(result.model, "edge:zh-CN-XiaoxiaoNeural", "model should describe the Edge voice");
    assert.equal(result.mimeType, "audio/mpeg", "mp3 format should map to audio/mpeg");
    assert.ok(!result.placeholder, "Edge audio must not be marked as a silent placeholder");
    assert.equal(
      Buffer.from(result.audioBase64, "base64").toString("utf8"),
      "FAKE-EDGE-AUDIO",
      "audio payload should be the concatenated Path:audio chunks"
    );

    const connection = fixture.connections.at(-1);
    assert.match(connection.url, /TrustedClientToken=/, "Edge URL should carry the trusted client token");
    assert.match(connection.url, /Sec-MS-GEC=[0-9A-F]+-[0-9A-F]{64}/, "Edge URL should carry a signed Sec-MS-GEC");
    assert.match(connection.url, /Sec-MS-GEC-Version=/, "Edge URL should pin the signature version");
    assert.match(connection.url, /ConnectionId=/, "Edge URL should carry a connection id");
    assert.equal(
      connection.headers.origin,
      "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Edge requires the Read Aloud extension origin"
    );
    assert.match(connection.headers["user-agent"] ?? "", /Edg\//, "Edge expects an Edge user agent");

    assert.ok(
      connection.messages[0].includes("Path:speech.config"),
      "the first frame must be the speech.config payload"
    );
    assert.ok(
      connection.messages[0].includes("audio-24khz-48kbitrate-mono-mp3"),
      "mp3 requests should ask for the mp3 output format"
    );
    assert.ok(
      connection.messages[1].includes("Path:ssml") && connection.messages[1].includes("今天也很想你。"),
      "the second frame must be the SSML request"
    );
    assert.ok(
      connection.messages[1].includes('rate="+0%"'),
      "speed=1 should map to a neutral prosody rate"
    );
  } catch (error) {
    errors.push(`synthesis: ${error.message}`);
  } finally {
    await fixture.close();
  }
}

async function testEscapesSsmlAndMapsVoiceAliases() {
  const fixture = await startFakeEdge();
  try {
    const provider = await createProvider(fixture.url);
    await provider.synthesize({ text: "5 < 6 & 7 > 4 \"q\" 'a'", voice: "soft", format: "wav", speed: 1.5 });

    const connection = fixture.connections.at(-1);
    const ssml = connection.messages[1];
    assert.ok(ssml.includes("5 &lt; 6 &amp; 7 &gt; 4 &quot;q&quot; &apos;a&apos;"), "text must be SSML-escaped");
    assert.ok(ssml.includes('name="zh-CN-XiaoyiNeural"'), "soft alias should map to Xiaoyi");
    assert.ok(ssml.includes('rate="+50%"'), "speed=1.5 should map to +50%");
    assert.ok(
      connection.messages[0].includes("audio-24khz-48kbitrate-mono-mp3"),
      "wav is not offered by Edge; mp3 remains the delivered format"
    );
  } catch (error) {
    errors.push(`escaping: ${error.message}`);
  } finally {
    await fixture.close();
  }
}

async function testRejectsEmptyAudio() {
  const fixture = await startFakeEdge({ emptyAudio: true });
  try {
    const provider = await createProvider(fixture.url);
    await assert.rejects(
      () => provider.synthesize({ text: "空的", voice: "warm" }),
      /returned empty audio/,
      "a turn.end without audio must surface as a provider error"
    );
  } catch (error) {
    errors.push(`empty audio: ${error.message}`);
  } finally {
    await fixture.close();
  }
}

async function testReportsServerRejection() {
  const fixture = await startFakeEdge({ rejectStatus: 403 });
  try {
    const provider = await createProvider(fixture.url);
    await assert.rejects(
      () => provider.synthesize({ text: "拒绝", voice: "warm" }),
      (error) =>
        error.details?.kind === "authentication" &&
        error.details?.status === 403 &&
        error.details?.retryable === false,
      "403 must surface as a non-retryable authentication failure"
    );
  } catch (error) {
    errors.push(`rejection: ${error.message}`);
  } finally {
    await fixture.close();
  }
}

async function createProvider(endpoint) {
  const types = await loadTsModule(VOICE_TYPES_PATH, {
    require(specifier) {
      throw new Error(`Unexpected require while loading voice types: ${specifier}`);
    }
  });
  const edge = await loadTsModule(EDGE_PROVIDER_PATH, {
    require(specifier) {
      if (specifier === "./types") return types;
      if (specifier === "ws") return { default: WebSocket, __esModule: true };
      throw new Error(`Unexpected require while loading edge provider: ${specifier}`);
    }
  });

  return new edge.EdgeTtsVoiceProvider({ endpoint, timeoutMs: 5_000 });
}

async function startFakeEdge(options = {}) {
  const connections = [];
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, request) => {
    const record = {
      url: request.url,
      headers: request.headers,
      messages: []
    };
    connections.push(record);

    socket.on("message", (data) => {
      const message = data.toString();
      record.messages.push(message);

      if (message.includes("Path:speech.config")) {
        socket.send(
          `X-RequestId:0\r\nContent-Type:application/json; charset=utf-8\r\nPath:turn.start\r\n\r\n{}`
        );
        return;
      }

      if (message.includes("Path:ssml")) {
        if (options.emptyAudio) {
          socket.send(`X-RequestId:0\r\nPath:turn.end\r\n\r\n`);
          return;
        }

        const audio = Buffer.from("FAKE-EDGE-AUDIO", "utf8");
        // 真实 Edge 的二进制帧是 `...\r\nPath:audio\r\n` 紧跟音频字节，没有额外空行。
        const header = Buffer.from(`X-RequestId:0\r\nPath:audio\r\n`);
        socket.send(Buffer.concat([header, audio]));
        socket.send(`X-RequestId:0\r\nPath:turn.end\r\n\r\n`);
      }
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const { port } = httpServer.address();
  const endpoint = `ws://127.0.0.1:${port}/consumer/speech/synthesize/readaloud/edge/v1`;

  if (options.rejectStatus) {
    // 拒绝场景需要握手失败，单独起一个只回状态码的 server。
    wss.close();
    const rejecting = createServer((_request, response) => {
      response.writeHead(options.rejectStatus, { date: new Date().toUTCString() });
      response.end();
    });
    await new Promise((resolve) => httpServer.close(resolve));
    await new Promise((resolve, reject) => {
      rejecting.once("error", reject);
      rejecting.listen(0, "127.0.0.1", resolve);
    });
    const rejectingPort = rejecting.address().port;
    return {
      url: `ws://127.0.0.1:${rejectingPort}/edge/v1`,
      connections,
      close: () => new Promise((resolve) => rejecting.close(resolve))
    };
  }

  return {
    url: endpoint,
    connections,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      })
  };
}

async function loadTsModule(path, options) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: path.pathname
  });

  const sandbox = {
    AbortSignal,
    Buffer,
    TextEncoder,
    console,
    crypto,
    exports: {},
    process: { env: {} },
    require: options.require,
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: path.pathname }).runInContext(sandbox);
  return sandbox.exports;
}
