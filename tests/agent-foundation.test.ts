import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";
import { agentStateContext } from "../apps/server/src/agent-state";
import { outstandingCalls } from "../packages/agent/src/runner";
import { providerSchema } from "@tadacut/providers";
import type { Job, Skill } from "../apps/server/src/storage";

describe("agent foundation lifecycle", () => {
  let server: Awaited<ReturnType<typeof createStudioServer>>, dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-foundation-"));
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    await server.app.ready();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const invoke = (name: string, args = {}, projectId = "demo-city") =>
    server.agent
      .tools(
        server.agent.host(projectId, new AbortController().signal, "manual"),
        undefined,
      )
      .find((t) => t.name === name)!
      .execute(args);
  const settle = async (id: string) => {
    for (let i = 0; i < 600; i++) {
      const job = server.repo.record<Job>("job", id)!;
      if (!["running", "queued"].includes(job.status)) return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("job timeout");
  };
  const custom = (): Skill => ({
    id: "custom-workflow",
    name: "保留原声",
    category: "音频",
    description: "保留原声与对白",
    prompt: "必须保留原声，不删除对白。",
    tools: [],
    enabled: true,
    files: [{ path: "guide.md", content: "参考".repeat(12000) }],
  });

  it("retains loaded skills, paged references, plans and pending approvals across compaction and restart", async () => {
    server.repo.save("skill", custom());
    await invoke("load_skill", { skillId: "custom-workflow" });
    const file: any = await invoke("read_skill_file", {
      skillId: "custom-workflow",
      path: "guide.md",
    });
    expect(file.nextOffset).toBe(10000);
    expect(
      (
        (await invoke("read_skill_file", {
          skillId: "custom-workflow",
          path: "guide.md",
          offset: file.nextOffset,
        })) as any
      ).nextOffset,
    ).toBe(20000);
    const state: any = await invoke("read_agent_state");
    await invoke("update_agent_plan", {
      expectedRevision: state.revision,
      goal: "制作访谈短片",
      constraints: ["保留原声"],
      steps: [
        { id: "inspect", title: "核对素材", status: "completed" },
        { id: "cut", title: "精剪对白", status: "in_progress" },
      ],
      notes: "待核对片段 c1 的对白衔接",
    });
    const thread = server.agent.thread("demo-city");
    for (let i = 0; i < 16; i++)
      thread.messages.push(
        { role: "user", content: `第 ${i} 轮：保留原声` },
        { role: "assistant", content: "已读取项目" },
      );
    thread.messages.push(
      { role: "user", content: "最后要求：暂时不要发布" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "approval", name: "publish_video", arguments: "{}" }],
      },
    );
    thread.pending = {
      kind: "approval",
      callId: "approval",
      messageId: "reply",
      providerId: "fixture",
      mode: "manual",
    };
    server.repo.save("agent-thread", thread);
    expect((await server.agent.compactThread("demo-city")).compacted).toBe(
      true,
    );
    expect(
      outstandingCalls(server.agent.thread("demo-city").messages).map(
        (c) => c.id,
      ),
    ).toEqual(["approval"]);
    await server.close();
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    await server.app.ready();
    const restored = server.agent.workingState("demo-city");
    expect(restored.goal).toBe("制作访谈短片");
    expect(restored.notes).toContain("c1");
    expect(restored.loadedSkills[0].files).toHaveLength(2);
    expect(agentStateContext(server.repo, "demo-city")).toContain(
      "必须保留原声，不删除对白",
    );
    expect(server.agent.thread("demo-city").pending?.callId).toBe("approval");
  });
  it("invalidates changed skills and supports explicit reload, unload and bounded retention", async () => {
    server.repo.save("skill", custom());
    await invoke("load_skill", { skillId: "custom-workflow" });
    server.repo.save("skill", { ...custom(), prompt: "新的工作流" });
    expect(server.agent.workingState("demo-city").loadedSkills[0].stale).toBe(
      true,
    );
    expect(agentStateContext(server.repo, "demo-city")).not.toContain(
      "新的工作流",
    );
    await invoke("load_skill", { skillId: "custom-workflow" });
    expect(agentStateContext(server.repo, "demo-city")).toContain("新的工作流");
    await invoke("unload_skill", { skillId: "custom-workflow" });
    expect(server.agent.workingState("demo-city").loadedSkills).toHaveLength(0);
    for (const id of [
      "advanced-cut",
      "visual-finish",
      "voice-lyrics",
      "team-review",
    ])
      await invoke("load_skill", { skillId: id });
    expect(
      server.agent.workingState("demo-city").loadedSkills.map((s) => s.id),
    ).toEqual(["visual-finish", "voice-lyrics", "team-review"]);
  });
  it("checks plan revisions and isolates working state from other projects and long-term memories", async () => {
    await invoke("update_agent_plan", {
      expectedRevision: 0,
      goal: "剪辑访谈",
      steps: [{ id: "read", title: "读取", status: "in_progress" }],
    });
    await expect(
      invoke("update_agent_plan", { expectedRevision: 0, goal: "过期修改" }),
    ).rejects.toThrow(/已变化/);
    const other = server.repo.create("Other");
    expect(((await invoke("read_agent_state", {}, other.id)) as any).goal).toBe(
      "",
    );
    await invoke("remember", { scope: "global", text: "字幕使用白色" });
    server.agent.resetThread("demo-city");
    expect(server.agent.workingState("demo-city").goal).toBe("");
    expect(server.repo.list("memory")).toHaveLength(1);
  });
  it("refreshes API instructions after skill loading and consumes a requested compaction", async () => {
    server.repo.save("skill", custom());
    server.repo.saveProvider(
      providerSchema.parse({
        id: "fixture",
        name: "Fixture",
        kind: "compatible",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "fixture",
      }),
      "fixture",
    );
    server.agent.saveSettings({ verify: false, inputBudget: 16000 });
    const requests: any[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const call =
        body.tools?.length &&
        requests.filter((r) => r.tools?.length).length === 1
          ? {
              id: "load",
              name: "load_skill",
              arguments: '{"skillId":"custom-workflow"}',
            }
          : null;
      const delta = call
        ? {
            tool_calls: [
              {
                index: 0,
                id: call.id,
                function: { name: call.name, arguments: call.arguments },
              },
            ],
          }
        : { content: "已核对" };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
      );
    });
    const thread = server.agent.thread("demo-city");
    for (let i = 0; i < 12; i++)
      thread.messages.push(
        { role: "user", content: `旧任务 ${i}` },
        { role: "assistant", content: "旧回复" },
      );
    server.repo.save("agent-thread", thread);
    await invoke("request_context_compaction");
    const job = await settle(
      server.jobs.enqueue("demo-city", "agent", "Check", {
        providerId: "fixture",
        message: "检查原声",
        mode: "manual",
      }).id,
    );
    expect(job.status).toBe("completed");
    expect(requests.at(-1).messages[0].content).toContain(
      "必须保留原声，不删除对白",
    );
    expect(server.agent.workingState("demo-city").compactRequested).toBe(false);
    expect(server.agent.thread("demo-city").compactions).toBeGreaterThan(0);
  });
  it("continues a failed CLI run using the persisted backend and mode", async () => {
    const executable = path.join(dir, "codex"),
      marker = path.join(dir, "once");
    await fs.writeFile(
      executable,
      `#!/usr/bin/env node
const fs=require('node:fs');const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.method)return;send({id:m.id,result:m.method==='thread/start'?{thread:{id:'t'}}:m.method==='account/read'?{account:{type:'chatgpt'},requiresOpenaiAuth:true}:{}});if(m.method==='turn/start'){if(!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'1');send({method:'turn/completed',params:{turn:{status:'failed',error:{message:'fixture interruption'}}}});}else{send({method:'item/agentMessage/delta',params:{delta:'恢复完成'}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}}});`,
      { mode: 0o700 },
    );
    vi.stubEnv("TADACUT_CODEX_PATH", executable);
    const first = await settle(
      server.jobs.enqueue("demo-city", "agent", "CLI", {
        backend: "codex",
        mode: "auto",
        message: "继续这个任务",
      }).id,
    );
    expect(first.status).toBe("failed");
    expect(
      server.agent.threadSummary(server.agent.thread("demo-city")).resumable,
    ).toBe(true);
    const resumed = server.agent.continueRun("demo-city");
    expect(resumed.input).toMatchObject({ backend: "codex", mode: "auto" });
    expect((await settle(resumed.id)).status).toBe("completed");
    expect(server.agent.thread("demo-city").messages.at(-1)?.content).toContain(
      "恢复完成",
    );
  });
  it("deduplicates accepted candidates, broadcasts removal and keeps rejected candidates out of memory", async () => {
    await invoke("remember", { scope: "global", text: "白色字幕" });
    for (const id of ["same", "reject"])
      server.repo.save("memory-candidate", {
        id,
        projectId: "demo-city",
        text: id === "same" ? "白色字幕" : "红色字幕",
        tags: [],
        reason: "用户明确表达",
        createdAt: new Date().toISOString(),
      });
    server.agent.resolveCandidate("same", true);
    server.agent.resolveCandidate("reject", false);
    expect(server.repo.list("memory-candidate")).toHaveLength(0);
    expect(server.repo.list<any>("memory").map((m) => m.text)).toEqual([
      "白色字幕",
    ]);
    expect(() => server.agent.saveSettings({ inputBudget: 100 })).toThrow(
      /预算/,
    );
  });
  it("refuses concurrent runs and context reset while a model request is in flight", async () => {
    server.repo.saveProvider(
      providerSchema.parse({
        id: "fixture",
        name: "Fixture",
        kind: "compatible",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "fixture",
      }),
      "fixture",
    );
    server.agent.saveSettings({ verify: false });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
    vi.stubGlobal("fetch", async () => {
      entered();
      await barrier;
      return new Response(
        'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n',
      );
    });
    const first = server.jobs.enqueue("demo-city", "agent", "In flight", {
      providerId: "fixture",
      message: "先检查项目",
    });
    await started;
    try {
      await expect(
        server.agent.run({
          job: {
            ...first,
            id: "second",
            input: { providerId: "fixture", message: "不应覆盖" },
          },
          signal: new AbortController().signal,
          progress: () => {},
        }),
      ).rejects.toThrow(/已有正在执行/);
      await expect(server.agent.compactThread("demo-city")).rejects.toThrow(
        /仍在运行/,
      );
      expect(() => server.agent.resetThread("demo-city")).toThrow(/仍在运行/);
    } finally {
      release();
    }
    expect((await settle(first.id)).status).toBe("completed");
    expect(
      server.agent
        .thread("demo-city")
        .messages.some((m) => m.content === "不应覆盖"),
    ).toBe(false);
  });
});
