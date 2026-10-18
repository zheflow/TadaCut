import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  captionStyleSchema,
  keyframeProperties,
  keyframeSchema,
} from "@tadacut/domain";
import type { MotionTemplate } from "../../../packages/motion/src/catalog";
import type { Repository } from "./storage";

/**
 * Extension packs (`tadacut-plugin@1`): a JSON file of motion
 * templates, LUTs, sounds, GLSL transitions and effects, camera moves and
 * caption styles. Packs only add resources; they never get code that runs
 * outside the motion iframe or a WebGL shader.
 */
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}$/i);
const shader = z.string().max(20000);
const forbidden =
  /\bimport\s|require\(|fetch\(|XMLHttpRequest|WebSocket|eval\(|Function\(/;
export const pluginSchema = z
  .object({
    format: z.literal("tadacut-plugin@1"),
    id,
    name: z.string().min(1).max(100),
    version: z.string().max(40).default("1.0.0"),
    author: z.string().max(100).default(""),
    description: z.string().max(2000).default(""),
    license: z.string().max(200).default(""),
    homepage: z.string().url().optional(),
    contents: z
      .object({
        templates: z
          .array(
            z
              .object({
                id,
                name: z.string().max(80),
                category: z
                  .enum([
                    "title",
                    "info",
                    "data",
                    "social",
                    "transition",
                    "ending",
                  ])
                  .default("info"),
                tags: z.array(z.string().max(30)).max(12).default([]),
                duration: z.number().min(0.2).max(120).default(4),
                params: z
                  .array(
                    z.object({
                      key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/),
                      name: z.string().max(40),
                      type: z.enum(["text", "color", "number", "list"]),
                      default: z.union([
                        z.string().max(2000),
                        z.number(),
                        z.array(z.string().max(200)).max(40),
                      ]),
                      brand: z
                        .enum(["primary", "secondary", "font"])
                        .optional(),
                    }),
                  )
                  .max(30)
                  .default([]),
                code: z
                  .string()
                  .max(100000)
                  .refine(
                    (c) => /export\s+default/.test(c) && !forbidden.test(c),
                    "模板代码只能 default export 一个 React 组件，不能引入模块或访问网络",
                  ),
              })
              .strict(),
          )
          .max(200)
          .default([]),
        luts: z
          .array(
            z
              .object({
                id,
                name: z.string().max(80),
                cube: z.string().max(4 * 1024 * 1024),
              })
              .strict(),
          )
          .max(60)
          .default([]),
        sounds: z
          .array(
            z
              .object({
                id,
                name: z.string().max(80),
                mime: z.enum(["audio/mpeg", "audio/wav", "audio/ogg"]),
                /** Base64 audio. */
                data: z.string().max(14 * 1024 * 1024),
                tags: z.array(z.string().max(30)).max(12).default([]),
                license: z.string().max(200).default(""),
              })
              .strict(),
          )
          .max(200)
          .default([]),
        transitions: z
          .array(z.object({ id, name: z.string().max(80), shader }).strict())
          .max(100)
          .default([]),
        effects: z
          .array(
            z
              .object({
                id,
                name: z.string().max(80),
                shader: shader.refine(
                  (s) => s.trimStart().startsWith("#version 300 es"),
                  "特效需要完整的 GLSL ES 3.00 片元着色器",
                ),
              })
              .strict(),
          )
          .max(100)
          .default([]),
        cameraMoves: z
          .array(
            z
              .object({
                id,
                name: z.string().max(80),
                /** Keyframes over a 0–1 clip span, scaled to the clip's length when used. */
                keyframes: z.record(
                  z.enum(keyframeProperties),
                  z.array(
                    keyframeSchema.extend({ frame: z.number().min(0).max(1) }),
                  ),
                ),
              })
              .strict(),
          )
          .max(100)
          .default([]),
        captionStyles: z.array(captionStyleSchema).max(100).default([]),
      })
      .strict(),
  })
  .strict();
export type PluginPack = z.infer<typeof pluginSchema>;
/** What is stored: the pack without sound data, which lives in files. */
export interface InstalledPlugin extends Omit<PluginPack, "contents"> {
  contents: Omit<PluginPack["contents"], "sounds"> & {
    sounds: {
      id: string;
      name: string;
      mime: string;
      file: string;
      tags: string[];
      license: string;
    }[];
  };
  installedAt: string;
  size: number;
}
export function installPlugin(repo: Repository, dataDir: string, raw: string) {
  if (raw.length > 64 * 1024 * 1024) throw new Error("扩展包过大");
  const pack = pluginSchema.parse(JSON.parse(raw));
  const dir = path.join(dataDir, "plugins", pack.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const sounds = pack.contents.sounds.map((sound) => {
    const ext =
        sound.mime === "audio/wav"
          ? ".wav"
          : sound.mime === "audio/ogg"
            ? ".ogg"
            : ".mp3",
      file = path.join(dir, `${sound.id}${ext}`);
    fs.writeFileSync(file, Buffer.from(sound.data, "base64"));
    return {
      id: sound.id,
      name: sound.name,
      mime: sound.mime,
      file,
      tags: sound.tags,
      license: sound.license,
    };
  });
  const installed: InstalledPlugin = {
    ...pack,
    contents: { ...pack.contents, sounds },
    installedAt: new Date().toISOString(),
    size: raw.length,
  };
  repo.save("plugin", installed);
  return installed;
}
export function uninstallPlugin(
  repo: Repository,
  dataDir: string,
  pluginId: string,
) {
  id.parse(pluginId);
  repo.deleteRecord("plugin", pluginId);
  fs.rmSync(path.join(dataDir, "plugins", pluginId), {
    recursive: true,
    force: true,
  });
}
export const installedPlugins = (repo: Repository) =>
  repo.list<InstalledPlugin>("plugin");
/** A summary for lists: counts, not contents. */
export const pluginSummary = (p: InstalledPlugin) => ({
  id: p.id,
  name: p.name,
  version: p.version,
  author: p.author,
  description: p.description,
  license: p.license,
  homepage: p.homepage,
  installedAt: p.installedAt,
  size: p.size,
  counts: Object.fromEntries(
    Object.entries(p.contents).map(([k, v]) => [k, (v as unknown[]).length]),
  ),
  items: Object.fromEntries(
    Object.entries(p.contents).map(([k, v]) => [
      k,
      (v as { id: string; name: string }[]).map((x) => ({
        id: x.id,
        name: x.name,
      })),
    ]),
  ),
});
export function pluginTemplates(repo: Repository): MotionTemplate[] {
  return installedPlugins(repo).flatMap((p) =>
    p.contents.templates.map(
      (t) =>
        ({
          ...t,
          id: `${p.id}/${t.id}`,
          tags: [...t.tags, p.name],
        }) as MotionTemplate,
    ),
  );
}
export function pluginItem<K extends keyof InstalledPlugin["contents"]>(
  repo: Repository,
  pluginId: string,
  kind: K,
  itemId: string,
): InstalledPlugin["contents"][K][number] {
  const plugin = repo.record<InstalledPlugin>("plugin", pluginId);
  if (!plugin) throw new Error("扩展未安装");
  const item = (plugin.contents[kind] as { id: string }[]).find(
    (x) => x.id === itemId,
  );
  if (!item) throw new Error("扩展中没有这一项");
  return item as InstalledPlugin["contents"][K][number];
}
