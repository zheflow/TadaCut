import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import os from "node:os";
import { executable, executableEnvironment, runProcess } from "./process";
import { copilotInstalled } from "./external";

export const runtimeIds = ["codex", "claude", "copilot"] as const;
export type RuntimeId = (typeof runtimeIds)[number];
export interface RuntimeStatus {
  id: RuntimeId;
  installed: boolean;
  kind: "cli" | "sdk";
  path?: string;
  state:
    | "missing"
    | "unverified"
    | "ready"
    | "limited"
    | "login-required"
    | "error";
  version?: string;
  protocol?: boolean;
  authentication?: string;
  message: string;
}
export function runtimeStatuses(): RuntimeStatus[] {
  return runtimeIds.map((id) => {
    if (id === "copilot") {
      const installed = copilotInstalled();
      return {
        id,
        installed,
        kind: "sdk",
        state: installed ? "unverified" : "missing",
        message: installed
          ? "Copilot SDK 已安装；本机运行时与登录尚未验证"
          : "未安装 Copilot SDK",
      };
    }
    const file = executable(id);
    return {
      id,
      installed: Boolean(file),
      kind: "cli",
      ...(file ? { path: file } : {}),
      state: file ? "unverified" : "missing",
      message: file
        ? "已找到 CLI；登录与连接尚未验证"
        : "未找到可执行的 CLI；已检查 PATH、nvm 和常见安装目录",
    };
  });
}

const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);
const lastLine = (output: string) =>
  output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(-300) ?? "";
/** Only initialize and read auth state. This never starts a model turn or changes login. */
export async function checkRuntime(
  id: RuntimeId,
  signal = new AbortController().signal,
): Promise<RuntimeStatus> {
  const status = runtimeStatuses().find((runtime) => runtime.id === id)!;
  if (!status.installed || !status.path) return status;
  if (id !== "codex") {
    try {
      const output = await runProcess(
        status.path,
        ["--version"],
        AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        8192,
        executableEnvironment(status.path),
      );
      return {
        ...status,
        version: output.stdout
          .toString()
          .match(/\d+\.\d+\.\d+(?:[-.\w]*)?/)?.[0],
        message: "CLI 可启动；尚未检查登录或发起模型对话",
      };
    } catch (error) {
      return {
        ...status,
        state: "error",
        message: `CLI 已找到，但无法启动：${reason(error)}`,
      };
    }
  }
  signal.throwIfAborted();
  const child = spawn(
    status.path,
    ["-c", "features.shell_tool=false", "app-server", "--listen", "stdio://"],
    {
      cwd: os.tmpdir(),
      env: executableEnvironment(status.path),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  let next = 0,
    failure: Error | undefined;
  const fail = (error: Error) => {
    failure = error;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("close", () => fail(new Error("CLI connection ended")));
  const abort = () => {
    fail(new Error("检测已取消"));
    child.kill("SIGTERM");
  };
  signal.addEventListener("abort", abort, { once: true });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const item = pending.get(message.id);
      if (item && !message.method) {
        clearTimeout(item.timer);
        pending.delete(message.id);
        message.error
          ? item.reject(
              new Error(String(message.error.message ?? "CLI protocol error")),
            )
          : item.resolve(message.result);
      }
    } catch {}
  });
  const request = (method: string, params: unknown, timeout = 8000) =>
    new Promise<any>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("CLI response timed out"));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ id, method, params }) + "\n",
        (error) => {
          if (error) fail(error);
        },
      );
    });
  try {
    const initialized = await request("initialize", {
      clientInfo: { name: "tadacut-connection-check", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    status.protocol = true;
    // "Codex Desktop/0.162.0 (…)" before 0.163, "<client name>/0.163.0 (…)" after.
    status.version = String(initialized.userAgent ?? "").match(
      /^[^/]+\/(\d+\.\d+\.\d+(?:[-.\w]*)?)/,
    )?.[1];
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    // Newer CLIs look up the ChatGPT workspace here, waiting up to 15 s.
    const result = await request(
      "account/read",
      { refreshToken: false },
      25000,
    );
    const ready =
      Boolean(result.account) || result.requiresOpenaiAuth === false;
    return {
      ...status,
      state: ready ? "ready" : "login-required",
      authentication:
        result.account?.type ?? (ready ? "configured-provider" : "none"),
      message: ready
        ? "真实 CLI 握手与登录检查通过；未发起模型推理"
        : "CLI 可连接，但尚未登录。请在终端运行 codex login",
    };
  } catch (error) {
    // The lookup only runs for a signed-in ChatGPT account, and threads still
    // start without it, so this is a network warning rather than a failure.
    if (status.protocol && /workspace routing/i.test(reason(error)))
      return {
        ...status,
        state: "limited",
        authentication: "chatgpt",
        message: `CLI 已连接并登录 ChatGPT，但查询工作区路由未完成（${reason(error)}）：访问 chatgpt.com 太慢或被阻断，请检查网络或代理。对话仍会尝试，失败时会显示原因`,
      };
    const detail = [reason(error), lastLine(stderr)]
      .filter(Boolean)
      .join(" · ");
    return {
      ...status,
      state: "error",
      message: status.protocol
        ? `CLI 协议已连接，但登录检查未完成：${detail}`
        : `CLI 已找到，但协议握手失败或超时：${detail}`,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    child.stdin.end();
    child.kill("SIGTERM");
    lines.close();
  }
}
