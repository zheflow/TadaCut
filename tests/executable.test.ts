import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { executable, executableEnvironment } from "../apps/server/src/process";
import { bundledMediaBinary } from "../apps/server/src/media";

describe("desktop CLI discovery", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-cli-discovery-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const binary = async (name: string, content = "#!/bin/sh\nexit 0\n") => {
    await fs.mkdir(path.dirname(name), { recursive: true });
    await fs.writeFile(name, content, { mode: 0o755 });
    return name;
  };
  const environment = () => ({
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    homeDir: dir,
    platform: "darwin" as const,
  });
  it("finds an npm-installed Codex in nvm when Finder did not load the shell PATH", async () => {
    const installed = await binary(
      path.join(dir, ".nvm/versions/node/v22.22.0/bin/codex"),
    );
    expect(executable("codex", environment())).toBe(installed);
  });
  it("keeps an explicit PATH choice ahead of fallback version-manager discovery", async () => {
    const installed = await binary(
      path.join(dir, ".nvm/versions/node/v22.22.0/bin/codex"),
    );
    const preferred = await binary(path.join(dir, "preferred/codex"));
    expect(
      executable("codex", {
        ...environment(),
        env: { PATH: path.dirname(preferred) },
      }),
    ).toBe(preferred);
    expect(executable("codex", environment())).toBe(installed);
  });
  it("does not treat directories or non-executable files as a working CLI, or ignore an invalid explicit override", async () => {
    const p = path.join(dir, "bin/codex");
    await fs.mkdir(p, { recursive: true });
    expect(
      executable("codex", { ...environment(), env: { PATH: path.dirname(p) } }),
    ).toBeNull();
    await fs.rm(p, { recursive: true });
    await fs.writeFile(p, "not executable", { mode: 0o644 });
    expect(
      executable("codex", { ...environment(), env: { PATH: path.dirname(p) } }),
    ).toBeNull();
    const good = await binary(path.join(dir, "valid/codex"));
    expect(
      executable("codex", {
        ...environment(),
        env: {
          TADACUT_CODEX_PATH: path.join(dir, "missing"),
          PATH: path.dirname(good),
        },
      }),
    ).toBeNull();
  });
  it("supplies the matching node binary when spawning an nvm CLI script from a minimal PATH", async () => {
    const installed = await binary(
      path.join(dir, ".nvm/versions/node/v22.22.0/bin/codex"),
      "#!/usr/bin/env node\nprocess.stdout.write('real-node-started')\n",
    );
    await fs.symlink(
      process.execPath,
      path.join(path.dirname(installed), "node"),
    );
    const command = executable("codex", environment())!;
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, [], {
        env: executableEnvironment(command, environment().env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`CLI exited ${code}`)),
      );
    });
    expect(result).toBe("real-node-started");
  });
});

describe("bundled FFmpeg", () => {
  it("uses only a directory written by the LGPL build script", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-ffmpeg-"));
    try {
      const loose = path.join(dir, "loose"),
        built = path.join(dir, "built");
      for (const root of [loose, built]) {
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, "ffmpeg"), "", { mode: 0o755 });
      }
      await fs.writeFile(path.join(built, "tadacut-ffmpeg.json"), "{}");
      expect(bundledMediaBinary("ffmpeg", ["", loose, built])).toBe(
        path.join(built, "ffmpeg"),
      );
      expect(bundledMediaBinary("ffprobe", [loose, built])).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
