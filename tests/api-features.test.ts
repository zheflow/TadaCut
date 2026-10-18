import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";
import { providerSchema } from "@tadacut/providers";
import type { ExportRecord } from "../apps/server/src/agent-tools/export";

/** A short silent mono WAV, which ffprobe reads like any exported sound. */
function wav(samples = 800, rate = 8000) {
  const data = Buffer.alloc(samples * 2),
    header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe("studio feature API", () => {
  let server: Awaited<ReturnType<typeof createStudioServer>>,
    dir: string,
    cookie: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-features-"));
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    const response = await server.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1" },
    });
    cookie = response.headers["set-cookie"]!.toString().split(";")[0];
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const request = (
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: any,
    headers: Record<string, string> = {},
  ) =>
    server.app.inject({
      method,
      url,
      payload,
      headers: { host: "127.0.0.1", cookie, ...headers },
    });
  const json = async (
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: any,
  ) => {
    const response = await request(method, url, payload);
    if (response.statusCode !== 200)
      throw new Error(
        `${method} ${url} → ${response.statusCode} ${response.body}`,
      );
    return response.json();
  };
  const settle = async (jobId: string) => {
    for (let i = 0; i < 600; i++) {
      const job = server.repo.record<any>("job", jobId);
      if (["completed", "failed", "cancelled"].includes(job?.status))
        return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("任务没有结束");
  };

  describe("versions and the trash", () => {
    it("restores a version as an undoable edit that keeps the project's name", async () => {
      const original = server.repo.get("demo-city");
      const version = await json("POST", "/api/projects/demo-city/versions", {
        name: "初稿",
      });
      expect(version).toMatchObject({
        name: "初稿",
        revision: 0,
        projectId: "demo-city",
      });
      await json("POST", "/api/projects/demo-city/commands", {
        requestId: "edit-1",
        expectedRevision: 0,
        label: "改名和梗概",
        commands: [
          { type: "project.rename", name: "新名字" },
          { type: "story.logline", logline: "新的梗概" },
        ],
      });
      const stale = await request(
        "POST",
        `/api/projects/demo-city/versions/${version.id}/restore`,
        {
          expectedRevision: 0,
        },
      );
      expect(stale.statusCode).toBe(409);
      const restored = await json(
        "POST",
        `/api/projects/demo-city/versions/${version.id}/restore`,
        {
          expectedRevision: 1,
        },
      );
      expect(restored).toMatchObject({
        id: "demo-city",
        revision: 2,
        name: "新名字",
        story: { logline: original.story.logline },
      });
      const undone = await json("POST", "/api/projects/demo-city/undo", {
        expectedRevision: 2,
      });
      expect(undone.story.logline).toBe("新的梗概");
      expect(
        await json("GET", "/api/projects/demo-city/versions"),
      ).toHaveLength(1);
      await json("DELETE", `/api/projects/demo-city/versions/${version.id}`);
      expect(await json("GET", "/api/projects/demo-city/versions")).toEqual([]);
      expect(
        (
          await request(
            "POST",
            `/api/projects/demo-city/versions/${version.id}/restore`,
            {
              expectedRevision: undone.revision,
            },
          )
        ).statusCode,
      ).toBe(400);
    });
    it("duplicates a project with its own identity and history", async () => {
      const copy = await json("POST", "/api/projects/demo-city/duplicate", {});
      const source = server.repo.get("demo-city");
      expect(copy.id).not.toBe("demo-city");
      expect(copy).toMatchObject({
        name: `${source.name} 副本`,
        revision: 0,
        archived: false,
      });
      expect(copy.assets).toEqual(source.assets);
      const named = await json("POST", "/api/projects/demo-city/duplicate", {
        name: "第二版",
      });
      expect(named.name).toBe("第二版");
    });
    it("deletes a project only from the trash, with everything recorded for it", async () => {
      const blocked = await request("DELETE", "/api/projects/demo-city");
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().code).toBe("NOT_IN_TRASH");
      const trashed = await json("POST", "/api/projects/demo-city/trash", {
        trashed: true,
        expectedRevision: 0,
      });
      expect(trashed.trashedAt).toBeTruthy();
      const back = await json("POST", "/api/projects/demo-city/trash", {
        trashed: false,
        expectedRevision: 1,
      });
      expect(back.trashedAt).toBeUndefined();
      await json("POST", "/api/projects/demo-city/trash", {
        trashed: true,
        expectedRevision: 2,
      });
      server.repo.save<ExportRecord>("export", {
        id: "old-export",
        projectId: "demo-city",
        timelineId: "t",
        kind: "video",
        filename: "a.mp4",
        url: "/artifacts/a.mp4",
        codec: "h264",
        size: 1,
        createdAt: new Date().toISOString(),
      });
      await json("POST", "/api/projects/demo-city/versions", {
        name: "删除前",
      });
      expect(await json("DELETE", "/api/projects/demo-city")).toEqual({
        deleted: true,
      });
      expect(
        (await json("GET", "/api/projects")).map((p: any) => p.id),
      ).not.toContain("demo-city");
      expect((await request("GET", "/api/projects/demo-city")).statusCode).toBe(
        400,
      );
      expect(server.repo.list<ExportRecord>("export")).toEqual([]);
      expect(server.repo.versions("demo-city")).toEqual([]);
    });
  });

  describe("agent conversation", () => {
    it("reports an empty thread and refuses actions with nothing to act on", async () => {
      expect(await json("GET", "/api/projects/demo-city/agent")).toMatchObject({
        projectId: "demo-city",
        messages: 0,
        draft: 0,
        pending: null,
        resumable: false,
      });
      expect(
        (await request("POST", "/api/projects/demo-city/agent/continue", {}))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await request("POST", "/api/projects/demo-city/agent/approve", {
            callId: "x",
            approve: true,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        await json("POST", "/api/projects/demo-city/agent/draft", {
          action: "finalize",
        }),
      ).toEqual({
        proposalId: null,
      });
      expect(
        await json("POST", "/api/projects/demo-city/agent/draft", {
          action: "discard",
        }),
      ).toEqual({
        discarded: true,
      });
      expect(
        await json("DELETE", "/api/projects/demo-city/agent/thread"),
      ).toEqual({ proposalId: null });
    });
    it("keeps publishing behind a confirmation in the settings", async () => {
      const saved = await json("POST", "/api/agent/settings", {
        permissions: { publish: "allow", generate: "allow" },
        verify: false,
        defaultMode: "auto",
      });
      expect(saved.permissions).toMatchObject({
        publish: "ask",
        generate: "allow",
        read: "allow",
      });
      expect(await json("GET", "/api/agent/settings")).toMatchObject({
        verify: false,
        defaultMode: "auto",
        permissions: { publish: "ask", generate: "allow" },
      });
      expect(
        (
          await request("POST", "/api/agent/settings", {
            permissions: { publish: "always" },
          })
        ).statusCode,
      ).toBe(400);
    });
    it("lists the tool catalog with groups and effects", async () => {
      const { groups, tools } = await json("GET", "/api/agent/tools");
      expect(Object.keys(groups).length).toBeGreaterThan(3);
      const names = tools.map((t: any) => t.name);
      expect(names).toContain("read_project");
      expect(new Set(names).size).toBe(names.length);
      for (const t of tools) {
        expect([
          "read",
          "edit",
          "job",
          "manage",
          "generate",
          "external",
          "publish",
          undefined,
        ]).toContain(t.effect);
        expect(t.description.length).toBeGreaterThan(0);
      }
    });
    it("cannot replay publishing or other external actions through rerun_job", async () => {
      const host = server.agent.host(
        "demo-city",
        new AbortController().signal,
        "auto",
      );
      const rerun = server.agent
        .tools(host, undefined)
        .find((t) => t.name === "rerun_job")!;
      for (const kind of [
        "publish",
        "upload",
        "import",
        "desktop",
        "run-code",
        "agent",
      ]) {
        server.repo.save("job", {
          id: `old-${kind}`,
          projectId: "demo-city",
          kind,
          status: "completed",
          input: { confirmed: true },
        });
        const count = server.repo.list("job").length;
        await expect(rerun.execute({ jobId: `old-${kind}` })).rejects.toThrow(
          /不能直接重跑/,
        );
        expect(server.repo.list("job")).toHaveLength(count);
      }
      // An allowed generation still uses a fresh job, without replaying its old snapshot.
      server.jobs.register("generate", async () => ({ fixture: true }));
      server.repo.save("job", {
        id: "old-generation",
        projectId: "demo-city",
        kind: "generate",
        label: "生成图片",
        status: "completed",
        input: { prompt: "海边", snapshot: { obsolete: true } },
      });
      const result = (await rerun.execute({ jobId: "old-generation" })) as {
        jobId: string;
      };
      const done = await settle(result.jobId);
      expect(done.status, done.error).toBe("completed");
      expect(done.input).toEqual({ prompt: "海边" });
    });
    it("seeds built-in skills with unique slash commands and keeps them on update", async () => {
      const skills = await json("GET", "/api/skills");
      const builtins = skills.filter((s: any) => s.source === "builtin");
      expect(builtins.length).toBeGreaterThanOrEqual(30);
      const commands = builtins.map((s: any) => s.command);
      expect(
        commands.every(
          (c: unknown) =>
            typeof c === "string" && /^[\p{L}\p{N}_-]+$/u.test(c as string),
        ),
      ).toBe(true);
      expect(new Set(commands).size).toBe(commands.length);
      const cleanup = builtins.find((s: any) => s.command === "clean");
      expect(cleanup).toMatchObject({
        id: "cleanup",
        enabled: true,
        builtin: true,
      });
      // Turning a built-in off sticks; it cannot be deleted.
      await json("POST", "/api/skills", { ...cleanup, enabled: false });
      expect(server.repo.record<any>("skill", "cleanup").enabled).toBe(false);
      expect((await request("DELETE", "/api/skills/cleanup")).statusCode).toBe(
        400,
      );
      expect(
        (
          await request("POST", "/api/skills", {
            ...cleanup,
            command: "has space",
          })
        ).statusCode,
      ).toBe(400);
    });
    it("runs a slash command with its skill and keeps the skill for “continue”", async () => {
      const requests: any[] = [];
      vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          'data: {"choices":[{"delta":{"content":"收到"}}]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":1}}\n\ndata: [DONE]\n\n',
        );
      });
      await json("POST", "/api/providers", {
        provider: providerSchema.parse({
          id: "fake",
          name: "Fake",
          kind: "compatible",
          baseUrl: "http://127.0.0.1:9/v1",
          model: "fake",
        }),
        apiKey: "test",
      });
      const run = async (input: Record<string, unknown>) =>
        settle(
          server.jobs.enqueue("demo-city", "agent", "Agent", {
            providerId: "fake",
            ...input,
          }).id,
        );
      expect((await run({ message: "/clean 只删语气词" })).status).toBe(
        "completed",
      );
      const system = (i: number) => requests[i].messages[0].content as string;
      expect(system(0)).toContain("本次使用技能「文稿精剪」");
      expect(requests[0].messages.at(-1)).toEqual({
        role: "user",
        content: "只删语气词",
      });
      expect(server.agent.thread("demo-city").skillId).toBe("cleanup");
      const typed = server.repo
        .list<any>("message")
        .filter((m) => m.role === "user")
        .map((m) => m.text);
      expect(typed).toContain("/clean 只删语气词");
      // “Continue” resumes with the same skill.
      const resumed = await json(
        "POST",
        "/api/projects/demo-city/agent/continue",
        { providerId: "fake" },
      );
      expect((await settle(resumed.id)).status).toBe("completed");
      expect(system(1)).toContain("本次使用技能「文稿精剪」");
      // A command alone starts the skill with its own opening request.
      await run({ message: "/clean" });
      expect(requests[2].messages.at(-1).content).toContain("文稿精剪");
      // Unknown commands are sent as written.
      await run({ message: "/nosuch 你好" });
      expect(system(3)).not.toContain("本次使用技能");
      expect(requests[3].messages.at(-1).content).toBe("/nosuch 你好");
      expect(server.agent.thread("demo-city").skillId).toBeUndefined();
      // Imported skills get commands from their names, Chinese included.
      const imported = await json("POST", "/api/skills/import", {
        markdown:
          "---\nname: 片头包装\ndescription: 做片头\n---\n先读项目，再做片头。",
      });
      expect(imported.command).toBe("片头包装");
      await run({ message: "/片头包装 做一个五秒片头" });
      expect(system(4)).toContain("本次使用技能「片头包装」");
      expect(requests[4].messages.at(-1).content).toBe("做一个五秒片头");
      // Clearing the chat removes the visible messages.
      const cleared = await json("DELETE", "/api/projects/demo-city/messages");
      expect(cleared.removed).toBeGreaterThanOrEqual(8);
      expect(
        server.repo
          .list<any>("message")
          .filter((m) => m.projectId === "demo-city"),
      ).toEqual([]);
    });
  });

  describe("memories", () => {
    it("adds, lists and removes memories, and keeps or drops candidates", async () => {
      const memory = await json("POST", "/api/memories", {
        text: "默认竖屏 9:16",
        tags: ["画幅"],
      });
      expect(memory).toMatchObject({
        text: "默认竖屏 9:16",
        tags: ["画幅"],
        source: "user",
      });
      expect(
        (await json("GET", "/api/memories")).map((m: any) => m.text),
      ).toContain("默认竖屏 9:16");
      await json("DELETE", `/api/memories/${memory.id}`);
      expect(
        (await json("GET", "/api/memories")).map((m: any) => m.id),
      ).not.toContain(memory.id);
      expect(
        (await request("POST", "/api/memories", { text: "" })).statusCode,
      ).toBe(400);
      for (const [id, text] of [
        ["keep", "字幕用黄色描边"],
        ["drop", "这次只做 15 秒"],
      ])
        server.repo.save("memory-candidate", {
          id,
          projectId: "demo-city",
          text,
          tags: [],
          reason: "对话中提到",
          createdAt: new Date().toISOString(),
        });
      expect(await json("GET", "/api/memory-candidates")).toHaveLength(2);
      expect(
        await json("POST", "/api/memory-candidates/keep", { keep: true }),
      ).toEqual({ kept: true });
      expect(
        await json("POST", "/api/memory-candidates/drop", { keep: false }),
      ).toEqual({ kept: false });
      expect(await json("GET", "/api/memory-candidates")).toEqual([]);
      const memories = await json("GET", "/api/memories");
      expect(
        memories.find((m: any) => m.text === "字幕用黄色描边"),
      ).toMatchObject({ source: "learned" });
      expect(memories.map((m: any) => m.text)).not.toContain("这次只做 15 秒");
      expect(
        (await request("POST", "/api/memory-candidates/keep", { keep: true }))
          .statusCode,
      ).toBe(400);
    });
  });

  describe("extension packs", () => {
    const pack = (extra: Record<string, unknown> = {}) => ({
      format: "tadacut-plugin@1",
      id: "test-pack",
      name: "测试扩展",
      version: "1.2.0",
      contents: {
        captionStyles: [
          {
            id: "pop",
            name: "弹跳",
            textStyle: { color: "#ffd400" },
            animation: "pop",
          },
        ],
        luts: [
          {
            id: "warm",
            name: "暖色",
            cube: "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
          },
        ],
        sounds: [
          {
            id: "ding",
            name: "叮",
            mime: "audio/wav",
            data: wav().toString("base64"),
            tags: ["提示"],
            license: "CC0",
          },
        ],
        ...extra,
      },
    });
    const upload = (content: string) => {
      const boundary = "----tadacut-test";
      return request(
        "POST",
        "/api/plugins/install",
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pack.json"\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--\r\n`,
        { "content-type": `multipart/form-data; boundary=${boundary}` },
      );
    };
    it("installs a pack, serves its items and sounds, and uninstalls it", async () => {
      const installed = await upload(JSON.stringify(pack()));
      expect(installed.statusCode).toBe(200);
      expect(installed.json()).toMatchObject({
        id: "test-pack",
        version: "1.2.0",
        counts: { captionStyles: 1, luts: 1, sounds: 1, templates: 0 },
      });
      expect(await json("GET", "/api/plugins")).toHaveLength(1);
      const sound = await json(
        "GET",
        "/api/plugins/test-pack/items/sounds/ding",
      );
      expect(sound).toEqual({
        id: "ding",
        name: "叮",
        mime: "audio/wav",
        tags: ["提示"],
        license: "CC0",
      });
      expect(
        (await json("GET", "/api/plugins/test-pack/items/luts/warm")).cube,
      ).toContain("LUT_3D_SIZE 2");
      expect(
        (await request("GET", "/api/plugins/test-pack/items/scripts/x"))
          .statusCode,
      ).toBe(400);
      expect(
        (await request("GET", "/api/plugins/test-pack/items/sounds/none"))
          .statusCode,
      ).toBe(400);
      const audio = await request("GET", "/api/plugins/test-pack/sounds/ding");
      expect(audio.headers["content-type"]).toContain("audio/wav");
      expect(audio.rawPayload.equals(wav())).toBe(true);
      // A sound added to a project is copied, so it outlives the pack.
      const added = await json("POST", "/api/projects/demo-city/plugin-sound", {
        pluginId: "test-pack",
        soundId: "ding",
      });
      expect(added.asset).toMatchObject({
        kind: "audio",
        folder: "音效",
        source: { kind: "plugin", name: "test-pack", license: "CC0" },
      });
      expect(added.asset.tags).toEqual(
        expect.arrayContaining(["音效", "扩展", "提示"]),
      );
      expect(await json("DELETE", "/api/plugins/test-pack")).toEqual({
        removed: true,
      });
      expect(await json("GET", "/api/plugins")).toEqual([]);
      expect(existsSync(path.join(dir, "plugins", "test-pack"))).toBe(false);
      expect(
        existsSync(path.join(server.media.dir, path.basename(added.asset.url))),
      ).toBe(true);
      expect(
        (await request("GET", "/api/plugins/test-pack/items/sounds/ding"))
          .statusCode,
      ).toBe(400);
    });
    it("rejects packs that try to run code outside the sandboxed template", async () => {
      const response = await upload(
        JSON.stringify(
          pack({
            templates: [
              {
                id: "t",
                name: "坏模板",
                code: "export default () => { fetch('https://x'); return null; }",
              },
            ],
          }),
        ),
      );
      expect(response.statusCode).toBe(400);
      expect(await json("GET", "/api/plugins")).toEqual([]);
      expect((await upload("{not json")).statusCode).toBe(400);
      expect(
        (await request("DELETE", "/api/plugins/..%2Fescape")).statusCode,
      ).toBe(400);
    });
  });

  describe("exports", () => {
    const record = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
      id: "sound-export",
      projectId: "demo-city",
      timelineId: "demo-city-main",
      kind: "audio",
      filename: "mix.wav",
      url: "/artifacts/mix.wav",
      codec: "pcm",
      size: 1,
      createdAt: new Date().toISOString(),
      expected: {
        duration: 0.1,
        fps: 30,
        width: 1920,
        height: 1080,
        audio: true,
      },
      ...overrides,
    });
    it("lists a project's exports and checks the file against the timeline", async () => {
      expect(await json("GET", "/api/projects/demo-city/exports")).toEqual([]);
      await fs.mkdir(path.join(dir, "artifacts"), { recursive: true });
      await fs.writeFile(path.join(dir, "artifacts", "mix.wav"), wav());
      server.repo.save("export", record());
      expect(await json("GET", "/api/projects/demo-city/exports")).toHaveLength(
        1,
      );
      const job = await json("POST", "/api/exports/sound-export/verify");
      const done = await settle(job.id);
      expect(done.status, done.error).toBe("completed");
      const checked = server.repo.record<ExportRecord>(
        "export",
        "sound-export",
      )!;
      expect(checked.verification).toMatchObject({ ok: true, issues: [] });
      expect(checked.verification!.duration).toBeCloseTo(0.1, 2);
      // A file that does not match what the timeline promised is reported.
      server.repo.save(
        "export",
        record({
          id: "short",
          expected: {
            duration: 5,
            fps: 30,
            width: 1920,
            height: 1080,
            audio: true,
          },
        }),
      );
      await settle((await json("POST", "/api/exports/short/verify")).id);
      const short = server.repo.record<ExportRecord>("export", "short")!;
      expect(short.verification?.ok).toBe(false);
      expect(short.verification?.issues.join()).toContain("时长");
    });
    it("refuses exports outside the artifacts folder and incomplete publish requests", async () => {
      server.repo.save(
        "export",
        record({ id: "escape", url: "/artifacts/../vault.json" }),
      );
      const failed = await settle(
        (await json("POST", "/api/exports/escape/verify")).id,
      );
      expect(failed.status).toBe("failed");
      expect(failed.error).toMatch(/路径无效/);
      expect(
        (await request("POST", "/api/exports/missing/verify")).statusCode,
      ).toBe(400);
      expect(
        (
          await request("POST", "/api/exports/escape/publish", {
            providerId: "x",
            title: "",
            platforms: [],
          })
        ).statusCode,
      ).toBe(400);
    });
  });

  describe("external agents over MCP", () => {
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await request(
        "POST",
        "/mcp",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
        {
          authorization: "Bearer " + server.repo.vault.get("mcp"),
          accept: "application/json, text/event-stream",
        },
      );
      const result = response.json().result;
      return result.isError
        ? { error: String(result.content[0].text) }
        : JSON.parse(result.content[0].text);
    };
    it("drafts edits in a manual session and hands them over as one proposal", async () => {
      const name = server.repo.get("demo-city").name;
      const { sessionId, mode } = await call("begin_edit_session", {
        projectId: "demo-city",
      });
      expect(mode).toBe("manual");
      const drafted = await call("apply_commands", {
        sessionId,
        label: "改名",
        commands: [{ type: "project.rename", name: "外部改名" }],
      });
      expect(drafted).toMatchObject({ drafted: true, draftSize: 1 });
      expect(server.repo.get("demo-city").name).toBe(name);
      expect(await call("review_edit_session", { sessionId })).toMatchObject({
        commands: 1,
        byType: { "project.rename": 1 },
      });
      expect(
        (
          await call("apply_commands", {
            sessionId,
            label: "坏",
            commands: [{ type: "nope" }],
          })
        ).error,
      ).toBeTruthy();
      const { proposalId } = await call("commit_edit_session", { sessionId });
      expect(proposalId).toBeTruthy();
      expect(
        (
          await call("apply_commands", {
            sessionId,
            label: "晚了",
            commands: [{ type: "project.rename", name: "x" }],
          })
        ).error,
      ).toMatch(/已结束/);
      server.agent.respond(proposalId, true);
      expect(server.repo.get("demo-city").name).toBe("外部改名");
    });
    it("applies edits directly in an auto session after the project was read", async () => {
      const { sessionId } = await call("begin_edit_session", {
        projectId: "demo-city",
        mode: "auto",
      });
      const unread = await call("apply_commands", {
        sessionId,
        label: "改名",
        commands: [{ type: "project.rename", name: "自动改名" }],
      });
      expect(unread.error).toMatch(/read_project/);
      await call("read_project", { sessionId });
      expect(
        await call("apply_commands", {
          sessionId,
          label: "改名",
          commands: [{ type: "project.rename", name: "自动改名" }],
        }),
      ).toMatchObject({ applied: true, revision: 1 });
      expect(server.repo.get("demo-city")).toMatchObject({
        name: "自动改名",
        revision: 1,
      });
      expect((await call("list_projects", {})).map((p: any) => p.id)).toContain(
        "demo-city",
      );
      expect(
        (await call("begin_edit_session", { projectId: "missing" })).error,
      ).toBeTruthy();
    });
  });
});
