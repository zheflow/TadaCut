import { z } from "zod";
export const computerActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("click"),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      button: z.enum(["left", "right"]).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("type"), text: z.string().min(1).max(10000) })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      key: z.enum([
        "Enter",
        "Escape",
        "Tab",
        "Backspace",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      direction: z.enum(["up", "down"]),
      amount: z.number().int().min(1).max(20),
    })
    .strict(),
]);
export function assertSession(
  session: { expiresAt: number } | undefined,
  now: number,
) {
  if (!session || session.expiresAt <= now)
    throw new Error("应用操作会话已结束，请重新选择窗口");
}
