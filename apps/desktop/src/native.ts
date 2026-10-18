import {
  desktopCapturer,
  systemPreferences,
  session as electronSession,
} from "electron";
import crypto from "node:crypto";
import type {
  AutomationSession,
  ComputerAction,
  DesktopPort,
} from "../../../packages/platform/src/contract";
import {
  assertSession,
  computerActionSchema,
} from "../../../packages/platform/src/validation";
import type { Window as NativeWindow } from "@nut-tree-fork/nut-js";
type Nut = typeof import("@nut-tree-fork/nut-js");
// nut-js 4.2.6 exposes a numeric native handle internally. This small pinned shim
// matches Electron's window ID and avoids ambiguous title matching.
const nativeId = (window: NativeWindow) =>
  String((window as unknown as { windowHandle: number }).windowHandle);
export function createDesktopPort(): DesktopPort {
  let module: Promise<Nut> | undefined,
    selectedSource = "";
  const load = () => (module ??= import("@nut-tree-fork/nut-js"));
  const windows = new Map<string, NativeWindow>(),
    sessions = new Map<string, AutomationSession>();
  const clicks = new Map<string, { at: number; x: number; y: number }[]>();
  let actionQueue = Promise.resolve();
  electronSession.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sourceId = selectedSource;
        selectedSource = "";
        if (!sourceId) return callback({});
        const source = (
          await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 1, height: 1 },
          })
        ).find((s) => s.id === sourceId);
        callback(
          source
            ? {
                video: source,
                ...(request.audioRequested
                  ? { audio: "loopback" as const }
                  : {}),
              }
            : {},
        );
      } catch {
        callback({});
      }
    },
  );
  async function selected(id: string) {
    const grant = sessions.get(id);
    assertSession(grant, Date.now());
    const window = windows.get(grant!.windowId);
    if (!window) throw new Error("目标窗口已关闭");
    const current = await load();
    const found = (await current.getWindows()).some(
      (w) => nativeId(w) === grant!.windowId,
    );
    if (!found) {
      sessions.delete(id);
      throw new Error("目标窗口已关闭");
    }
    return { grant: grant!, window, current };
  }
  return {
    async status() {
      let automation = true;
      try {
        await load();
      } catch {
        automation = false;
      }
      return {
        platform: process.platform,
        screen:
          process.platform !== "darwin" ||
          systemPreferences.getMediaAccessStatus("screen") === "granted",
        microphone:
          process.platform !== "darwin" ||
          systemPreferences.getMediaAccessStatus("microphone") === "granted",
        accessibility:
          process.platform !== "darwin" ||
          systemPreferences.isTrustedAccessibilityClient(false),
        automation,
      };
    },
    async sources() {
      return (
        await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 420, height: 260 },
        })
      ).map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
    },
    async selectSource(id) {
      if (
        !(
          await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 1, height: 1 },
          })
        ).some((s) => s.id === id)
      )
        throw new Error("录制来源已关闭");
      selectedSource = id;
    },
    async windows() {
      const current = await load();
      const result = [];
      for (const window of await current.getWindows()) {
        try {
          const title = await window.title,
            region = await window.region,
            id = nativeId(window);
          if (!title || region.width < 40 || region.height < 40) continue;
          windows.set(id, window);
          result.push({
            id,
            title,
            width: region.width,
            height: region.height,
          });
        } catch {}
      }
      return result;
    },
    async startSession(windowId) {
      if (
        process.platform === "darwin" &&
        !systemPreferences.isTrustedAccessibilityClient(false)
      ) {
        systemPreferences.isTrustedAccessibilityClient(true);
        throw new Error(
          "请在系统设置中允许 TadaCut 的辅助功能权限，然后重新开始会话",
        );
      }
      const window = windows.get(windowId);
      if (!window) throw new Error("请先刷新并选择目标窗口");
      const grant = {
        id: crypto.randomUUID(),
        windowId,
        title: await window.title,
        startedAt: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000,
      };
      sessions.set(grant.id, grant);
      clicks.set(grant.id, []);
      return grant;
    },
    async endSession(id) {
      sessions.delete(id);
    },
    async clicks(id, since) {
      if (!clicks.has(id)) throw new Error("应用会话不存在");
      return clicks
        .get(id)!
        .filter((c) => c.at >= since)
        .map((c) => ({ time: (c.at - since) / 1000, x: c.x, y: c.y }));
    },
    async action(id, input) {
      const action = computerActionSchema.parse(input) as ComputerAction;
      const operation = actionQueue.then(async () => {
        const { window, grant, current } = await selected(id);
        if (!(await window.focus())) throw new Error("无法激活目标窗口");
        if (nativeId(await current.getActiveWindow()) !== grant.windowId)
          throw new Error("目标窗口没有获得焦点，操作已停止");
        if (action.type === "click") {
          const region = await window.region;
          await current.mouse.setPosition(
            new current.Point(
              Math.round(region.left + action.x * (region.width - 1)),
              Math.round(region.top + action.y * (region.height - 1)),
            ),
          );
          await current.mouse.click(
            action.button === "right"
              ? current.Button.RIGHT
              : current.Button.LEFT,
          );
          clicks.get(id)?.push({ at: Date.now(), x: action.x, y: action.y });
        } else if (action.type === "type")
          await current.keyboard.type(action.text);
        else if (action.type === "scroll") {
          const region = await window.region;
          await current.mouse.setPosition(
            new current.Point(
              Math.round(region.left + region.width / 2),
              Math.round(region.top + region.height / 2),
            ),
          );
          await (action.direction === "up"
            ? current.mouse.scrollUp(action.amount)
            : current.mouse.scrollDown(action.amount));
        } else {
          const keys = {
            Enter: current.Key.Return,
            Escape: current.Key.Escape,
            Tab: current.Key.Tab,
            Backspace: current.Key.Backspace,
            ArrowUp: current.Key.Up,
            ArrowDown: current.Key.Down,
            ArrowLeft: current.Key.Left,
            ArrowRight: current.Key.Right,
          };
          await current.keyboard.type(keys[action.key]);
        }
      });
      actionQueue = operation.catch(() => {});
      await operation;
    },
    async screenshot(id) {
      const { grant } = await selected(id);
      const source = (
        await desktopCapturer.getSources({
          types: ["window"],
          thumbnailSize: { width: 1440, height: 1000 },
        })
      ).find((s) => s.id.split(":")[1] === grant.windowId);
      if (!source || source.thumbnail.isEmpty())
        throw new Error("无法读取授权窗口，请检查屏幕录制权限");
      const size = source.thumbnail.getSize();
      return {
        image:
          "data:image/jpeg;base64," +
          source.thumbnail.toJPEG(85).toString("base64"),
        ...size,
      };
    },
  };
}
