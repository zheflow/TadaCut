import { toolResultText } from "./runner";

/** Never put encoded image bytes into a language-model text result. */
export function modelToolResult(output: unknown) {
  const object =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : undefined;
  const { _image, _images, ...plain } = object ?? {};
  const images = [
    ...(_image ? [_image] : []),
    ...(Array.isArray(_images) ? _images : []),
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        /^data:image\/[a-z0-9.+-]+;base64,/i.test(value),
    )
    .slice(0, 6);
  return { text: toolResultText(object ? plain : output), images };
}
