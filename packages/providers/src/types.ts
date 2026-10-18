import { z } from "zod";
export const capabilities = [
  "chat",
  "embedding",
  "image",
  "video",
  "speech",
  "transcription",
  "music",
  "voice-clone",
  "sfx",
  "voice-isolation",
  "video-matte",
  "video-inpaint",
  "video-upscale",
  "avatar",
  "lip-sync",
  "ref-video",
  "image-edit",
  "stock",
  "web",
  "publish",
  "storage",
] as const;
export type Capability = (typeof capabilities)[number];
export const providerKinds = [
  "openai",
  "compatible",
  "ollama",
  "anthropic",
  "elevenlabs",
  "custom",
  "fal",
  "pexels",
  "pixabay",
  "freesound",
  "firecrawl",
  "jina",
  "searxng",
  "upload-post",
  "s3",
] as const;
/** Settings that are not secrets, such as a bucket name or a publishing profile. Secrets stay in the vault. */
export const providerOptionKeys = [
  "bucket",
  "region",
  "accessKeyId",
  "pathStyle",
  "publicBaseUrl",
  "prefix",
  "user",
  "platforms",
  "readerUrl",
  "language",
] as const;
export const providerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    kind: z.enum(providerKinds),
    baseUrl: z
      .string()
      .url()
      .refine(
        (u) =>
          ["http:", "https:"].includes(new URL(u).protocol) &&
          !new URL(u).username &&
          !new URL(u).password,
        "仅支持 HTTP/HTTPS 服务",
      ),
    model: z.string().default(""),
    enabled: z.boolean().default(true),
    capabilities: z.array(z.enum(capabilities)).default(["chat"]),
    models: z.record(z.enum(capabilities), z.string()).default({}),
    routes: z
      .record(
        z.enum(capabilities),
        z.object({
          path: z.string().startsWith("/"),
          method: z.enum(["POST", "GET"]).default("POST"),
          body: z.record(z.unknown()).optional(),
          resultPath: z.string().optional(),
          pollPath: z.string().optional(),
        }),
      )
      .default({}),
    options: z
      .record(z.enum(providerOptionKeys), z.string().max(500))
      .default({}),
  })
  .strict();
export type Provider = z.infer<typeof providerSchema>;
export type PublicProvider = Provider & {
  hasKey: boolean;
  /** A key is saved but the vault cannot open it on this launch. */
  keyUnreadable?: boolean;
};
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  images?: string[];
  /** Host-generated feedback must not be learned as a user preference. */
  synthetic?: "feedback" | "summary";
}
export interface Completion {
  text: string;
  calls: ToolCall[];
  usage: { input: number; output: number; reported?: boolean };
  /** The reply stopped at the output limit rather than finishing. */
  truncated?: boolean;
}
export interface ProviderContext {
  provider: Provider;
  apiKey: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}
export function endpoint(base: string, path: string) {
  return base.replace(/\/$/, "") + path;
}
export function headers(ctx: ProviderContext): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const kind = ctx.provider.kind;
  // Pixabay takes its key in the query; S3 signs each request.
  if (ctx.apiKey && kind !== "pixabay" && kind !== "s3")
    headers[
      kind === "anthropic"
        ? "x-api-key"
        : kind === "elevenlabs"
          ? "xi-api-key"
          : "Authorization"
    ] =
      kind === "anthropic" || kind === "elevenlabs" || kind === "pexels"
        ? ctx.apiKey
        : kind === "fal"
          ? `Key ${ctx.apiKey}`
          : kind === "freesound"
            ? `Token ${ctx.apiKey}`
            : kind === "upload-post"
              ? `Apikey ${ctx.apiKey}`
              : `Bearer ${ctx.apiKey}`;
  if (ctx.provider.kind === "anthropic")
    headers["anthropic-version"] = "2023-06-01";
  return headers;
}
/** A service's own explanation, short and without the caller's key. */
export function serviceDetail(value: unknown, apiKey?: string): string {
  const pick = (v: any): unknown =>
    typeof v === "string"
      ? v
      : v && typeof v === "object"
        ? (pick(v.error) ?? pick(v.message) ?? pick(v.detail) ?? pick(v.msg))
        : undefined;
  const found = pick(value);
  if (typeof found !== "string" || !found.trim()) return "";
  let text = found;
  if (apiKey && apiKey.length >= 8) text = text.split(apiKey).join("***");
  text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return text.length > 300 ? text.slice(0, 300) + "…" : text;
}
const statusHint = (status: number) =>
  status === 401 || status === 403
    ? "凭据无效或没有权限"
    : status === 404
      ? "地址、路径或模型不存在"
      : status === 429
        ? "额度用尽或请求过于频繁"
        : status >= 500
          ? "服务端或中间的代理暂时出错"
          : "请检查地址、模型和参数";
export async function checkedFetch(
  ctx: ProviderContext,
  path: string,
  init: RequestInit = {},
) {
  const response = await (ctx.fetcher ?? fetch)(
    endpoint(ctx.provider.baseUrl, path),
    { ...init, signal: ctx.signal },
  );
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 8192);
    } catch {}
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body);
    } catch {}
    const detail = serviceDetail(parsed, ctx.apiKey);
    throw new Error(
      `服务返回 HTTP ${response.status}（${statusHint(response.status)}）${detail ? "：" + detail : "。"}`,
    );
  }
  return response;
}
export async function listModels(ctx: ProviderContext): Promise<string[]> {
  const route =
    ctx.provider.kind === "ollama"
      ? ctx.provider.baseUrl.endsWith("/v1")
        ? "/models"
        : "/api/tags"
      : "/models";
  const value = (await (
    await checkedFetch(ctx, route, { headers: headers(ctx) })
  ).json()) as { data?: { id: string }[]; models?: { name: string }[] };
  return value.data?.map((m) => m.id) ?? value.models?.map((m) => m.name) ?? [];
}
export async function embedTexts(
  ctx: ProviderContext,
  texts: string[],
): Promise<number[][]> {
  const model = ctx.provider.models.embedding || ctx.provider.model;
  const native =
    ctx.provider.kind === "ollama" && !ctx.provider.baseUrl.endsWith("/v1");
  const result = (await (
    await checkedFetch(ctx, native ? "/api/embed" : "/embeddings", {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({ model, input: texts }),
    })
  ).json()) as {
    embeddings?: number[][];
    data?: { index: number; embedding: number[] }[];
  };
  const values =
    result.embeddings ??
    result.data?.sort((a, b) => a.index - b.index).map((x) => x.embedding);
  if (
    !values ||
    values.length !== texts.length ||
    values.some((v) => !v.length || v.some((x) => !Number.isFinite(x)))
  )
    throw new Error("服务没有返回有效 embedding");
  return values;
}
