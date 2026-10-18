import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";
import { StudioControl } from "../apps/server/src/studio-control";
import {
  studioActionSchema,
  studioContextSchema,
} from "../packages/platform/src/studio";
import { runAgent } from "../packages/agent/src/runner";
import { providerSchema, type ChatMessage } from "@tadacut/providers";

describe("application management tools", () => {
  let server: Awaited<ReturnType<typeof createStudioServer>>, dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-application-"));
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    await server.app.ready();
  });
  afterEach(async () => {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const tools = () =>
    server.agent.tools(
      server.agent.host("demo-city", new AbortController().signal, "auto"),
      undefined,
    );
  const invoke = (name: string, args = {}) =>
    tools()
      .find((t) => t.name === name)!
      .execute(args);

  it("uses the real settings handlers and lets the assistant only tighten its own limits", async () => {
    await invoke("update_app_settings", {
      name: "樱花工作室",
      agent: {
        defaultMode: "ask",
        permissions: { external: "deny", generate: "deny" },
      },
    });
    for (const agent of [
      { defaultMode: "auto" },
      { permissions: { manage: "allow" } },
      { permissions: { publish: "allow" } },
      { permissions: { generate: "ask" } },
    ])
      await expect(
        invoke("update_app_settings", { name: "不应保存", agent }),
      ).rejects.toThrow(/放宽/);
    expect(server.repo.settings("preferences", {})).toEqual({
      name: "樱花工作室",
    });
    expect(server.agent.settings()).toMatchObject({
      defaultMode: "ask",
      permissions: {
        external: "deny",
        generate: "deny",
        manage: "ask",
        publish: "ask",
      },
    });
  });
  it("leaves switching to auto mode to the user", async () => {
    const manual = server.agent
      .tools(
        server.agent.host("demo-city", new AbortController().signal, "manual"),
        undefined,
      )
      .find((t) => t.name === "set_assistant_options")!;
    await expect(manual.execute({ mode: "auto" })).rejects.toThrow(/自动模式/);
  });
  it("edits public provider configuration while retaining its host credential and rejecting credential fields and path traversal", async () => {
    server.repo.saveProvider(
      providerSchema.parse({
        id: "local",
        name: "Local",
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "before",
      }),
      "private-test-key",
    );
    const updated = await invoke("configure_provider", {
      providerId: "local",
      patch: { model: "after", enabled: false },
    });
    expect(updated).toMatchObject({
      id: "local",
      model: "after",
      enabled: false,
      hasKey: true,
    });
    expect(JSON.stringify(updated)).not.toContain("private-test-key");
    expect(server.repo.vault.get("provider:local")).toBe("private-test-key");
    await expect(
      invoke("configure_provider", {
        providerId: "local",
        patch: { apiKey: "do-not-store" },
      }),
    ).rejects.toThrow();
    // The saved key follows the address, so only the user may move it.
    for (const patch of [
      { baseUrl: "https://elsewhere.example/v1" },
      { kind: "compatible" },
    ])
      await expect(
        invoke("configure_provider", { providerId: "local", patch }),
      ).rejects.toThrow(/密钥/);
    expect(server.repo.provider("local")).toMatchObject({
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434",
    });
    server.repo.saveProvider(
      providerSchema.parse({
        id: "keyless",
        name: "Keyless",
        kind: "compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
      }),
    );
    expect(
      await invoke("configure_provider", {
        providerId: "keyless",
        patch: { baseUrl: "http://127.0.0.1:5678/v1" },
      }),
    ).toMatchObject({ baseUrl: "http://127.0.0.1:5678/v1", hasKey: false });
    await expect(
      invoke("remove_provider", { providerId: "../mcp-config" }),
    ).rejects.toThrow(/ID/);
    expect(
      tools().some((t) =>
        /^(http_request|shell|read_credential)$/.test(t.name),
      ),
    ).toBe(false);
    await expect(
      invoke("set_workspace_view", { type: "appearance", theme: "dark" }),
    ).rejects.toThrow();
    await expect(
      invoke("control_playback", { type: "appearance", theme: "dark" }),
    ).rejects.toThrow();
  });
  it("creates and changes disabled skills, preserves built-in identity, and imports and exports markdown", async () => {
    await invoke("configure_skill", {
      skillId: "custom",
      patch: {
        name: "素材整理",
        prompt: "读取用户引用的素材，整理标签。",
        enabled: false,
        command: "整理",
      },
    });
    expect(await invoke("list_all_skills")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "custom", enabled: false }),
      ]),
    );
    await invoke("configure_skill", {
      skillId: "custom",
      patch: { enabled: true },
    });
    expect(
      await invoke("export_skill_markdown", { skillId: "custom" }),
    ).toContain("读取用户引用的素材");
    await invoke("configure_skill", {
      skillId: "cleanup",
      patch: { builtin: false, enabled: false },
    });
    await expect(
      invoke("remove_skill", { skillId: "cleanup" }),
    ).rejects.toThrow(/不能删除/);
    await invoke("remove_skill", { skillId: "custom" });
    expect(server.repo.record("skill", "custom")).toBeUndefined();
  });
  it("manages projects with checked, undoable transactions and enforces the trash rule", async () => {
    const created: any = await invoke("create_project", { name: "新项目" });
    await invoke("set_project_status", {
      projectId: created.id,
      archived: true,
    });
    expect(server.repo.get(created.id)).toMatchObject({
      archived: true,
      revision: 1,
    });
    server.repo.travel(created.id, 1, "undo");
    expect(server.repo.get(created.id).archived).toBe(false);
    await expect(
      invoke("delete_project_permanently", { projectId: created.id }),
    ).rejects.toThrow(/回收站/);
    await invoke("set_project_status", {
      projectId: created.id,
      trashed: true,
    });
    await invoke("delete_project_permanently", { projectId: created.id });
    expect(server.repo.projects().some((p) => p.id === created.id)).toBe(false);
    await expect(
      invoke("delete_project_permanently", { projectId: "demo-city" }),
    ).rejects.toThrow(/先打开/);
  });
  it("stops before application changes, then executes the exact approved call through the real adapter", async () => {
    const provider = providerSchema.parse({
      id: "fixture",
      name: "Fixture",
      kind: "compatible",
      baseUrl: "http://fixture.invalid",
      model: "test",
    });
    const turn = (calls?: unknown[]) =>
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: calls ? { tool_calls: calls } : { content: "完成" } }] })}\n\ndata: [DONE]\n\n`,
      );
    const call = {
      index: 0,
      id: "manage-1",
      function: {
        name: "update_app_settings",
        arguments: JSON.stringify({ name: "对话设置" }),
      },
    };
    const run = (
      messages: ChatMessage[],
      decision?: { callId: string; approve: boolean },
    ) =>
      runAgent({
        context: {
          provider,
          apiKey: "",
          signal: new AbortController().signal,
          fetcher: vi.fn(async () => (decision ? turn() : turn([call]))),
        },
        system: "Test",
        tools: tools(),
        activeGroups: ["application"],
        messages,
        decision,
        onText: () => {},
        onTool: () => {},
      });
    const first = await run([{ role: "user", content: "修改工作室名" }]);
    expect(first.stop).toMatchObject({
      kind: "approval",
      effect: "manage",
      callId: "manage-1",
    });
    expect(server.repo.settings<any>("preferences", {}).name).not.toBe(
      "对话设置",
    );
    await run(first.messages, { callId: "manage-1", approve: true });
    expect(server.repo.settings<any>("preferences", {}).name).toBe("对话设置");
  });
});

describe("typed live studio control", () => {
  afterEach(() => vi.useRealTimers());
  it("matches the request and project, rejects invalid results and ignores repeated acknowledgements", async () => {
    const events: { id: string; projectId: string }[] = [];
    const control = new StudioControl((_type, event) =>
      events.push(event as (typeof events)[number]),
    );
    const pending = control.request(
      "p1",
      { type: "navigate", page: "skills" },
      new AbortController().signal,
    );
    expect(control.acknowledge(events[0].id, "p2", { status: "applied" })).toBe(
      false,
    );
    expect(() =>
      control.acknowledge(events[0].id, "p1", {
        status: "applied",
        credential: "secret",
      }),
    ).toThrow();
    expect(
      control.acknowledge(events[0].id, "p1", {
        status: "needs-user",
        message: "等待文件选择",
      }),
    ).toBe(true);
    expect(await pending).toEqual({
      status: "needs-user",
      message: "等待文件选择",
    });
    expect(control.acknowledge(events[0].id, "p1", { status: "applied" })).toBe(
      false,
    );
  });
  it("reports an unavailable UI honestly and cancels pending requests", async () => {
    vi.useFakeTimers();
    const control = new StudioControl(() => {});
    const pending = control.request(
      "p1",
      { type: "snapshot" },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(12000);
    expect(await pending).toMatchObject({
      status: "error",
      message: expect.stringContaining("未响应"),
    });
    const abort = new AbortController();
    const cancelled = control.request("p1", { type: "snapshot" }, abort.signal);
    const check = expect(cancelled).rejects.toThrow("cancelled");
    abort.abort(new Error("cancelled"));
    await check;
    control.close();
  });
  it("accepts page context with multiple object kinds, and rejects unknown UI actions and oversized selections", () => {
    const context = {
      page: "library",
      workspace: "edit",
      projectId: "p",
      projectName: "项目",
      frame: 5,
      references: [
        { kind: "asset", id: "a", name: "素材", projectId: "p" },
        { kind: "skill", id: "s", name: "技能" },
      ],
      theme: "light",
      sakuraEffects: true,
      details: { search: "春天" },
    };
    expect(studioContextSchema.parse(context).references).toHaveLength(2);
    expect(() =>
      studioContextSchema.parse({
        ...context,
        references: Array(101).fill(context.references[0]),
      }),
    ).toThrow();
    expect(() =>
      studioActionSchema.parse({ type: "shell", command: "anything" }),
    ).toThrow();
    expect(() =>
      studioActionSchema.parse({ type: "creative-tool", tool: "unknown" }),
    ).toThrow();
  });
});
