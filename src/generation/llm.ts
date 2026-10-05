import { config } from "../config.ts";

export type ToolArguments = Record<string, unknown>;

export interface ToolCall {
  id: string;
  name: string;
  arguments: ToolArguments;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<ToolCall>;
  toolCallId?: string;
  toolName?: string;
}

export interface LLMUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  loadMs?: number;
  promptEvalMs?: number;
  evalMs?: number;
}

export interface LLMResult {
  text: string;
  model: string;
  usage?: LLMUsage;
  toolCalls?: Array<ToolCall>;
}

export interface ChatOptions {
  temperature?: number;
  tools?: Array<ToolDefinition>;
}

export interface LLM {
  readonly model: string;
  chat(messages: Array<ChatMessage>, options?: ChatOptions): Promise<LLMResult>;
}

export interface LLMConnection {
  url?: string;
  apiKey?: string;
  model?: string;
}

export interface OllamaTimings {
  prompt_eval_count?: number;
  prompt_eval_cached_count?: number;
  eval_count?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
}

interface OllamaFunctionCall {
  name: string;
  arguments: ToolArguments;
}

interface OllamaToolCall {
  id?: string;
  function: OllamaFunctionCall;
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<OllamaToolCall>;
  tool_name?: string;
}

interface OllamaChatResponse extends OllamaTimings {
  model: string;
  message: OllamaMessage;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: ToolArguments;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<AnthropicContentBlock>;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicResponse {
  model: string;
  content: Array<AnthropicContentBlock>;
  usage?: AnthropicUsage;
}

const nanosToMs = (ns?: number): number | undefined => (ns === undefined ? undefined : ns / 1e6);

export const mapOllamaUsage = (timings: OllamaTimings): LLMUsage => ({
  inputTokens: timings.prompt_eval_count,
  cachedInputTokens: timings.prompt_eval_cached_count,
  outputTokens: timings.eval_count,
  loadMs: nanosToMs(timings.load_duration),
  promptEvalMs: nanosToMs(timings.prompt_eval_duration),
  evalMs: nanosToMs(timings.eval_duration),
});

const mapAnthropicUsage = (usage: AnthropicUsage): LLMUsage => {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + cacheRead + cacheWrite,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: usage.output_tokens,
  };
};

const toOllamaMessage = (message: ChatMessage): OllamaMessage => ({
  role: message.role,
  content: message.content,
  ...(message.toolCalls && {
    tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.arguments } })),
  }),
  ...(message.toolName && { tool_name: message.toolName }),
});

const fromOllamaToolCalls = (calls: Array<OllamaToolCall>): Array<ToolCall> =>
  calls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function.name,
    arguments: call.function.arguments,
  }));

const toAnthropicBlocks = (message: ChatMessage): Array<AnthropicContentBlock> => {
  if (message.role === "tool") return [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }];
  const textBlocks: Array<AnthropicContentBlock> = message.content ? [{ type: "text", text: message.content }] : [];
  const toolBlocks = (message.toolCalls ?? []).map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments }));
  return [...textBlocks, ...toolBlocks];
};

const toAnthropicMessages = (messages: Array<ChatMessage>): Array<AnthropicMessage> => {
  const merged: Array<AnthropicMessage> = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks = toAnthropicBlocks(message);
    const previous = merged.at(-1);
    if (previous?.role === role && Array.isArray(previous.content)) previous.content.push(...blocks);
    else merged.push({ role, content: blocks });
  }
  return merged;
};

const failedResponse = async (provider: string, response: Response): Promise<Error> => {
  const body = await response.text();
  return new Error(`${provider} failed (${response.status}): ${body}`);
};

export class OllamaLLM implements LLM {
  readonly model: string;
  private readonly url: string;

  constructor(connection?: LLMConnection) {
    this.url = connection?.url ?? config.ollama.url;
    this.model = connection?.model ?? config.llm.model;
  }

  async chat(messages: Array<ChatMessage>, options?: ChatOptions): Promise<LLMResult> {
    const response = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOllamaMessage),
        stream: false,
        options: { temperature: options?.temperature ?? 0 },
        ...(options?.tools && {
          tools: options.tools.map((tool) => ({ type: "function", function: tool })),
        }),
      }),
    });
    if (!response.ok) throw await failedResponse("ollama chat", response);
    const data = (await response.json()) as OllamaChatResponse;
    return {
      text: data.message.content.trim(),
      model: data.model,
      usage: mapOllamaUsage(data),
      ...(data.message.tool_calls && { toolCalls: fromOllamaToolCalls(data.message.tool_calls) }),
    };
  }
}

export class AnthropicLLM implements LLM {
  readonly model: string;
  private readonly apiKey: string;

  constructor(connection?: LLMConnection) {
    this.apiKey = connection?.apiKey ?? config.llm.anthropicApiKey;
    this.model = connection?.model ?? config.llm.anthropicModel;
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
  }

  async chat(messages: Array<ChatMessage>, options?: ChatOptions): Promise<LLMResult> {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const conversation = messages.filter((message) => message.role !== "system");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        temperature: options?.temperature ?? 0,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(conversation),
        ...(options?.tools && {
          tools: options.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
        }),
      }),
    });
    if (!response.ok) throw await failedResponse("anthropic", response);
    const data = (await response.json()) as AnthropicResponse;
    const toolCalls = data.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id ?? "", name: block.name ?? "", arguments: block.input ?? {} }));
    return {
      text: data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("").trim(),
      model: data.model,
      usage: data.usage && mapAnthropicUsage(data.usage),
      ...(toolCalls.length > 0 && { toolCalls }),
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
