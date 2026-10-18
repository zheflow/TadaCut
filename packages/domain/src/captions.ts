import type { Command } from "./commands";
import { DomainError } from "./engine";
import { diffClips, transcriptText } from "./edits";
import { newTrack } from "./placement";
import { wordsOnTimeline, type TimedWord } from "./transcript";
import {
  assetSchema,
  captionStyleSchema,
  clipSchema,
  textStyleSchema,
  type CaptionAnimation,
  type CaptionStyle,
  type Clip,
  type Asset,
  type Project,
  type TextStyle,
  type Timeline,
  type Transcript,
} from "./model";

type MakeId = () => string;
const style = (
  id: string,
  name: string,
  textStyle: Partial<TextStyle>,
  animation: CaptionAnimation = "none",
  highlight?: string,
): CaptionStyle =>
  captionStyleSchema.parse({
    id,
    name,
    textStyle: textStyleSchema.parse(textStyle),
    animation,
    ...(highlight ? { highlight } : {}),
  });
/** Built-in caption looks. Projects keep their own named styles in styles.captions. */
export const captionPresets: CaptionStyle[] = [
  style("clean", "简洁白字", {
    fontSize: 46,
    fontWeight: 600,
    shadow: "0 2px 6px rgba(0,0,0,.55)",
  }),
  style("outline", "描边粗体", {
    fontSize: 52,
    fontWeight: 800,
    strokeColor: "#111111",
    strokeWidth: 6,
  }),
  style("classic-yellow", "黄字黑边", {
    fontSize: 50,
    fontWeight: 700,
    color: "#ffd84a",
    strokeColor: "#000000",
    strokeWidth: 5,
  }),
  style("box", "半透明底条", {
    fontSize: 42,
    fontWeight: 500,
    background: "rgba(10,12,16,.62)",
    padding: 14,
    boxRadius: 10,
  }),
  style(
    "karaoke",
    "卡拉 OK",
    {
      fontSize: 54,
      fontWeight: 800,
      color: "#ffffff",
      strokeColor: "#101010",
      strokeWidth: 5,
    },
    "karaoke",
    "#4fe0b6",
  ),
  style(
    "word-pop",
    "逐词弹出",
    { fontSize: 62, fontWeight: 900, strokeColor: "#000000", strokeWidth: 7 },
    "word-pop",
  ),
  style(
    "highlight",
    "当前词高亮",
    {
      fontSize: 52,
      fontWeight: 800,
      strokeColor: "#0b0b0b",
      strokeWidth: 5,
    },
    "highlight",
    "#ffcf3d",
  ),
  style(
    "neon",
    "霓虹",
    {
      fontSize: 56,
      fontWeight: 700,
      color: "#e8fbff",
      shadow: "0 0 10px #38d6ff, 0 0 26px #38d6ff, 0 0 44px #a35bff",
    },
    "fade",
  ),
  style(
    "typewriter",
    "打字机",
    {
      fontSize: 44,
      fontFamily: "Menlo, 'SF Mono', monospace",
      background: "rgba(0,0,0,.5)",
      padding: 10,
      boxRadius: 4,
    },
    "typewriter",
  ),
  style(
    "variety",
    "综艺大字",
    {
      fontSize: 78,
      fontWeight: 900,
      color: "#fff35c",
      strokeColor: "#ff3d6e",
      strokeWidth: 9,
      shadow: "0 6px 0 #1c1c1c",
      bottom: 0.18,
    },
    "pop",
  ),
  style(
    "lower-third",
    "访谈小字",
    {
      fontSize: 34,
      fontWeight: 500,
      align: "left",
      bottom: 0.08,
      maxWidth: 0.6,
      background: "rgba(255,255,255,.9)",
      color: "#1b1f24",
      padding: 10,
      boxRadius: 6,
    },
    "slide-up",
  ),
  style(
    "subtle",
    "极简",
    {
      fontSize: 36,
      fontWeight: 400,
      letterSpacing: 0.04,
      shadow: "0 1px 3px rgba(0,0,0,.6)",
    },
    "fade-up",
  ),
];
export const captionAnimationNames: Record<CaptionAnimation, string> = {
  none: "无",
  fade: "淡入",
  "fade-up": "上浮淡入",
  pop: "弹出",
  "slide-up": "上滑",
  bounce: "弹跳",
  typewriter: "打字机",
  "word-pop": "逐词弹出",
  karaoke: "卡拉 OK",
  highlight: "逐词高亮",
};
/** Word-level animations need word timing on the clip. */
export const wordAnimations: CaptionAnimation[] = [
  "word-pop",
  "karaoke",
  "highlight",
];
export const findCaptionStyle = (p: Project, id: string) =>
  p.styles.captions.find((s) => s.id === id) ??
  captionPresets.find((s) => s.id === id);

const sentenceEnd = /[。！？!?…]$|[.]$/;
const softBreak = /[，,、；;：:]$/;
const trailing = /[，。、；：,.;:]+$/;
const cjk = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
export interface CaptionCue {
  start: number;
  duration: number;
  text: string;
  speaker: string;
  /** Word timing in cue-local frames. */
  words: { text: string; start: number; end: number }[];
}
/**
 * Splits the words heard on the timeline into readable cues: at most
 * maxChars characters (or maxWords words), breaking at sentence ends, long
 * pauses, speaker changes and clip boundaries, and preferring commas when a
 * cue is getting long.
 */
export function captionCues(
  transcript: Transcript,
  t: Timeline,
  options: {
    maxChars?: number;
    maxWords?: number;
    maxGap?: number;
    keepPunctuation?: boolean;
  } = {},
): CaptionCue[] {
  const maxChars = options.maxChars ?? 18,
    maxWords = options.maxWords ?? 10,
    maxGap = Math.round((options.maxGap ?? 0.7) * t.fps),
    groups: TimedWord[][] = [];
  const length = (group: TimedWord[]) =>
    transcriptText(group.map((w) => w.word)).text.length;
  for (const timed of wordsOnTimeline(transcript, t)) {
    let group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    const full =
      group &&
      (group.length >= maxWords ||
        length([...group, timed]) > maxChars ||
        // Past two thirds of the limit, a comma is a good place to stop.
        (softBreak.test(previous.word.text) &&
          length(group) > (maxChars * 2) / 3));
    if (
      !group ||
      full ||
      previous.clipId !== timed.clipId ||
      previous.word.speaker !== timed.word.speaker ||
      timed.start - previous.end > maxGap ||
      sentenceEnd.test(previous.word.text)
    ) {
      group = [];
      groups.push(group);
    }
    group.push(timed);
  }
  return groups.map((group) => {
    const start = group[0].start,
      end = Math.max(start + 1, group[group.length - 1].end),
      words = group.map((w) => ({
        text: w.word.text,
        start: w.start - start,
        end: Math.max(w.start - start + 1, w.end - start),
      }));
    let text = transcriptText(group.map((w) => w.word)).text;
    if (!options.keepPunctuation) {
      text = text.replace(trailing, "");
      const last = words[words.length - 1];
      last.text = last.text.replace(trailing, "") || last.text;
    }
    // Latin words read with spaces; the renderer joins words the same way.
    if (!cjk.test(text)) words.forEach((w, i) => i && (w.text = " " + w.text));
    return {
      start,
      duration: end - start,
      text,
      speaker: group[0].word.speaker,
      words,
    };
  });
}
/**
 * Commands that put a transcript's captions on a text track. With `replace`,
 * earlier captions on that track (clips with caption data) are removed first,
 * along with caption assets nothing else uses.
 */
export function buildCaptionClips(
  p: Project,
  t: Timeline,
  transcript: Transcript,
  makeId: MakeId,
  now: string,
  options: {
    styleId?: string;
    trackId?: string;
    replace?: boolean;
    maxChars?: number;
    maxWords?: number;
    animation?: CaptionAnimation;
  } = {},
): { commands: Command[]; count: number; trackId: string } {
  const chosen = options.styleId
    ? findCaptionStyle(p, options.styleId)
    : captionPresets[0];
  if (!chosen) throw new DomainError("NOT_FOUND", "字幕样式不存在");
  const cues = captionCues(transcript, t, options);
  if (!cues.length)
    throw new DomainError(
      "NO_CUES",
      "时间线上没有这段文稿对应的音视频，请先把素材放到时间线",
    );
  const commands: Command[] = [];
  let track = t.tracks.find(
    (x) => x.id === options.trackId && x.kind === "text",
  );
  if (options.trackId && !track)
    throw new DomainError("NOT_FOUND", "目标字幕轨道不存在");
  track ??= t.tracks.find((x) => x.kind === "text" && !x.locked);
  if (!track) {
    track = newTrack(t, "text", makeId());
    commands.push({ type: "track.add", timelineId: t.id, track });
  }
  if (track.locked) throw new DomainError("TRACK_LOCKED", "字幕轨道已锁定");
  const trackId = track.id;
  if (options.replace) {
    const old = t.clips.filter((c) => c.trackId === trackId && c.caption);
    commands.push(...diffClips(t.id, old, []));
    const kept = new Set(
      p.timelines.flatMap((x) =>
        x.clips.filter((c) => !old.includes(c)).map((c) => c.assetId),
      ),
    );
    for (const assetId of new Set(old.map((c) => c.assetId)))
      if (!kept.has(assetId)) commands.push({ type: "asset.remove", assetId });
  } else {
    const busy = t.clips.filter((c) => c.trackId === trackId);
    if (
      cues.some((cue) =>
        busy.some(
          (c) =>
            c.start < cue.start + cue.duration &&
            cue.start < c.start + c.duration,
        ),
      )
    )
      throw new DomainError(
        "TRACK_BUSY",
        "字幕轨道上已有内容，请选择替换已有字幕或换一条轨道",
      );
  }
  const asset = assetSchema.parse({
    id: makeId(),
    name: `字幕 · ${transcript.language || "文稿"}`,
    kind: "text",
    text: cues.map((c) => c.text).join("\n"),
    folder: "字幕",
    color: "#ae96c7",
    createdAt: now,
  });
  commands.push({ type: "asset.add", asset });
  const animation = options.animation ?? chosen.animation;
  for (const cue of cues)
    commands.push({
      type: "clip.add",
      timelineId: t.id,
      clip: clipSchema.parse({
        id: makeId(),
        assetId: asset.id,
        trackId,
        start: cue.start,
        duration: cue.duration,
        name: cue.text.slice(0, 40),
        text: cue.text,
        textStyle: chosen.textStyle,
        caption: {
          styleId: chosen.id,
          animation,
          ...(chosen.highlight ? { highlight: chosen.highlight } : {}),
          words: cue.words.slice(0, 400),
          language: transcript.language,
        },
      }),
    });
  return { commands, count: cues.length, trackId };
}
/** Applies a caption style to text clips. */
export function applyCaptionStyle(
  t: Timeline,
  clipIds: string[],
  chosen: CaptionStyle,
): Command[] {
  const ids = new Set(clipIds);
  return diffClips(
    t.id,
    t.clips,
    t.clips.map((c) =>
      ids.has(c.id)
        ? {
            ...c,
            textStyle: chosen.textStyle,
            caption: {
              ...c.caption,
              styleId: chosen.id,
              animation: chosen.animation,
              highlight: chosen.highlight,
            },
          }
        : c,
    ),
  );
}
/**
 * Puts translated text on caption clips, keeping the first original. Word
 * timing belongs to the original language, so word animations fall back to
 * animating the whole line.
 */
export function translateCaptions(
  t: Timeline,
  items: { clipId: string; text: string }[],
  language: string,
): Command[] {
  const byId = new Map(items.map((i) => [i.clipId, i.text]));
  return diffClips(
    t.id,
    t.clips,
    t.clips.map((c): Clip => {
      const text = byId.get(c.id);
      if (text === undefined) return c;
      const animation = c.caption?.animation ?? "none";
      return {
        ...c,
        text,
        caption: {
          ...c.caption,
          animation: wordFallback(animation),
          words: undefined,
          original: c.caption?.original ?? c.text ?? "",
          language,
        },
      };
    }),
  );
}
const wordFallback = (a: CaptionAnimation): CaptionAnimation =>
  a === "word-pop" ? "pop" : a === "karaoke" || a === "highlight" ? "fade" : a;

/** A detected subject's box at a timeline frame, in fractions of the frame. */
export interface SubjectBox {
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Approximate areas each platform's interface covers, as fractions of a vertical or horizontal frame. */
export const safeZones = {
  douyin: { name: "抖音", top: 0.12, bottom: 0.2, left: 0.04, right: 0.16 },
  tiktok: { name: "TikTok", top: 0.12, bottom: 0.2, left: 0.04, right: 0.16 },
  "youtube-shorts": {
    name: "YouTube Shorts",
    top: 0.1,
    bottom: 0.2,
    left: 0.04,
    right: 0.14,
  },
  reels: {
    name: "Instagram Reels",
    top: 0.12,
    bottom: 0.22,
    left: 0.04,
    right: 0.13,
  },
  xiaohongshu: {
    name: "小红书",
    top: 0.1,
    bottom: 0.18,
    left: 0.04,
    right: 0.1,
  },
  bilibili: {
    name: "哔哩哔哩",
    top: 0.05,
    bottom: 0.1,
    left: 0.03,
    right: 0.03,
  },
  youtube: {
    name: "YouTube",
    top: 0.05,
    bottom: 0.12,
    left: 0.03,
    right: 0.03,
  },
} as const;
export type SafeZone = keyof typeof safeZones;
/** A text style moved inside a platform's safe area. */
export function fitSafeZone(textStyle: TextStyle, zone: SafeZone): TextStyle {
  const z = safeZones[zone];
  return {
    ...textStyle,
    bottom: Math.max(textStyle.bottom, z.bottom + 0.02),
    ...(textStyle.top !== undefined
      ? { top: Math.max(textStyle.top, z.top + 0.02) }
      : {}),
    maxWidth: Math.min(textStyle.maxWidth, 1 - 2 * Math.max(z.left, z.right)),
  };
}
const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/** The band a caption occupies, as a box in frame fractions. */
function captionBand(c: Clip, t: Timeline, top?: number) {
  const s = c.textStyle ?? textStyleSchema.parse({}),
    lines = Math.max(1, Math.ceil((c.text ?? "").length / 22)),
    height = (s.fontSize * s.lineHeight * lines + s.padding * 2) / t.height,
    y = top ?? s.top ?? 1 - s.bottom - height;
  return { x: (1 - s.maxWidth) / 2, y, width: s.maxWidth, height };
}
/**
 * Moves captions that would cover a detected subject (a face, a product) to
 * the top of the frame, or back to the bottom when the top is busier.
 */
export function avoidSubjects(
  t: Timeline,
  clipIds: string[],
  boxes: SubjectBox[],
  topPosition = 0.08,
): Command[] {
  const ids = new Set(clipIds);
  return diffClips(
    t.id,
    t.clips,
    t.clips.map((c): Clip => {
      if (!ids.has(c.id) || !c.text) return c;
      const during = boxes.filter(
          (b) => b.frame >= c.start && b.frame < c.start + c.duration,
        ),
        style = c.textStyle ?? textStyleSchema.parse({}),
        { top: _top, ...bottomStyle } = style,
        bottomBand = captionBand({ ...c, textStyle: bottomStyle }, t),
        topBand = captionBand(c, t, topPosition),
        cost = (band: typeof bottomBand) =>
          during.reduce((sum, b) => sum + overlap(band, b), 0);
      if (!during.length) return c;
      const moveUp = cost(bottomBand) > cost(topBand) + 1e-4;
      return {
        ...c,
        textStyle: moveUp ? { ...style, top: topPosition } : bottomStyle,
      };
    }),
  );
}
/**
 * Where a graphic of the given size (frame fractions) covers the least of the
 * subjects, preferring positions away from the center and inside the margins.
 * Returns the graphic's center.
 */
export function freeRegion(
  boxes: Omit<SubjectBox, "frame">[],
  size: { width: number; height: number },
  margin = 0.05,
) {
  let best = { x: 0.5, y: 0.5, cost: Infinity, covered: 0 };
  const steps = 12;
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j <= steps; j++) {
      const x =
          margin + size.width / 2 + ((1 - 2 * margin - size.width) * i) / steps,
        y =
          margin +
          size.height / 2 +
          ((1 - 2 * margin - size.height) * j) / steps,
        box = {
          x: x - size.width / 2,
          y: y - size.height / 2,
          width: size.width,
          height: size.height,
        },
        covered = boxes.reduce((sum, b) => sum + overlap(box, b), 0),
        // A small pull toward the thirds keeps ties from landing in corners.
        cost =
          covered * 10 +
          Math.min(Math.abs(x - 1 / 3), Math.abs(x - 2 / 3)) * 0.02 +
          Math.min(Math.abs(y - 1 / 3), Math.abs(y - 2 / 3)) * 0.02;
      if (cost < best.cost) best = { x, y, cost, covered };
    }
  /** covered: how much of the subjects the graphic still overlaps, in frame area. */
  return { x: best.x, y: best.y, covered: best.covered };
}

/**
 * How much of the frame a layer shows, as fractions. Pictures are drawn in a
 * frame-sized box that is then scaled: `cover` fills that box, `contain`
 * shows the whole picture inside it. Animations draw anywhere in their box,
 * so they get a typical graphic size.
 */
export function layerSize(
  t: Timeline,
  c: Clip,
  asset: Pick<Asset, "kind" | "width" | "height">,
): { width: number; height: number } {
  if (asset.kind === "text") {
    const style = c.textStyle ?? textStyleSchema.parse({}),
      lines = Math.max(1, Math.ceil((c.text ?? "").length / 22));
    return {
      width: style.maxWidth,
      height: Math.min(
        1,
        (style.fontSize * style.lineHeight * lines + style.padding * 2) /
          t.height,
      ),
    };
  }
  if (asset.kind === "motion") return { width: 0.3, height: 0.2 };
  const crop = c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 },
    sx = c.scale * c.scaleX * (1 - crop.left - crop.right),
    sy = c.scale * c.scaleY * (1 - crop.top - crop.bottom);
  if (c.fit === "cover" || !asset.width || !asset.height)
    return { width: Math.min(1, sx), height: Math.min(1, sy) };
  const fit = Math.min(t.width / asset.width, t.height / asset.height);
  return {
    width: Math.min(1, (asset.width * fit * sx) / t.width),
    height: Math.min(1, (asset.height * fit * sy) / t.height),
  };
}
/** The change that moves a graphic or text clip to where it covers the least of the subjects. */
export function freeAreaPatch(
  t: Timeline,
  c: Clip,
  asset: Pick<Asset, "kind" | "width" | "height">,
  boxes: Omit<SubjectBox, "frame">[],
  size = layerSize(t, c, asset),
): { patch: Partial<Clip>; covered: number } {
  if (size.width >= 0.95 && size.height >= 0.95)
    throw new DomainError(
      "FULL_FRAME",
      "这个图层铺满了画面，没有空白处可放；请先缩小它",
    );
  const spot = freeRegion(boxes, size);
  // Text is placed by its style box; other layers move as a whole.
  const patch: Partial<Clip> =
    asset.kind === "text"
      ? {
          x: 0,
          y: 0,
          textStyle: {
            ...textStyleSchema.parse(c.textStyle ?? {}),
            top: Math.max(0, Math.min(1, spot.y - size.height / 2)),
            align: spot.x < 0.4 ? "left" : spot.x > 0.6 ? "right" : "center",
            maxWidth: Math.max(0.1, Math.min(1, size.width)),
          },
        }
      : { x: (spot.x - 0.5) * t.width, y: (spot.y - 0.5) * t.height };
  return { patch, covered: spot.covered };
}
