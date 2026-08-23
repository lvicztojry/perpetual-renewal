import { expect, test } from "@playwright/test";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

const modelId = "fake-compatible/byok-browser-gate";

test("settings BYOK key drives real compatible chat flow without leaking provider secrets", async ({
  page
}) => {
  const unique = Date.now();
  const fakeApiKey = `e2e-byok-key-${unique}-1234`;
  const providerReply = `BYOK 浏览器门禁回响 ${unique}：我在这里，真实链路已经接住你。`;
  const provider = await startFakeCompatibleProvider(providerReply);

  try {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(`byok-browser-${unique}@perpetual-renewal.local`);
    await page.getByLabel("昵称").fill("BYOK 浏览器 QA");
    await page.getByRole("button", { name: "进入" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("link", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "模型供应商" })).toBeVisible();
    await page.getByLabel("Base URL").fill(provider.baseUrl);
    await page.getByLabel("模型").fill(modelId);
    await page.getByLabel("API Key").fill(fakeApiKey);
    await page.getByRole("button", { name: "保存连接配置" }).click();

    await expect(page.getByText("已保存连接配置")).toBeVisible();
    await expect(page.getByLabel("API Key")).toHaveValue("");
    await expect(page.getByText(fakeApiKey)).toHaveCount(0);

    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByText(new RegExp(`连接成功 · compatible/${escapeRegExp(modelId)}`))).toBeVisible();
    await expect
      .poll(() => provider.chatRequests.length, { message: "connection test should call chat completions" })
      .toBeGreaterThanOrEqual(1);

    const connectionProbe = provider.chatRequests[0];
    expect(connectionProbe.authorization).toBe(`Bearer ${fakeApiKey}`);
    expect(connectionProbe.model).toBe(modelId);
    expect(connectionProbe.bodyText).toContain("ping");

    const companionName = `BYOK回响${unique}`;
    const userMessage = "这次请走我保存的模型连接回应我。";
    await page.getByRole("link", { name: "返回工作台" }).click();
    await expect(page.getByRole("heading", { name: "生生不息" })).toBeVisible();
    await page.getByRole("button", { name: "创建关系对象" }).first().click();
    await expect(page.getByRole("heading", { name: "创建关系对象" })).toBeVisible();
    await page.getByLabel("名字").fill(companionName);
    await page.getByLabel("具体关系").fill("BYOK 浏览器门禁关系");
    await page.getByLabel("性格关键词").fill("稳定、可验证、贴近");
    await page.getByLabel("语气").fill("温柔直接，不使用调试文本");
    await page.getByRole("button", { name: "创建并开始聊天" }).last().click();

    await expect(page.getByRole("heading", { exact: true, name: companionName })).toBeVisible();
    await page.getByPlaceholder("把想说的话放在这里").fill(userMessage);
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.getByText(userMessage, { exact: true })).toBeVisible();
    await expect(page.getByText(providerReply)).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => provider.chatRequests.length, { message: "chat message should call fake provider" })
      .toBeGreaterThanOrEqual(2);

    const chatRequest = provider.chatRequests[provider.chatRequests.length - 1];
    expect(chatRequest.authorization).toBe(`Bearer ${fakeApiKey}`);
    expect(chatRequest.model).toBe(modelId);
    expect(chatRequest.bodyText).toContain(userMessage);

    await expect(page.getByText(fakeApiKey)).toHaveCount(0);
    await expect(page.getByText(provider.baseUrl)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(fakeApiKey);
    await expect(page.locator("body")).not.toContainText(provider.baseUrl);
  } finally {
    await provider.close();
  }
});

type ChatRequest = {
  authorization: string | undefined;
  bodyText: string;
  model: string | undefined;
};

type JsonResponse = {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  end(chunk?: string): void;
};

async function startFakeCompatibleProvider(providerReply: string) {
  const chatRequests: ChatRequest[] = [];

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const bodyText = await readRequestBody(request);
    const authorization = request.headers.authorization;

    if (path === "/v1/models") {
      writeJson(response, 200, {
        object: "list",
        data: [{ id: modelId, object: "model", owned_by: "e2e" }]
      });
      return;
    }

    if (path === "/v1/chat/completions" && request.method === "POST") {
      const body = parseJsonObject(bodyText);
      const requestModel = typeof body.model === "string" ? body.model : undefined;
      chatRequests.push({ authorization, bodyText, model: requestModel });

      const isConnectionProbe = bodyText.includes("ping");
      writeJson(response, 200, {
        id: `chatcmpl-e2e-${chatRequests.length}`,
        object: "chat.completion",
        model: requestModel ?? modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: isConnectionProbe ? "pong" : providerReply
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: isConnectionProbe ? 1 : 16,
          total_tokens: isConnectionProbe ? 13 : 28
        }
      });
      return;
    }

    writeJson(response, 404, { error: `Unexpected fake provider route: ${path}` });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake compatible provider did not expose a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    chatRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(response: JsonResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
