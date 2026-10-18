import {
  checkedFetch,
  headers,
  type ProviderContext,
  type Capability,
} from "./types";
import { falRun } from "./services";
export type AdvancedMediaCapability =
  | "video-matte"
  | "video-inpaint"
  | "video-upscale"
  | "avatar"
  | "lip-sync";
export const advancedMediaModels: Record<AdvancedMediaCapability, string> = {
  "video-matte": "bria/video/background-removal",
  "video-inpaint": "fal-ai/void-video-inpainting",
  "video-upscale": "fal-ai/video-upscaler",
  avatar: "veed/fabric-1.0",
  "lip-sync": "fal-ai/sync-lipsync/v2",
};
export interface AdvancedMediaInput {
  source: string;
  audio?: string;
  mask?: string;
  prompt?: string;
  scale?: number;
}
export function advancedMediaPayload(
  capability: AdvancedMediaCapability,
  input: AdvancedMediaInput,
) {
  switch (capability) {
    case "video-matte":
      return {
        video_url: input.source,
        background_color: "Transparent",
        output_container_and_codec: "webm_vp9",
        preserve_audio: true,
      };
    case "video-inpaint":
      if (!input.mask)
        throw new Error(
          "视频消除需要黑色代表消除区域、白色代表保留区域的蒙版视频",
        );
      return {
        video_url: input.source,
        quad_mask_video_url: input.mask,
        prompt: input.prompt,
        enable_pass2_refinement: true,
      };
    case "video-upscale":
      return { video_url: input.source, scale: input.scale ?? 2 };
    case "avatar":
      if (!input.audio) throw new Error("数字人需要配音素材");
      return {
        image_url: input.source,
        audio_url: input.audio,
        resolution: "720p",
      };
    case "lip-sync":
      if (!input.audio) throw new Error("口型同步需要配音素材");
      return {
        video_url: input.source,
        audio_url: input.audio,
        model: "lipsync-2",
        sync_mode: "cut_off",
      };
  }
}
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[k]
          : undefined,
      value,
    );
export async function processAdvancedMedia(
  ctx: ProviderContext,
  capability: AdvancedMediaCapability,
  input: AdvancedMediaInput,
  progress: (n: number) => void,
) {
  if (
    !ctx.provider.enabled ||
    !ctx.provider.capabilities.includes(capability as Capability)
  )
    throw new Error("所选供应商未启用这项能力");
  if (!ctx.apiKey && ctx.provider.kind === "fal")
    throw new Error("请先在模型设置中保存 fal 密钥");
  const route = ctx.provider.routes[capability];
  const payload = {
    ...route?.body,
    ...advancedMediaPayload(capability, input),
  };
  if (ctx.provider.kind === "fal")
    return falRun(
      ctx,
      ctx.provider.models[capability] || advancedMediaModels[capability],
      payload,
      progress,
      route?.resultPath,
    );
  if (!route) throw new Error("此供应商需要配置该能力的真实处理接口");
  let value = (await (
    await checkedFetch(ctx, route.path, {
      method: "POST",
      headers: headers(ctx),
      body: JSON.stringify(payload),
    })
  ).json()) as Record<string, unknown>;
  const deadline = Date.now() + 20 * 60 * 1000;
  if (route.pollPath && value.id) {
    const id = encodeURIComponent(String(value.id));
    while (
      !["completed", "succeeded", "success"].includes(String(value.status))
    ) {
      if (["failed", "error", "cancelled"].includes(String(value.status)))
        throw new Error("媒体服务处理失败");
      if (Date.now() > deadline) throw new Error("媒体服务处理超时");
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(ctx.signal.reason);
        };
        const timer = setTimeout(() => {
          ctx.signal.removeEventListener("abort", stop);
          resolve();
        }, 1500);
        ctx.signal.addEventListener("abort", stop, { once: true });
      });
      value = (await (
        await checkedFetch(ctx, route.pollPath.replace("{id}", id), {
          headers: headers(ctx),
        })
      ).json()) as Record<string, unknown>;
      progress(Math.min(90, Number(value.progress) || 15));
    }
  }
  const url = at(value, route.resultPath ?? "video.url");
  if (typeof url !== "string" || !/^https?:\/\//.test(url))
    throw new Error("媒体服务未返回有效结果地址");
  return { url, raw: value };
}
