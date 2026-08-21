import { expect, test, type Page } from "@playwright/test";

type ApiResult<T> = {
  status: number;
  body: T;
};

type LoginBody = {
  session: {
    userId: string;
    email: string;
    provider: string;
  };
};

type CompanionBody = {
  companion: {
    id: string;
    name: string;
    conversationId: string;
  };
};

type CompanionsBody = {
  companions: Array<{
    id: string;
    name: string;
  }>;
};

type CredentialBody = {
  credential: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    keyPreview: string | null;
  };
};

type AccountDeleteBody = {
  deleted: boolean;
  persistence: string;
  sessionCleared: boolean;
  fallbackDemoAccount: boolean;
  counts: {
    companions: number;
    providerCredentials: number;
  };
};

test("memory fallback keeps logged-in users isolated across relationships, credentials, and account deletion", async ({
  browser
}) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const loginA = await loginByApi(pageA, `isolation-a-${stamp}@perpetual-renewal.local`);
    const companionAName = `隔离A-${stamp}`;
    await createCompanionByApi(pageA, companionAName);
    await saveCredentialByApi(pageA, {
      apiKey: `isolation-a-key-${stamp}-aaaa`,
      model: `isolation-a-model-${stamp}`
    });

    const loginB = await loginByApi(pageB, `isolation-b-${stamp}@perpetual-renewal.local`);
    expect(loginB.session.userId).not.toBe(loginA.session.userId);
    expect(loginA.session.provider).toBe("local-email");
    expect(loginB.session.provider).toBe("local-email");

    await expectCompanionNames(pageB, []);
    await expectCredential(pageB, {
      configured: false,
      model: null,
      keyPreview: null
    });

    const companionBName = `隔离B-${stamp}`;
    await createCompanionByApi(pageB, companionBName);
    await saveCredentialByApi(pageB, {
      apiKey: `isolation-b-key-${stamp}-bbbb`,
      model: `isolation-b-model-${stamp}`
    });

    await expectCompanionNames(pageA, [companionAName], [companionBName]);
    await expectCredential(pageA, {
      configured: true,
      model: `isolation-a-model-${stamp}`,
      keyPreview: "...aaaa"
    });

    const deletedB = await requestJson<AccountDeleteBody>(pageB, "/api/me/account", {
      method: "DELETE",
      body: { confirmation: "删除我的账号" }
    });
    expect(deletedB.status).toBe(200);
    expect(deletedB.body).toMatchObject({
      deleted: true,
      persistence: "memory",
      sessionCleared: true,
      fallbackDemoAccount: false
    });
    expect(deletedB.body.counts.companions).toBe(1);
    expect(deletedB.body.counts.providerCredentials).toBe(1);

    await expectCompanionNames(pageA, [companionAName], [companionBName]);
    await expectCredential(pageA, {
      configured: true,
      model: `isolation-a-model-${stamp}`,
      keyPreview: "...aaaa"
    });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function loginByApi(page: Page, email: string) {
  await page.goto("/login");
  const result = await requestJson<LoginBody>(page, "/api/auth/login", {
    method: "POST",
    body: {
      email,
      nickname: "隔离 QA"
    }
  });
  expect(result.status).toBe(200);
  expect(result.body.session.email).toBe(email);
  return result.body;
}

async function createCompanionByApi(page: Page, name: string) {
  const result = await requestJson<CompanionBody>(page, "/api/companions", {
    method: "POST",
    body: {
      name,
      relationshipKind: "CUSTOM",
      customKind: "并行隔离测试",
      userAddress: "我",
      companionAddress: name,
      personality: ["稳定", "细腻"],
      speakingStyle: "温柔、稳定、不过度打扰",
      background: "用于验证 memory fallback 用户隔离。",
      boundaries: "不泄露其他用户数据。",
      immersionEnabled: true,
      proactiveMessagesEnabled: true,
      proactiveFrequencyPreset: "1m",
      proactiveFrequencyMinutes: 1
    }
  });
  expect(result.status).toBe(201);
  expect(result.body.companion.name).toBe(name);
  expect(result.body.companion.conversationId).toBeTruthy();
  return result.body.companion;
}

async function saveCredentialByApi(
  page: Page,
  input: {
    apiKey: string;
    model: string;
  }
) {
  const result = await requestJson<CredentialBody>(page, "/api/me/llm-credential", {
    method: "PUT",
    body: {
      provider: "compatible",
      baseUrl: "https://isolation-provider.example.test/v1",
      model: input.model,
      apiKey: input.apiKey
    }
  });
  expect(result.status).toBe(200);
  expect(result.body.credential).toMatchObject({
    configured: true,
    provider: "compatible",
    model: input.model,
    keyPreview: `...${input.apiKey.slice(-4)}`
  });
}

async function expectCompanionNames(page: Page, expected: string[], forbidden: string[] = []) {
  const result = await requestJson<CompanionsBody>(page, "/api/companions");
  expect(result.status).toBe(200);
  const names = result.body.companions.map((companion) => companion.name);

  for (const name of expected) {
    expect(names).toContain(name);
  }
  for (const name of forbidden) {
    expect(names).not.toContain(name);
  }
}

async function expectCredential(
  page: Page,
  expected: {
    configured: boolean;
    model: string | null;
    keyPreview: string | null;
  }
) {
  const result = await requestJson<CredentialBody>(page, "/api/me/llm-credential");
  expect(result.status).toBe(200);
  expect(result.body.credential).toMatchObject(expected);
}

async function requestJson<T>(
  page: Page,
  path: string,
  init: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ path: requestPath, init: requestInit }) => {
      const response = await fetch(requestPath, {
        method: requestInit.method ?? "GET",
        headers:
          requestInit.body === undefined ? undefined : { "content-type": "application/json" },
        body: requestInit.body === undefined ? undefined : JSON.stringify(requestInit.body)
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null
      };
    },
    { path, init }
  ) as Promise<ApiResult<T>>;
}
