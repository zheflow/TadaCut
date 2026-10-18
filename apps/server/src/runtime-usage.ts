export interface RuntimeUsage {
  input: number | null;
  output: number | null;
  reported: boolean;
}
export const unknownRuntimeUsage = (): RuntimeUsage => ({
  input: null,
  output: null,
  reported: false,
});
/** Only accept actual numeric counters supplied by a runtime. Unknown is never zero. */
export function reportedRuntimeUsage(value: unknown): RuntimeUsage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const input = data.inputTokens ?? data.input_tokens,
    output = data.outputTokens ?? data.output_tokens;
  return typeof input === "number" &&
    Number.isFinite(input) &&
    input >= 0 &&
    typeof output === "number" &&
    Number.isFinite(output) &&
    output >= 0
    ? { input, output, reported: true }
    : null;
}
