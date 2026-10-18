import { capcutDraft } from "./capcut";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import {
  activeTimeline,
  assetSchema,
  clipSchema,
  exportFcpxml,
  exportEdl,
  exportSrt,
  exportTimelineMarkdown,
  importEdl,
  makeProject,
  validateProject,
  type Project,
} from "@tadacut/domain";
import type { Repository } from "./storage";
import type { MediaService } from "./media";
const encode = (s: string) => new TextEncoder().encode(s);
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const parseSeconds = (value: string | undefined) => {
  if (!value) return 0;
  const numbers = value.replace(/s$/, "").split("/").map(Number);
  const n = numbers[0] / (numbers[1] || 1);
  if (!Number.isFinite(n)) throw new Error("FCPXML 时间值错误");
  return n;
};
export function importFcpxml(text: string, id: string, now: string): Project {
  if (text.length > 8 * 1024 * 1024) throw new Error("工程 XML 过大");
  const data = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    processEntities: false,
  }).parse(text).fcpxml;
  if (!data?.resources) throw new Error("不是有效的 FCPXML 工程");
  const event = asArray(data.library?.event)[0] as any,
    original = asArray(event?.project)[0] as any,
    sequence = original?.sequence;
  if (!sequence) throw new Error("未找到可导入的 sequence");
  const p = makeProject(id, original.name || "FCPXML 工程", now),
    t = activeTimeline(p);
  const format =
    asArray<any>(data.resources.format).find((f) => f.id === sequence.format) ??
    asArray<any>(data.resources.format)[0];
  if (format?.width && format?.height) {
    t.width = Number(format.width);
    t.height = Number(format.height);
  }
  if (format?.frameDuration)
    t.fps = Math.round(1 / parseSeconds(format.frameDuration));
  const refs = new Map<string, string>();
  for (const original of asArray<any>(data.resources.asset)) {
    const assetId = crypto.randomUUID(),
      rep = asArray<any>(original["media-rep"])[0];
    refs.set(original.id, assetId);
    p.assets.push(
      assetSchema.parse({
        id: assetId,
        name: original.name || assetId,
        kind: Number(original.hasVideo) ? "video" : "audio",
        url: "",
        duration: parseSeconds(original.duration),
        originalPath: rep?.src ?? original.src ?? "",
        tags: ["待重连"],
        createdAt: now,
        description: "导入后请选择本地源文件重连",
      }),
    );
  }
  let number = 0;
  for (const original of asArray<any>(sequence.spine?.["asset-clip"])) {
    const assetId = refs.get(original.ref);
    if (!assetId) continue;
    const asset = p.assets.find((a) => a.id === assetId)!;
    t.clips.push(
      clipSchema.parse({
        id: `import-${number++}`,
        assetId,
        name: original.name || asset.name,
        trackId: asset.kind === "audio" ? t.tracks[1].id : t.tracks[0].id,
        start: Math.max(0, Math.round(parseSeconds(original.offset) * t.fps)),
        duration: Math.max(
          1,
          Math.round(parseSeconds(original.duration) * t.fps),
        ),
        sourceOffset: parseSeconds(original.start),
      }),
    );
  }
  return validateProject(p);
}
export class Artifacts {
  constructor(
    private repo: Repository,
    private media: MediaService,
    private dir: string,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }
  async export(projectId: string, format: string, timelineId?: string) {
    const p = this.repo.get(projectId),
      t = p.timelines.find((t) => t.id === timelineId) ?? activeTimeline(p),
      folder = crypto.randomUUID(),
      base = path.join(this.dir, folder);
    fs.mkdirSync(base);
    let filename = "project.tadacut";
    if (format === "project") {
      const files: Record<string, Uint8Array> = {},
        manifest: Record<string, string> = {};
      let total = 0;
      for (const a of p.assets) {
        if (!a.url.startsWith("/media/")) continue;
        const file = this.media.file(a),
          bytes = await fsp.readFile(file);
        total += bytes.length;
        if (total > 512 * 1024 * 1024)
          throw new Error("工程超过 512 MB，请分批整理素材后导出");
        const name = "media/" + path.basename(file);
        files[name] = bytes;
        manifest[a.id] = name;
      }
      const snapshot = structuredClone(p);
      snapshot.assets.forEach((a) => {
        delete a.originalPath;
      });
      files["project.json"] = encode(
        JSON.stringify({
          format: "tadacut-project@1",
          project: snapshot,
          files: manifest,
        }),
      );
      await fsp.writeFile(
        path.join(base, filename),
        zipSync(files, { level: 1 }),
      );
    } else if (format === "fcpxml") {
      filename = "timeline.fcpxml";
      await fsp.writeFile(path.join(base, filename), exportFcpxml(p, t));
    } else if (format === "srt") {
      filename = "subtitles.srt";
      await fsp.writeFile(path.join(base, filename), exportSrt(p, t));
    } else if (format === "markdown") {
      filename = "timeline.md";
      await fsp.writeFile(
        path.join(base, filename),
        exportTimelineMarkdown(p, t),
      );
    } else if (format === "capcut") {
      filename = (await capcutDraft(p, t, this.media, base)).filename;
    } else if (format === "edl") {
      filename = "timeline.edl";
      await fsp.writeFile(path.join(base, filename), exportEdl(p, t));
    } else throw new Error("不支持的工程导出类型");
    return { url: `/artifacts/${folder}/${filename}`, filename };
  }
  async import(bytes: Uint8Array, name: string) {
    const now = new Date().toISOString();
    let p: Project;
    if (/\.tadacut$/i.test(name)) {
      let total = 0,
        count = 0;
      const files = unzipSync(bytes, {
        filter: (file) => {
          total += file.originalSize;
          count++;
          if (total > 512 * 1024 * 1024 || count > 3000)
            throw new Error("工程包过大");
          return (
            file.name === "project.json" ||
            /^media\/[a-zA-Z0-9._-]+$/.test(file.name)
          );
        },
      });
      if (!files["project.json"]) throw new Error("工程包缺少 project.json");
      const envelope = JSON.parse(
        new TextDecoder().decode(files["project.json"]),
      );
      if (envelope.format !== "tadacut-project@1")
        throw new Error("工程格式不支持");
      p = validateProject(envelope.project);
      p.id = crypto.randomUUID();
      p.revision = 0;
      p.createdAt = p.updatedAt = now;
      for (const a of p.assets) {
        const entry = envelope.files[a.id];
        if (!entry) {
          if (a.kind !== "text" && a.kind !== "motion") {
            a.url = "";
            a.tags.push("待重连");
          }
          continue;
        }
        if (!/^media\/[a-zA-Z0-9._-]+$/.test(entry) || !files[entry])
          throw new Error("工程媒体映射无效");
        const filename = crypto.randomUUID() + this.media.extension(entry);
        await fsp.writeFile(path.join(this.media.dir, filename), files[entry], {
          flag: "wx",
        });
        a.url = "/media/" + filename;
        a.originalPath = path.join(this.media.dir, filename);
        delete a.thumbnail;
      }
    } else if (/\.edl$/i.test(name))
      p = importEdl(new TextDecoder().decode(bytes), crypto.randomUUID(), now);
    else if (/\.(xml|fcpxml)$/i.test(name))
      p = importFcpxml(
        new TextDecoder().decode(bytes),
        crypto.randomUUID(),
        now,
      );
    else {
      p = validateProject(JSON.parse(new TextDecoder().decode(bytes)));
      p.id = crypto.randomUUID();
      p.revision = 0;
      p.createdAt = p.updatedAt = now;
      p.assets.forEach((a) => {
        if (a.kind !== "text" && a.kind !== "motion") {
          a.url = "";
          a.tags = [...a.tags, "待重连"];
        }
      });
    }
    this.repo.put(p);
    return p;
  }
}
