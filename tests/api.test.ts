import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";
import { providerSchema } from "@tadacut/providers";
describe("local studio boundary", () => {
  let server: Awaited<ReturnType<typeof createStudioServer>>,
    dir: string,
    cookie: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-test-"));
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
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const request = (
    method: "GET" | "POST",
    url: string,
    payload?: any,
    headers: any = {},
  ) =>
    server.app.inject({
      method,
      url,
      payload,
      headers: { host: "127.0.0.1", cookie, ...headers },
    });
  it("requires a session before reading project data", async () => {
    const response = await server.app.inject({
      url: "/api/projects",
      headers: { host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(401);
  });
  it("rejects DNS rebinding and cross-site writes", async () => {
    expect(
      (
        await request(
          "POST",
          "/api/projects",
          { name: "Blocked" },
          { origin: "https://attacker.example" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request("GET", "/api/session", undefined, {
          host: "attacker.example",
        })
      ).statusCode,
    ).toBe(403);
  });
  it("does not trust another local port unless it is the configured dev server", async () => {
    // Session cookies are shared by every port on 127.0.0.1.
    const fromVite = () =>
      request("GET", "/api/projects", undefined, {
        origin: "http://127.0.0.1:4318",
      });
    expect((await fromVite()).statusCode).toBe(403);
    await server.close();
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
      devOrigins: ["http://127.0.0.1:4318"],
    });
    const session = await server.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1" },
    });
    cookie = session.headers["set-cookie"]!.toString().split(";")[0];
    expect((await fromVite()).statusCode).toBe(200);
  });
  it("keeps a job's name while its progress reports steps", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.jobs.register("probe", async ({ progress }) => {
      progress(40, "正在处理第一段");
      await gate;
      return { ok: true };
    });
    const job = server.jobs.enqueue("demo-city", "probe", "测试任务", {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    const running = server.repo.record<any>("job", job.id);
    expect(running).toMatchObject({
      label: "测试任务",
      stage: "正在处理第一段",
      progress: 40,
    });
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const done = server.repo.record<any>("job", job.id);
    expect(done.status).toBe("completed");
    expect(done.label).toBe("测试任务");
    expect(done.stage).toBeUndefined();
  });
  it("shuts down while the studio window is still streaming events", async () => {
    // The desktop app closes the server on quit before its window goes away.
    const origin = await server.listen();
    const session = await fetch(origin + "/api/session");
    const stream = await fetch(origin + "/api/events", {
      headers: { cookie: session.headers.getSetCookie()[0].split(";")[0] },
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "connected",
    );
    const closed = await Promise.race([
      server.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    expect(closed).toBe(true);
    const end = await reader.read().catch(() => ({ done: true }));
    expect(end.done).toBe(true);
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
  });
  it("starts and reports unreadable keys when the keychain stops opening them", async () => {
    // Behaves like Electron safeStorage, which refuses data it did not seal.
    const keychain = {
      encrypt: (value: string) => Buffer.from("v10" + value).toString("base64"),
      decrypt: (value: string) => {
        const text = Buffer.from(value, "base64").toString();
        if (!text.startsWith("v10"))
          throw new Error("Ciphertext does not appear to be encrypted.");
        return text.slice(3);
      },
    };
    const launch = async (cipher?: typeof keychain) => {
      await server.close();
      server = await createStudioServer({
        root: process.cwd(),
        dataDir: dir,
        port: 0,
        cipher,
      });
      const session = await server.app.inject({
        url: "/api/session",
        headers: { host: "127.0.0.1" },
      });
      cookie = session.headers["set-cookie"]!.toString().split(";")[0];
    };
    await fs.rm(path.join(dir, "vault.json"));
    await launch(keychain);
    const token = server.repo.vault.get("mcp");
    server.repo.saveProvider(
      providerSchema.parse({
        id: "cloud",
        name: "Cloud",
        kind: "compatible",
        baseUrl: "https://models.example/v1",
        model: "m",
      }),
      "secret-sealed-by-keychain",
    );
    // Keychain access is denied on the next launch. Starting and listing
    // providers do not open any secret, so neither asks the keychain.
    let opened = 0;
    await launch({
      encrypt: keychain.encrypt,
      decrypt: () => {
        opened++;
        throw new Error("User interaction is not allowed.");
      },
    });
    const listed = await request("GET", "/api/providers");
    // Everything the studio loads on start, settings included.
    for (const url of [
      "/api/projects",
      "/api/jobs",
      "/api/skills",
      "/api/settings",
      "/api/agent/settings",
      "/api/capabilities",
    ])
      expect((await request("GET", url)).statusCode).toBe(200);
    expect(opened).toBe(0);
    expect(listed.body).not.toContain("secret-sealed-by-keychain");
    expect(listed.json().find((p: any) => p.id === "cloud")).toMatchObject({
      hasKey: true,
    });
    // Using the key reports the real cause, and the list then says so too.
    const used = await request("POST", "/api/providers/cloud/models", {});
    expect(used.statusCode).toBeGreaterThanOrEqual(400);
    expect(used.json().message).toMatch(/钥匙串/);
    expect(
      (await request("GET", "/api/providers"))
        .json()
        .find((p: any) => p.id === "cloud"),
    ).toMatchObject({ hasKey: false, keyUnreadable: true });
    // The MCP token is replaced on first use.
    const config = (await request("GET", "/api/mcp-config")).json();
    const header = config.mcpServers.tadacut.headers.Authorization;
    expect(header).toMatch(/^Bearer .{20,}/);
    expect(header).not.toBe(`Bearer ${token}`);
  });
  it("does not return plaintext credentials in any provider DTO", async () => {
    const provider = providerSchema.parse({
      id: "custom",
      name: "My local model",
      kind: "compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "test",
    });
    const result = await request("POST", "/api/providers", {
      provider,
      apiKey: "secret-only-for-test",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain("secret-only-for-test");
    expect(result.json().hasKey).toBe(true);
    const files = await fs.readFile(path.join(dir, "vault.json"), "utf8");
    expect(files).not.toContain("secret-only-for-test");
    expect(server.repo.vault.get("provider:custom")).toBe(
      "secret-only-for-test",
    );
  });
  it("persists edits, detects conflicts, and supports monotonic undo/redo", async () => {
    const id = "demo-city";
    const body = {
      requestId: "rename",
      expectedRevision: 0,
      label: "Rename",
      commands: [{ type: "project.rename", name: "Changed" }],
    };
    expect(
      (await request("POST", `/api/projects/${id}/commands`, body)).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", `/api/projects/${id}/commands`, {
          ...body,
          requestId: "stale",
        })
      ).statusCode,
    ).toBe(409);
    const undone = await request("POST", `/api/projects/${id}/undo`, {
      expectedRevision: 1,
    });
    expect(undone.json().revision).toBe(2);
    expect(undone.json().name).toBe("城市漫游");
    const redone = await request("POST", `/api/projects/${id}/redo`, {
      expectedRevision: 2,
    });
    expect(redone.json().revision).toBe(3);
    expect(redone.json().name).toBe("Changed");
  });
  it("replays a request only when its payload matches", async () => {
    const body = {
      requestId: "r",
      expectedRevision: 0,
      label: "Rename",
      commands: [{ type: "project.rename", name: "Changed" }],
    };
    await request("POST", "/api/projects/demo-city/commands", body);
    const replay = await request(
      "POST",
      "/api/projects/demo-city/commands",
      body,
    );
    expect(replay.json().replayed).toBe(true);
    expect(server.repo.get("demo-city").revision).toBe(1);
    expect(
      (
        await request("POST", "/api/projects/demo-city/commands", {
          ...body,
          label: "Different",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("keeps a stale Agent proposal from applying to changed state", async () => {
    const p = server.agent.proposal("demo-city", "Proposal", [
      { type: "project.rename", name: "AI title" },
    ]);
    await request("POST", "/api/projects/demo-city/commands", {
      requestId: "manual",
      expectedRevision: 0,
      label: "Manual",
      commands: [{ type: "project.rename", name: "Human title" }],
    });
    expect(
      (await request("POST", `/api/proposals/${p.id}`, { apply: true }))
        .statusCode,
    ).toBe(409);
    expect(server.repo.get("demo-city").name).toBe("Human title");
  });
  it("binds automatic Agent edits to the version actually read by that tool session", async () => {
    const host = server.agent.host(
      "demo-city",
      new AbortController().signal,
      "auto",
    );
    const tools = server.agent.tools(host, undefined);
    await tools.find((t) => t.name === "read_project")!.execute({});
    server.repo.commit("demo-city", {
      requestId: "manual",
      expectedRevision: 0,
      label: "Manual",
      commands: [{ type: "project.rename", name: "New" }],
    });
    await expect(
      tools
        .find((t) => t.name === "propose_edit")!
        .execute({
          label: "Old",
          commands: [{ type: "project.rename", name: "Stale" }],
        }),
    ).rejects.toThrow("发生变化");
  });
  it("round trips the portable project with its real local media", async () => {
    const result = await server.artifacts.export("demo-city", "project");
    const bytes = await fs.readFile(
      path.join(dir, result.url.replace("/artifacts/", "artifacts/")),
    );
    const imported = await server.artifacts.import(bytes, "project.tadacut");
    expect(imported.assets).toHaveLength(6);
    expect(imported.timelines[0].clips).toHaveLength(6);
    expect(imported.id).not.toBe("demo-city");
    expect(
      imported.assets
        .filter((a) => a.kind === "image")
        .every((a) => a.url.startsWith("/media/")),
    ).toBe(true);
  });
  it("requires a bearer credential on MCP independently of browser cookies", async () => {
    expect(
      (
        await request("POST", "/mcp", {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        })
      ).statusCode,
    ).toBe(401);
  });
  it("performs a real MCP initialize handshake", async () => {
    const response = await request(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      {
        authorization: "Bearer " + server.repo.vault.get("mcp"),
        accept: "application/json, text/event-stream",
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().result.serverInfo.name).toBe("tadacut");
  });
  it("runs the offline assistant as a real persisted job without remote requests", async () => {
    const job = server.jobs.enqueue("demo-city", "agent", "Offline", {
      message: "把时间线调整为 15 秒",
    });
    for (
      let i = 0;
      i < 100 &&
      !["completed", "failed"].includes(
        server.repo.record<any>("job", job.id).status,
      );
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    expect(server.repo.record<any>("job", job.id).status).toBe("completed");
    expect(server.repo.list<any>("proposal")).toHaveLength(1);
    expect(server.repo.list<any>("message")).toHaveLength(2);
    const proposal = server.repo.list<any>("proposal")[0];
    server.agent.respond(proposal.id, true);
    const timeline = server.repo.get("demo-city").timelines[0];
    expect(Math.max(...timeline.clips.map((c) => c.start + c.duration))).toBe(
      450,
    );
  });
});
