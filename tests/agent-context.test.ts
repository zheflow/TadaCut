import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@tadacut/providers";
import {
  createToolCatalog,
  externalToolGateway,
} from "../packages/agent/src/catalog";
import {
  fitConversation,
  inputTokens,
  isUserMessage,
} from "../packages/agent/src/context";
import { modelToolResult } from "../packages/agent/src/output";
import { guardExternalTools } from "../apps/server/src/external-tools";
import { recallMemories } from "../apps/server/src/agent-memory";
import type { AgentTool } from "../packages/agent/src/runner";

const tool = (
  name: string,
  group = "large",
  effect: AgentTool["effect"] = "read",
): AgentTool => ({
  name,
  group,
  effect,
  description: name,
  parameters: { type: "object", properties: {} },
  execute: vi.fn(async () => ({ ok: true })),
});
function longConversation(): ChatMessage[] {
  const result: ChatMessage[] = [
    { role: "user", content: "保留白色字幕和开头镜头，剪成 15 秒。" },
  ];
  for (let i = 0; i < 16; i++)
    result.push(
      {
        role: "assistant",
        content: "正在处理",
        toolCalls: [{ id: `call-${i}`, name: "read_project", arguments: "{}" }],
      },
      {
        role: "tool",
        toolCallId: `call-${i}`,
        content: JSON.stringify({
          revision: i,
          clipId: `clip-${i}`,
          detail: "素材细节".repeat(4000),
        }),
      },
    );
  return result;
}
describe("agent context and capability budgets", () => {
  it("searches exact tools without activating their entire group and expires older schemas", async () => {
    const tools = [
      tool("read_project", "core"),
      ...Array.from({ length: 120 }, (_, i) => tool(`edit_${i}`)),
    ];
    const catalog = createToolCatalog(tools, { large: "剪辑" });
    expect(catalog.offered().map((t) => t.name)).toEqual(["read_project"]);
    const found: any = await catalog.search.execute({ query: "edit_71" });
    expect(found.tools[0].name).toBe("edit_71");
    expect(found.tools[0].parameters).toBeDefined();
    expect(catalog.offered().length).toBeLessThanOrEqual(7);
    for (let i = 0; i < 25; i++) catalog.activate([`edit_${i}`]);
    expect(catalog.offered().length).toBeLessThanOrEqual(13);
    expect(catalog.offered().some((t) => t.name === "edit_71")).toBe(false);
  });
  it("keeps external schemas small and enforces the real tool's permission behind the gateway", async () => {
    const edit = tool("publish_video", "export", "publish");
    const approve = vi.fn(async () => false);
    const guarded = guardExternalTools(
      [
        tool("read_project", "core"),
        edit,
        ...Array.from({ length: 230 }, (_, i) => tool(`op_${i}`)),
      ],
      {
        signal: new AbortController().signal,
        permissions: { publish: "allow" },
        approve,
      },
    );
    const exposed = externalToolGateway(guarded, {});
    expect(exposed.map((t) => t.name)).toEqual([
      "read_project",
      "tool_search",
      "call_tool",
    ]);
    const execute = exposed.find((t) => t.name === "call_tool")!;
    await expect(
      execute.execute({ name: "publish_video", arguments: {} }),
    ).rejects.toThrow(/tool_search/);
    await exposed
      .find((t) => t.name === "tool_search")!
      .execute({ query: "publish_video" });
    await expect(
      execute.execute({ name: "publish_video", arguments: {} }),
    ).rejects.toThrow(/未允许/);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(edit.execute).not.toHaveBeenCalled();
  });
  it("compacts a single long tool loop, preserving the current request and call/result pairs", async () => {
    const original = longConversation();
    const fitted = await fitConversation({
      system: "system",
      messages: original,
      tools: [],
      budget: 9000,
    });
    expect(fitted.compacted).toBe(true);
    expect(fitted.tokens).toBeLessThanOrEqual(9000);
    expect(fitted.messages).toContainEqual(original[0]);
    for (const m of fitted.messages.filter((m) => m.role === "tool"))
      expect(
        fitted.messages.some((a) =>
          a.toolCalls?.some((c) => c.id === m.toolCallId),
        ),
      ).toBe(true);
    expect(original).toHaveLength(33);
  });
  it("falls back when summarization fails, preserving a pending approval and latest user constraints", async () => {
    const original = longConversation();
    original.push(
      { role: "user", content: "改成 20 秒，不要发布。" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "pending", name: "publish_video", arguments: "{}" }],
      },
    );
    const fitted = await fitConversation({
      system: "system",
      messages: original,
      tools: [],
      budget: 9000,
      summarize: async () => {
        throw new Error("offline");
      },
    });
    expect(
      fitted.messages.some((m) => m.content === "改成 20 秒，不要发布。"),
    ).toBe(true);
    expect(fitted.messages.at(-1)?.toolCalls?.[0].id).toBe("pending");
    expect(
      fitted.messages.some(
        (m) => m.role === "tool" && m.toolCallId === "pending",
      ),
    ).toBe(false);
    expect(fitted.messages[0].content).toContain("保留白色字幕");
  });
  it("budgets the system and schemas too and never silently trims an oversized current request", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "要求".repeat(3000) },
    ];
    expect(inputTokens("x", messages, [tool("schema")])).toBeGreaterThan(2000);
    await expect(
      fitConversation({ system: "system", messages, tools: [], budget: 2000 }),
    ).rejects.toThrow(/未丢弃/);
    await expect(
      fitConversation({
        system: "规则".repeat(3000),
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        budget: 2000,
      }),
    ).rejects.toThrow(/预算/);
  });
  it("keeps screenshot bytes out of text and caps oversized external results", () => {
    const image = "data:image/png;base64," + "a".repeat(80000);
    const result = modelToolResult({
      _images: [image],
      result: "details".repeat(10000),
    });
    expect(result.images).toEqual([image]);
    expect(result.text.length).toBeLessThan(16000);
    expect(result.text).not.toContain("data:image");
    expect(JSON.parse(result.text).truncated).toBe(true);
    expect(modelToolResult([1, 2]).text).toBe("[1,2]");
  });
  it("recalls relevant older memories before recent unrelated ones and deduplicates without mutation", () => {
    const memories = [
      { id: "old", text: "字幕使用白色", tags: ["字幕"], updatedAt: "2020" },
      ...Array.from({ length: 80 }, (_, i) => ({
        id: `m${i}`,
        text: `偏好音乐 ${i}`,
        tags: ["音乐"],
        updatedAt: "2026",
      })),
      {
        id: "duplicate",
        text: "字幕使用白色",
        tags: ["字幕"],
        updatedAt: "2026",
      },
    ];
    const recalled = recallMemories(memories, "字幕", {
      chars: 100,
      limit: 8,
      relevantOnly: true,
    });
    expect(recalled).toHaveLength(1);
    expect(recalled[0].id).toBe("duplicate");
    expect(memories).toHaveLength(82);
    expect(
      isUserMessage({
        role: "user",
        content: "请检查结果",
        synthetic: "feedback",
      }),
    ).toBe(false);
    expect(isUserMessage({ role: "user", content: "长期喜欢白色字幕" })).toBe(
      true,
    );
  });
});
