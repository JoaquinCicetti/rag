import { config } from "../config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LLM {
  readonly model: string;
  chat(messages: ChatMessage[], opts?: { temperature?: number }): Promise<LLMResult>;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Ollama chat via /api/chat, non-streaming. */
export class OllamaLLM implements LLM {
  readonly model: string;
  private readonly url: string;

  constructor(opts?: { url?: string; model?: string }) {
    this.url = opts?.url ?? config.ollama.url;
    this.model = opts?.model ?? config.llm.model;
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<LLMResult> {
    const res = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0 },
      }),
    });
    if (!res.ok) throw new Error(`ollama chat failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as OllamaChatResponse;
    return {
      text: data.message.content.trim(),
      model: data.model,
      usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count },
    };
  }
}

/** Anthropic Messages API, plain fetch (no SDK) to keep the pipeline transparent. */
export class AnthropicLLM implements LLM {
  readonly model: string;
  private readonly apiKey: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? config.llm.anthropicApiKey;
    this.model = opts?.model ?? config.llm.anthropicModel;
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<LLMResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        temperature: opts.temperature ?? 0,
        ...(system ? { system } : {}),
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`anthropic failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as {
      model: string;
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    return {
      text: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim(),
      model: data.model,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
    };
  }
}

export const createLLM = (): LLM => {
  switch (config.llm.provider) {
    case "anthropic":
      return new AnthropicLLM();
    case "ollama":
    default:
      return new OllamaLLM();
  }
};
