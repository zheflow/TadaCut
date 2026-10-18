import crypto from "node:crypto";
import { checkedFetch, endpoint, headers, type ProviderContext } from "./types";
import type { GeneratedMedia } from "./media";

/**
 * Adapters for non-chat services: online media libraries, web search and
 * reading, social publishing, S3-compatible storage and fal.ai's queue.
 * Each one only talks to the service the user configured, with the key from
 * the vault, and reports clearly when a service cannot do what was asked.
 */
const getPath = (v: any, path: string) =>
  path.split(".").reduce((a, k) => a?.[k], v);
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
const query = (values: Record<string, string | number | undefined>) =>
  Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");

export interface StockItem {
  id: string;
  title: string;
  kind: "image" | "video" | "audio";
  previewUrl: string;
  downloadUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  author?: string;
  license: string;
  sourceUrl?: string;
  provider: string;
}
/** Searches the configured media library. */
export async function searchStock(
  ctx: ProviderContext,
  options: {
    query: string;
    kind: "image" | "video" | "audio";
    page?: number;
    perPage?: number;
    orientation?: "landscape" | "portrait" | "square";
  },
): Promise<StockItem[]> {
  const per = Math.max(1, Math.min(50, options.perPage ?? 20)),
    page = Math.max(1, options.page ?? 1),
    name = ctx.provider.name;
  switch (ctx.provider.kind) {
    case "pexels": {
      if (options.kind === "audio") throw new Error("Pexels 不提供音频素材");
      if (options.kind === "image") {
        const value = (await (
          await checkedFetch(
            ctx,
            `/v1/search?${query({ query: options.query, per_page: per, page, orientation: options.orientation })}`,
            { headers: headers(ctx) },
          )
        ).json()) as any;
        return (value.photos ?? []).map(
          (p: any): StockItem => ({
            id: `pexels-photo-${p.id}`,
            title: p.alt || `Pexels ${p.id}`,
            kind: "image",
            previewUrl: p.src?.medium ?? p.src?.small,
            downloadUrl: p.src?.large2x ?? p.src?.original,
            width: p.width,
            height: p.height,
            author: p.photographer,
            license: "Pexels License",
            sourceUrl: p.url,
            provider: name,
          }),
        );
      }
      const value = (await (
        await checkedFetch(
          ctx,
          `/videos/search?${query({ query: options.query, per_page: per, page, orientation: options.orientation })}`,
          { headers: headers(ctx) },
        )
      ).json()) as any;
      return (value.videos ?? []).flatMap((v: any): StockItem[] => {
        // The largest file up to 1080p keeps downloads reasonable.
        const files = [...(v.video_files ?? [])]
          .filter((f: any) => f.file_type === "video/mp4" && f.link)
          .sort((a: any, b: any) => (b.height ?? 0) - (a.height ?? 0));
        const file =
          files.find((f: any) => (f.height ?? 0) <= 1080) ?? files.at(-1);
        return file
          ? [
              {
                id: `pexels-video-${v.id}`,
                title: `Pexels 视频 ${v.id}`,
                kind: "video",
                previewUrl: v.image,
                downloadUrl: file.link,
                width: file.width ?? v.width,
                height: file.height ?? v.height,
                duration: v.duration,
                author: v.user?.name,
                license: "Pexels License",
                sourceUrl: v.url,
                provider: name,
              },
            ]
          : [];
      });
    }
    case "pixabay": {
      if (options.kind === "audio")
        throw new Error("Pixabay 接口不提供音频检索");
      const path = options.kind === "video" ? "/videos/" : "/";
      const value = (await (
        await checkedFetch(
          ctx,
          `${path}?${query({
            key: ctx.apiKey,
            q: options.query,
            per_page: Math.max(3, per),
            page,
            safesearch: "true",
            ...(options.kind === "image"
              ? {
                  orientation:
                    options.orientation === "portrait"
                      ? "vertical"
                      : options.orientation === "landscape"
                        ? "horizontal"
                        : undefined,
                }
              : {}),
          })}`,
          { headers: headers(ctx) },
        )
      ).json()) as any;
      return (value.hits ?? []).flatMap((h: any): StockItem[] => {
        if (options.kind === "video") {
          const file = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
          if (!file?.url) return [];
          return [
            {
              id: `pixabay-video-${h.id}`,
              title: h.tags || `Pixabay ${h.id}`,
              kind: "video",
              previewUrl: h.videos?.tiny?.thumbnail ?? file.thumbnail ?? "",
              downloadUrl: file.url,
              width: file.width,
              height: file.height,
              duration: h.duration,
              author: h.user,
              license: "Pixabay Content License",
              sourceUrl: h.pageURL,
              provider: name,
            },
          ];
        }
        return [
          {
            id: `pixabay-image-${h.id}`,
            title: h.tags || `Pixabay ${h.id}`,
            kind: "image",
            previewUrl: h.webformatURL,
            downloadUrl: h.largeImageURL ?? h.webformatURL,
            width: h.imageWidth,
            height: h.imageHeight,
            author: h.user,
            license: "Pixabay Content License",
            sourceUrl: h.pageURL,
            provider: name,
          },
        ];
      });
    }
    case "freesound": {
      if (options.kind !== "audio") throw new Error("Freesound 只提供音频");
      const value = (await (
        await checkedFetch(
          ctx,
          `/search/text/?${query({
            query: options.query,
            page,
            page_size: per,
            fields: "id,name,previews,duration,license,username,url",
          })}`,
          { headers: headers(ctx) },
        )
      ).json()) as any;
      return (value.results ?? []).map(
        (r: any): StockItem => ({
          id: `freesound-${r.id}`,
          title: r.name,
          kind: "audio",
          previewUrl:
            r.previews?.["preview-lq-mp3"] ?? r.previews?.["preview-hq-mp3"],
          downloadUrl: r.previews?.["preview-hq-mp3"],
          duration: r.duration,
          author: r.username,
          license: r.license,
          sourceUrl: r.url,
          provider: name,
        }),
      );
    }
    default:
      throw new Error("这个供应商不是在线素材库");
  }
}

export interface WebResult {
  url: string;
  title: string;
  snippet: string;
}
/** Web search through Firecrawl, Jina or a SearXNG instance. */
export async function webSearch(
  ctx: ProviderContext,
  q: string,
  limit = 8,
): Promise<WebResult[]> {
  const n = Math.max(1, Math.min(20, limit));
  switch (ctx.provider.kind) {
    case "firecrawl": {
      const value = (await (
        await checkedFetch(ctx, "/v1/search", {
          method: "POST",
          headers: headers(ctx),
          body: JSON.stringify({ query: q, limit: n }),
        })
      ).json()) as any;
      return (value.data ?? []).slice(0, n).map((r: any) => ({
        url: r.url,
        title: r.title ?? r.metadata?.title ?? r.url,
        snippet: r.description ?? r.markdown?.slice(0, 300) ?? "",
      }));
    }
    case "jina": {
      const value = (await (
        await checkedFetch(ctx, `/?${query({ q })}`, {
          headers: { ...headers(ctx), Accept: "application/json" },
        })
      ).json()) as any;
      return (value.data ?? []).slice(0, n).map((r: any) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.description ?? r.content?.slice(0, 300) ?? "",
      }));
    }
    case "searxng": {
      const value = (await (
        await checkedFetch(
          ctx,
          `/search?${query({ q, format: "json", language: ctx.provider.options.language })}`,
          { headers: headers(ctx) },
        )
      ).json()) as any;
      return (value.results ?? []).slice(0, n).map((r: any) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.content ?? "",
      }));
    }
    default:
      throw new Error("这个供应商不提供网页搜索");
  }
}
/** A page as Markdown, read by Firecrawl or Jina Reader. Returns null when the service cannot read pages. */
export async function readPage(
  ctx: ProviderContext,
  url: string,
): Promise<{ url: string; title: string; markdown: string } | null> {
  if (ctx.provider.kind === "firecrawl") {
    const value = (await (
      await checkedFetch(ctx, "/v1/scrape", {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      })
    ).json()) as any;
    return {
      url,
      title: value.data?.metadata?.title ?? url,
      markdown: value.data?.markdown ?? "",
    };
  }
  if (ctx.provider.kind === "jina") {
    const reader = ctx.provider.options.readerUrl || "https://r.jina.ai";
    const response = await (ctx.fetcher ?? fetch)(
      `${reader.replace(/\/$/, "")}/${url}`,
      {
        headers: { ...headers(ctx), Accept: "application/json" },
        signal: ctx.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`阅读服务返回 HTTP ${response.status}`);
    }
    const value = (await response.json()) as any;
    return {
      url,
      title: value.data?.title ?? url,
      markdown: value.data?.content ?? "",
    };
  }
  return null;
}
/** Links on a site, from Firecrawl's map. Returns null when the service has no site map. */
export async function mapSite(ctx: ProviderContext, url: string, limit = 200) {
  if (ctx.provider.kind !== "firecrawl") return null;
  const value = (await (
    await checkedFetch(ctx, "/v1/map", {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({ url, limit }),
    })
  ).json()) as any;
  return ((value.links ?? []) as unknown[])
    .map((l) => (typeof l === "string" ? l : (l as any)?.url))
    .filter((l): l is string => typeof l === "string")
    .slice(0, limit);
}

/** Publishes a video through Upload-Post. Callers must have the user's confirmation first. */
export async function publishVideo(
  ctx: ProviderContext,
  video: { bytes: Uint8Array; name: string; mime: string },
  options: {
    title: string;
    description?: string;
    platforms: string[];
    user?: string;
  },
) {
  if (ctx.provider.kind !== "upload-post")
    throw new Error("这个供应商不是发布服务");
  const user = options.user || ctx.provider.options.user;
  if (!user) throw new Error("请在发布服务里填写账号档案名称（user）");
  if (!options.platforms.length) throw new Error("请选择至少一个平台");
  const form = new FormData();
  form.append("user", user);
  form.append("title", options.title);
  if (options.description) form.append("description", options.description);
  for (const platform of options.platforms) form.append("platform[]", platform);
  form.append(
    "video",
    new Blob([new Uint8Array(video.bytes)], { type: video.mime }),
    video.name,
  );
  const h = headers(ctx);
  delete h["Content-Type"];
  return (await (
    await checkedFetch(ctx, "/api/upload", {
      method: "POST",
      headers: h,
      body: form,
    })
  ).json()) as Record<string, unknown>;
}

const rfc3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
const sha256 = (data: string | Uint8Array) =>
  crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: crypto.BinaryLike, data: string) =>
  crypto.createHmac("sha256", key).update(data, "utf8").digest();
/** Where an object lives and how to sign for it, from the provider's options. */
function s3Target(ctx: ProviderContext, key: string) {
  const {
    bucket,
    region = "us-east-1",
    accessKeyId,
    pathStyle,
    prefix,
  } = ctx.provider.options;
  if (!bucket || !accessKeyId || !ctx.apiKey)
    throw new Error("请填写存储桶、Access Key ID 和 Secret Access Key");
  const base = new URL(ctx.provider.baseUrl),
    path = (prefix ? `${prefix.replace(/\/+$/, "")}/` : "") + key,
    encoded = path.split("/").map(rfc3986).join("/"),
    pathStyled = pathStyle !== "false",
    host = pathStyled ? base.host : `${bucket}.${base.host}`,
    root = base.pathname.replace(/\/$/, "");
  return {
    region,
    accessKeyId,
    host,
    origin: `${base.protocol}//${host}`,
    uri: pathStyled
      ? `${root}/${rfc3986(bucket)}/${encoded}`
      : `${root}/${encoded}`,
    path,
  };
}
const stamp = (now: Date) => {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, date: iso.slice(0, 8) };
};
function signature(
  secret: string,
  date: string,
  region: string,
  stringToSign: string,
) {
  const key = hmac(
    hmac(hmac(hmac("AWS4" + secret, date), region), "s3"),
    "aws4_request",
  );
  return crypto
    .createHmac("sha256", key)
    .update(stringToSign, "utf8")
    .digest("hex");
}
/** Uploads bytes to S3-compatible storage with a SigV4-signed PUT. */
export async function s3Put(
  ctx: ProviderContext,
  key: string,
  body: Uint8Array,
  contentType: string,
  now = new Date(),
) {
  const target = s3Target(ctx, key),
    { amzDate, date } = stamp(now),
    payload = sha256(body),
    scope = `${date}/${target.region}/s3/aws4_request`,
    signed: Record<string, string> = {
      "content-type": contentType,
      host: target.host,
      "x-amz-content-sha256": payload,
      "x-amz-date": amzDate,
    },
    names = Object.keys(signed).sort(),
    canonical = [
      "PUT",
      target.uri,
      "",
      names.map((n) => `${n}:${signed[n].trim()}\n`).join(""),
      names.join(";"),
      payload,
    ].join("\n"),
    toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const response = await (ctx.fetcher ?? fetch)(target.origin + target.uri, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payload,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature(ctx.apiKey, date, target.region, toSign)}`,
    },
    body: new Uint8Array(body),
    signal: ctx.signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `存储服务返回 HTTP ${response.status}，请检查存储桶、区域和凭据`,
    );
  }
  return { key: target.path };
}
/** A time-limited URL anyone can read the object from, for services that fetch inputs by URL. */
export function s3PresignGet(
  ctx: ProviderContext,
  key: string,
  expires = 3600,
  now = new Date(),
) {
  const publicBase = ctx.provider.options.publicBaseUrl;
  const target = s3Target(ctx, key);
  if (publicBase)
    return `${publicBase.replace(/\/$/, "")}/${target.path.split("/").map(rfc3986).join("/")}`;
  const { amzDate, date } = stamp(now),
    scope = `${date}/${target.region}/s3/aws4_request`,
    params: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${target.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(
        Math.max(1, Math.min(604800, Math.round(expires))),
      ),
      "X-Amz-SignedHeaders": "host",
    },
    canonicalQuery = Object.keys(params)
      .sort()
      .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
      .join("&"),
    canonical = [
      "GET",
      target.uri,
      canonicalQuery,
      `host:${target.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n"),
    toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  return `${target.origin}${target.uri}?${canonicalQuery}&X-Amz-Signature=${signature(ctx.apiKey, date, target.region, toSign)}`;
}

/** Common places a media URL appears in generation results. */
const mediaUrl = (value: any): string | undefined =>
  [
    value?.video?.url,
    value?.audio?.url,
    value?.audio_file?.url,
    value?.image?.url,
    value?.images?.[0]?.url,
    value?.output?.url,
    value?.url,
    typeof value?.output === "string" ? value.output : undefined,
  ].find((u): u is string => typeof u === "string");
/**
 * Runs a model on fal.ai's queue: submit, poll the status until it
 * completes, then fetch the result. The model ID is the provider's model for
 * the capability.
 */
export async function falRun(
  ctx: ProviderContext,
  model: string,
  input: Record<string, unknown>,
  onProgress: (value: number) => void = () => {},
  resultPath?: string,
): Promise<{ url: string; raw: unknown }> {
  if (!model) throw new Error("请为这个能力填写 fal 模型 ID");
  const submitted = (await (
    await checkedFetch(ctx, `/${model}`, {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify(input),
    })
  ).json()) as any;
  const statusUrl: string | undefined = submitted.status_url,
    responseUrl: string | undefined = submitted.response_url;
  if (!statusUrl || !responseUrl) {
    const url = resultPath
      ? getPath(submitted, resultPath)
      : mediaUrl(submitted);
    if (typeof url === "string") return { url, raw: submitted };
    throw new Error("fal 没有返回任务地址");
  }
  // Status and result URLs must stay on the configured service.
  const allowed = new URL(ctx.provider.baseUrl).host;
  for (const u of [statusUrl, responseUrl])
    if (new URL(u).host !== allowed)
      throw new Error("fal 返回了其他域名的地址");
  const deadline = Date.now() + 20 * 60 * 1000;
  for (let tick = 0; ; tick++) {
    ctx.signal.throwIfAborted();
    if (Date.now() > deadline) throw new Error("生成任务超时");
    const status = (await (
      await (ctx.fetcher ?? fetch)(statusUrl, {
        headers: headers(ctx),
        signal: ctx.signal,
      })
    ).json()) as any;
    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED" || status.error)
      throw new Error(
        `生成失败：${String(status.error ?? "服务没有给出原因").slice(0, 300)}`,
      );
    onProgress(Math.min(90, 5 + tick * 3));
    await wait(2000, ctx.signal);
  }
  const result = (await (
    await (ctx.fetcher ?? fetch)(responseUrl, {
      headers: headers(ctx),
      signal: ctx.signal,
    })
  ).json()) as any;
  const url = resultPath ? getPath(result, resultPath) : mediaUrl(result);
  if (typeof url !== "string") throw new Error("生成结果里没有媒体地址");
  return { url, raw: result };
}
const toDataUri = (bytes: Uint8Array, mime: string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
/** Sound effect from a description. */
export async function generateSfx(
  ctx: ProviderContext,
  prompt: string,
  duration: number | undefined,
  onProgress: (value: number) => void = () => {},
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes.sfx;
  if (ctx.provider.kind === "elevenlabs") {
    const response = await checkedFetch(
      ctx,
      route?.path ?? "/sound-generation",
      {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({
          ...route?.body,
          text: prompt,
          ...(duration
            ? { duration_seconds: Math.max(0.5, Math.min(22, duration)) }
            : {}),
        }),
      },
    );
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: response.headers.get("content-type") || "audio/mpeg",
    };
  }
  if (ctx.provider.kind === "fal") {
    const { url } = await falRun(
      ctx,
      ctx.provider.models.sfx ?? "",
      { ...route?.body, prompt, ...(duration ? { duration } : {}) },
      onProgress,
      route?.resultPath,
    );
    return { url, mime: "audio/mpeg" };
  }
  if (!route) throw new Error("请在供应商高级设置中配置音效生成接口");
  const value = (await (
    await checkedFetch(ctx, route.path, {
      method: route.method,
      headers: headers(ctx),
      body: JSON.stringify({ ...route.body, prompt, duration }),
    })
  ).json()) as any;
  const url = route.resultPath
    ? getPath(value, route.resultPath)
    : mediaUrl(value);
  if (typeof url !== "string") throw new Error("音效服务没有返回音频");
  return { url, mime: "audio/mpeg" };
}
/** Speech separated from music and noise. */
export async function isolateVoice(
  ctx: ProviderContext,
  audio: { bytes: Uint8Array; name: string; mime: string },
  onProgress: (value: number) => void = () => {},
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes["voice-isolation"];
  if (ctx.provider.kind === "fal") {
    const { url } = await falRun(
      ctx,
      ctx.provider.models["voice-isolation"] ?? "",
      { ...route?.body, audio_url: toDataUri(audio.bytes, audio.mime) },
      onProgress,
      route?.resultPath,
    );
    return { url, mime: "audio/wav" };
  }
  if (ctx.provider.kind !== "elevenlabs" && !route)
    throw new Error("请在供应商高级设置中配置人声分离接口");
  const form = new FormData();
  form.append(
    "audio",
    new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }),
    audio.name,
  );
  const h = headers(ctx);
  delete h["Content-Type"];
  const response = await checkedFetch(ctx, route?.path ?? "/audio-isolation", {
    method: "POST",
    headers: h,
    body: form,
  });
  const type = response.headers.get("content-type") || "";
  if (type.includes("json")) {
    const value = (await response.json()) as any;
    const url = route?.resultPath
      ? getPath(value, route.resultPath)
      : mediaUrl(value);
    if (typeof url !== "string") throw new Error("人声分离服务没有返回音频");
    return { url, mime: "audio/wav" };
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime: type || "audio/mpeg",
  };
}
/**
 * Video from a reference image and a prompt. The image goes as a file to
 * OpenAI-style services, and as a URL (a presigned storage URL when given,
 * else a data URI) to the others.
 */
export async function generateReferenceVideo(
  ctx: ProviderContext,
  prompt: string,
  image: { bytes: Uint8Array; mime: string; url?: string },
  duration: number,
  onProgress: (value: number) => void = () => {},
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes["ref-video"],
    imageUrl = image.url ?? toDataUri(image.bytes, image.mime);
  if (ctx.provider.kind === "fal") {
    const { url } = await falRun(
      ctx,
      ctx.provider.models["ref-video"] ?? "",
      { ...route?.body, prompt, image_url: imageUrl, duration },
      onProgress,
      route?.resultPath,
    );
    return { url, mime: "video/mp4" };
  }
  if (ctx.provider.kind === "openai") {
    const form = new FormData();
    form.append(
      "model",
      ctx.provider.models["ref-video"] ||
        ctx.provider.models.video ||
        ctx.provider.model,
    );
    form.append("prompt", prompt);
    form.append("seconds", String(duration));
    form.append(
      "input_reference",
      new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
      "reference.jpg",
    );
    const h = headers(ctx);
    delete h["Content-Type"];
    let result = (await (
      await checkedFetch(ctx, route?.path ?? "/videos", {
        method: "POST",
        headers: h,
        body: form,
      })
    ).json()) as any;
    const id = result.id;
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!["completed", "succeeded"].includes(result.status)) {
      if (["failed", "error", "cancelled"].includes(result.status))
        throw new Error("生成服务未完成任务");
      if (Date.now() > deadline) throw new Error("生成任务超时");
      onProgress(Number(result.progress ?? 0));
      await wait(2000, ctx.signal);
      result = await (
        await checkedFetch(ctx, `/videos/${encodeURIComponent(id)}`, {
          headers: headers(ctx),
        })
      ).json();
    }
    const data = await checkedFetch(
      ctx,
      `/videos/${encodeURIComponent(id)}/content`,
      {
        headers: headers(ctx),
      },
    );
    return {
      bytes: new Uint8Array(await data.arrayBuffer()),
      mime: "video/mp4",
      remoteId: id,
    };
  }
  if (!route) throw new Error("请在供应商高级设置中配置参考图生视频接口");
  let result = (await (
    await checkedFetch(ctx, route.path, {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({
        ...route.body,
        model: ctx.provider.models["ref-video"] || ctx.provider.model,
        prompt,
        image: imageUrl,
        duration,
      }),
    })
  ).json()) as any;
  const jobId = result.id ?? result.task_id;
  if (jobId && route.pollPath) {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (
      !["completed", "succeeded", "success"].includes(
        String(result.status).toLowerCase(),
      )
    ) {
      if (
        ["failed", "error", "cancelled"].includes(
          String(result.status).toLowerCase(),
        )
      )
        throw new Error("生成服务未完成任务");
      if (Date.now() > deadline) throw new Error("生成任务超时");
      onProgress(Number(result.progress ?? 0));
      await wait(2000, ctx.signal);
      result = await (
        await checkedFetch(
          ctx,
          route.pollPath.replace("{id}", encodeURIComponent(jobId)),
          {
            headers: headers(ctx),
          },
        )
      ).json();
    }
  }
  const url = route.resultPath
    ? getPath(result, route.resultPath)
    : mediaUrl(result);
  if (typeof url !== "string") throw new Error("生成任务没有返回视频");
  return { url, mime: "video/mp4", remoteId: jobId };
}
/** Edits an image by instruction, keeping what the prompt does not change. */
export async function editImage(
  ctx: ProviderContext,
  prompt: string,
  image: { bytes: Uint8Array; mime: string; url?: string },
  onProgress: (value: number) => void = () => {},
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes["image-edit"];
  if (ctx.provider.kind === "fal") {
    const { url } = await falRun(
      ctx,
      ctx.provider.models["image-edit"] ?? "",
      {
        ...route?.body,
        prompt,
        image_url: image.url ?? toDataUri(image.bytes, image.mime),
      },
      onProgress,
      route?.resultPath,
    );
    return { url, mime: "image/png" };
  }
  const form = new FormData();
  form.append(
    "model",
    ctx.provider.models["image-edit"] ||
      ctx.provider.models.image ||
      ctx.provider.model,
  );
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append(
    "image",
    new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
    "image.png",
  );
  const h = headers(ctx);
  delete h["Content-Type"];
  const value = (await (
    await checkedFetch(ctx, route?.path ?? "/images/edits", {
      method: "POST",
      headers: h,
      body: form,
    })
  ).json()) as any;
  const item = value.data?.[0] ?? value;
  if (item.b64_json)
    return {
      bytes: Uint8Array.from(Buffer.from(item.b64_json, "base64")),
      mime: "image/png",
    };
  const url = route?.resultPath ? getPath(value, route.resultPath) : item.url;
  if (typeof url !== "string") throw new Error("图片编辑服务没有返回图片");
  return { url, mime: "image/png" };
}
/** The base URL a provider kind talks to by default; also used to explain where data goes. */
export const serviceHost = (baseUrl: string) => {
  try {
    return new URL(endpoint(baseUrl, "/")).host;
  } catch {
    return baseUrl;
  }
};
