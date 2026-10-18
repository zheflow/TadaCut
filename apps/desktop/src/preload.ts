import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../../../packages/platform/src/contract";
const invoke = (method: string, ...args: unknown[]) =>
  ipcRenderer.invoke("tadacut:" + method, ...args);
const bridge: DesktopBridge = {
  platform: process.platform,
  status: () => invoke("status"),
  sources: () => invoke("sources"),
  selectSource: (id) => invoke("selectSource", id),
  windows: () => invoke("windows"),
  startSession: (id) => invoke("startSession", id),
  endSession: (id) => invoke("endSession", id),
  action: (id, action) => invoke("action", id, action),
  screenshot: (id) => invoke("screenshot", id),
  clicks: (id, since) => invoke("clicks", id, since),
  openExternal: (url) => invoke("openExternal", url),
  chooseDirectory: () => invoke("chooseDirectory"),
  openDataDirectory: () => invoke("openDataDirectory"),
  setTheme: (theme) => invoke("setTheme", theme),
};
contextBridge.exposeInMainWorld("tadacut", bridge);
