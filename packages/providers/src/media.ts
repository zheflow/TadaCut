import {
  checkedFetch,
  headers,
  type Capability,
  type ProviderContext,
} from "./types";
import { falRun } from "./services";
export interface GeneratedMedia {
  bytes?: Uint8Array;
  url?: string;
  mime: string;
  remoteId?: string;
}
const getPath = (v: any, path: string) =>
  path.split(".").reduce((a, k) => a?.[k], v);
export async function generateImage(
  ctx: ProviderContext,
  prompt: string,
  size = "1536x1024",
  references: Uint8Array[] = [],
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes.image;
  if (ctx.provider.kind === "fal") {
    const [w, h] = size.split("x").map(Number);
    const { url } = await falRun(
      ctx,
      ctx.provider.models.image || ctx.provider.model,
      {
        ...route?.body,
        prompt,
        image_size: { width: w, height: h },
        ...(references.length
          ? {
              image_urls: references.map(
                (r) =>
                  `data:image/jpeg;base64,${Buffer.from(r).toString("base64")}`,
              ),
            }
          : {}),
      },
      () => {},
      route?.resultPath,
    );
    return { url, mime: "image/png" };
  }
  let response: Response;
  if (references.length && ctx.provider.kind !== "custom") {
    const form = new FormData();
    form.append("model", ctx.provider.models.image || ctx.provider.model);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("n", "1");
    for (const [i, reference] of references.entries())
      form.append(
        "image[]",
        new Blob([new Uint8Array(reference)], { type: "image/jpeg" }),
        `reference-${i}.jpg`,
      );
    const h = headers(ctx);
    delete h["Content-Type"];
    response = await checkedFetch(ctx, route?.path ?? "/images/edits", {
      method: "POST",
      headers: h,
      body: form,
    });
  } else
    response = await checkedFetch(ctx, route?.path ?? "/images/generations", {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({
        ...route?.body,
        model: ctx.provider.models.image || ctx.provider.model,
        prompt,
        n: 1,
        size,
      }),
    });
  const value = (await response.json()) as any;
  const item = value.data?.[0] ?? value;
  if (item.b64_json)
    return {
      bytes: Uint8Array.from(Buffer.from(item.b64_json, "base64")),
      mime: "image/png",
    };
  const url = route?.resultPath ? getPath(value, route.resultPath) : item.url;
  if (typeof url !== "string") throw new Error("图片服务没有返回图片");
  return { url, mime: "image/png" };
}
export async function synthesizeSpeech(
  ctx: ProviderContext,
  text: string,
  voice = "alloy",
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes.speech,
    eleven = ctx.provider.kind === "elevenlabs";
  const body = eleven
    ? { text, model_id: ctx.provider.models.speech || "eleven_multilingual_v2" }
    : {
        model: ctx.provider.models.speech || ctx.provider.model,
        input: text,
        voice,
        response_format: "mp3",
      };
  const response = await checkedFetch(
    ctx,
    route?.path ??
      (eleven
        ? `/text-to-speech/${encodeURIComponent(voice)}`
        : "/audio/speech"),
    {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify({ ...route?.body, ...body }),
    },
  );
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime: response.headers.get("content-type") || "audio/mpeg",
  };
}
export async function cloneVoice(
  ctx: ProviderContext,
  name: string,
  samples: { bytes: Uint8Array; name: string; mime: string }[],
) {
  const form = new FormData();
  form.append("name", name);
  for (const sample of samples)
    form.append(
      "files",
      new Blob([new Uint8Array(sample.bytes)], { type: sample.mime }),
      sample.name,
    );
  const h = headers(ctx);
  delete h["Content-Type"];
  return (
    await checkedFetch(
      ctx,
      ctx.provider.routes["voice-clone"]?.path ?? "/voices/add",
      { method: "POST", headers: h, body: form },
    )
  ).json();
}
export async function transcribe(
  ctx: ProviderContext,
  audio: { bytes: Uint8Array; name: string; mime: string },
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }),
    audio.name,
  );
  form.append("model", ctx.provider.models.transcription || ctx.provider.model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const h = headers(ctx);
  delete h["Content-Type"];
  const result = (await (
    await checkedFetch(
      ctx,
      ctx.provider.routes.transcription?.path ?? "/audio/transcriptions",
      { method: "POST", headers: h, body: form },
    )
  ).json()) as {
    text?: string;
    language?: string;
    words?: { word: string; start: number; end: number }[];
  };
  if (!result.words?.length)
    throw new Error("此服务未返回词级时间戳，请选择支持词时间戳的模型");
  return result;
}
export async function generateTask(
  ctx: ProviderContext,
  capability: Extract<Capability, "video" | "music">,
  prompt: string,
  duration: number,
  onProgress: (value: number) => void,
): Promise<GeneratedMedia> {
  const route = ctx.provider.routes[capability];
  if (ctx.provider.kind === "fal") {
    const { url } = await falRun(
      ctx,
      ctx.provider.models[capability] || ctx.provider.model,
      { ...route?.body, prompt, duration },
      onProgress,
      route?.resultPath,
    );
    return { url, mime: capability === "video" ? "video/mp4" : "audio/mpeg" };
  }
  if (capability === "music" && !route)
    throw new Error("请在供应商高级设置中配置音乐生成接口");
  const response = await checkedFetch(ctx, route?.path ?? "/videos", {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({
      ...route?.body,
      model: ctx.provider.models[capability] || ctx.provider.model,
      prompt,
      ...(ctx.provider.kind === "openai"
        ? { seconds: String(duration) }
        : { duration }),
    }),
  });
  let result = (await response.json()) as any;
  const jobId = result.id ?? result.task_id;
  if (jobId && (route?.pollPath || capability === "video")) {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!["completed", "succeeded", "success"].includes(result.status)) {
      if (["failed", "error", "cancelled"].includes(result.status))
        throw new Error("生成服务未完成任务");
      if (Date.now() > deadline) throw new Error("生成任务超时");
      ctx.signal.throwIfAborted();
      onProgress(Number(result.progress ?? 0));
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(ctx.signal.reason);
        };
        const timer = setTimeout(() => {
          ctx.signal.removeEventListener("abort", abort);
          resolve();
        }, 2000);
        ctx.signal.addEventListener("abort", abort, { once: true });
      });
      result = await (
        await checkedFetch(
          ctx,
          (route?.pollPath ?? "/videos/{id}").replace(
            "{id}",
            encodeURIComponent(jobId),
          ),
          { headers: headers(ctx) },
        )
      ).json();
    }
  }
  const url = route?.resultPath
    ? getPath(result, route.resultPath)
    : (result.url ?? result.video_url ?? result.audio_url);
  if (typeof url === "string")
    return {
      url,
      mime: capability === "video" ? "video/mp4" : "audio/mpeg",
      remoteId: jobId,
    };
  if (capability === "video" && jobId) {
    const data = await checkedFetch(
      ctx,
      `/videos/${encodeURIComponent(jobId)}/content`,
      { headers: headers(ctx) },
    );
    return {
      bytes: new Uint8Array(await data.arrayBuffer()),
      mime: "video/mp4",
      remoteId: jobId,
    };
  }
  throw new Error("生成任务没有返回可下载的媒体");
}
