import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkRuntime } from "../apps/server/src/runtime-status";
import {
  executableEnvironment,
  systemProxyEnvironment,
} from "../apps/server/src/process";
import {
  reportedRuntimeUsage,
  unknownRuntimeUsage,
} from "../apps/server/src/runtime-usage";

describe("runtime connection diagnostics", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-runtime-check-"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const cli = async (account: unknown) => {
    const file = path.join(dir, "codex");
    await fs.writeFile(
      file,
      `#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line); fs.appendFileSync(${JSON.stringify(path.join(dir, "methods"))},message.method+'\\n');
 if(message.id!==undefined)process.stdout.write(JSON.stringify({id:message.id,result:message.method==='initialize'?{userAgent:'Codex Desktop/0.162.0 (test)'}:${JSON.stringify(account)}})+'\\n');
});
`,
      { mode: 0o755 },
    );
    vi.stubEnv("TADACUT_CODEX_PATH", file);
  };
  it("checks a subprocess protocol fixture without submitting a model turn or returning account details", async () => {
    await cli({
      account: {
        type: "chatgpt",
        email: "private@example.invalid",
        accessToken: "never-return",
      },
      requiresOpenaiAuth: true,
    });
    const status = await checkRuntime("codex");
    expect(status).toMatchObject({
      state: "ready",
      installed: true,
      protocol: true,
      version: "0.162.0",
      authentication: "chatgpt",
    });
    expect(JSON.stringify(status)).not.toMatch(/private@example|never-return/);
    expect(
      (await fs.readFile(path.join(dir, "methods"), "utf8")).trim().split("\n"),
    ).toEqual(["initialize", "initialized", "account/read"]);
  });
  it("distinguishes missing CLI, login required and failed protocol", async () => {
    vi.stubEnv("TADACUT_CODEX_PATH", path.join(dir, "missing"));
    expect(await checkRuntime("codex")).toMatchObject({
      state: "missing",
      installed: false,
    });
    await cli({ account: null, requiresOpenaiAuth: true });
    expect(await checkRuntime("codex")).toMatchObject({
      state: "login-required",
      installed: true,
      protocol: true,
    });
    await fs.writeFile(path.join(dir, "codex"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    expect(await checkRuntime("codex")).toMatchObject({
      state: "error",
      installed: true,
    });
  });
  it("reports a slow ChatGPT workspace lookup as a network warning, not a failed connection", async () => {
    const file = path.join(dir, "codex");
    await fs.writeFile(
      file,
      `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.id===undefined)return;
 process.stdout.write(JSON.stringify(m.method==='account/read'?{id:m.id,error:{code:-32603,message:'workspace routing discovery timed out'}}:{id:m.id,result:{userAgent:'tadacut-connection-check/0.163.0 (Mac OS 15.2.0; arm64) unknown (tadacut-connection-check; 0.1.0)'}})+'\\n');
});
`,
      { mode: 0o755 },
    );
    vi.stubEnv("TADACUT_CODEX_PATH", file);
    expect(await checkRuntime("codex")).toMatchObject({
      state: "limited",
      protocol: true,
      version: "0.163.0",
      authentication: "chatgpt",
      message: expect.stringContaining("chatgpt.com"),
    });
  });
  it("gives CLIs the system proxy when the app was opened without one", () => {
    const proxy = systemProxyEnvironment(`<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}`);
    expect(proxy).toMatchObject({
      HTTPS_PROXY: "http://127.0.0.1:7897",
      HTTP_PROXY: "http://127.0.0.1:7897",
      https_proxy: "http://127.0.0.1:7897",
    });
    expect(proxy.NO_PROXY.split(",")).toEqual([
      "localhost",
      "127.0.0.1",
      "::1",
      ".local",
      "169.254/16",
    ]);
    expect(
      systemProxyEnvironment("<dictionary> {\n  HTTPEnable : 0\n}"),
    ).toEqual({});
    expect(
      systemProxyEnvironment(
        "  SOCKSEnable : 1\n  SOCKSPort : 1080\n  SOCKSProxy : 10.0.0.2\n",
      ),
    ).toMatchObject({ ALL_PROXY: "socks5h://10.0.0.2:1080" });
    const command = path.join(dir, "codex");
    expect(
      executableEnvironment(command, { PATH: "/usr/bin" }, () => proxy),
    ).toMatchObject({ HTTPS_PROXY: "http://127.0.0.1:7897" });
    // A proxy the user set explicitly wins, and nothing is added on top.
    const own = executableEnvironment(
      command,
      { PATH: "/usr/bin", https_proxy: "http://10.0.0.9:8080" },
      () => proxy,
    );
    expect(own.https_proxy).toBe("http://10.0.0.9:8080");
    expect(own.HTTPS_PROXY).toBeUndefined();
  });
  it("keeps unknown token use distinct from a reported zero", () => {
    expect(unknownRuntimeUsage()).toEqual({
      input: null,
      output: null,
      reported: false,
    });
    expect(reportedRuntimeUsage({})).toBeNull();
    expect(reportedRuntimeUsage({ inputTokens: 0, outputTokens: 0 })).toEqual({
      input: 0,
      output: 0,
      reported: true,
    });
    expect(
      reportedRuntimeUsage({ input_tokens: 25, output_tokens: 8 }),
    ).toEqual({ input: 25, output: 8, reported: true });
    expect(
      reportedRuntimeUsage({ inputTokens: -1, outputTokens: 2 }),
    ).toBeNull();
  });
});
