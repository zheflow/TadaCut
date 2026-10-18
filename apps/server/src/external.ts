import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type { AgentTool } from "../../../packages/agent/src/runner";
import { executable, executableEnvironment } from "./process";
import { serveExternalTools } from "./external-mcp";
import { modelToolResult } from "../../../packages/agent/src/output";
import {
  reportedRuntimeUsage,
  unknownRuntimeUsage,
  type RuntimeUsage,
} from "./runtime-usage";
const require = createRequire(import.meta.url);
/** The Copilot runtime is an optional dependency; its own login is checked when a session starts. */
export function copilotInstalled() {
  try {
    require.resolve("@github/copilot-sdk");
    return true;
  } catch {
    return false;
  }
}
interface Options {
  system: string;
  prompt: string;
  tools: AgentTool[];
  signal: AbortSignal;
  onText(delta: string): void;
  /** A passing state the user should see, such as a retry; null clears it. */
  onNotice?(text: string | null): void;
  cwd: string;
}
/** The useful end of a runtime's diagnostic output. */
function lastError(output: string) {
  const lines = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line =
    [...lines].reverse().find((l) => /error|错误|failed|denied/i.test(l)) ??
    lines.at(-1) ??
    "";
  return line.length > 300 ? line.slice(-300) : line;
}
const hint = (reason: string) =>
  /\b(401|403)\b|unauthori[sz]ed|forbidden|not logged in|login/i.test(reason)
    ? "（请在终端重新登录这个 CLI）"
    : /\b429\b|rate.?limit|quota|usage limit/i.test(reason)
      ? "（额度用尽或请求过于频繁，请稍后再试）"
      : /\b50[0234]\b|bad gateway|timed? ?out|stream disconnected|connection (refused|reset)/i.test(
            reason,
          )
        ? /127\.0\.0\.1|localhost/.test(reason)
          ? "（错误来自 CLI 配置的本机服务或代理，请确认它正常运行）"
          : "（模型服务或网络暂时不可用）"
        : "";
/** "Codex 未完成任务：<reason>（<hint>）", or says that no reason was given. */
export function runtimeFailure(
  runtime: string,
  what: string,
  reason?: string | null,
) {
  const text = reason?.replace(/\s+/g, " ").trim().slice(0, 500);
  return text
    ? `${runtime} ${what}：${text}${hint(text)}`
    : `${runtime} ${what}，运行时没有给出原因。`;
}
export async function runExternalAgent(
  backend: string,
  options: Options,
): Promise<{ usage: RuntimeUsage }> {
  if (backend === "copilot") return copilot(options);
  if (backend === "codex") return codex(options);
  if (backend === "claude") return claude(options);
  throw new Error("未知外部 Agent 后端");
}
function ownChild(command: string, args: string[], options: Options) {
  options.signal.throwIfAborted();
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: false,
    windowsHide: true,
    env: executableEnvironment(command),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stop = () => child.kill("SIGTERM");
  options.signal.addEventListener("abort", stop, { once: true });
  // Drained so the runtime never blocks on it; the end explains failures.
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-8000);
  });
  child.once("close", () => options.signal.removeEventListener("abort", stop));
  return { child, stderr: () => lastError(stderr) };
}
async function codex(options: Options) {
  const command = executable("codex");
  if (!command)
    throw new Error(
      "未找到可执行的 Codex CLI。请在模型页检测连接，或检查 CLI 路径；这不代表登录已失效。",
    );
  const { child, stderr } = ownChild(
      command,
      ["-c", "features.shell_tool=false", "app-server", "--listen", "stdio://"],
      options,
    ),
    lines = createInterface({ input: child.stdout });
  const describe = (error: any) =>
    [error?.message, error?.additionalDetails]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" · ");
  let reported: string | undefined;
  const pending = new Map<
    number,
    { resolve(v: any): void; reject(e: Error): void; timer: NodeJS.Timeout }
  >();
  let next = 0,
    usage = unknownRuntimeUsage(),
    finish: (() => void) | undefined,
    fail: ((e: Error) => void) | undefined;
  const send = (v: unknown) => child.stdin.write(JSON.stringify(v) + "\n");
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex ${method} 响应超时`));
        }, 60000);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  lines.on("line", async (line) => {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.id !== undefined && !event.method) {
      const task = pending.get(event.id);
      if (task) {
        clearTimeout(task.timer);
        pending.delete(event.id);
        if (event.error)
          task.reject(
            new Error("Codex 协议请求未成功：" + event.error.message),
          );
        else task.resolve(event.result);
      }
      return;
    }
    if (event.method === "error") {
      reported = describe(event.params?.error) || reported;
      if (event.params?.willRetry && reported)
        options.onNotice?.(`Codex 正在重试：${reported}`);
    }
    if (event.method === "item/agentMessage/delta") {
      options.onNotice?.(null);
      options.onText(event.params.delta ?? "");
    }
    if (event.method === "thread/tokenUsage/updated")
      usage = reportedRuntimeUsage(event.params?.tokenUsage?.total) ?? usage;
    if (event.method === "turn/completed") {
      const turn = event.params.turn;
      if (turn.status === "completed") finish?.();
      else
        fail?.(
          new Error(
            runtimeFailure(
              "Codex",
              turn.status === "interrupted" ? "任务被中断" : "未完成任务",
              describe(turn.error) || reported,
            ),
          ),
        );
    }
    if (event.id !== undefined && event.method === "item/tool/call") {
      try {
        const tool = options.tools.find((t) => t.name === event.params.tool);
        if (!tool) throw new Error("工具不在授权目录中");
        const result = modelToolResult(
          await tool.execute(event.params.arguments),
        );
        send({
          id: event.id,
          result: {
            contentItems: [
              { type: "inputText", text: result.text },
              ...result.images.map((imageUrl) => ({
                type: "inputImage",
                imageUrl,
              })),
            ],
            success: true,
          },
        });
      } catch (e) {
        send({
          id: event.id,
          result: {
            contentItems: [
              {
                type: "inputText",
                text: e instanceof Error ? e.message : String(e),
              },
            ],
            success: false,
          },
        });
      }
    } else if (
      event.id !== undefined &&
      event.method?.includes("requestApproval")
    )
      send({ id: event.id, result: { decision: "decline" } });
    else if (event.id !== undefined && event.method === "tool/requestUserInput")
      send({ id: event.id, result: { answers: {} } });
  });
  child.on("error", (e) => fail?.(e));
  child.on("close", (code) => {
    const e = new Error(
      runtimeFailure(
        "Codex",
        `连接已结束${code ? `（退出码 ${code}）` : ""}`,
        reported || stderr(),
      ),
    );
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(e);
    }
    pending.clear();
    fail?.(e);
  });
  try {
    await request("initialize", {
      clientInfo: {
        name: "tadacut",
        title: "TadaCut",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized", params: {} });
    // Newer CLIs also look up the ChatGPT workspace here. When chatgpt.com is
    // slow that lookup times out, yet threads still start and model requests
    // may use another endpoint, so only a confirmed missing login stops us.
    let account: any;
    try {
      account = await request("account/read", { refreshToken: false });
    } catch (e) {
      options.onNotice?.(
        `Codex 账户检查未完成（${String((e as Error).message).replace(/^Codex 协议请求未成功：/, "")}），继续尝试对话`,
      );
    }
    if (account?.requiresOpenaiAuth && !account.account)
      throw new Error(
        "已找到 Codex CLI，但当前 CLI 尚未登录。请在终端运行 codex login，再检测连接。",
      );
    const thread = await request("thread/start", {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: options.system,
      dynamicTools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters,
      })),
    });
    const completed = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const interrupt = () => fail?.(new Error("任务已停止"));
    options.signal.addEventListener("abort", interrupt, { once: true });
    try {
      await request("turn/start", {
        threadId: thread.thread.id,
        input: [{ type: "text", text: options.prompt }],
      });
      await completed;
    } finally {
      options.signal.removeEventListener("abort", interrupt);
    }
    return { usage };
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
    lines.close();
  }
}
async function claude(options: Options) {
  const command = executable("claude");
  if (!command)
    throw new Error(
      "未找到可执行的 Claude Code CLI。请在模型页检测连接，或检查 CLI 路径。",
    );
  const file = path.join(options.cwd, `mcp-${crypto.randomUUID()}.json`);
  const connection = await serveExternalTools(options.tools, options.signal);
  let emitted = "",
    usage = unknownRuntimeUsage();
  try {
    await fs.writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          tadacut: {
            type: "http",
            url: connection.url,
            headers: { Authorization: `Bearer ${connection.token}` },
          },
        },
      }),
      { mode: 0o600, flag: "wx" },
    );
    const { child, stderr } = ownChild(
      command,
      [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--mcp-config",
        file,
        "--tools",
        "",
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__tadacut__*",
        "--append-system-prompt",
        options.system,
      ],
      options,
    );
    const lines = createInterface({ input: child.stdout });
    child.stdin.end(options.prompt);
    let failure: string | undefined;
    lines.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "result")
          usage = reportedRuntimeUsage(event.usage) ?? usage;
        if (event.type === "result" && event.is_error)
          failure = String(event.result || event.subtype || "");
        if (event.type === "assistant")
          for (const block of event.message?.content ?? [])
            if (block.type === "text") {
              options.onText(block.text);
              emitted += block.text;
            }
        if (event.type === "result" && event.result && !emitted)
          options.onText(event.result);
      } catch {}
    });
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        lines.close();
        if (options.signal.aborted) reject(new Error("任务已停止"));
        else if (code === 0 && !failure) resolve();
        else
          reject(
            new Error(
              runtimeFailure(
                "Claude Code",
                `未完成任务${code ? `（退出码 ${code}）` : ""}`,
                failure || stderr(),
              ),
            ),
          );
      });
    });
    return { usage };
  } finally {
    await fs.unlink(file).catch(() => {});
    await connection.close();
  }
}
async function copilot(options: Options) {
  const { CopilotClient, defineTool } = await import("@github/copilot-sdk");
  const client = new CopilotClient();
  let usage = unknownRuntimeUsage();
  try {
    const session = await client.createSession({
      workingDirectory: options.cwd,
      systemMessage: { mode: "replace", content: options.system },
      availableTools: options.tools.map((t) => t.name),
      tools: options.tools.map((t) =>
        defineTool(t.name, {
          description: t.description,
          parameters: t.parameters as any,
          handler: async (args: unknown) => {
            const result = modelToolResult(await t.execute(args));
            return {
              resultType: "success" as const,
              textResultForLlm: result.text,
              binaryResultsForLlm: result.images.map((image) => ({
                type: "image" as const,
                mimeType: image.slice(5, image.indexOf(";")),
                data: image.slice(image.indexOf(",") + 1),
              })),
            };
          },
        }),
      ),
      onPermissionRequest: async () => ({ kind: "reject" as const }),
    });
    const stop = () => void session.abort();
    options.signal.addEventListener("abort", stop, { once: true });
    let emitted = false;
    session.on("assistant.usage", (event) => {
      const reported = reportedRuntimeUsage(event.data);
      if (reported)
        usage = {
          input: (usage.input ?? 0) + reported.input!,
          output: (usage.output ?? 0) + reported.output!,
          reported: true,
        };
    });
    session.on("assistant.message_delta", (event) => {
      emitted = true;
      options.onText(event.data.deltaContent);
    });
    let failure: string | undefined;
    session.on("session.error", (event) => {
      failure = [
        event.data.message,
        event.data.statusCode ? `HTTP ${event.data.statusCode}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    });
    try {
      const response = await session.sendAndWait(
        { prompt: options.prompt },
        15 * 60 * 1000,
      );
      if (failure && !emitted && !response?.data.content)
        throw new Error(failure);
      if (!emitted && response?.data.content)
        options.onText(response.data.content);
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new Error(
        runtimeFailure(
          "Copilot",
          "未完成任务",
          failure || (error instanceof Error ? error.message : String(error)),
        ),
      );
    } finally {
      options.signal.removeEventListener("abort", stop);
      await session.disconnect();
    }
    return { usage };
  } finally {
    await client.stop();
  }
}
