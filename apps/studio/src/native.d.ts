import type { DesktopBridge } from "../../../packages/platform/src/contract";
declare global {
  interface Window {
    tadacut?: DesktopBridge;
  }
}
export {};
