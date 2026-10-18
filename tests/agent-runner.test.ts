import { describe, expect, it } from "vitest";
import {
  providerSchema,
  type ChatMessage,
  type ProviderContext,
} from "@tadacut/providers";
import {
  outstandingCalls,
  runAgent,
  settleOutstanding,
  type AgentRunOptions,
  type AgentTool,
} from "../packages/agent/src/runner";

const encode = new TextEncoder();
const sse = (events: unknown[]) =>
  new Response(
    encode.encode(
      events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") +
        "data: [DONE]\n\n",
    ),
  );
interface Turn {
  text?: string;
  calls?: { id: string; name: string; arguments?: string }[];
}
/** A chat model that plays back turns and keeps every request it was sent. */
function scripted(turns: Turn[]) {
  const requests: any[] = [];
  const context: ProviderContext = {
    provider: providerSchema.parse({
      id: "fake",
      name: "Fake",
      kind: "compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "fake",
    }),
    apiKey: "test",
    signal: new AbortController().signal,
    fetcher: (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const turn = turns[requests.length - 1] ?? { text: "完成" };
      return sse([
        {
          choices: [
            {
              delta: {
                ...(turn.text ? { content: turn.text } : {}),
                ...(turn.calls
                  ? {
                      tool_calls: turn.calls.map((c, index) => ({
                        index,
                        id: c.id,
                        function: {
                          name: c.name,
                          arguments: c.arguments ?? "{}",
                        },
                      })),
                    }
                  : {}),
              },
            },
          ],
        },
        { usage: { prompt_tokens: 3, completion_tokens: 2 } },
      ]);
    }) as typeof fetch,
  };
  return {
    context,
    requests,
    /** Tool names offered in a request. */
    offered: (i: number) =>
      (requests[i]?.tools ?? []).map((t: any) => t.function.name as string),
    /** Messages of a request, without the system prompt. */
    sent: (i: number) => (requests[i]?.messages ?? []).slice(1),
  };
}
/** Tools with a log of what ran. */
function toolkit() {
  const ran: string[] = [];
  const tool = (
    name: string,
    group: string,
    effect: AgentTool["effect"],
    output: unknown = { ok: true },
  ): AgentTool => ({
    name,
    description: `${name} tool`,
    group,
    effect,
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => {
      ran.push(name);
      return output;
    },
  });
  return {
    ran,
    tools: [
      tool("read_project", "core", "read", { name: "Demo" }),
      tool("add_captions", "captions", "edit", { applied: true }),
      tool("generate_image", "generate", "generate", { assetId: "img" }),
    ],
  };
}
const run = (
  model: ReturnType<typeof scripted>,
  tools: AgentTool[],
  options: Partial<AgentRunOptions> = {},
) =>
  runAgent({
    context: model.context,
    system: "system",
    messages: [{ role: "user", content: "做一个视频" }],
    tools,
    groupLabels: { captions: "字幕", generate: "生成" },
    onText: () => {},
    onTool: () => {},
    ...options,
  });
const toolResults = (messages: ChatMessage[]) =>
  messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));

describe("agent runner", () => {
  it("offers group tools only after tool_search enables them", async () => {
    const model = scripted([
      {
        calls: [
          { id: "s", name: "tool_search", arguments: '{"query":"字幕"}' },
        ],
      },
      { calls: [{ id: "c", name: "add_captions" }] },
      { text: "字幕已加好" },
    ]);
    const { tools, ran } = toolkit();
    const result = await run(model, tools);
    expect(model.offered(0)).toEqual(["read_project", "tool_search"]);
    expect(model.offered(1)).toContain("add_captions");
    expect(model.offered(1)).not.toContain("generate_image");
    expect(ran).toEqual(["add_captions"]);
    expect(result.activeGroups).toEqual(["captions"]);
    expect(result.stop).toEqual({ kind: "done" });
    expect(result.usage).toMatchObject({ input: 9, output: 6, reported: true });
    expect(toolResults(result.messages)[0].enabled).toEqual(["captions"]);
  });
  it("keeps groups enabled by an earlier run", async () => {
    const model = scripted([{ text: "好" }]);
    await run(model, toolkit().tools, { activeGroups: ["generate"] });
    expect(model.offered(0)).toContain("generate_image");
  });
  it("stops for approval before a tool that asks, then resumes on the answer", async () => {
    const first = scripted([
      {
        text: "先生成一张图。",
        calls: [
          { id: "g", name: "generate_image", arguments: '{"prompt":"海边"}' },
        ],
      },
    ]);
    const kit = toolkit();
    const stopped = await run(first, kit.tools);
    expect(stopped.stop).toEqual({
      kind: "approval",
      callId: "g",
      tool: "generate_image",
      arguments: '{"prompt":"海边"}',
      effect: "generate",
    });
    expect(kit.ran).toEqual([]);
    expect(outstandingCalls(stopped.messages).map((c) => c.id)).toEqual(["g"]);
    // Denied: the model hears why and carries on without the tool.
    const denied = scripted([{ text: "好的，不生成。" }]);
    const afterDeny = await run(denied, kit.tools, {
      messages: stopped.messages,
      decision: { callId: "g", approve: false },
    });
    expect(kit.ran).toEqual([]);
    expect(toolResults(afterDeny.messages).at(-1).error).toMatch(/拒绝/);
    expect(afterDeny.stop).toEqual({ kind: "done" });
    // Approved: the call runs before the next turn.
    const approved = scripted([{ text: "图已生成。" }]);
    const afterApprove = await run(approved, kit.tools, {
      messages: stopped.messages,
      decision: { callId: "g", approve: true },
    });
    expect(kit.ran).toEqual(["generate_image"]);
    expect(toolResults(afterApprove.messages).at(-1)).toEqual({
      assetId: "img",
    });
    expect(approved.sent(0).at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "g",
    });
  });
  it("refuses tools the settings deny without asking", async () => {
    const model = scripted([
      { calls: [{ id: "c", name: "add_captions" }] },
      { text: "无法添加字幕" },
    ]);
    const kit = toolkit();
    const result = await run(model, kit.tools, {
      permissions: { edit: "deny" },
    });
    expect(kit.ran).toEqual([]);
    expect(toolResults(result.messages)[0].error).toMatch(/设置禁止/);
  });
  it("marks calls left by an interrupted run as unknown instead of running them", async () => {
    const kit = toolkit();
    const model = scripted([{ text: "我先确认一下项目。" }]);
    const result = await run(model, kit.tools, {
      messages: [
        { role: "user", content: "加字幕" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c", name: "add_captions", arguments: "{}" }],
        },
      ],
    });
    expect(kit.ran).toEqual([]);
    expect(toolResults(result.messages)[0].error).toMatch(/中断/);
  });
  it("asks once for a check after the model changed something", async () => {
    const model = scripted([
      { calls: [{ id: "c", name: "add_captions" }] },
      { text: "完成了。" },
      { text: "检查过，没有问题。" },
    ]);
    const result = await run(model, toolkit().tools, { verify: "请检查结果" });
    expect(model.requests).toHaveLength(3);
    expect(model.sent(2).at(-1)).toEqual({
      role: "user",
      content: "请检查结果",
    });
    expect(result.text).toContain("检查过");
    expect(result.stop).toEqual({ kind: "done" });
  });
  it("does not ask for a check when nothing changed", async () => {
    const model = scripted([
      { calls: [{ id: "r", name: "read_project" }] },
      { text: "项目叫 Demo。" },
    ]);
    await run(model, toolkit().tools, { verify: "请检查结果" });
    expect(model.requests).toHaveLength(2);
  });
  it("stops at the turn limit", async () => {
    const model = scripted([
      { calls: [{ id: "a", name: "read_project", arguments: '{"n":1}' }] },
      { calls: [{ id: "b", name: "read_project", arguments: '{"n":2}' }] },
      { calls: [{ id: "c", name: "read_project", arguments: '{"n":3}' }] },
    ]);
    const result = await run(model, toolkit().tools, { maxTurns: 2 });
    expect(result.stop).toEqual({ kind: "limit" });
    expect(result.turns).toBe(2);
    expect(model.requests).toHaveLength(2);
  });
  it("stops a model that repeats the same call", async () => {
    const same = {
      calls: [{ id: "x", name: "read_project", arguments: '{"a":1}' }],
    };
    const model = scripted([same, same, same, same, same]);
    await expect(run(model, toolkit().tools)).rejects.toThrow(/重复/);
  });
  it("reports unknown tools and broken arguments to the model", async () => {
    const model = scripted([
      {
        calls: [
          { id: "u", name: "no_such_tool" },
          { id: "b", name: "read_project", arguments: '{"cut' },
        ],
      },
      { text: "好" },
    ]);
    const result = await run(model, toolkit().tools);
    const [unknown, broken] = toolResults(result.messages);
    expect(unknown.error).toMatch(/tool_search/);
    expect(broken.error).toMatch(/JSON/);
  });
  it("settles unanswered calls so a new message can follow", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "read_project", arguments: "{}" },
          { id: "b", name: "add_captions", arguments: "{}" },
        ],
      },
      { role: "tool", toolCallId: "a", content: "{}" },
    ];
    expect(outstandingCalls(messages).map((c) => c.id)).toEqual(["b"]);
    const settled = settleOutstanding(messages, "用户发送了新消息");
    expect(outstandingCalls(settled)).toEqual([]);
    expect(JSON.parse(settled.at(-1)!.content)).toEqual({
      skipped: true,
      note: "用户发送了新消息",
    });
  });
});
