import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  activeTimeline,
  applyTransaction,
  assetSchema,
  clipSchema,
  makeProject,
  maskSchema,
  maskSvg,
  sampleMask,
  remappedDuration,
  sourceAtOutput,
  formatFrameTimecode,
  timelineProfileSchema,
  dependencyValue,
  parseSubtitles,
  importSubtitleCommands,
  convertColor,
  decodeTransfer,
  encodeTransfer,
  homography,
  trackRegion,
  validateProject,
  type Command,
} from "@tadacut/domain";
const now = "2026-10-18T00:00:00Z";
function fixture() {
  const p = makeProject("advanced", "Advanced", now),
    t = activeTimeline(p);
  p.assets.push(
    assetSchema.parse({
      id: "v",
      kind: "video",
      name: "Test",
      url: "/media/a.mp4",
      duration: 10,
      createdAt: now,
    }),
  );
  t.clips.push(
    clipSchema.parse({
      id: "c",
      assetId: "v",
      trackId: t.tracks[0].id,
      start: 30,
      duration: 300,
      keyframes: {
        x: [
          { frame: 0, value: 0 },
          { frame: 299, value: 100 },
        ],
      },
      advanced: {
        masks: [
          maskSchema.parse({
            id: "m",
            shape: "ellipse",
            keys: [{ frame: 299, x: 0.5, y: 0.5, width: 0.5, height: 0.5 }],
          }),
        ],
      },
    }),
  );
  return p;
}
const apply = (p: ReturnType<typeof fixture>, commands: Command[]) =>
  applyTransaction(
    p,
    {
      requestId: crypto.randomUUID(),
      expectedRevision: p.revision,
      label: "test",
      commands,
    },
    now,
  ).project;
describe("advanced editing domain", () => {
  it("integrates and inverts a changing speed without accumulating segment drift", () => {
    const points = [
      { position: 0, speed: 0.5 },
      { position: 0.4, speed: 3 },
      { position: 1, speed: 1 },
    ];
    for (const fraction of [0, 0.01, 0.2, 0.4, 0.6, 0.99, 1])
      expect(
        sourceAtOutput(remappedDuration(12, points, fraction), 12, points),
      ).toBeCloseTo(12 * fraction, 8);
    expect(
      remappedDuration(10, [
        { position: 0, speed: 2 },
        { position: 1, speed: 2 },
      ]),
    ).toBe(5);
  });
  it("formats NTSC drop frame boundaries and never drops actual video frames", () => {
    const p = timelineProfileSchema.parse({
      rate: { numerator: 30000, denominator: 1001 },
      dropFrame: true,
    });
    expect(formatFrameTimecode(1799, p)).toBe("00:00:59;29");
    expect(formatFrameTimecode(1800, p)).toBe("00:01:00;02");
    expect(formatFrameTimecode(17982, p)).toBe("00:10:00;00");
    expect(formatFrameTimecode(107892, p)).toBe("01:00:00;00");
    expect(() =>
      timelineProfileSchema.parse({
        ...p,
        rate: { numerator: 25, denominator: 1 },
      }),
    ).toThrow();
  });
  it("preserves time when changing frame rates and clamps animation endpoints", () => {
    const p = fixture(),
      t = activeTimeline(p),
      before = t.clips[0];
    const next = apply(p, [
      {
        type: "timeline.profile",
        timelineId: t.id,
        profile: timelineProfileSchema.parse({
          rate: { numerator: 24000, denominator: 1001 },
        }),
        preserveTime: true,
      },
    ]);
    const after = activeTimeline(next),
      c = after.clips[0];
    expect(c.duration / after.fps).toBeCloseTo(before.duration / t.fps, 1);
    expect(c.keyframes.x!.at(-1)!.frame).toBeLessThan(c.duration);
    expect(c.advanced!.masks![0].keys[0].frame).toBeLessThan(c.duration);
    expect(() => validateProject(next)).not.toThrow();
  });
  it("rejects applying stale processing even when the caller supplies a fresh revision", () => {
    const p = fixture(),
      t = activeTimeline(p),
      dep = { kind: "clip" as const, id: "c", timelineId: t.id },
      guard: Command = {
        type: "project.assert",
        dependencies: [{ ...dep, value: dependencyValue(p, dep) }],
      };
    const next = apply(p, [
      { type: "clip.update", timelineId: t.id, clipId: "c", patch: { x: 10 } },
    ]);
    expect(() =>
      apply(next, [
        guard,
        {
          type: "clip.update",
          timelineId: t.id,
          clipId: "c",
          patch: { speed: 2 },
        },
      ]),
    ).toThrow(/原素材/);
    const renamed = apply(p, [
      { type: "project.rename", name: "safe independent edit" },
    ]);
    expect(() => apply(renamed, [guard])).not.toThrow();
  });
  it("slices animated masks with boundary samples when splitting", () => {
    const p = fixture(),
      t = activeTimeline(p),
      m = t.clips[0].advanced!.masks![0];
    m.keys = [
      {
        frame: 0,
        x: 0.2,
        y: 0.5,
        width: 0.5,
        height: 0.5,
        rotation: 0,
        feather: 0,
      },
      {
        frame: 299,
        x: 0.8,
        y: 0.5,
        width: 0.5,
        height: 0.5,
        rotation: 0,
        feather: 0.1,
      },
    ];
    const next = apply(p, [
      {
        type: "clip.split",
        timelineId: t.id,
        clipId: "c",
        at: 180,
        newClipId: "right",
      },
    ]);
    const right = activeTimeline(next).clips[1];
    expect(sampleMask(right.advanced!.masks![0], 0).x).toBeCloseTo(
      sampleMask(m, 150).x,
    );
    expect(right.advanced!.masks![0].keys.at(-1)!.frame).toBeLessThan(
      right.duration,
    );
  });
  it("renders additive/subtractive masks, invert and feather into actual pixels", async () => {
    const sample = async (masks: ReturnType<typeof maskSchema.parse>[]) => {
      const { data, info } = await sharp(Buffer.from(maskSvg(masks, 100, 100)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return (x: number, y: number) => data[(y * info.width + x) * 4];
    };
    const circle = maskSchema.parse({
      id: "a",
      shape: "ellipse",
      width: 0.6,
      height: 0.6,
    });
    let px = await sample([circle]);
    expect(px(50, 50)).toBe(255);
    expect(px(1, 1)).toBe(0);
    px = await sample([{ ...circle, inverted: true }]);
    expect(px(50, 50)).toBe(0);
    expect(px(1, 1)).toBe(255);
    px = await sample([
      circle,
      maskSchema.parse({
        id: "b",
        shape: "rectangle",
        width: 0.2,
        height: 0.2,
        operation: "subtract",
      }),
    ]);
    expect(px(50, 50)).toBe(0);
    expect(px(70, 50)).toBe(255);
    px = await sample([{ ...circle, feather: 0.2 }]);
    expect(px(79, 50)).toBeGreaterThan(0);
    expect(px(79, 50)).toBeLessThan(255);
  });
  it("imports timed subtitles, ASS karaoke and LRC offset with one editable transaction", () => {
    const srt = parseSubtitles(
      "1\n00:00:01,250 --> 00:00:02,500\n<b>Hello</b>\nWorld\n",
      "srt",
    );
    expect(srt.cues[0]).toMatchObject({
      start: 1.25,
      end: 2.5,
      text: "Hello\nWorld",
    });
    const ass = parseSubtitles(
      "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\k50}你好,{\\k150}世界",
      "ass",
    );
    expect(ass.cues[0].words?.[1]).toMatchObject({
      text: "世界",
      start: 1.5,
      end: 3,
    });
    const lrc = parseSubtitles(
      "[offset:200]\n[00:01.00][00:03.00]line one\n[00:05.00]line two",
      "lrc",
    );
    expect(lrc.cues.map((c) => c.start)).toEqual([1.2, 3.2, 5.2]);
    expect(lrc.cues[0].end).toBe(3.2);
    const p = fixture(),
      t = activeTimeline(p);
    let id = 0;
    const result = importSubtitleCommands(
      p,
      t,
      { format: "srt", text: "1\n00:00:00,000 --> 00:00:02,000\n你好\n" },
      () => `sub${id++}`,
      now,
    );
    const next = apply(p, result.commands);
    expect(activeTimeline(next).clips.at(-1)?.text).toBe("你好");
    expect(next.revision).toBe(p.revision + 1);
  });
  it("rejects canvas group cycles and missing references atomically", () => {
    const p = fixture();
    expect(() =>
      apply(p, [
        {
          type: "canvas.upsert",
          node: {
            id: "g",
            kind: "group",
            parentId: "g",
            x: 0,
            y: 0,
            label: "cycle",
          },
        },
      ]),
    ).toThrow(/包含自身/);
    expect(() =>
      apply(p, [
        {
          type: "canvas.upsert",
          node: {
            id: "n",
            kind: "note",
            references: ["missing"],
            x: 0,
            y: 0,
            label: "bad",
          },
        },
      ]),
    ).toThrow(/引用/);
  });
  it("converts transfer functions and color primaries, preserving HDR values in the transform", () => {
    for (const space of [
      "rec709",
      "srgb",
      "rec2020-pq",
      "rec2020-hlg",
    ] as const)
      for (const value of [0.01, 0.25, 0.5, 0.9])
        expect(encodeTransfer(decodeTransfer(value, space), space)).toBeCloseTo(
          value,
          5,
        );
    expect(decodeTransfer(1, "rec2020-pq")).toBeCloseTo(10000, 3);
    expect(convertColor([0.5, 0.5, 0.5], "rec709", "rec709")).toEqual([
      0.5, 0.5, 0.5,
    ]);
    const v = convertColor([1, 1, 1], "rec709", "rec2020-pq");
    expect(v[0]).toBeCloseTo(encodeTransfer(203, "rec2020-pq"), 5);
  });
  it("tracks moving textured patches and solves perspective from four correspondences", () => {
    const width = 80,
      height = 80,
      pixels = new Uint8Array(width * height),
      current = new Uint8Array(width * height);
    let seed = 7;
    for (let y = 10; y < 65; y++)
      for (let x = 10; x < 65; x++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        pixels[y * width + x] = seed >>> 24;
        current[(y + 3) * width + x + 4] = pixels[y * width + x];
      }
    const corners: [number, number][] = [
      [20, 20],
      [50, 20],
      [50, 50],
      [20, 50],
    ];
    const result = trackRegion(
      { pixels, width, height },
      { pixels: current, width, height },
      corners,
      "plane",
    );
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.corners[0][0]).toBeCloseTo(24, 0);
    expect(result.corners[0][1]).toBeCloseTo(23, 0);
    const h = homography(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      [
        [0, 0],
        [2, 0],
        [1.5, 1],
        [0.5, 1],
      ],
    )!;
    const mapped = (x: number, y: number) => [
      (h[0] * x + h[1] * y + h[2]) / (h[6] * x + h[7] * y + 1),
      (h[3] * x + h[4] * y + h[5]) / (h[6] * x + h[7] * y + 1),
    ];
    expect(mapped(1, 1)[0]).toBeCloseTo(1.5);
    expect(mapped(1, 1)[1]).toBeCloseTo(1);
  });
});
