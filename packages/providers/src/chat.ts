import {
  checkedFetch,
  serviceDetail,
  headers,
  type ChatMessage,
  type Completion,
  type ProviderContext,
  type ToolCall,
  type ToolDefinition,
} from "./types";
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const parse = (chunk: string) => {
    const data = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    return data && data !== "[DONE]" ? JSON.parse(data) : null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const value = parse(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (value) yield value;
      }
      if (done) {
        if (buffer.trim()) {
          const value = parse(buffer);
          if (value) yield value;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export async function completeChat(
  ctx: ProviderContext,
  system: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onText: (delta: string) => void,
): Promise<Completion> {
  if (!ctx.provider.model) throw new Error("请选择或填写聊天模型");
  if (ctx.provider.kind === "anthropic")
    return anthropic(ctx, system, messages, tools, onText);
  if (ctx.provider.kind === "openai")
    return responses(ctx, system, messages, tools, onText);
  const nativeOllama =
    ctx.provider.kind === "ollama" && !ctx.provider.baseUrl.endsWith("/v1");
  if (nativeOllama) return ollama(ctx, system, messages, tools, onText);
  const payload = {
    model: ctx.provider.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: system },
      ...messages.map((m) =>
        m.role === "tool"
          ? { role: "tool", content: m.content, tool_call_id: m.toolCallId }
          : {
              role: m.role,
              content: m.images?.length
                ? [
                    { type: "text", text: m.content },
                    ...m.images.map((url) => ({
                      type: "image_url",
                      image_url: { url },
                    })),
                  ]
                : m.content,
              ...(m.toolCalls?.length
                ? {
                    tool_calls: m.toolCalls.map((c) => ({
                      id: c.id,
                      type: "function",
                      function: { name: c.name, arguments: c.arguments },
                    })),
                  }
                : {}),
            },
      ),
    ],
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: "function",
            function: { ...t, strict: false },
          })),
        }
      : {}),
  };
  const response = await checkedFetch(ctx, "/chat/completions", {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify(payload),
  });
  if (!response.body) throw new Error("模型返回了空响应");
  let text = "",
    truncated = false;
  const calls = new Map<number, ToolCall>();
  const usage = { input: 0, output: 0, reported: false };
  for await (const event of readSse(response.body)) {
    if (event.error)
      throw new Error(
        "模型流返回错误" +
          (serviceDetail(event.error, ctx.apiKey)
            ? "：" + serviceDetail(event.error, ctx.apiKey)
            : "，服务没有给出原因"),
      );
    if (event.choices?.[0]?.finish_reason === "length") truncated = true;
    const delta = event.choices?.[0]?.delta;
    if (delta?.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const c of delta?.tool_calls ?? []) {
      const current = calls.get(c.index) ?? {
        id: c.id ?? `tool-${c.index}`,
        name: "",
        arguments: "",
      };
      if (c.id) current.id = c.id;
      if (c.function?.name) current.name += c.function.name;
      if (c.function?.arguments) current.arguments += c.function.arguments;
      calls.set(c.index, current);
    }
    if (event.usage) {
      usage.reported = true;
      usage.input = event.usage.prompt_tokens ?? 0;
      usage.output = event.usage.completion_tokens ?? 0;
    }
  }
  return { text, calls: [...calls.values()], usage, truncated };
}
async function responses(
  ctx: ProviderContext,
  system: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onText: (delta: string) => void,
): Promise<Completion> {
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool")
      input.push({
        type: "function_call_output",
        call_id: m.toolCallId,
        output: m.content,
      });
    else {
      if (m.content)
        input.push({
          role: m.role,
          content: m.images?.length
            ? [
                { type: "input_text", text: m.content },
                ...m.images.map((image_url) => ({
                  type: "input_image",
                  image_url,
                })),
              ]
            : m.content,
        });
      for (const c of m.toolCalls ?? [])
        input.push({
          type: "function_call",
          call_id: c.id,
          name: c.name,
          arguments: c.arguments,
        });
    }
  }
  const response = await checkedFetch(ctx, "/responses", {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({
      model: ctx.provider.model,
      instructions: system,
      input,
      stream: true,
      store: false,
      tools: tools.map((t) => ({ type: "function", ...t, strict: false })),
    }),
  });
  if (!response.body) throw new Error("模型返回了空响应");
  let text = "",
    truncated = false;
  const calls = new Map<number, ToolCall>();
  const usage = { input: 0, output: 0, reported: false };
  for await (const e of readSse(response.body)) {
    if (e.type === "response.output_text.delta") {
      text += e.delta;
      onText(e.delta);
    }
    if (
      e.type === "response.output_item.added" &&
      e.item?.type === "function_call"
    )
      calls.set(e.output_index, {
        id: e.item.call_id,
        name: e.item.name,
        arguments: e.item.arguments ?? "",
      });
    if (
      e.type === "response.function_call_arguments.delta" &&
      calls.has(e.output_index)
    )
      calls.get(e.output_index)!.arguments += e.delta;
    if (
      e.type === "response.function_call_arguments.done" &&
      calls.has(e.output_index)
    )
      calls.get(e.output_index)!.arguments = e.arguments;
    if (e.type === "response.completed" || e.type === "response.incomplete") {
      usage.reported = Boolean(e.response?.usage);
      usage.input = e.response?.usage?.input_tokens ?? 0;
      usage.output = e.response?.usage?.output_tokens ?? 0;
    }
    if (e.type === "response.incomplete") {
      if (e.response?.incomplete_details?.reason !== "max_output_tokens")
        throw new Error(
          "模型响应未完整完成：" +
            (e.response?.incomplete_details?.reason ?? "服务没有给出原因"),
        );
      truncated = true;
    }
    if (e.type === "error" || e.type === "response.failed") {
      const detail = serviceDetail(e.response?.error ?? e, ctx.apiKey);
      throw new Error(
        "模型响应失败" + (detail ? "：" + detail : "，服务没有给出原因"),
      );
    }
  }
  return { text, calls: [...calls.values()], usage, truncated };
}
async function anthropic(
  ctx: ProviderContext,
  system: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onText: (delta: string) => void,
): Promise<Completion> {
  const converted = messages.map((m) =>
    m.role === "tool"
      ? {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId,
              content: m.content,
            },
          ],
        }
      : {
          role: m.role,
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...(m.images ?? []).map((image) => {
              const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(image);
              if (!match) throw new Error("视觉操作需要 base64 图片");
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2],
                },
              };
            }),
            ...(m.toolCalls ?? []).map((c) => ({
              type: "tool_use",
              id: c.id,
              name: c.name,
              input: JSON.parse(c.arguments || "{}"),
            })),
          ],
        },
  );
  const response = await checkedFetch(ctx, "/messages", {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({
      model: ctx.provider.model,
      system,
      max_tokens: 8192,
      stream: true,
      messages: converted,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    }),
  });
  if (!response.body) throw new Error("模型返回了空响应");
  let text = "",
    truncated = false;
  const calls = new Map<number, ToolCall>();
  const usage = { input: 0, output: 0, reported: false };
  for await (const e of readSse(response.body)) {
    if (
      e.type === "content_block_start" &&
      e.content_block?.type === "tool_use"
    )
      calls.set(e.index, {
        id: e.content_block.id,
        name: e.content_block.name,
        arguments: "",
      });
    if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
      text += e.delta.text;
      onText(e.delta.text);
    }
    if (
      e.type === "content_block_delta" &&
      e.delta?.type === "input_json_delta"
    )
      calls.get(e.index)!.arguments += e.delta.partial_json;
    if (e.type === "message_start") {
      usage.reported = Boolean(e.message?.usage);
      usage.input = e.message?.usage?.input_tokens ?? 0;
    }
    if (e.type === "message_delta") {
      usage.output = e.usage?.output_tokens ?? 0;
      if (e.delta?.stop_reason === "max_tokens") truncated = true;
    }
    if (e.type === "error") {
      const detail = serviceDetail(e, ctx.apiKey);
      throw new Error("Anthropic 返回流错误" + (detail ? "：" + detail : ""));
    }
  }
  return { text, calls: [...calls.values()], usage, truncated };
}
async function ollama(
  ctx: ProviderContext,
  system: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onText: (delta: string) => void,
): Promise<Completion> {
  const response = await checkedFetch(ctx, "/api/chat", {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({
      model: ctx.provider.model,
      stream: false,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.images?.length
            ? {
                images: m.images.map((image) =>
                  image.replace(/^data:[^;]+;base64,/, ""),
                ),
              }
            : {}),
          ...(m.toolCalls
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  function: {
                    name: c.name,
                    arguments: JSON.parse(c.arguments || "{}"),
                  },
                })),
              }
            : {}),
        })),
      ],
      tools: tools.map((t) => ({ type: "function", function: t })),
    }),
  });
  const data = (await response.json()) as any;
  const text = data.message?.content ?? "";
  if (text) onText(text);
  return {
    truncated: data.done_reason === "length",
    text,
    calls: (data.message?.tool_calls ?? []).map((c: any, i: number) => ({
      id: `ollama-${i}`,
      name: c.function.name,
      arguments: JSON.stringify(c.function.arguments),
    })),
    usage: {
      reported: data.prompt_eval_count !== undefined,
      input: data.prompt_eval_count ?? 0,
      output: data.eval_count ?? 0,
    },
  };
}
