import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";
import type { Job, Message } from "../apps/server/src/storage";
import { providerSchema } from "@tadacut/providers";

describe("skills, memory and external conversation persistence", () => {
  let server: Awaited<ReturnType<typeof createStudioServer>>, dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-context-"));
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
  const invoke = (name: string, args = {}) =>
    server.agent
      .tools(
        server.agent.host("demo-city", new AbortController().signal, "auto"),
        undefined,
      )
      .find((t) => t.name === name)!
      .execute(args);
  const run = async (message: string) => {
    const job = server.jobs.enqueue(
      "demo-city",
      "agent",
      "Context verification",
      { backend: "codex", mode: "auto", message },
    );
    for (let i = 0; i < 500; i++) {
      const current = server.repo.record<Job>("job", job.id)!;
      if (!["queued", "running"].includes(current.status)) {
        expect(current.error).toBeUndefined();
        expect(current.status).toBe("completed");
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("agent timeout");
  };
  it("uses a small gateway, loads a skill and preserves previous messages and tool outcomes after restart", async () => {
    const executable = path.join(dir, "codex"),
      log = path.join(dir, "requests.jsonl");
    await fs.writeFile(
      executable,
      `#!/usr/bin/env node
const fs=require('node:fs');
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
let sequence=[],at=0;
function next(){if(at<sequence.length){const [tool,args]=sequence[at++];send({id:900+at,method:'item/tool/call',params:{tool,arguments:args}});}else{send({method:'item/agentMessage/delta',params:{delta:'上下文验证完成'}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}}
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const e=JSON.parse(line);
 if(e.method==='thread/start'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({tools:e.params.dynamicTools,system:e.params.baseInstructions})+'\\n');send({id:e.id,result:{thread:{id:'fixture'}}});return;}
 if(e.method==='turn/start'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({prompt:e.params.input[0].text})+'\\n');send({id:e.id,result:{}});sequence=[['read_project',{}],['load_skill',{skillId:'advanced-cut'}],['tool_search',{query:'rename_project'}],['call_tool',{name:'rename_project',arguments:{name:'技能上下文验证'}}]];next();return;}
 if(e.method){send({id:e.id,result:e.method==='account/read'?{account:{type:'chatgpt'},requiresOpenaiAuth:true}:{}});return;}
 if(e.id>=900){if(!e.result.success){send({method:'turn/completed',params:{turn:{status:'failed',error:{message:JSON.stringify(e.result)}}}});return;}next();}
});`,
      { mode: 0o700 },
    );
    vi.stubEnv("TADACUT_CODEX_PATH", executable);
    await run("请保留白色字幕，先整理项目。");
    const first = server.agent.thread("demo-city");
    expect(
      first.messages.some((m) =>
        m.toolCalls?.some((t) => t.name === "rename_project"),
      ),
    ).toBe(true);
    expect(first.messages.at(-1)?.content).toContain("上下文验证完成");
    await server.close();
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    await server.app.ready();
    await run("第二轮，继续按之前的字幕要求。");
    const records = (await fs.readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const record of records.filter((x) => x.tools)) {
      expect(record.tools.length).toBe(8);
      expect(record.tools.some((t: any) => t.name === "rename_project")).toBe(
        false,
      );
      expect(JSON.stringify(record.tools).length).toBeLessThan(11000);
    }
    expect(records.at(-1).prompt).toContain("请保留白色字幕");
    expect(records.at(-1).prompt).toContain("rename_project");
    expect(records.at(-1).prompt).toContain("上下文验证完成");
    const message = server.repo
      .list<Message>("message")
      .find((m) => m.agentContext)!;
    expect(message.agentContext).toMatchObject({
      offeredTools: 8,
      skills: ["高级精剪"],
    });
    expect(server.repo.get("demo-city").name).toBe("技能上下文验证");
  });
  it("offers learned memories only when enabled and keeps them pending until the user accepts", async () => {
    await expect(
      invoke("suggest_memory", {
        text: "偏好白色字幕",
        reason: "用户明确表达",
      }),
    ).rejects.toThrow(/未启用/);
    server.agent.saveSettings({ learnPreferences: true });
    const result: any = await invoke("suggest_memory", {
      text: "偏好白色字幕",
      reason: "用户明确表达",
    });
    expect(result.status).toBe("awaiting-user-confirmation");
    expect(server.repo.list("memory")).toHaveLength(0);
    await invoke("suggest_memory", {
      text: "偏好白色字幕",
      reason: "重复候选",
    });
    expect(server.repo.list("memory-candidate")).toHaveLength(1);
  });
  it("deduplicates explicit preferences and prevents consolidation from deleting concurrent memories", async () => {
    await invoke("remember", { scope: "global", text: "字幕使用白色" });
    await invoke("remember", { scope: "global", text: "字幕使用白色" });
    expect(server.repo.list("memory")).toHaveLength(1);
    await invoke("remember", { scope: "global", text: "竖屏发布" });
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
    vi.stubGlobal("fetch", async () => {
      server.repo.save("memory", {
        id: "concurrent",
        text: "保留片头",
        tags: [],
        updatedAt: new Date().toISOString(),
        source: "user",
      });
      const content = JSON.stringify({
        keep: [{ text: "字幕使用白色", tags: [] }],
      });
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      );
    });
    await expect(
      invoke("consolidate_memories", {
        scope: "global",
        providerId: "fixture",
      }),
    ).rejects.toThrow(/发生变化/);
    expect(server.repo.list("memory")).toHaveLength(3);
  });
  it("validates a memory rewrite before replacing records atomically", async () => {
    await invoke("remember", { scope: "global", text: "字幕白色" });
    await invoke("remember", { scope: "global", text: "字幕用白色" });
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
    let keep: unknown[] = [{ text: "" }];
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ keep }) } }] })}\n\ndata: [DONE]\n\n`,
        ),
    );
    await expect(
      invoke("consolidate_memories", {
        scope: "global",
        providerId: "fixture",
      }),
    ).rejects.toThrow(/可用的整理结果/);
    expect(server.repo.list("memory")).toHaveLength(2);
    keep = [{ text: "字幕使用白色", tags: ["字幕"] }];
    expect(
      await invoke("consolidate_memories", {
        scope: "global",
        providerId: "fixture",
      }),
    ).toMatchObject({ before: 2, after: 1 });
    expect(server.repo.list<any>("memory").map((m) => m.text)).toEqual([
      "字幕使用白色",
    ]);
  });
});
