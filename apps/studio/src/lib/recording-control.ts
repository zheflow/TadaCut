import type { StudioAction } from "../../../../packages/platform/src/studio";
export type RecordingAction = Extract<StudioAction, { type: "recording" }>;
let handler: ((action: RecordingAction) => Promise<unknown>) | undefined;
export function registerRecordingControl(next: typeof handler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}
export async function recordingControl(action: RecordingAction) {
  const deadline = Date.now() + 3000;
  while (!handler) {
    if (Date.now() > deadline) throw new Error("录制页面尚未就绪");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return handler(action);
}
