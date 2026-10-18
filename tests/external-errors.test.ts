import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runExternalAgent, runtimeFailure } from "../apps/server/src/external";
import { checkedFetch, providerSchema } from "@tadacut/providers";

describe("runtime and service failures explain themselves", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-runtime-error-"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const gateway =
    "unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3425/backend-api/codex/responses";
  it("passes on the reason a Codex turn failed, and the retries before it", async () => {
    const file = path.join(dir, "codex");
    // Answers like the app server, then fails the turn the way a broken proxy does.
    await fs.writeFile(
      file,
      `#!/usr/bin/env node
const readline = require('node:readline');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'account/read') return send({ id: m.id, result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } });
  if (m.method === 'thread/start') return send({ id: m.id, result: { thread: { id: 't' } } });
  send({ id: m.id, result: {} });
  if (m.method === 'turn/start') {
    send({ method: 'error', params: { error: { message: ${JSON.stringify(gateway)} }, willRetry: true } });
    send({ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: ${JSON.stringify(gateway)} } } } });
  }
});
`,
      { mode: 0o755 },
    );
    vi.stubEnv("TADACUT_CODEX_PATH", file);
    const notices: (string | null)[] = [];
    const run = runExternalAgent("codex", {
      system: "test",
      prompt: "你好",
      tools: [],
      signal: new AbortController().signal,
      onText: () => {},
      onNotice: (text) => notices.push(text),
      cwd: dir,
    });
    await expect(run).rejects.toThrow(
      /Codex 未完成任务：.*502 Bad Gateway.*本机服务或代理/,
    );
    expect(notices[0]).toMatch(/正在重试.*502/);
  });
  it("keeps going when the ChatGPT workspace lookup times out", async () => {
    const file = path.join(dir, "codex");
    // Codex 0.163 answers account/read this way when chatgpt.com is slow,
    // yet still starts threads and runs turns.
    await fs.writeFile(
      file,
      `#!/usr/bin/env node
const readline = require('node:readline');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'account/read') return send({ id: m.id, error: { code: -32603, message: 'workspace routing discovery timed out' } });
  if (m.method === 'thread/start') return send({ id: m.id, result: { thread: { id: 't' } } });
  send({ id: m.id, result: {} });
  if (m.method === 'turn/start') {
    send({ method: 'item/agentMessage/delta', params: { delta: '好的。' } });
    send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  }
});
`,
      { mode: 0o755 },
    );
    vi.stubEnv("TADACUT_CODEX_PATH", file);
    const notices: (string | null)[] = [];
    let text = "";
    await runExternalAgent("codex", {
      system: "test",
      prompt: "你好",
      tools: [],
      signal: new AbortController().signal,
      onText: (delta) => (text += delta),
      onNotice: (notice) => notices.push(notice),
      cwd: dir,
    });
    expect(text).toBe("好的。");
    expect(notices[0]).toMatch(
      /账户检查未完成.*workspace routing discovery timed out/,
    );
    expect(notices.at(-1)).toBeNull();
  });
  it("says when a runtime gave no reason, instead of a bare failure", () => {
    expect(runtimeFailure("Codex", "未完成任务")).toBe(
      "Codex 未完成任务，运行时没有给出原因。",
    );
    expect(
      runtimeFailure("Copilot", "未完成任务", "HTTP 429 rate limit"),
    ).toMatch(/额度用尽/);
  });
  it("includes the service's own error message, without the key", async () => {
    const ctx = {
      provider: providerSchema.parse({
        id: "p",
        name: "P",
        kind: "compatible",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "m",
      }),
      apiKey: "sk-test-secret-123456",
      signal: new AbortController().signal,
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Incorrect API key provided: sk-test-secret-123456",
            },
          }),
          { status: 401 },
        )) as typeof fetch,
    };
    const failure = checkedFetch(ctx, "/models").catch((e: Error) => e.message);
    const message = await failure;
    expect(message).toMatch(
      /HTTP 401（凭据无效或没有权限）：Incorrect API key/,
    );
    expect(message).not.toContain("sk-test-secret-123456");
  });
});
