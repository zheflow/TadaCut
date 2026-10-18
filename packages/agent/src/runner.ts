import {
  completeChat,
  type ChatMessage,
  type ProviderContext,
  type ToolCall,
  type ToolDefinition,
} from "../../providers/src/index";

/** What running a tool does. Permissions are chosen per effect. */
export type ToolEffect =
  | "read"
  | "edit"
  | "job"
  | "generate"
  | "external"
  | "manage"
  | "publish";
export type Permission = "allow" | "ask" | "deny";
export interface AgentTool extends ToolDefinition {
  execute(args: unknown): Promise<unknown>;
  /** Tools outside the core group are offered once tool_search turns their group on. */
  group?: string;
  effect?: ToolEffect;
}
/** Paid generation, outside access and publishing ask first unless the user changes it. */
export const defaultPermissions: Record<ToolEffect, Permission> = {
  read: "allow",
  edit: "allow",
  job: "allow",
  generate: "ask",
  external: "ask",
  manage: "ask",
  publish: "ask",
};
export type AgentStop =
  | { kind: "done" }
  | { kind: "limit" }
  | { kind: "question"; text: string }
  | {
      kind: "approval";
      callId: string;
      tool: string;
      arguments: string;
      effect: ToolEffect;
    };
export interface ApprovalDecision {
  callId: string;
  approve: boolean;
}
export interface AgentRunOptions {
  context: ProviderContext;
  system: string;
  /** The conversation so far, tool calls and results included. */
  messages: ChatMessage[];
  tools: AgentTool[];
  /** Groups offered from the start besides core. */
  activeGroups?: string[];
  /** Names shown for groups in tool_search results. */
  groupLabels?: Record<string, string>;
  permissions?: Partial<Record<ToolEffect, Permission>>;
  /** The user's answer to the approval a previous run stopped at. */
  decision?: ApprovalDecision;
  onText(delta: string): void;
  /** Tool progress for the host's display; detail is the arguments on start and the reason on error. */
  onTool(
    name: string,
    phase: "start" | "complete" | "error" | "denied",
    detail?: string,
  ): void;
  /** The conversation after each change, so a host can keep the ledger. */
  onMessages?(messages: ChatMessage[]): void;
  maxTurns?: number;
  /** Sent once when the model first stops after changing something, to check the result. */
  verify?: string;
  /** Approximate characters of conversation kept before older turns are summarized. */
  contextBudget?: number;
}
/** Serializes a tool result for the model; an oversized result says so instead of ending mid-document. */
export function toolResultText(output: unknown, limit = 40000) {
  const text = JSON.stringify(output) ?? "null";
  if (text.length <= limit) return text;
  return JSON.stringify({
    truncated: true,
    chars: text.length,
    note: "结果过长，以下只是开头。请改用分段或分页参数读取。",
    head: text.slice(0, limit - 400),
  });
}
/** Calls of the last assistant turn that have no result yet. */
export function outstandingCalls(messages: ChatMessage[]): ToolCall[] {
  const index = messages.findLastIndex(
    (m) => m.role === "assistant" && m.toolCalls?.length,
  );
  if (index < 0) return [];
  const answered = new Set(
    messages
      .slice(index + 1)
      .filter((m) => m.role === "tool")
      .map((m) => m.toolCallId),
  );
  return messages[index].toolCalls!.filter((c) => !answered.has(c.id));
}
/** Gives every unanswered call a result, so the conversation can continue without them. */
export function settleOutstanding(messages: ChatMessage[], note: string) {
  return [
    ...messages,
    ...outstandingCalls(messages).map((call) => ({
      role: "tool" as const,
      toolCallId: call.id,
      content: JSON.stringify({ skipped: true, note }),
    })),
  ];
}
const textSize = (messages: ChatMessage[]) =>
  messages.reduce(
    (n, m) =>
      n +
      m.content.length +
      (m.toolCalls ?? []).reduce((a, c) => a + c.arguments.length + 40, 0),
    0,
  );
/** Images stay only on the latest message that has them; older ones are already described. */
const withoutOldImages = (messages: ChatMessage[]) => {
  const last = messages.findLastIndex((m) => m.images?.length);
  return messages.map((m, i) =>
    m.images?.length && i !== last
      ? { ...m, images: undefined, content: m.content + "\n（截图已省略）" }
      : m,
  );
};
const COMPACT =
  "把下面的对话压缩成供助手继续工作的摘要。保留：用户的目标与明确偏好、已经完成的修改和提出的方案、尚未完成的事项、仍然需要的素材、片段、轨道等 ID。删除寒暄和工具结果的细节。只输出摘要正文。";
const CJK = /[㐀-鿿]/;
/** Words and, for Chinese, two-character pieces, since queries have no spaces. */
function searchTerms(query: string) {
  const words = query
    .toLowerCase()
    .split(/[\s,，、。;；:：/|]+/)
    .filter(Boolean);
  const terms = new Set(words);
  for (const w of words)
    if (CJK.test(w))
      for (let i = 0; i + 2 <= w.length; i++) terms.add(w.slice(i, i + 2));
  return [...terms];
}
function toolSearch(
  tools: AgentTool[],
  active: Set<string>,
  labels: Record<string, string>,
): AgentTool {
  const groups = [
    ...new Set(tools.map((t) => t.group).filter((g) => g && g !== "core")),
  ] as string[];
  const named = groups.map((g) => (labels[g] ? `${g}（${labels[g]}）` : g));
  return {
    name: "tool_search",
    group: "core",
    effect: "read",
    description: `查找并启用更多工具，启用后即可调用。用关键词（如“字幕”“转场”“卡点”）或分组名搜索。分组：${named.join("、")}。`,
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args: any) => {
      const query = String(args?.query ?? "");
      const terms = searchTerms(query);
      const scored = tools
        .filter((t) => t.group && t.group !== "core")
        .map((t) => {
          const haystack =
            `${t.name} ${t.description} ${t.group} ${labels[t.group!] ?? ""}`.toLowerCase();
          const whole =
            query.includes(t.group!) ||
            (labels[t.group!] && query.includes(labels[t.group!]));
          return {
            t,
            score:
              (whole ? 5 : 0) +
              terms.filter((term) => haystack.includes(term)).length,
          };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 24)
        .map((x) => x.t);
      for (const t of scored) active.add(t.group!);
      return {
        enabled: [...new Set(scored.map((t) => t.group))],
        tools: scored.map((t) => ({
          name: t.name,
          group: t.group,
          description: t.description,
        })),
        groups: named,
        ...(scored.length
          ? {}
          : { note: "没有找到匹配的工具，可换一个关键词或直接用分组名。" }),
      };
    },
  };
}
/** Host-independent orchestration. Tools own capabilities; the model owns no shell. */
export async function runAgent(options: AgentRunOptions) {
  const context = options.context,
    signal = context.signal;
  const messages = [...options.messages];
  const active = new Set(["core", ...(options.activeGroups ?? [])]);
  const permissions = { ...defaultPermissions, ...options.permissions };
  const tools = [
    ...options.tools,
    toolSearch(options.tools, active, options.groupLabels ?? {}),
  ];
  const usage = { input: 0, output: 0, reported: true };
  const repeats = new Map<string, number>();
  const budget = options.contextBudget ?? 120000;
  let turns = 0,
    fullText = "",
    changed = false,
    verified = !options.verify,
    continuations = 0;
  const save = () => options.onMessages?.(messages);
  const push = (...items: ChatMessage[]) => {
    messages.push(...items);
    save();
  };
  const finish = (stop: AgentStop) => ({
    text: fullText,
    usage,
    turns,
    messages,
    activeGroups: [...active].filter((g) => g !== "core"),
    stop,
  });
  const say = (text: string) => {
    fullText += text;
    options.onText(text);
  };
  async function compact() {
    // The kept part starts at a user message, so no tool result loses its call.
    const keepFrom = messages
      .map((m) => m.role)
      .lastIndexOf("user", messages.length - 12);
    if (keepFrom < 2) return;
    const older = messages.slice(0, keepFrom);
    const transcript = older
      .map((m) =>
        m.role === "tool"
          ? `工具结果：${m.content.slice(0, 600)}`
          : `${m.role === "user" ? "用户" : "助手"}：${m.content.slice(0, 3000)}${
              m.toolCalls?.length
                ? `\n调用：${m.toolCalls.map((c) => `${c.name} ${c.arguments.slice(0, 300)}`).join("；")}`
                : ""
            }`,
      )
      .join("\n")
      .slice(-80000);
    let summary = "";
    try {
      const result = await completeChat(
        context,
        COMPACT,
        [{ role: "user", content: transcript }],
        [],
        () => {},
      );
      usage.input += result.usage.input;
      usage.output += result.usage.output;
      summary = result.text.trim();
    } catch (e) {
      signal.throwIfAborted();
    }
    if (!summary)
      summary = older
        .filter((m) => m.role !== "tool")
        .map((m) => `${m.role}: ${m.content.slice(0, 1500)}`)
        .join("\n")
        .slice(-18000);
    messages.splice(0, keepFrom, {
      role: "user",
      content: `此前对话的摘要（项目现状以 read_project 为准）：\n${summary}`,
    });
    save();
  }
  /** Runs one turn's calls in order; reads next to each other run together. */
  async function runCalls(calls: ToolCall[], interrupted: boolean) {
    const images: string[] = [];
    if (interrupted) {
      push(
        ...calls.map((call) => ({
          role: "tool" as const,
          toolCallId: call.id,
          content: JSON.stringify({
            error: "执行被中断，结果未知。请先读取项目确认现状再决定是否重做。",
          }),
        })),
      );
      return undefined;
    }
    let i = 0;
    while (i < calls.length) {
      signal.throwIfAborted();
      const call = calls[i],
        tool = tools.find((t) => t.name === call.name),
        effect = tool?.effect ?? "read",
        decision =
          options.decision?.callId === call.id ? options.decision : undefined,
        permission = decision
          ? decision.approve
            ? "allow"
            : "deny"
          : tool
            ? permissions[effect]
            : "allow";
      if (permission === "ask")
        return {
          kind: "approval" as const,
          callId: call.id,
          tool: call.name,
          arguments: call.arguments,
          effect,
        };
      // Neighbouring reads that need no approval run at the same time.
      const batch = [call];
      if (permission === "allow" && effect === "read")
        while (i + batch.length < calls.length) {
          const next = calls[i + batch.length],
            nextTool = tools.find((t) => t.name === next.name);
          if (
            !nextTool ||
            (nextTool.effect ?? "read") !== "read" ||
            permissions.read !== "allow"
          )
            break;
          batch.push(next);
        }
      if (permission === "deny") options.onTool(call.name, "denied");
      const outputs = await Promise.all(
        batch.map((c) =>
          permission === "deny" && c === call
            ? Promise.resolve({
                error: decision
                  ? "用户拒绝了这次操作。"
                  : "用户的设置禁止这类操作。",
              })
            : execute(c),
        ),
      );
      for (const [k, c] of batch.entries()) {
        let output: any = outputs[k];
        if (output?._wait || output?._finish) {
          push({
            role: "tool",
            toolCallId: c.id,
            content: JSON.stringify(
              output._wait ? { asked: true } : { finished: true },
            ),
          });
          const rest = calls.slice(i + k + 1);
          if (rest.length)
            push(
              ...rest.map((r) => ({
                role: "tool" as const,
                toolCallId: r.id,
                content: JSON.stringify({ skipped: true }),
              })),
            );
          const text = String(output.question ?? output.summary ?? "");
          say(text);
          return output._wait
            ? { kind: "question" as const, text }
            : { kind: "done" as const };
        }
        for (const key of ["_image", "_images"] as const) {
          const value = output?.[key];
          if (value) {
            images.push(...(Array.isArray(value) ? value : [value]));
            const { [key]: _drop, ...rest } = output;
            output = rest;
          }
        }
        push({
          role: "tool",
          content: toolResultText(output),
          toolCallId: c.id,
        });
      }
      i += batch.length;
    }
    if (images.length)
      push({
        role: "user",
        content: "以上工具取得的画面如下。",
        images: images.slice(-6),
      });
    return undefined;
  }
  async function execute(call: ToolCall): Promise<unknown> {
    const tool = tools.find((t) => t.name === call.name);
    const signature = call.name + ":" + call.arguments;
    repeats.set(signature, (repeats.get(signature) ?? 0) + 1);
    if ((repeats.get(signature) ?? 0) > 3)
      throw new Error("模型重复执行相同请求，已停止；可调整指令后继续");
    if (!tool) return { error: "没有这个工具，可以先用 tool_search 查找。" };
    // A tool found by name is usable even if its group was not searched yet.
    if (tool.group) active.add(tool.group);
    let args: unknown;
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch {
      return {
        error: "参数不是有效 JSON（可能输出被截断），请分步提交较小的修改。",
      };
    }
    try {
      options.onTool(call.name, "start", call.arguments);
      const output = await tool.execute(args);
      const failed =
        output !== null && typeof output === "object" && "error" in output;
      options.onTool(
        call.name,
        failed ? "error" : "complete",
        failed ? String((output as { error: unknown }).error) : undefined,
      );
      if (tool.effect === "edit" && !failed) changed = true;
      return output;
    } catch (e) {
      signal.throwIfAborted();
      const message = e instanceof Error ? e.message : String(e);
      options.onTool(call.name, "error", message);
      return { error: message };
    }
  }
  // A resumed run first settles the turn it stopped in.
  const pending = outstandingCalls(messages);
  if (pending.length) {
    const stop = await runCalls(pending, !options.decision);
    if (stop) return finish(stop);
  }
  while (!signal.aborted && (!options.maxTurns || turns < options.maxTurns)) {
    turns++;
    if (textSize(messages) > budget && messages.length > 14) await compact();
    const offered = tools.filter(
      (t) => !t.group || t.group === "core" || active.has(t.group),
    );
    const result = await completeChat(
      context,
      options.system,
      withoutOldImages(messages),
      offered,
      say,
    );
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    usage.reported = usage.reported && Boolean(result.usage.reported);
    push({
      role: "assistant",
      content: result.text,
      ...(result.calls.length ? { toolCalls: result.calls } : {}),
    });
    if (!result.calls.length) {
      if (result.truncated && continuations < 3) {
        continuations++;
        push({
          role: "user",
          content:
            "输出在长度上限处中断了。请从中断处直接继续，不要重复已经输出的内容。",
        });
        continue;
      }
      if (!verified && changed) {
        verified = true;
        say("\n\n");
        push({ role: "user", content: options.verify! });
        continue;
      }
      return finish({ kind: "done" });
    }
    const stop = await runCalls(result.calls, false);
    if (stop) return finish(stop);
  }
  signal.throwIfAborted();
  return finish({ kind: "limit" });
}
