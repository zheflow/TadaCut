import crypto from "node:crypto";
import {
  studioActionSchema,
  studioResultSchema,
  type StudioAction,
  type StudioResult,
} from "../../../packages/platform/src/studio";

/** Typed UI requests are acknowledged by the real app; replayed events cannot run twice. */
export class StudioControl {
  private pending = new Map<
    string,
    { projectId: string; clientId?: string; finish(value: StudioResult): void }
  >();
  constructor(private publish: (type: string, data: unknown) => void) {}
  request = (
    projectId: string,
    input: StudioAction,
    signal: AbortSignal,
    clientId?: string,
  ): Promise<StudioResult> => {
    signal.throwIfAborted();
    const action = studioActionSchema.parse(input),
      id = crypto.randomUUID(),
      timeout = action.type === "confirm" ? 180000 : 12000;
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      const abort = () => {
        clean();
        reject(signal.reason ?? new Error("任务已取消"));
      };
      const timer = setTimeout(() => {
        clean();
        resolve({
          status: "error",
          message: "应用界面未响应。请打开 TadaCut 窗口后重试。",
        });
      }, timeout);
      this.pending.set(id, {
        projectId,
        clientId,
        finish: (result) => {
          clean();
          resolve(result);
        },
      });
      signal.addEventListener("abort", abort, { once: true });
      this.publish("studio-action", {
        id,
        projectId,
        clientId,
        action,
        expiresAt: Date.now() + timeout - 1000,
      });
    });
  };
  acknowledge(
    id: string,
    projectId: string,
    value: unknown,
    clientId?: string,
  ) {
    const item = this.pending.get(id);
    if (
      !item ||
      item.projectId !== projectId ||
      (item.clientId && item.clientId !== clientId)
    )
      return false;
    item.finish(studioResultSchema.parse(value));
    return true;
  }
  close() {
    for (const item of [...this.pending.values()])
      item.finish({ status: "error", message: "应用已关闭" });
  }
}
