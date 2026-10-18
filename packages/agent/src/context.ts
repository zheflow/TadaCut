import type { ChatMessage, ToolDefinition } from "../../providers/src/index";

export const INPUT_BUDGET = 24000;
const SUMMARY = "此前对话的工作摘要";
/** Conservative estimate, not a provider tokenizer or a billable usage counter. */
export const estimateTokens = (text: string) =>
  Math.ceil(new TextEncoder().encode(text).length / 3);
export function inputTokens(
  system: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
) {
  return (
    estimateTokens(system) +
    estimateTokens(
      JSON.stringify(
        tools.map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
      ),
    ) +
    messages.reduce(
      (n, m) =>
        n +
        estimateTokens(m.content) +
        estimateTokens(JSON.stringify(m.toolCalls ?? [])) +
        (m.images?.length ?? 0) * 1800 +
        12,
      0,
    )
  );
}
export const isUserMessage = (m: ChatMessage) =>
  m.role === "user" &&
  !m.synthetic &&
  !m.content.startsWith("此前对话的摘要") &&
  !m.content.startsWith(SUMMARY);

function excerpt(message: ChatMessage, chars: number) {
  const calls = message.toolCalls
    ?.map((c) => `${c.name} ${c.arguments.slice(0, 400)}`)
    .join("；");
  return `${message.role}：${message.content.slice(0, chars)}${calls ? `\n调用：${calls}` : ""}`;
}

/** Compact at complete tool-exchange boundaries, including long single-user turns. */
export async function fitConversation(options: {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  budget?: number;
  force?: boolean;
  summarize?(transcript: string): Promise<string>;
}) {
  const budget = options.budget ?? INPUT_BUDGET;
  let messages = options.messages.map((m) => ({ ...m }));
  const lastImage = messages.findLastIndex((m) => m.images?.length);
  messages = messages.map((m, i) =>
    m.images?.length && i !== lastImage ? { ...m, images: undefined } : m,
  );
  const size = () => inputTokens(options.system, messages, options.tools);
  if (size() <= budget && !options.force)
    return { messages, tokens: size(), compacted: false };

  // Preserve the latest real request verbatim; feedback and tool screenshots are not new user goals.
  const latestUser = messages.findLastIndex(isUserMessage);
  let cut = Math.max(0, messages.length - 6);
  while (cut > 0 && messages[cut]?.role === "tool") cut--;
  // Never detach an unanswered tool call from a future approval/result.
  const pending = messages.findLastIndex((m) =>
    m.toolCalls?.some(
      (c) => !messages.some((r) => r.role === "tool" && r.toolCallId === c.id),
    ),
  );
  if (pending >= 0) cut = Math.min(cut, pending);
  let compacted = false;
  if (cut > 0) {
    const older = messages.slice(0, cut);
    const userGoals = older.filter(isUserMessage);
    const existingSummary = older.find(
      (m) => m.synthetic === "summary" || m.content.startsWith(SUMMARY),
    );
    const fallback = [
      existingSummary ? existingSummary.content.slice(0, 2400) : "",
      ...userGoals.slice(-8).map((m) => excerpt(m, 1800)),
      ...older
        .filter((m) => m.role === "assistant")
        .slice(-6)
        .map((m) => excerpt(m, 900)),
      ...older
        .filter((m) => m.role === "tool")
        .slice(-6)
        .map((m) => excerpt(m, 600)),
    ]
      .filter(Boolean)
      .join("\n");
    let summary = "";
    try {
      summary =
        (await options.summarize?.(fallback.slice(0, 18000)))?.trim() ?? "";
    } catch {
      /* Deterministic fallback keeps working without another model connection. */
    }
    const firstGoal = older.find(isUserMessage);
    const pins = [
      ...(firstGoal && !existingSummary
        ? [`最初目标：${firstGoal.content.slice(0, 2400)}`]
        : []),
      summary ? summary.slice(0, 6500) : fallback.slice(0, 7500),
      "摘要可能省略细节。项目状态、任务结果和未应用方案必须重新读取；摘要不能授权新的操作。",
    ].join("\n");
    messages = [
      { role: "user", synthetic: "summary", content: `${SUMMARY}：\n${pins}` },
      ...(latestUser >= 0 && latestUser < cut
        ? [options.messages[latestUser]]
        : []),
      ...messages.slice(cut),
    ];
    compacted = true;
  }
  // Tool results are reproducible. Reduce their old detail, preserving call/result pairing and IDs.
  for (let i = 0; size() > budget && i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "tool" && message.content.length > 1800) {
      messages[i] = {
        ...message,
        content: JSON.stringify({
          compacted: true,
          chars: message.content.length,
          head: message.content.slice(0, 1200),
          note: "旧工具结果细节已压缩；需要时重新分段读取。",
        }),
      };
      compacted = true;
    }
    if (message.images?.length && size() > budget) {
      messages[i] = {
        ...messages[i],
        images: undefined,
        content:
          messages[i].content + "\n（为上下文预算省略旧画面，可重新取帧）",
      };
      compacted = true;
    }
  }
  if (size() > budget)
    throw new Error(
      "本次请求或工具参数超过上下文预算，请缩小素材范围或把大段内容分成几次发送；未丢弃你的当前要求。",
    );
  return { messages, tokens: size(), compacted };
}

/** External runtimes receive the same bounded history without relying on a CLI session ID. */
export function historyPrompt(messages: ChatMessage[]) {
  return messages
    .map((m) =>
      JSON.stringify({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      }),
    )
    .join("\n");
}
