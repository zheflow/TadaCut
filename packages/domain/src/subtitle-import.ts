import {
  assetSchema,
  clipSchema,
  textStyleSchema,
  type Command,
  type Project,
  type Timeline,
  type TextStyle,
} from "./index";
import { captionPresets } from "./captions";
import { newTrack } from "./placement";
export interface ImportedCue {
  start: number;
  end: number;
  text: string;
  words?: { text: string; start: number; end: number }[];
  style?: Partial<TextStyle>;
}
export const subtitleFormats = ["srt", "vtt", "lrc", "ass"] as const;
export type SubtitleFormat = (typeof subtitleFormats)[number];
const timestamp = (s: string) => {
  const parts = s.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((v, p) => v * 60 + p, 0);
};
const plain = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\u0000/g, "")
    .trim();
export function parseSubtitles(
  source: string,
  format: SubtitleFormat,
  options: { duration?: number } = {},
) {
  if (source.length > 2_000_000) throw new Error("字幕文件过大（最多 2 MB）");
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"),
    cues: ImportedCue[] = [],
    warnings: string[] = [];
  if (format === "srt" || format === "vtt") {
    for (const block of text.split(/\n\s*\n/)) {
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(block.trim())) continue;
      const lines = block.trim().split("\n"),
        at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) continue;
      const match = lines[at].match(
        /((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)/,
      );
      if (!match) {
        warnings.push("已忽略无法识别的时间行");
        continue;
      }
      cues.push({
        start: timestamp(match[1]),
        end: timestamp(match[2]),
        text: plain(lines.slice(at + 1).join("\n")),
      });
    }
  } else if (format === "lrc") {
    const offset =
      Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
    for (const line of text.split("\n")) {
      const tags = [...line.matchAll(/\[(\d+:\d{2}(?:[.:]\d+)?)\]/g)];
      if (!tags.length) continue;
      const raw = line.replace(/\[\d+:\d{2}(?:[.:]\d+)?\]/g, "");
      for (const tag of tags) {
        const start = Math.max(
          0,
          timestamp(
            tag[1].replace(/:(\d{2,3})$/, (_, n) =>
              tag[1].split(":").length > 2 ? "." + n : ":" + n,
            ),
          ) + offset,
        );
        const timed = [...raw.matchAll(/<(\d+:\d{2}(?:\.\d+)?)>([^<]*)/g)];
        const words = timed
          .map((m, i) => ({
            text: plain(m[2]),
            start: Math.max(start, timestamp(m[1]) + offset),
            end:
              i + 1 < timed.length
                ? timestamp(timed[i + 1][1]) + offset
                : start + 5,
          }))
          .filter((w) => w.text);
        cues.push({
          start,
          end: start + 5,
          text: plain(raw),
          ...(words.length ? { words } : {}),
        });
      }
    }
    cues.sort((a, b) => a.start - b.start);
    cues.forEach((c, i) => {
      c.end =
        cues.slice(i + 1).find((n) => n.start > c.start)?.start ??
        Math.max(c.start + 0.1, options.duration ?? c.start + 5);
      if (c.words?.length) c.words[c.words.length - 1].end = c.end;
    });
  } else {
    let section = "",
      fields: string[] = [],
      styleFields: string[] = [];
    const styles = new Map<string, Partial<TextStyle>>();
    const split = (row: string, count: number) => {
      const items = row.split(",");
      return [...items.slice(0, count - 1), items.slice(count - 1).join(",")];
    };
    const color = (s: string) => {
      const m = s
        .trim()
        .match(/&H(?:[\da-f]{2})?([\da-f]{2})([\da-f]{2})([\da-f]{2})&?/i);
      return m ? `#${m[3]}${m[2]}${m[1]}` : undefined;
    };
    for (const line of text.split("\n")) {
      if (line.trim().startsWith("[")) {
        section = line.trim().toLowerCase();
        continue;
      }
      if (/^Format:/i.test(line)) {
        const names = line
          .slice(line.indexOf(":") + 1)
          .split(",")
          .map((f) => f.trim().toLowerCase());
        if (section === "[events]") fields = names;
        else styleFields = names;
        continue;
      }
      if (/^Style:/i.test(line) && styleFields.length) {
        const values = split(
            line.slice(line.indexOf(":") + 1).trim(),
            styleFields.length,
          ),
          v = Object.fromEntries(
            styleFields.map((f, i) => [f, values[i] ?? ""]),
          );
        const style: Partial<TextStyle> = {};
        if (v.fontname) style.fontFamily = v.fontname;
        if (Number(v.fontsize) > 0)
          style.fontSize = Math.min(300, Math.max(8, Number(v.fontsize)));
        if (color(v.primarycolour ?? "")) style.color = color(v.primarycolour);
        style.fontWeight = Number(v.bold) ? 700 : 400;
        styles.set(v.name, style);
      }
      if (!/^Dialogue:/i.test(line)) continue;
      const names = fields.length
        ? fields
        : [
            "layer",
            "start",
            "end",
            "style",
            "name",
            "marginl",
            "marginr",
            "marginv",
            "effect",
            "text",
          ];
      const values = split(
          line.slice(line.indexOf(":") + 1).trim(),
          names.length,
        ),
        v = Object.fromEntries(names.map((f, i) => [f, values[i] ?? ""]));
      const start = timestamp(v.start),
        end = timestamp(v.end),
        raw = v.text ?? "";
      let elapsed = start;
      const words = [
        ...raw.matchAll(/\{[^}]*\\[kK](?:f|o)?(\d+)[^}]*\}([^{}]*)/g),
      ].map((m) => {
        const w = {
          text: m[2].replace(/\\[Nnh]/g, " "),
          start: elapsed,
          end: elapsed + Number(m[1]) / 100,
        };
        elapsed = w.end;
        return w;
      });
      if (/\\(?:pos|move|clip|t|fad|an|p)\b/.test(raw))
        warnings.push(
          "ASS 动画、定位或绘图指令已转成可编辑纯文本；字体、颜色与卡拉 OK 时间已保留",
        );
      cues.push({
        start,
        end,
        text: plain(
          raw
            .replace(/\{[^}]*\}/g, "")
            .replace(/\\[Nn]/g, "\n")
            .replace(/\\h/g, " "),
        ),
        ...(styles.has(v.style) ? { style: styles.get(v.style) } : {}),
        ...(words.length ? { words } : {}),
      });
    }
  }
  const valid = cues.filter(
    (c) =>
      Number.isFinite(c.start) &&
      Number.isFinite(c.end) &&
      c.start >= 0 &&
      c.end > c.start &&
      c.text,
  );
  if (valid.length !== cues.length) warnings.push("已忽略空字幕或无效时间范围");
  if (!valid.length) throw new Error("文件中没有可导入的字幕");
  if (valid.length > 10000) throw new Error("一次最多导入 10000 行字幕");
  return {
    cues: valid.sort((a, b) => a.start - b.start),
    warnings: [...new Set(warnings)],
  };
}
export function importSubtitleCommands(
  project: Project,
  timeline: Timeline,
  input: {
    text: string;
    format: SubtitleFormat;
    name?: string;
    offset?: number;
    styleId?: string;
    lyrics?: boolean;
    duration?: number;
  },
  makeId: () => string,
  now: string,
) {
  const { cues, warnings } = parseSubtitles(input.text, input.format, {
    duration: input.duration,
  });
  const chosen =
    project.styles.captions.find((s) => s.id === input.styleId) ??
    captionPresets.find(
      (s) => s.id === (input.styleId ?? (input.lyrics ? "karaoke" : "clean")),
    ) ??
    captionPresets[0];
  const track = {
    ...newTrack(timeline, "text", makeId()),
    name: input.lyrics ? "歌词" : "导入字幕",
  };
  const asset = assetSchema.parse({
    id: makeId(),
    kind: "text",
    name: input.name ?? "导入字幕",
    text: cues.map((c) => c.text).join("\n"),
    folder: input.lyrics ? "歌词" : "字幕",
    createdAt: now,
  });
  const commands: Command[] = [
    { type: "track.add", timelineId: timeline.id, track },
    { type: "asset.add", asset },
  ];
  for (const cue of cues) {
    const start = Math.max(
        0,
        Math.round((cue.start + (input.offset ?? 0)) * timeline.fps),
      ),
      end = Math.max(
        start + 1,
        Math.round((cue.end + (input.offset ?? 0)) * timeline.fps),
      );
    let words = cue.words;
    if (input.lyrics && !words) {
      const parts = cue.text.match(
          /[\p{Script=Han}]|[^\s\p{Script=Han}]+/gu,
        ) ?? [cue.text],
        length = parts.reduce((n, w) => n + w.length, 0);
      let elapsed = cue.start;
      words = parts.map((w) => {
        const start = elapsed;
        elapsed += ((cue.end - cue.start) * w.length) / length;
        return { text: w, start, end: elapsed };
      });
    }
    commands.push({
      type: "clip.add",
      timelineId: timeline.id,
      clip: clipSchema.parse({
        id: makeId(),
        assetId: asset.id,
        trackId: track.id,
        start,
        duration: end - start,
        text: cue.text,
        name: cue.text.slice(0, 40),
        textStyle: textStyleSchema.parse({ ...chosen.textStyle, ...cue.style }),
        caption: {
          styleId: chosen.id,
          animation: chosen.animation,
          highlight: chosen.highlight,
          words: (words ?? [])
            .map((w) => ({
              text: w.text,
              start: Math.max(
                0,
                Math.round((w.start - cue.start) * timeline.fps),
              ),
              end: Math.min(
                end - start,
                Math.round((w.end - cue.start) * timeline.fps),
              ),
            }))
            .filter((w) => w.end > w.start)
            .slice(0, 400),
        },
      }),
    });
  }
  if (input.lyrics && cues.some((c) => !c.words))
    warnings.push(
      "未提供逐词时间的歌词按字数估算高亮；可用歌词识别获得模型词时间戳",
    );
  return { commands, count: cues.length, warnings };
}
