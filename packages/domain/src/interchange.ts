import { formatFrameTimecode, rationalFrameRate } from "./advanced";
import { timelineProfileSchema } from "./advanced-model";
import type { Command } from "./commands";
import {
  activeTimeline,
  clipSchema,
  makeProject,
  type Project,
  type Timeline,
} from "./model";
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const seconds = (frames: number, fps: number) => {
  const rate = rationalFrameRate(fps);
  return `${Math.round(frames) * rate.denominator}/${rate.numerator}s`;
};
export function exportFcpxml(p: Project, t = activeTimeline(p)): string {
  const assets = p.assets.filter((a) =>
    t.clips.some((c) => c.assetId === a.id),
  );
  const refs = new Map(assets.map((a, i) => [a.id, `r${i + 2}`]));
  const resources = assets
    .map(
      (a) =>
        `<asset id="${refs.get(a.id)}" name="${xml(a.name)}" start="0s" duration="${Math.max(a.duration ?? 1, ...t.clips.filter((c) => c.assetId === a.id).map((c) => c.sourceOffset + (c.duration / t.fps) * c.speed))}s" hasVideo="${a.kind === "audio" ? 0 : 1}" hasAudio="${a.kind === "video" || a.kind === "audio" ? 1 : 0}" format="r1"><media-rep kind="original-media" src="${xml(a.originalPath ? `file://${a.originalPath}` : a.url)}"/></asset>`,
    )
    .join("");
  const clips = [...t.clips]
    .sort((a, b) => a.start - b.start)
    .map(
      (c) =>
        `<asset-clip ref="${refs.get(c.assetId)}" name="${xml(c.name || p.assets.find((a) => a.id === c.assetId)?.name || "")}" offset="${seconds(c.start, t.fps)}" start="${seconds(Math.round(c.sourceOffset * t.fps), t.fps)}" duration="${seconds(c.duration, t.fps)}" lane="${t.tracks.findIndex((tr) => tr.id === c.trackId)}"/>`,
    )
    .join("");
  const duration = Math.max(1, ...t.clips.map((c) => c.start + c.duration));
  return `<?xml version="1.0" encoding="UTF-8"?><fcpxml version="1.10"><resources><format id="r1" name="FFVideoFormat${t.height}p${t.fps}" frameDuration="${seconds(1, t.fps)}" width="${t.width}" height="${t.height}"/>${resources}</resources><library><event name="${xml(p.name)}"><project name="${xml(t.name)}"><sequence format="r1" duration="${seconds(duration, t.fps)}" tcStart="0s" tcFormat="${t.profile?.dropFrame ? "DF" : "NDF"}"><spine>${clips}</spine></sequence></project></event></library></fcpxml>`;
}
export function exportSrt(p: Project, t = activeTimeline(p)): string {
  const clock = (frame: number) => {
    const ms = Math.round((frame / t.fps) * 1000),
      s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return t.clips
    .filter((c) => p.assets.find((a) => a.id === c.assetId)?.kind === "text")
    .sort((a, b) => a.start - b.start)
    .map(
      (c, i) =>
        `${i + 1}\n${clock(c.start)} --> ${clock(c.start + c.duration)}\n${c.text ?? p.assets.find((a) => a.id === c.assetId)?.text ?? c.name}\n`,
    )
    .join("\n");
}
const cell = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
/**
 * The timeline as a Markdown table. The ID column lets an edited table be
 * applied back with applyTimelineMarkdown.
 */
export function exportTimelineMarkdown(
  p: Project,
  t = activeTimeline(p),
): string {
  return (
    `# ${p.name} / ${t.name}\n\n| 轨道 | 素材 | 起点（秒） | 时长（秒） | 文字 | ID |\n|---|---|---:|---:|---|---|\n` +
    [...t.clips]
      .sort((a, b) => a.start - b.start)
      .map(
        (c) =>
          `| ${cell(t.tracks.find((tr) => tr.id === c.trackId)?.name ?? "")} | ${cell(c.name || p.assets.find((a) => a.id === c.assetId)?.name || "")} | ${(c.start / t.fps).toFixed(3)} | ${(c.duration / t.fps).toFixed(3)} | ${cell(c.text ?? "")} | ${c.id} |`,
      )
      .join("\n")
  );
}
/** Splits a Markdown table row, honoring escaped pipes. */
function rowCells(line: string) {
  const cells: string[] = [];
  let current = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      current += body[++i];
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}
/**
 * Commands that apply an edited timeline table: rows with an ID update that
 * clip's track, name, start, length and text; rows without one add a clip
 * when the material names an asset; with removeMissing, clips whose rows
 * were deleted are removed.
 */
export function applyTimelineMarkdown(
  p: Project,
  t: Timeline,
  markdown: string,
  makeId: () => string,
  options: { removeMissing?: boolean } = {},
): Command[] {
  const rows = markdown
    .split(/\r?\n/)
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|\s*-/.test(l))
    .map(rowCells);
  const header = rows.shift();
  if (!header || !header.includes("起点（秒）"))
    throw new Error("没有找到时间线表格");
  const col = (name: string) => header.indexOf(name),
    seen = new Set<string>(),
    commands: Command[] = [];
  for (const cells of rows) {
    const get = (name: string) =>
        col(name) >= 0 ? (cells[col(name)] ?? "") : "",
      start = Math.round(Number(get("起点（秒）")) * t.fps),
      duration = Math.round(Number(get("时长（秒）")) * t.fps);
    if (
      !Number.isFinite(start) ||
      start < 0 ||
      !Number.isFinite(duration) ||
      duration < 1
    )
      throw new Error(`时间无效：${cells.join(" | ")}`);
    const track = t.tracks.find((x) => x.name === get("轨道")),
      id = get("ID"),
      existing = t.clips.find((c) => c.id === id);
    if (existing) {
      seen.add(existing.id);
      const patch: Record<string, unknown> = {};
      if (existing.start !== start) patch.start = start;
      if (existing.duration !== duration) {
        patch.duration = duration;
        // Keyframes past the new end would make the clip invalid.
        patch.keyframes = Object.fromEntries(
          Object.entries(existing.keyframes).map(([k, keys]) => [
            k,
            keys!.filter((key) => key.frame < duration),
          ]),
        );
      }
      if (track && track.id !== existing.trackId) patch.trackId = track.id;
      const name = get("素材");
      if (
        name &&
        name !==
          (existing.name ||
            p.assets.find((a) => a.id === existing.assetId)?.name)
      )
        patch.name = name;
      const text = get("文字");
      if (existing.text !== undefined && text !== existing.text)
        patch.text = text;
      if (Object.keys(patch).length)
        commands.push({
          type: "clip.update",
          timelineId: t.id,
          clipId: existing.id,
          patch,
        } as Command);
      continue;
    }
    const asset = p.assets.find((a) => a.name === get("素材"));
    if (!asset || !track) continue;
    commands.push({
      type: "clip.add",
      timelineId: t.id,
      clip: clipSchema.parse({
        id: makeId(),
        assetId: asset.id,
        trackId: track.id,
        start,
        duration,
        name: asset.name,
        ...(get("文字") ? { text: get("文字") } : {}),
      }),
    });
  }
  if (options.removeMissing)
    for (const c of t.clips)
      if (!seen.has(c.id))
        commands.unshift({
          type: "clip.remove",
          timelineId: t.id,
          clipId: c.id,
          ripple: false,
        });
  return commands;
}
export function parseTimecode(
  tc: string,
  fps: number,
  dropFrame = tc.includes(";"),
): number {
  const parts = tc.trim().split(/[:;]/).map(Number),
    nominal = Math.round(fps);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0) ||
    parts[1] >= 60 ||
    parts[2] >= 60 ||
    parts[3] >= nominal
  )
    throw new Error("时间码格式错误");
  let frames =
    ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * nominal + parts[3];
  if (dropFrame) {
    const rate = rationalFrameRate(fps);
    timelineProfileSchema.parse({ rate, dropFrame: true });
    const drop = nominal === 60 ? 4 : 2,
      minutes = parts[0] * 60 + parts[1];
    if (parts[1] % 10 !== 0 && parts[2] === 0 && parts[3] < drop)
      throw new Error("这是被跳过的丢帧时间码");
    frames -= drop * (minutes - Math.floor(minutes / 10));
  }
  return frames;
}
export function importEdl(
  text: string,
  projectId: string,
  now: string,
  fps = 30,
): Project {
  const p = makeProject(
      projectId,
      /^TITLE:\s*(.+)$/m.exec(text)?.[1]?.trim() || "EDL 工程",
      now,
    ),
    t = activeTimeline(p);
  t.fps = fps;
  const dropFrame = /FCM:\s*DROP FRAME/i.test(text);
  t.profile = timelineProfileSchema.parse({
    rate: rationalFrameRate(fps),
    dropFrame,
  });
  t.fps = t.profile.rate.numerator / t.profile.rate.denominator;
  const lines = text.split(/\r?\n/);
  let number = 0;
  for (let i = 0; i < lines.length; i++) {
    const match =
      /^\s*(\d+)\s+(\S+)\s+([VA]+)\s+C\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)/.exec(
        lines[i],
      );
    if (!match) continue;
    const name =
      /^\*\s*(?:FROM CLIP NAME|SOURCE FILE):\s*(.+)/.exec(
        lines[i + 1] ?? "",
      )?.[1] ?? match[2];
    const assetId = `${projectId}-asset-${number}`,
      clipId = `${projectId}-clip-${number++}`;
    p.assets.push({
      id: assetId,
      name,
      kind: match[3] === "A" ? "audio" : "video",
      url: "",
      description: "导入工程中的素材，请重连文件",
      tags: ["待重连"],
      folder: "EDL 导入",
      color: "#779d91",
      createdAt: now,
      originalPath: name,
    });
    t.clips.push(
      clipSchema.parse({
        id: clipId,
        assetId,
        trackId: match[3] === "A" ? t.tracks[1].id : t.tracks[0].id,
        start: parseTimecode(match[6], fps, dropFrame),
        duration: Math.max(
          1,
          parseTimecode(match[7], fps, dropFrame) -
            parseTimecode(match[6], fps, dropFrame),
        ),
        sourceOffset: parseTimecode(match[4], fps, dropFrame) / fps,
        name,
      }),
    );
  }
  if (!number) throw new Error("未找到 CMX3600 剪辑记录");
  return p;
}

export function exportEdl(p: Project, t = activeTimeline(p)) {
  const tc = (f: number) =>
    formatFrameTimecode(
      Math.round(f),
      t.profile ?? { rate: rationalFrameRate(t.fps), dropFrame: false },
    );
  return (
    `TITLE: ${p.name} / ${t.name}\nFCM: ${t.profile?.dropFrame ? "DROP FRAME" : "NON-DROP FRAME"}\n\n` +
    [...t.clips]
      .filter((c) => {
        const a = p.assets.find((a) => a.id === c.assetId);
        return a && ["video", "image", "audio"].includes(a.kind);
      })
      .sort((a, b) => a.start - b.start)
      .map(
        (c, i) =>
          `${String(i + 1).padStart(3, "0")}  AX       ${p.assets.find((a) => a.id === c.assetId)!.kind === "audio" ? "A" : "V"}     C        ${tc(c.sourceOffset * t.fps)} ${tc(c.sourceOffset * t.fps + c.duration * c.speed)} ${tc(c.start)} ${tc(c.start + c.duration)}\n* FROM CLIP NAME: ${p.assets.find((a) => a.id === c.assetId)!.name}\n`,
      )
      .join("\n")
  );
}
