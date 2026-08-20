import type { LlmCompletion, LlmCompletionOptions, LlmProvider } from "./types";
import { estimateTokenCount } from "@/lib/usage/tokens";

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  constructor(private readonly fallbackReason?: string) {}

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    const lastUserMessage = [...options.messages].reverse().find((message) => message.role === "user");
    const content = `我收到你说的：“${lastUserMessage?.content ?? "我在"}”。我会先把它好好放在这里，然后用你设定的关系继续回应你。`;
    const inputTokens = estimateTokenCount(options.messages.map((message) => message.content).join("\n"));
    const outputTokens = estimateTokenCount(content);

    return {
      content,
      provider: this.name,
      model: options.model ?? "mock-local",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      fallbackReason: this.fallbackReason
    };
  }
}
