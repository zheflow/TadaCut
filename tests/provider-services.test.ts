import { afterEach, describe, expect, it, vi } from "vitest";
import {
  falRun,
  providerPresets,
  providerSchema,
  publishVideo,
  s3PresignGet,
  s3Put,
  searchStock,
  type Provider,
  type ProviderContext,
} from "@tadacut/providers";

interface Sent {
  url: string;
  init?: RequestInit;
}
/** A context whose requests are answered by `answer` and kept in `sent`. */
function service(
  provider: Partial<Provider> & Pick<Provider, "kind" | "baseUrl">,
  answer: (url: string, init?: RequestInit) => unknown,
  apiKey = "secret",
) {
  const sent: Sent[] = [];
  const context: ProviderContext = {
    provider: providerSchema.parse({ id: "svc", name: "服务", ...provider }),
    apiKey,
    signal: new AbortController().signal,
    fetcher: (async (url, init) => {
      sent.push({ url: String(url), init });
      const body = answer(String(url), init);
      return body instanceof Response ? body : Response.json(body);
    }) as typeof fetch,
  };
  return { context, sent };
}
const header = (s: Sent, name: string) =>
  new Headers(s.init?.headers as HeadersInit).get(name);
afterEach(() => vi.useRealTimers());

describe("online media libraries", () => {
  it("maps Pexels photos and sends the key as Pexels expects", async () => {
    const { context, sent } = service(
      { kind: "pexels", baseUrl: "https://api.pexels.com" },
      () => ({
        photos: [
          {
            id: 7,
            alt: "海边日落",
            width: 4000,
            height: 3000,
            url: "https://www.pexels.com/photo/7",
            photographer: "Lin",
            src: {
              medium: "https://images.pexels.com/7-m.jpg",
              large2x: "https://images.pexels.com/7-l.jpg",
            },
          },
        ],
      }),
    );
    const items = await searchStock(context, {
      query: "日落 海边",
      kind: "image",
      orientation: "portrait",
    });
    expect(items).toEqual([
      {
        id: "pexels-photo-7",
        title: "海边日落",
        kind: "image",
        previewUrl: "https://images.pexels.com/7-m.jpg",
        downloadUrl: "https://images.pexels.com/7-l.jpg",
        width: 4000,
        height: 3000,
        author: "Lin",
        license: "Pexels License",
        sourceUrl: "https://www.pexels.com/photo/7",
        provider: "服务",
      },
    ]);
    const url = new URL(sent[0].url);
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("query")).toBe("日落 海边");
    expect(url.searchParams.get("orientation")).toBe("portrait");
    // Pexels takes the bare key, not a bearer token.
    expect(header(sent[0], "Authorization")).toBe("secret");
  });
  it("picks the largest Pexels video file up to 1080p", async () => {
    const { context } = service(
      { kind: "pexels", baseUrl: "https://api.pexels.com" },
      () => ({
        videos: [
          {
            id: 9,
            image: "https://images.pexels.com/9.jpg",
            duration: 12,
            url: "https://www.pexels.com/video/9",
            user: { name: "Mo" },
            video_files: [
              {
                file_type: "video/mp4",
                link: "https://v/4k.mp4",
                width: 3840,
                height: 2160,
              },
              {
                file_type: "video/mp4",
                link: "https://v/1080.mp4",
                width: 1920,
                height: 1080,
              },
              {
                file_type: "video/mp4",
                link: "https://v/720.mp4",
                width: 1280,
                height: 720,
              },
              {
                file_type: "video/webm",
                link: "https://v/1080.webm",
                width: 1920,
                height: 1080,
              },
            ],
          },
          { id: 10, video_files: [] },
        ],
      }),
    );
    const [video, ...rest] = await searchStock(context, {
      query: "city",
      kind: "video",
    });
    expect(rest).toEqual([]);
    expect(video).toMatchObject({
      id: "pexels-video-9",
      downloadUrl: "https://v/1080.mp4",
      width: 1920,
      height: 1080,
      duration: 12,
      author: "Mo",
    });
  });
  it("says which libraries cannot search for a kind", async () => {
    const pexels = service(
      { kind: "pexels", baseUrl: "https://api.pexels.com" },
      () => ({}),
    );
    await expect(
      searchStock(pexels.context, { query: "rain", kind: "audio" }),
    ).rejects.toThrow(/音频/);
    const chat = service(
      { kind: "compatible", baseUrl: "https://api.example.com/v1" },
      () => ({}),
    );
    await expect(
      searchStock(chat.context, { query: "rain", kind: "image" }),
    ).rejects.toThrow(/素材库/);
    expect(pexels.sent).toEqual([]);
  });
  it("keeps the Pixabay key in the query instead of a header", async () => {
    const { context, sent } = service(
      { kind: "pixabay", baseUrl: "https://pixabay.com/api" },
      () => ({
        hits: [
          {
            id: 3,
            tags: "flower",
            webformatURL: "https://p/3-w.jpg",
            largeImageURL: "https://p/3-l.jpg",
            imageWidth: 10,
            imageHeight: 20,
            user: "U",
            pageURL: "https://p/3",
          },
        ],
      }),
    );
    const [item] = await searchStock(context, {
      query: "flower",
      kind: "image",
      orientation: "landscape",
    });
    expect(item).toMatchObject({
      id: "pixabay-image-3",
      downloadUrl: "https://p/3-l.jpg",
    });
    const url = new URL(sent[0].url);
    expect(url.searchParams.get("key")).toBe("secret");
    expect(url.searchParams.get("orientation")).toBe("horizontal");
    expect(header(sent[0], "Authorization")).toBeNull();
  });
});

describe("S3-compatible storage", () => {
  // The example from the AWS Signature Version 4 query-string documentation.
  // https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html
  const aws = (options: Provider["options"]) =>
    service(
      {
        kind: "s3",
        baseUrl: "https://s3.amazonaws.com",
        options: {
          bucket: "examplebucket",
          region: "us-east-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          ...options,
        },
      },
      () => new Response(null, { status: 200 }),
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
  it("presigns a GET exactly as the AWS example", () => {
    const { context } = aws({ pathStyle: "false" });
    expect(
      s3PresignGet(
        context,
        "test.txt",
        86400,
        new Date("2013-05-24T00:00:00Z"),
      ),
    ).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
  it("uses path-style addresses, prefixes and public bases", () => {
    const pathStyle = aws({ pathStyle: "true", prefix: "icut/" });
    const url = new URL(
      s3PresignGet(
        pathStyle.context,
        "a b.mp4",
        60,
        new Date("2026-01-01T00:00:00Z"),
      ),
    );
    expect(url.host).toBe("s3.amazonaws.com");
    expect(url.pathname).toBe("/examplebucket/icut/a%20b.mp4");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    const publicBase = aws({ publicBaseUrl: "https://cdn.example.com/media/" });
    expect(s3PresignGet(publicBase.context, "a b.mp4")).toBe(
      "https://cdn.example.com/media/a%20b.mp4",
    );
  });
  it("signs uploads with the payload hash and reports failures", async () => {
    const { context, sent } = aws({ pathStyle: "true" });
    const result = await s3Put(
      context,
      "clip.mp4",
      new Uint8Array([1, 2, 3]),
      "video/mp4",
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result).toEqual({ key: "clip.mp4" });
    expect(sent[0].url).toBe("https://s3.amazonaws.com/examplebucket/clip.mp4");
    expect(sent[0].init?.method).toBe("PUT");
    expect(header(sent[0], "x-amz-content-sha256")).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(header(sent[0], "Authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260101\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    const failing = service(
      {
        kind: "s3",
        baseUrl: "https://s3.amazonaws.com",
        options: { bucket: "b", accessKeyId: "k" },
      },
      () => new Response("denied", { status: 403 }),
    );
    await expect(
      s3Put(failing.context, "x", new Uint8Array(), "video/mp4"),
    ).rejects.toThrow(/403/);
  });
  it("asks for the bucket and keys before signing anything", () => {
    const { context } = service(
      { kind: "s3", baseUrl: "https://s3.amazonaws.com" },
      () => ({}),
    );
    expect(() => s3PresignGet(context, "x")).toThrow(/存储桶/);
  });
});

describe("fal queue", () => {
  const fal = (
    statuses: unknown[],
    result: unknown = { video: { url: "https://cdn.fal/out.mp4" } },
  ) => {
    let polls = 0;
    return service({ kind: "fal", baseUrl: "https://queue.fal.run" }, (url) => {
      if (url.endsWith("/status"))
        return statuses[Math.min(polls++, statuses.length - 1)];
      if (url.endsWith("/requests/r1")) return result;
      return {
        status_url: "https://queue.fal.run/fal-ai/x/requests/r1/status",
        response_url: "https://queue.fal.run/fal-ai/x/requests/r1",
      };
    });
  };
  it("submits, polls until done and returns the media address", async () => {
    // Only the polling delay is faked; responses still settle normally.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { context, sent } = fal([
      { status: "IN_QUEUE" },
      { status: "IN_PROGRESS" },
      { status: "COMPLETED" },
    ]);
    const progress: number[] = [];
    const running = falRun(context, "fal-ai/x", { prompt: "海浪" }, (v) =>
      progress.push(v),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const result = await running;
    expect(result.url).toBe("https://cdn.fal/out.mp4");
    expect(sent.map((s) => s.url)).toEqual([
      "https://queue.fal.run/fal-ai/x",
      "https://queue.fal.run/fal-ai/x/requests/r1/status",
      "https://queue.fal.run/fal-ai/x/requests/r1/status",
      "https://queue.fal.run/fal-ai/x/requests/r1/status",
      "https://queue.fal.run/fal-ai/x/requests/r1",
    ]);
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({ prompt: "海浪" });
    expect(header(sent[0], "Authorization")).toBe("Key secret");
    expect(progress).toEqual([5, 8]);
  });
  it("reports failed generations with the service's reason", async () => {
    const { context } = fal([{ status: "FAILED", error: "内容不合规" }]);
    await expect(falRun(context, "fal-ai/x", {})).rejects.toThrow(/内容不合规/);
  });
  it("refuses status addresses on another host", async () => {
    const { context } = service(
      { kind: "fal", baseUrl: "https://queue.fal.run" },
      () => ({
        status_url: "https://attacker.example/status",
        response_url: "https://queue.fal.run/r",
      }),
    );
    await expect(falRun(context, "fal-ai/x", {})).rejects.toThrow(/其他域名/);
  });
  it("accepts synchronous results and asks for a model id", async () => {
    const { context } = service(
      { kind: "fal", baseUrl: "https://queue.fal.run" },
      () => ({
        images: [{ url: "https://cdn.fal/a.png" }],
      }),
    );
    expect((await falRun(context, "fal-ai/flux", {})).url).toBe(
      "https://cdn.fal/a.png",
    );
    await expect(falRun(context, "", {})).rejects.toThrow(/模型 ID/);
  });
});

describe("publishing", () => {
  it("posts the video and platforms as a form with the Upload-Post key", async () => {
    const { context, sent } = service(
      {
        kind: "upload-post",
        baseUrl: "https://api.upload-post.com",
        options: { user: "studio" },
      },
      () => ({ success: true }),
    );
    const result = await publishVideo(
      context,
      { bytes: new Uint8Array([0, 1]), name: "film.mp4", mime: "video/mp4" },
      { title: "城市漫游", platforms: ["tiktok", "youtube"] },
    );
    expect(result).toEqual({ success: true });
    expect(sent[0].url).toBe("https://api.upload-post.com/api/upload");
    expect(header(sent[0], "Authorization")).toBe("Apikey secret");
    // The form sets its own multipart boundary.
    expect(header(sent[0], "Content-Type")).toBeNull();
    const form = sent[0].init?.body as FormData;
    expect(form.get("user")).toBe("studio");
    expect(form.get("title")).toBe("城市漫游");
    expect(form.getAll("platform[]")).toEqual(["tiktok", "youtube"]);
    expect((form.get("video") as File).name).toBe("film.mp4");
  });
  it("needs a profile, a platform and a publishing service", async () => {
    const video = { bytes: new Uint8Array(), name: "a.mp4", mime: "video/mp4" };
    const noUser = service(
      { kind: "upload-post", baseUrl: "https://api.upload-post.com" },
      () => ({}),
    );
    await expect(
      publishVideo(noUser.context, video, { title: "t", platforms: ["x"] }),
    ).rejects.toThrow(/user/);
    const withUser = service(
      {
        kind: "upload-post",
        baseUrl: "https://api.upload-post.com",
        options: { user: "u" },
      },
      () => ({}),
    );
    await expect(
      publishVideo(withUser.context, video, { title: "t", platforms: [] }),
    ).rejects.toThrow(/平台/);
    const chat = service(
      { kind: "compatible", baseUrl: "https://api.example.com/v1" },
      () => ({}),
    );
    await expect(
      publishVideo(chat.context, video, { title: "t", platforms: ["x"] }),
    ).rejects.toThrow(/发布服务/);
    expect([...noUser.sent, ...withUser.sent, ...chat.sent]).toEqual([]);
  });
});

describe("service presets", () => {
  it("are valid providers with unique ids", () => {
    const ids = providerPresets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of providerPresets)
      expect(() =>
        providerSchema.parse({
          id: preset.id,
          name: preset.name,
          kind: preset.kind,
          baseUrl: preset.baseUrl,
          capabilities: preset.capabilities,
          options: preset.options ?? {},
          ...(preset.model ? { model: preset.model } : {}),
        }),
      ).not.toThrow();
  });
});
