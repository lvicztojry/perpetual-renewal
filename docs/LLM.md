# LLM 适配层与 Prompt Builder 草案

## 环境变量

`.env.example` 中保留以下配置：

```text
LLM_PROVIDER="compatible"
LLM_API_KEY=""
LLM_BASE_URL="https://api.tryanotherone.com/v1"
LLM_MODEL=""
```

- 真实测试可以接当前会话使用的中转站或任意兼容网关，但密钥只能放在本机 `.env.local`、CI Secret 或部署平台环境变量里。
- `.env`、`.env.local`、`.env.*.local` 已在 `.gitignore` 中排除；仓库文件只允许出现空值或占位值。
- 推送前运行 `npm run secrets:check`，用于扫描将被 git 纳入的文件中是否出现真实 key 形态或非占位 API key。
- `LLM_PROVIDER=mock`：始终使用本地 mock provider。
- `LLM_PROVIDER=compatible` 且 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 非空：调用兼容 `/chat/completions` 协议的供应商或代理网关。
- `LLM_PROVIDER=anthropic` 且 key/model 非空：调用 Anthropic Messages API。
- `LLM_PROVIDER=gemini` 且 key/model 非空：调用 Google Gemini `generateContent` API。
- `LLM_PROVIDER=openai-responses` 且 key/model 非空：调用 OpenAI Responses API。这个是可选专用适配器，不是项目默认路线。
- `LLM_PROVIDER=openai-compatible`：历史别名，会被映射为 `compatible`。
- 真实 provider 缺少 key/model/baseUrl（`compatible` 需要 baseUrl）时：自动 fallback 到 mock provider，便于无密钥开发；`/api/chat/complete` 会返回 `fallbackReason` 说明缺失项。
- `LLM_BASE_URL`：供应商 API 根地址。当前推荐 `https://api.tryanotherone.com/v1`；Anthropic/Gemini 可不填并使用默认官方地址。
- `LLM_MODEL`：供应商侧模型名。项目不假设模型固定存在，生产部署必须显式配置。
- `LLM_API_KEY`：供应商中立密钥，优先级最高。
- `USER_KEY_VAULT_SECRET`：用户级 API key vault 的服务端加密主密钥。生产环境必须配置；本地开发未配置时使用开发 fallback，不能用于真实用户数据。
- `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`GOOGLE_API_KEY`：仅作为供应商专用兼容变量保留；更推荐生产环境统一注入 `LLM_API_KEY`。
- `ANTHROPIC_VERSION`：Anthropic API 版本，默认 `2023-06-01`。
- `LLM_INPUT_COST_USD_PER_1M`、`LLM_OUTPUT_COST_USD_PER_1M`：可选成本估算覆盖值，单位为每 100 万 input/output tokens 的美元价格。用于用户自带 API 的成本看板，不参与扣费或额度限制。

业务层不要直接读取这些环境变量，也不要直接调用供应商 SDK；统一通过 `createLlmProvider()` 或聊天服务函数调用。

真实密钥只放在本地 `.env.local`、部署平台环境变量或用户级加密 vault 中，不写入仓库。当前仓库只保留变量名与 `.env.example` 占位。

## 用户级 API Key Vault

设置页提供第一版用户级 LLM 密钥保存能力：

- 保存接口：`PUT /api/me/llm-credential`。
- 查询接口：`GET /api/me/llm-credential`，只返回 provider、model、key 尾号、key 指纹、端点是否已配置和端点指纹；不返回 key 原文、Base URL 明文或 `baseUrl` 字段。
- 删除接口：`DELETE /api/me/llm-credential`。
- 模型列表接口：`GET /api/me/llm-models`，使用用户 vault 或服务端 env key 读取兼容中转站 `/models`，不返回 API key、Bearer、Base URL 明文、provider 原始错误、底层网络错误或堆栈。
- 连接测试接口：`POST /api/me/llm-test`，使用用户 vault 中已保存的 key 或服务端 env key，并采用当前表单传入的 provider、baseUrl、model 做一次低 token 聊天探针；compatible provider 会尽量读取 `/models` 作辅助诊断，但最终以 `/chat/completions` 探针是否成功为准。
- 聊天链路优先使用当前用户 vault 中的 LLM 配置；未配置时回落服务端环境变量或 mock provider。
- 密钥用 AES-256-GCM 加密保存，生产环境必须配置 `USER_KEY_VAULT_SECRET`。

日志、成本看板和前端响应不得返回 API key、prompt、用户消息正文或 AI 回复正文。

## 模型连接测试

设置页的“测试连接”按钮调用 `POST /api/me/llm-test`。请求体只发送当前表单中的 provider、baseUrl、model，不发送 API key；服务端自行读取当前用户 vault 或服务端环境变量中的 key。测试动作会发送一次低 token 聊天探针，用来验证凭据、baseUrl、provider 与模型名是否真的能完成 chat completion；compatible provider 的 `/models` 只作为可用时的辅助诊断，模型列表不可用但聊天探针可用时仍可通过。失败响应只能返回稳定友好文案，不透出 API key、Bearer、Base URL 原文、prompt、raw payload、底层网络错误或堆栈。

无 key 时返回可预测失败：

```json
{
  "ok": false,
  "provider": "compatible",
  "model": "provider-model-name",
  "credentialSource": "none",
  "latencyMs": 1,
  "errorType": "missing_api_key",
  "error": "请先保存 API Key，或在服务端环境变量中配置 LLM_API_KEY。",
  "retryable": false
}
```

成功响应只包含 `ok`、provider、model、credentialSource、latencyMs 和 `probe:"chat_completion"`。失败响应只增加错误类型、友好错误、HTTP status、diagnostic 与 retryable。接口不会返回 API key、Base URL 原文、Authorization header、prompt、请求 payload 或供应商 raw payload。

用户自带 API 模式保持不变：测试连接只是帮用户确认自己的 key 或服务端 env key 能否完成一次低成本模型调用；项目不会因此保存订阅状态、扣费记录或平台额度。

## 错误分类与 fallback

所有真实供应商适配器失败时都抛出 `LlmProviderError`，业务/API 层只处理统一字段，不解析供应商原始响应：

| kind | 典型来源 | retryable |
| --- | --- | --- |
| `authentication` | HTTP 401/403，key 无效或权限不足 | false |
| `rate_limit` | HTTP 429 | true |
| `timeout` | HTTP 408、Abort/Timeout | true |
| `network` | fetch 网络失败、DNS/TLS/连接错误 | true |
| `provider_response` | 供应商 4xx/5xx、空 completion、非预期 payload | 5xx 通常 true，空响应 false |

配置缺失不是线上静默重试错误，而是 adapter factory 的开发期 fallback：

- `LLM_PROVIDER` 未设置、未知或为 `mock`：返回 `MockLlmProvider`，`fallbackReason` 标明原因。
- `compatible` 缺 `LLM_API_KEY`/`OPENAI_API_KEY`、`LLM_BASE_URL` 或 `LLM_MODEL`：fallback 到 mock。
- `anthropic`/`gemini`/`openai-responses` 缺 key 或 model：fallback 到 mock。
- `LLM_API_KEY` 优先于供应商专用 key；供应商专用 key 只作兼容 fallback。

## Provider 边界

核心接口位于 `src/lib/llm/types.ts`：

```ts
interface LlmProvider {
  readonly name: "mock" | "compatible" | "anthropic" | "gemini" | "openai-responses";
  complete(options: LlmCompletionOptions): Promise<LlmCompletion>;
}
```

当前实现：

- `MockLlmProvider`：无 key fallback，保持本地可运行。
- `CompatibleChatProvider`：通过 `/chat/completions` payload 调用兼容服务，是默认推荐接入方式。
- `AnthropicProvider`：原生调用 Anthropic Messages API。
- `GeminiProvider`：原生调用 Google Gemini `generateContent` API。
- `OpenAiResponsesProvider`：OpenAI Responses API 专用接入，只有显式配置 `LLM_PROVIDER=openai-responses` 时启用。

后续新增供应商时，只需要实现 `LlmProvider` 并扩展 `createLlmProvider()` 的选择逻辑。

## 供应商接入示例

```text
# 任意 /chat/completions 兼容供应商或代理
LLM_PROVIDER="compatible"
LLM_API_KEY="..."
LLM_BASE_URL="https://api.tryanotherone.com/v1"
LLM_MODEL="provider-model-name"
```

```text
# Anthropic
LLM_PROVIDER="anthropic"
LLM_API_KEY="..."
LLM_MODEL="claude-model-name"
```

```text
# Gemini
LLM_PROVIDER="gemini"
LLM_API_KEY="..."
LLM_MODEL="gemini-model-name"
```

```text
# OpenAI Responses API
LLM_PROVIDER="openai-responses"
LLM_API_KEY="..."
LLM_MODEL="openai-model-name"
```

```text
# 无密钥本地开发
LLM_PROVIDER="mock"
LLM_API_KEY=""
LLM_MODEL=""
```

## Prompt Builder

入口：`buildRenewalPrompt(input)`。

上下文优先级：

1. 高风险规则。
2. 用户禁区与角色边界。
3. 角色设定与关系语气模板。
4. `active` 记忆。
5. 关系状态。
6. 最近消息。

角色设定、关系类型、双方称呼、沉浸边界和特殊关系边界属于受保护系统上下文，不参与记忆/消息预算裁剪。这样即使上下文很长，也会保留恋人、朋友、家人、师友、现实人物替代、逝者纪念、前任、公众人物想象、虚构角色、原创角色与自定义关系的关键设定。

记忆与最近消息有独立预算：

- 记忆只允许 `active` 状态进入 prompt；`pending`、`archived`、`deleted` 一律排除。
- active 记忆按重要标记、重要度、置信度、更新时间和类型加权选择。
- 高置信、重要、近期的 active 记忆优先保留；超长单条记忆会截断并保留截断标记。
- 最近消息排除历史 `system` 消息，优先保留最新消息；被标记 `metadata.important=true` 的消息可获得额外优先级。
- 消息按原始时间顺序输出，保证最新用户消息仍在模型消息序列末尾。

默认预算位于 `src/lib/prompt-builder/builder.ts`，调用方也可以通过 `contextBudget` 覆盖：

```ts
buildRenewalPrompt({
  companion,
  memories,
  recentMessages,
  contextBudget: {
    maxActiveMemories: 12,
    maxMemoryChars: 2400,
    maxSingleMemoryChars: 360,
    maxRecentMessages: 20,
    maxMessageChars: 5200,
    maxSingleMessageChars: 900
  }
});
```

返回值包含 `contextStats`，供 QA 和后续观测使用：

- `budget`：本次实际采用的预算。
- `activeMemories.available/selected/dropped/inactiveExcluded/truncated/estimatedChars`。
- `recentMessages.available/selected/dropped/systemExcluded/truncated/estimatedChars`。
- `protectedSystemChars` 与 `totalPromptChars`。

Prompt builder 只接收结构化数据，不读取数据库。聊天模块应先取出当前关系对象、active 记忆、关系状态和最近消息，再交给 builder。关系状态的生成与更新应复用共享 RelationshipState 演进逻辑和 renewal repository adapter，当前发布候选按共享引擎已集成处理。

## 聊天服务/API

服务函数：

```ts
generateCompanionReply(input)
```

API 草案：

```text
POST /api/chat/complete
```

最小请求体：

```json
{
  "companion": {
    "name": "回响",
    "relationshipKind": "自定义",
    "userAddress": "你",
    "speakingStyle": "温柔、细腻",
    "immersionEnabled": true
  },
  "memories": [
    {
      "type": "relationship_event",
      "status": "active",
      "content": "用户第一次对话里提到想见一个现实中见不到的人。"
    }
  ],
  "relationshipState": {
    "familiarityScore": 42,
    "closenessScore": 36,
    "recentEmotion": "想念"
  },
  "recentMessages": [
    { "role": "user", "content": "我突然很想见一个见不到的人。" }
  ]
}
```

返回：

```json
{
  "content": "生成回复",
  "provider": "mock",
  "model": "mock-local",
  "fallbackReason": "compatible provider missing LLM_BASE_URL; using mock provider.",
  "activeMemoryCount": 1
}
```

说明：`activeMemoryCount` 表示预算后实际进入 prompt 的 active 记忆数量；更细的 `contextStats` 当前保留在 prompt builder 层用于 QA，业务 API 可按后续观测需求再决定是否透出。

## 调用日志与成本看板

M-COST 第一版已加入模型调用观测层：

- 记录入口：聊天回复、重新生成、`/api/chat/complete`。
- 查询入口：`GET /api/usage/model-calls?rangeDays=7`。
- UI 入口：首页聊天顶部的“模型调用看板”图标。
- 数据表：`ModelUsageLog`，迁移位于 `prisma/migrations/20260820013000_model_usage_log/migration.sql`。
- 本地 fallback：未配置数据库或迁移未执行时，开发环境自动写入内存 usage store。

记录字段只包含脱敏元数据：

- userId、companionId、conversationId、messageId。
- purpose、provider、model、success/error、错误类型、HTTP status。
- input/output/total tokens、估算美元成本、latencyMs、fallbackReason。

不会记录：

- API key、baseUrl、请求 prompt、用户消息正文、AI 回复正文、供应商原始响应。

成本估算说明：

- mock 与 compatible 默认价格为 0，避免错误估算用户中转站价格。
- Anthropic/Gemini/OpenAI Responses 有保守默认估算。
- 若用户通过中转站或其它供应商自带 API，可设置 `LLM_INPUT_COST_USD_PER_1M` 与 `LLM_OUTPUT_COST_USD_PER_1M` 覆盖估算。
- 本模块只做可观测性，不做订阅、扣费、额度拦截。

## 集成注意点

- `deleted`、`archived`、`pending` 记忆不得进入生成上下文；builder 只会使用 `active` 记忆。
- active 记忆和最近消息不得无上限进入 LLM 上下文；必须经过 prompt builder 的预算、排序和截断策略。
- 高风险规则位于系统 prompt 最高优先级，角色设定不能覆盖。
- 当前聊天链路使用非流式响应；如需增加流式输出，应在 `LlmProvider` 上扩展 stream 方法，并保持同样的 prompt、正文、key、Base URL 和 raw payload 脱敏边界。
- API 不负责消息持久化。调用方应在服务函数前后保存 user/assistant 消息和错误状态。
- 调用日志必须保持脱敏，不允许把 prompt、正文、key、baseUrl 或供应商 raw payload 写入 usage 表。

## Voice Provider

语音能力使用独立 `VoiceProvider` 接口，但真实供应商配置默认与文本 LLM 共用同一个兼容中转站，避免用户重复维护两套 key。第一版已接 OpenAI 风格 HTTP 协议：

- STT：`POST {LLM_BASE_URL}/audio/transcriptions`
- TTS：`POST {LLM_BASE_URL}/audio/speech`

```text
VOICE_PROVIDER="shared-llm"
VOICE_STT_MODEL=""
VOICE_TTS_MODEL=""
VOICE_DEFAULT_VOICE="warm"
VOICE_CREDENTIAL_SOURCE="server-env"
```

- `VOICE_PROVIDER=mock`：本地 mock STT/TTS，可用于 UI 与 API 联调。
- `VOICE_PROVIDER=shared-llm`：语音与文本 LLM 共用 `LLM_API_KEY`、`LLM_BASE_URL`；STT/TTS 模型优先读取 `VOICE_STT_MODEL`、`VOICE_TTS_MODEL`，为空时 fallback 到 `LLM_MODEL`。
- `VOICE_PROVIDER=compatible`：`shared-llm` 的兼容别名，保留给兼容网关语义；新配置推荐只用 `LLM_*`。
- `VOICE_CREDENTIAL_SOURCE=server-env`：服务端统一环境变量模式，适合自部署内测。
- 用户级 vault：当当前用户保存了 `compatible` 或 `openai-compatible` 的 LLM key、Base URL 和 model，语音 API 会优先复用这组服务端加密凭据；前端状态只显示端点配置状态和端点指纹，不显示 Base URL 明文。非兼容音频协议的供应商继续走服务端 env 或 mock fallback。
- `VOICE_CREDENTIAL_SOURCE=user-vault`：表示真实语音请求来自用户 vault；key 加密保存，不写入仓库，也不返回给前端。
- `.env.local`、`.env.*.local` 已在 `.gitignore`，真实 key 只放本地或部署平台 secret。
- 如果缺少 key/baseUrl/model，或真实语音请求出现鉴权、限流、网络、超时、供应商响应异常，API 会安全 fallback 到 mock provider。
- fallback 响应只返回脱敏的 `fallbackReason`、`fallbackKind`、`requestedProvider`、`credentialSource`、provider、model、HTTP status 等元数据，不返回 API key、Bearer token、baseUrl、供应商错误正文或 raw payload。
- `/api/voice/*` 会从 provider 结果中剥离内部 `raw` 调试字段，只把前端需要展示/播放的安全字段返回给浏览器。
- `VOICE_DEFAULT_VOICE` 会传给 `/audio/speech` 的 `voice`；请求体里传入 `voice` 时优先使用请求值。
- `format=ogg` 会按兼容 OpenAI 的 `response_format=opus` 请求，响应侧仍返回 `audio/ogg` 语义。
- 兼容 adapter 默认 30 秒请求超时；OpenAI 风格二进制 TTS 响应和常见 JSON base64 TTS 响应都会被接住，STT 会兼容 `text`、`transcription`、`output_text` 和 segments 形态。

当前 API：

```text
POST /api/voice/transcribe
POST /api/voice/synthesize
```

`/api/voice/transcribe` 接收 JSON 中的 `audioBase64`、`mimeType`、`fileName`、`language`；真实 provider 会组装 multipart form-data。`mockTranscript` 仅供 mock fallback 与本地联调用。

`/api/voice/synthesize` 接收 `text`、`voice`、`format`、`speed`，返回 `audioBase64`、`mimeType` 与 `audioDataUrl`。mock provider 返回一段静音 wav，供前端 `<audio>` 验证链路。业务 UI 不直接依赖具体语音供应商。

聊天输入区的麦克风按钮已接入浏览器 `MediaRecorder`：第一次点击开始录音，第二次点击停止并转写。前端只把当前录音的 base64 音频发送到 `/api/voice/transcribe`，不会保存到仓库；如果浏览器不支持录音或麦克风不可用，会回落到 mock STT，便于本地开发和 CI 演示。
