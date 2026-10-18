import { describe, expect, it } from "vitest";
import {
  advancedMediaModels,
  advancedMediaPayload,
  processAdvancedMedia,
  providerSchema,
  type AdvancedMediaCapability,
  type ProviderContext,
} from "@tadacut/providers";
describe("advanced provider wire contracts (fixture responses, no paid inference)", () => {
  for (const capability of Object.keys(
    advancedMediaModels,
  ) as AdvancedMediaCapability[])
    it(`submits ${capability} to its actual public endpoint and accepts media results`, async () => {
      const calls: { url: string; body: any }[] = [];
      const ctx: ProviderContext = {
        provider: providerSchema.parse({
          id: "fal",
          name: "fal",
          kind: "fal",
          baseUrl: "https://queue.fal.run",
          capabilities: [capability],
        }),
        apiKey: "fixture-key",
        signal: new AbortController().signal,
        fetcher: async (url, options) => {
          calls.push({
            url: String(url),
            body: JSON.parse(String(options?.body)),
          });
          expect(new Headers(options?.headers).get("Authorization")).toBe(
            "Key fixture-key",
          );
          return Response.json({
            video: { url: "https://media.example.test/output.mp4" },
          });
        },
      };
      const input = {
        source: "data:video/mp4;base64,AA==",
        audio: "data:audio/wav;base64,AA==",
        mask: "data:video/mp4;base64,AA==",
        prompt: "Reconstruct the wall",
        scale: 4,
      };
      const result = await processAdvancedMedia(
        ctx,
        capability,
        input,
        () => {},
      );
      expect(calls[0].url).toBe(
        `https://queue.fal.run/${advancedMediaModels[capability]}`,
      );
      expect(calls[0].body).toEqual(advancedMediaPayload(capability, input));
      expect(result.url).toBe("https://media.example.test/output.mp4");
      if (capability === "video-inpaint")
        expect(calls[0].body.quad_mask_video_url).toBe(input.mask);
      if (capability === "avatar")
        expect(calls[0].body).toMatchObject({
          resolution: "720p",
          audio_url: input.audio,
        });
    });
  it("refuses unconfigured capabilities before contacting a service", async () => {
    let contacted = false;
    const ctx: ProviderContext = {
      provider: providerSchema.parse({
        id: "f",
        name: "f",
        kind: "fal",
        baseUrl: "https://queue.fal.run",
        capabilities: [],
      }),
      apiKey: "fixture",
      signal: new AbortController().signal,
      fetcher: async () => {
        contacted = true;
        return Response.json({});
      },
    };
    await expect(
      processAdvancedMedia(
        ctx,
        "avatar",
        { source: "image", audio: "audio" },
        () => {},
      ),
    ).rejects.toThrow(/未启用/);
    expect(contacted).toBe(false);
  });
  it("supports a configured custom service with a result path without fabricating output", async () => {
    const ctx: ProviderContext = {
      provider: providerSchema.parse({
        id: "c",
        name: "custom",
        kind: "custom",
        baseUrl: "https://models.example.test",
        capabilities: ["video-upscale"],
        routes: {
          "video-upscale": { path: "/enhance", resultPath: "result.url" },
        },
      }),
      apiKey: "",
      signal: new AbortController().signal,
      fetcher: async () =>
        Response.json({
          result: { url: "https://media.example.test/real-result.mp4" },
        }),
    };
    expect(
      (
        await processAdvancedMedia(
          ctx,
          "video-upscale",
          { source: "data:video/mp4;base64,AA==", scale: 2 },
          () => {},
        )
      ).url,
    ).toContain("real-result");
    ctx.fetcher = async () => Response.json({ result: {} });
    await expect(
      processAdvancedMedia(
        ctx,
        "video-upscale",
        { source: "source" },
        () => {},
      ),
    ).rejects.toThrow(/未返回/);
  });
});
