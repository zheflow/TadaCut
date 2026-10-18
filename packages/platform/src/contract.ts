export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
}
export interface AutomationWindow {
  id: string;
  title: string;
  width: number;
  height: number;
}
export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "type"; text: string }
  | {
      type: "key";
      key:
        | "Enter"
        | "Escape"
        | "Tab"
        | "Backspace"
        | "ArrowUp"
        | "ArrowDown"
        | "ArrowLeft"
        | "ArrowRight";
    }
  | { type: "scroll"; direction: "up" | "down"; amount: number };
export interface AutomationSession {
  id: string;
  windowId: string;
  title: string;
  startedAt: number;
  expiresAt: number;
}
export interface DesktopPort {
  status(): Promise<{
    platform: string;
    screen: boolean;
    microphone: boolean;
    accessibility: boolean;
    automation: boolean;
  }>;
  sources(): Promise<CaptureSource[]>;
  selectSource(id: string): Promise<void>;
  windows(): Promise<AutomationWindow[]>;
  startSession(windowId: string): Promise<AutomationSession>;
  endSession(id: string): Promise<void>;
  action(id: string, action: ComputerAction): Promise<void>;
  screenshot(
    id: string,
  ): Promise<{ image: string; width: number; height: number }>;
  clicks(
    id: string,
    since: number,
  ): Promise<{ time: number; x: number; y: number }[]>;
}
export interface DesktopBridge extends DesktopPort {
  platform: string;
  openExternal(url: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  openDataDirectory(): Promise<void>;
  /** Native menus, scrollbars and the window background follow the studio theme. */
  setTheme(theme: "system" | "light" | "dark"): Promise<void>;
}
