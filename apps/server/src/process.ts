import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
interface ExecutableOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}
export function executable(
  name: string,
  options: ExecutableOptions = {},
): string | null {
  const env = options.env ?? process.env,
    homeDir = options.homeDir ?? os.homedir(),
    platform = options.platform ?? process.platform;
  const usable = (file: string) => {
    try {
      if (!fs.statSync(file).isFile()) return false;
      fs.accessSync(
        file,
        platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
      );
      return true;
    } catch {
      return false;
    }
  };
  const explicit = env[`TADACUT_${name.toUpperCase().replace(/-/g, "_")}_PATH`];
  // An explicitly configured executable must never silently fall back to another runtime.
  if (explicit) return usable(explicit) ? explicit : null;
  const versions = (dir: string, suffix: string) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .slice(0, 64)
        .map((version) => path.join(dir, version, suffix));
    } catch {
      return [];
    }
  };
  const bins =
    platform === "win32"
      ? []
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          env.NVM_BIN,
          ...[
            ".local/bin",
            ".npm-global/bin",
            ".bun/bin",
            ".deno/bin",
            ".cargo/bin",
            ".volta/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
            "Library/pnpm",
            ".claude/local",
          ].map((dir) => path.join(homeDir, dir)),
          ...versions(
            path.join(
              env.NVM_DIR ?? path.join(homeDir, ".nvm"),
              "versions/node",
            ),
            "bin",
          ),
          ...[
            env.FNM_DIR,
            path.join(homeDir, ".local/share/fnm"),
            path.join(homeDir, "Library/Application Support/fnm"),
          ]
            .filter((dir): dir is string => Boolean(dir))
            .flatMap((dir) =>
              versions(path.join(dir, "node-versions"), "installation/bin"),
            ),
          ...versions(
            path.join(homeDir, ".local/share/mise/installs/node"),
            "bin",
          ),
        ].filter((dir): dir is string => Boolean(dir));
  const candidates = [
    ...String(env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) =>
        path.join(dir, name + (platform === "win32" ? ".exe" : "")),
      ),
    ...bins.map((dir) => path.join(dir, name)),
  ];
  return [...new Set(candidates)].find(usable) ?? null;
}
const proxyNames = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"];
const hasProxy = (env: NodeJS.ProcessEnv) =>
  proxyNames.some((name) => env[name] || env[name.toLowerCase()]);
/**
 * Proxy variables from `scutil --proxy`. An app opened from the Dock does not
 * inherit a terminal's HTTPS_PROXY, so CLIs started here use the proxy set in
 * System Settings instead; local addresses always stay direct.
 */
export function systemProxyEnvironment(output: string): Record<string, string> {
  const value = (key: string) =>
    output.match(new RegExp(`^\\s*${key} : (.+)$`, "m"))?.[1].trim();
  const proxy = (kind: string) =>
    value(`${kind}Enable`) === "1" &&
    value(`${kind}Proxy`) &&
    value(`${kind}Port`)
      ? `${value(`${kind}Proxy`)}:${value(`${kind}Port`)}`
      : undefined;
  const https = proxy("HTTPS"),
    http = proxy("HTTP"),
    socks = proxy("SOCKS");
  if (!https && !http && !socks) return {};
  const exceptions = [
    ...(output
      .match(/ExceptionsList : <array> \{([\s\S]*?)\}/)?.[1]
      .matchAll(/^\s*\d+ : (.+)$/gm) ?? []),
  ].map((match) => match[1].trim().replace(/^\*\./, "."));
  const bypass = [
    ...new Set(["localhost", "127.0.0.1", "::1", ...exceptions]),
  ].join(",");
  const env: Record<string, string> = { NO_PROXY: bypass, no_proxy: bypass };
  const set = (name: string, url: string) => {
    env[name] = url;
    env[name.toLowerCase()] = url;
  };
  if (https || http) {
    set("HTTPS_PROXY", `http://${https ?? http}`);
    set("HTTP_PROXY", `http://${http ?? https}`);
  } else set("ALL_PROXY", `socks5h://${socks}`);
  return env;
}
let systemProxy: { at: number; env: Record<string, string> } | undefined;
function macProxy() {
  if (process.platform !== "darwin") return {};
  if (systemProxy && Date.now() - systemProxy.at < 30000)
    return systemProxy.env;
  let env: Record<string, string> = {};
  try {
    const result = spawnSync("/usr/sbin/scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (result.status === 0) env = systemProxyEnvironment(result.stdout);
  } catch {}
  systemProxy = { at: Date.now(), env };
  return env;
}
/**
 * npm CLI shims need their version manager's node even when Finder's PATH is
 * minimal, and network access needs the system proxy a terminal would carry.
 */
export function executableEnvironment(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  proxy: () => Record<string, string> = macProxy,
): NodeJS.ProcessEnv {
  const node = executable("node", { env });
  return {
    ...(hasProxy(env) ? {} : proxy()),
    ...env,
    PATH: [
      ...new Set(
        [
          path.dirname(command),
          ...(node ? [path.dirname(node)] : []),
          ...(env.PATH ?? "").split(path.delimiter),
        ].filter(Boolean),
      ),
    ].join(path.delimiter),
  };
}
export async function runProcess(
  command: string,
  args: string[],
  signal?: AbortSignal,
  maxBytes = 128 * 1024 * 1024,
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let bytes = 0,
      stderr = "";
    let failure: Error | null = null;
    let hardKill: NodeJS.Timeout | undefined;
    const kill = () => {
      failure = new Error("任务已取消");
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 2000);
    };
    signal?.addEventListener("abort", kill, { once: true });
    const timer = setTimeout(
      () => {
        failure = new Error("本机进程执行超时");
        child.kill("SIGKILL");
      },
      20 * 60 * 1000,
    );
    child.stdout.on("data", (data: Buffer) => {
      bytes += data.length;
      if (bytes > maxBytes) {
        failure = new Error("处理结果过大，请缩短素材");
        child.kill("SIGKILL");
      } else output.push(data);
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + String(data)).slice(-20000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      signal?.removeEventListener("abort", kill);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      signal?.removeEventListener("abort", kill);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `${path.basename(command)} 未完成处理（${code}）：${stderr.slice(-1200)}`,
          ),
        );
      else resolve({ stdout: Buffer.concat(output), stderr });
    });
  });
}
export function findBrowser() {
  if (
    process.env.TADACUT_CHROME_PATH &&
    fs.existsSync(process.env.TADACUT_CHROME_PATH)
  )
    return process.env.TADACUT_CHROME_PATH;
  const resources = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const roots = [
    resources ? path.join(resources, "render-browser") : "",
    path.resolve("build/render-browser"),
  ];
  for (const dir of roots)
    if (dir && fs.existsSync(path.join(dir, "tadacut-browser.json"))) {
      try {
        const metadata = JSON.parse(
          fs.readFileSync(path.join(dir, "tadacut-browser.json"), "utf8"),
        );
        const file = path.join(dir, metadata.executable);
        if (
          file.startsWith(path.resolve(dir) + path.sep) &&
          fs.existsSync(file)
        )
          return file;
      } catch {}
    }
  return (
    [
      process.env.TADACUT_CHROME_PATH,
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "",
      process.platform === "win32"
        ? path.join(
            process.env.PROGRAMFILES ?? "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          )
        : "/usr/bin/chromium",
    ].find((p) => p && fs.existsSync(p)) ?? null
  );
}
