import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  makeProject,
  activeTimeline,
  assetSchema,
  clipSchema,
  shotSchema,
  sampleProperty,
  wordsOnTimeline,
  subtitleCues,
  storySyncConflicts,
  parseCube,
  sampleLut,
  analyzePcm,
  alignAudio,
  moveClips,
  newTrack,
  pasteClips,
  placeAsset,
  trimBounds,
  layoutStory,
  reframeTimeline,
  coverPosition,
  type Project,
} from "@tadacut/domain";
import { layersAt, renderPlan } from "../packages/render/src/plan";
const now = "2026-10-14T00:00:00Z";
function fixture() {
  const p = makeProject("test", "Test", now),
    t = activeTimeline(p);
  p.assets.push(
    assetSchema.parse({
      id: "a",
      name: "Audio",
      kind: "audio",
      url: "/media/a.wav",
      duration: 20,
      createdAt: now,
    }),
  );
  t.clips.push(
    clipSchema.parse({
      id: "c",
      assetId: "a",
      trackId: t.tracks[1].id,
      start: 60,
      duration: 300,
      sourceOffset: 2,
      speed: 2,
      keyframes: {
        volume: [
          { frame: 0, value: 0, easing: "linear" },
          { frame: 299, value: 1, easing: "linear" },
        ],
      },
    }),
  );
  return { p, t };
}
const edit = (p: ReturnType<typeof makeProject>, commands: unknown[]) =>
  applyTransaction(
    p,
    { requestId: "r", expectedRevision: p.revision, label: "test", commands },
    now,
  ).project;
describe("transactional editor", () => {
  it("rolls back the entire composite command on a broken reference", () => {
    const { p, t } = fixture();
    expect(() =>
      edit(p, [
        { type: "project.rename", name: "Changed" },
        {
          type: "clip.update",
          timelineId: t.id,
          clipId: "c",
          patch: { assetId: "missing" },
        },
      ]),
    ).toThrow("不存在");
    expect(p.name).toBe("Test");
    expect(p.revision).toBe(0);
  });
  it("rejects stale project revisions", () => {
    const { p } = fixture();
    expect(() =>
      applyTransaction(
        p,
        {
          requestId: "r",
          expectedRevision: 3,
          label: "",
          commands: [{ type: "project.rename", name: "Changed" }],
        },
        now,
      ),
    ).toThrow("发生变化");
  });
  it("rejects unknown commands instead of silently accepting them", () => {
    const { p } = fixture();
    expect(() => edit(p, [{ type: "shell", command: "rm" }])).toThrow();
  });
  it("honors locked tracks for adds and edits", () => {
    const { p, t } = fixture();
    t.tracks[1].locked = true;
    expect(() =>
      edit(p, [
        {
          type: "clip.update",
          timelineId: t.id,
          clipId: "c",
          patch: { start: 0 },
        },
      ]),
    ).toThrow("解锁");
    expect(() =>
      edit(p, [
        {
          type: "clip.add",
          timelineId: t.id,
          clip: { ...t.clips[0], id: "d" },
        },
      ]),
    ).toThrow("锁定");
  });
  it("splits with speed-correct source offset and continuous keyframe boundaries", () => {
    const { p, t } = fixture();
    const next = edit(p, [
        {
          type: "clip.split",
          timelineId: t.id,
          clipId: "c",
          at: 180,
          newClipId: "d",
        },
      ]),
      clips = activeTimeline(next).clips;
    expect(clips[0].duration).toBe(120);
    expect(clips[1].sourceOffset).toBe(10);
    expect(clips[1].duration).toBe(180);
    expect(sampleProperty(clips[1], "volume", 0)).toBeCloseTo(
      sampleProperty(t.clips[0], "volume", 120),
    );
  });
  it("cuts transcript words in source time, preserves keyframes, and ripples only that track", () => {
    const { p, t } = fixture();
    p.transcripts.push({
      id: "tr",
      assetId: "a",
      language: "zh",
      words: [
        { id: "w", text: "嗯", start: 4, end: 6, speaker: "A", deleted: false },
      ],
    });
    t.clips.push(
      clipSchema.parse({
        id: "later",
        assetId: "a",
        trackId: t.tracks[1].id,
        start: 500,
        duration: 30,
        sourceOffset: 0,
      }),
    );
    const next = edit(p, [
        {
          type: "transcript.cut",
          transcriptId: "tr",
          timelineId: t.id,
          wordIds: ["w"],
        },
      ]),
      clips = activeTimeline(next).clips;
    expect(clips[0].duration).toBe(30);
    expect(clips[1].start).toBe(90);
    expect(clips[1].sourceOffset).toBe(6);
    expect(clips.find((c) => c.id === "later")!.start).toBe(470);
    expect(next.transcripts[0].words[0].deleted).toBe(true);
  });
  it("preserves clip identity when selected words do not intersect its source range", () => {
    const { p, t } = fixture();
    p.transcripts.push({
      id: "tr",
      assetId: "a",
      language: "zh",
      words: [
        {
          id: "w",
          text: "outside",
          start: 40,
          end: 41,
          speaker: "A",
          deleted: false,
        },
      ],
    });
    const next = edit(p, [
      {
        type: "transcript.cut",
        transcriptId: "tr",
        timelineId: t.id,
        wordIds: ["w"],
      },
    ]);
    expect(activeTimeline(next).clips[0].id).toBe("c");
  });
  it("detects a conflict only when story and timeline both diverge", () => {
    const { p, t } = fixture();
    const shot = shotSchema.parse({
      id: "s",
      number: 1,
      title: "Shot",
      description: "",
      assetId: "a",
      duration: 10,
    });
    p.story.shots.push(shot);
    t.clips[0].shotId = shot.id;
    let next = edit(p, [
      {
        type: "story.sync",
        timelineId: t.id,
        trackId: t.tracks[1].id,
        direction: "timeline-to-story",
        force: false,
      },
    ]);
    next.story.shots[0].dialogue = "A new line";
    expect(storySyncConflicts(next, activeTimeline(next))).toEqual([]);
    activeTimeline(next).clips[0].duration = 200;
    expect(storySyncConflicts(next, activeTimeline(next))).toHaveLength(1);
    expect(() =>
      edit(next, [
        {
          type: "story.sync",
          timelineId: t.id,
          trackId: t.tracks[1].id,
          direction: "story-to-timeline",
          force: false,
        },
      ]),
    ).toThrow("两侧");
  });
  it("can synchronize a shortened shot without leaving out-of-range keyframes", () => {
    const { p, t } = fixture();
    p.story.shots.push(
      shotSchema.parse({
        id: "s",
        number: 1,
        title: "Shot",
        description: "",
        assetId: "a",
        duration: 1,
      }),
    );
    t.clips[0].shotId = "s";
    const next = edit(p, [
      {
        type: "story.sync",
        timelineId: t.id,
        trackId: t.tracks[1].id,
        direction: "story-to-timeline",
        force: true,
      },
    ]);
    expect(activeTimeline(next).clips[0].duration).toBe(30);
  });
});
describe("track placement, clipboard and trimming", () => {
  // Two images on the first video track: "one" at 0–90 and "two" at 120–180.
  function board() {
    const p = makeProject("board", "Board", now),
      t = activeTimeline(p);
    p.assets.push(
      assetSchema.parse({
        id: "img",
        name: "Still.png",
        kind: "image",
        url: "/media/still.png",
        createdAt: now,
      }),
      assetSchema.parse({
        id: "vid",
        name: "Take.mp4",
        kind: "video",
        url: "/media/take.mp4",
        duration: 10,
        createdAt: now,
      }),
      assetSchema.parse({
        id: "lut",
        name: "Look.cube",
        kind: "text",
        url: "/media/look.cube",
        createdAt: now,
      }),
    );
    for (const [id, start, duration] of [
      ["one", 0, 90],
      ["two", 120, 60],
    ] as const)
      t.clips.push(
        clipSchema.parse({
          id,
          assetId: "img",
          trackId: t.tracks[0].id,
          start,
          duration,
        }),
      );
    return { p, t };
  }
  let n = 0;
  const ids = () => `id-${++n}`;
  const withOverlay = (p: Project) => {
    const t = activeTimeline(p);
    t.tracks.push(newTrack(t, "video", "v2"));
    return t;
  };
  it("rejects clips on tracks of another kind and LUT files on the timeline", () => {
    const { p, t } = board();
    expect(() =>
      edit(p, [
        {
          type: "clip.update",
          timelineId: t.id,
          clipId: "one",
          patch: { trackId: t.tracks[1].id },
        },
      ]),
    ).toThrow("音频轨道不能放置图片素材");
    expect(() =>
      edit(p, [
        {
          type: "clip.add",
          timelineId: t.id,
          clip: { ...t.clips[0], id: "lut-clip", assetId: "lut" },
        },
      ]),
    ).toThrow("LUT");
    expect(() =>
      placeAsset(p, t, p.assets.find((a) => a.id === "lut")!, 0, ids),
    ).toThrow("LUT");
  });
  it("moves clips to a compatible track and blocks overlaps", () => {
    const { p } = board(),
      t = withOverlay(p);
    t.clips.push(
      clipSchema.parse({
        id: "above",
        assetId: "img",
        trackId: "v2",
        start: 200,
        duration: 60,
      }),
    );
    const moved = moveClips(p, t, ["one"], 0, 3);
    expect(moved).toEqual({
      moves: [{ clipId: "one", start: 0, trackId: "v2" }],
    });
    const next = edit(
      p,
      "moves" in moved
        ? moved.moves.map((m) => ({
            type: "clip.update",
            timelineId: t.id,
            clipId: m.clipId,
            patch: { start: m.start, trackId: m.trackId },
          }))
        : [],
    );
    expect(
      activeTimeline(next).clips.find((c) => c.id === "one")!.trackId,
    ).toBe("v2");
    expect(moveClips(p, t, ["one"], 150, 3)).toEqual({
      error: "目标位置已有片段",
      reason: "position",
    });
    expect(moveClips(p, t, ["one"], 60, 0)).toEqual({
      error: "目标位置已有片段",
      reason: "position",
    });
    expect(moveClips(p, t, ["one"], 0, 1)).toEqual({
      error: "音频轨道不能放置图片素材",
      reason: "track",
    });
    // "one" fits on the overlay track, but "two" would land on "above".
    expect(moveClips(p, t, ["one", "two"], 30, 3)).toEqual({
      error: "目标位置已有片段",
      reason: "position",
    });
  });
  it("pastes with relative timing on a free track and remaps groups", () => {
    const { p, t } = board();
    t.clips.forEach((c) => {
      c.groupId = "g";
      c.shotId = "s";
    });
    const pasted = pasteClips(
      p,
      t,
      { clips: structuredClone(t.clips), assets: [] },
      30,
      ids,
    );
    // 30–120 and 150–210 collide on the first track, so both go to one new overlay track.
    expect(pasted.commands.filter((c) => c.type === "track.add")).toHaveLength(
      1,
    );
    const next = activeTimeline(edit(p, pasted.commands)),
      copies = next.clips.filter((c) => pasted.clipIds.includes(c.id));
    expect(copies.map((c) => [c.start, c.duration])).toEqual([
      [30, 90],
      [150, 60],
    ]);
    expect(new Set(copies.map((c) => c.trackId)).size).toBe(1);
    expect(copies[0].trackId).not.toBe(t.tracks[0].id);
    expect(copies.every((c) => c.shotId === undefined)).toBe(true);
    expect(copies[0].groupId).toBeDefined();
    expect(copies[0].groupId).not.toBe("g");
    expect(copies[1].groupId).toBe(copies[0].groupId);
    expect(pasted.end).toBe(210);
    // Pasting after the material keeps the original track.
    const after = pasteClips(
      p,
      t,
      { clips: [structuredClone(t.clips[0])], assets: [] },
      400,
      ids,
    );
    expect(after.commands).toEqual([
      expect.objectContaining({
        type: "clip.add",
        clip: expect.objectContaining({ trackId: t.tracks[0].id, start: 400 }),
      }),
    ]);
  });
  it("carries assets when pasting into another project", () => {
    const { p, t } = board(),
      other = makeProject("other", "Other", now);
    const pasted = pasteClips(
      other,
      activeTimeline(other),
      { clips: [t.clips[0]], assets: [p.assets[0]] },
      0,
      ids,
    );
    expect(pasted.commands[0]).toEqual({
      type: "asset.add",
      asset: p.assets[0],
    });
    expect(activeTimeline(edit(other, pasted.commands)).clips).toHaveLength(1);
  });
  it("places a new asset beside busy clips instead of covering them", () => {
    const { p, t } = board();
    const placed = placeAsset(
      p,
      t,
      p.assets.find((a) => a.id === "img")!,
      60,
      ids,
      t.tracks[0].id,
    );
    expect(placed.commands.map((c) => c.type)).toEqual([
      "track.add",
      "clip.add",
    ]);
    expect(() => edit(p, placed.commands)).not.toThrow();
  });
  it("limits trims to neighbors and the source media", () => {
    const { p, t } = board(),
      clip = clipSchema.parse({
        id: "take",
        assetId: "vid",
        trackId: t.tracks[0].id,
        start: 300,
        duration: 60,
        sourceOffset: 2,
      });
    t.clips.push(clip);
    expect(trimBounds(t, clip, p.assets[1])).toEqual({
      minStart: 240,
      maxEnd: 540,
    });
    t.clips.push({ ...clip, id: "blocker", start: 420 });
    expect(trimBounds(t, clip, p.assets[1]).maxEnd).toBe(420);
    expect(trimBounds(t, t.clips[1], p.assets[0])).toEqual({
      minStart: 90,
      maxEnd: 300,
    });
  });
  it("keeps the outgoing transition only on the right half after a split", () => {
    const { p, t } = board();
    t.clips[0].transition = { kind: "dissolve", duration: 10 };
    const clips = activeTimeline(
      edit(p, [
        {
          type: "clip.split",
          timelineId: t.id,
          clipId: "one",
          at: 30,
          newClipId: "one-b",
        },
      ]),
    ).clips;
    expect(clips.find((c) => c.id === "one")!.transition).toBeUndefined();
    expect(clips.find((c) => c.id === "one-b")!.transition).toEqual({
      kind: "dissolve",
      duration: 10,
    });
  });
  it("brings a shot clip from another track back without duplicating its ID", () => {
    const { p } = board(),
      t = withOverlay(p);
    p.story.shots.push(
      shotSchema.parse({
        id: "s",
        number: 1,
        title: "Shot",
        description: "",
        assetId: "img",
        duration: 2,
      }),
    );
    t.clips.push(
      clipSchema.parse({
        id: "shot-clip",
        assetId: "img",
        trackId: "v2",
        start: 400,
        duration: 60,
        shotId: "s",
      }),
    );
    const clips = activeTimeline(
      edit(p, [
        {
          type: "story.sync",
          timelineId: t.id,
          trackId: t.tracks[0].id,
          direction: "story-to-timeline",
          force: true,
        },
      ]),
    ).clips.filter((c) => c.shotId === "s");
    expect(clips).toEqual([
      expect.objectContaining({
        id: "shot-clip",
        trackId: t.tracks[0].id,
        duration: 60,
      }),
    ]);
  });
});
describe("storyboard layout", () => {
  const board = () => {
    const p = makeProject("story", "Story", now),
      t = activeTimeline(p);
    p.assets.push(
      assetSchema.parse({
        id: "img",
        name: "Still.png",
        kind: "image",
        url: "/media/still.png",
        createdAt: now,
      }),
      assetSchema.parse({
        id: "vid",
        name: "Take.mp4",
        kind: "video",
        url: "/media/take.mp4",
        duration: 10,
        createdAt: now,
      }),
    );
    for (const [id, start, duration] of [
      ["one", 0, 90],
      ["two", 120, 60],
    ] as const)
      t.clips.push(
        clipSchema.parse({
          id,
          assetId: "img",
          trackId: t.tracks[0].id,
          start,
          duration,
        }),
      );
    p.story.shots.push(
      shotSchema.parse({
        id: "s1",
        number: 1,
        title: "One",
        description: "",
        assetId: "img",
        duration: 1,
      }),
      shotSchema.parse({
        id: "s2",
        number: 2,
        title: "Two",
        description: "",
        assetId: "vid",
        duration: 2,
      }),
    );
    return { p, t };
  };
  const sync = (p: Project, trackId: string) =>
    edit(p, [
      {
        type: "story.sync",
        timelineId: activeTimeline(p).id,
        trackId,
        direction: "story-to-timeline",
        force: true,
      },
    ]);
  it("lays a new storyboard after the clips already on the track", () => {
    const { p, t } = board();
    const laid = activeTimeline(sync(p, t.tracks[0].id)).clips.filter(
      (c) => c.shotId,
    );
    expect(laid.map((c) => [c.start, c.duration])).toEqual([
      [180, 30],
      [210, 60],
    ]);
  });
  it("keeps an existing sequence in place and refuses to cover other clips", () => {
    const { p, t } = board();
    t.clips.push(
      clipSchema.parse({
        id: "old",
        assetId: "img",
        trackId: t.tracks[0].id,
        start: 90,
        duration: 20,
        shotId: "s1",
      }),
    );
    expect(layoutStory(p, t, t.tracks[0].id).blocked?.id).toBe("two");
    expect(() => sync(p, t.tracks[0].id)).toThrow("分镜序列会覆盖");
    const free = newTrack(t, "video", "v2");
    t.tracks.push(free);
    const laid = activeTimeline(sync(p, free.id)).clips.filter((c) => c.shotId);
    expect(laid.map((c) => [c.id, c.trackId, c.start])).toEqual([
      ["old", "v2", 90],
      ["shot-clip-" + t.id + "-s2", "v2", 120],
    ]);
  });
});
describe("multi-format reframing", () => {
  it("keeps relative positions and text size and centers detected subjects", () => {
    const p = makeProject("frame", "Frame", now),
      t = activeTimeline(p);
    p.assets.push(
      assetSchema.parse({
        id: "v",
        name: "Wide.mp4",
        kind: "video",
        url: "/media/wide.mp4",
        width: 1920,
        height: 1080,
        duration: 10,
        createdAt: now,
      }),
      assetSchema.parse({
        id: "txt",
        name: "Title",
        kind: "text",
        createdAt: now,
      }),
    );
    t.clips.push(
      clipSchema.parse({
        id: "wide",
        assetId: "v",
        trackId: t.tracks[0].id,
        start: 0,
        duration: 90,
        x: 192,
        keyframes: { y: [{ frame: 0, value: 108 }] },
      }),
      clipSchema.parse({
        id: "title",
        assetId: "txt",
        trackId: t.tracks[2].id,
        start: 0,
        duration: 90,
        text: "Hi",
        textStyle: { fontSize: 60 },
      }),
    );
    const next = reframeTimeline(
      t,
      p.assets,
      { id: "tall", name: "竖屏", width: 1080, height: 1920 },
      {
        wide: [
          { frame: 0, x: 0.8, y: 0.5 },
          { frame: 60, x: 0.8, y: 0.5 },
        ],
      },
    );
    const wide = next.clips.find((c) => c.assetId === "v")!;
    expect(wide.x).toBeCloseTo(108);
    expect(wide.keyframes.y![0].value).toBeCloseTo(192);
    // 9:16 shows 31.6% of a 16:9 source's width; a subject at 80% needs the crop near its right edge.
    const visible = 0.5625 / (1920 / 1080);
    expect(wide.keyframes.focusX![0].value).toBeCloseTo(
      (0.8 - visible / 2) / (1 - visible),
    );
    expect(wide.keyframes.focusY).toBeUndefined();
    expect(
      next.clips.find((c) => c.assetId === "txt")!.textStyle!.fontSize,
    ).toBe(60);
    expect(
      next.clips.every((c) => next.tracks.some((tr) => tr.id === c.trackId)),
    ).toBe(true);
    const q = edit(p, [{ type: "timeline.create", timeline: next }]);
    expect(activeTimeline(q)).toMatchObject({ id: "tall", width: 1080 });
    expect(q.timelines).toHaveLength(2);
  });
  it("puts the subject in the middle of a cover crop", () => {
    expect(coverPosition(0.5, 0.3)).toBeCloseTo(0.5);
    expect(coverPosition(0.05, 0.3)).toBe(0);
    expect(coverPosition(0.99, 0.3)).toBe(1);
    expect(coverPosition(0.7, 1)).toBe(0.5);
  });
});
describe("signal and rendering contracts", () => {
  it("measures actual PCM energy and silence", () => {
    const samples = new Float32Array(8000).fill(0.2);
    const result = analyzePcm(samples, 8000);
    expect(result.rmsDb).toBeCloseTo(20 * Math.log10(0.2), 2);
    expect(result.waveform.every((v) => v > 0)).toBe(true);
  });
  it("aligns a delayed second microphone", () => {
    const a = Array.from(
        { length: 200 },
        (_, i) => Math.sin(i * 1.618) ** 2 * Math.sin(i * 0.713) ** 2,
      ),
      b = Array.from({ length: 200 }, (_, i) => (i >= 7 ? a[i - 7] : 0));
    const result = alignAudio(a, b, 10);
    expect(Math.abs(result.offsetSeconds)).toBeCloseTo(0.7);
    expect(result.confidence).toBeGreaterThan(0.8);
  });
  it("interpolates an identity 3D LUT", () => {
    const data =
      "LUT_3D_SIZE 2\n" +
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
      ]
        .map((v) => v.join(" "))
        .join("\n");
    const cube = parseCube(data);
    sampleLut(cube, [0.2, 0.4, 0.8]).forEach((v, i) =>
      expect(v).toBeCloseTo([0.2, 0.4, 0.8][i]),
    );
  });
  it("rejects invalid LUT data", () =>
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0")).toThrow());
  it.each(["dissolve", "wipe", "slide"] as const)(
    "pre-rolls the next shot for a %s transition",
    (kind) => {
      const { p, t } = fixture();
      p.assets[0].kind = "image";
      t.clips[0].start = 0;
      t.clips[0].duration = 90;
      t.clips[0].transition = { kind, duration: 30 };
      t.clips.push({
        ...t.clips[0],
        id: "next",
        start: 90,
        transition: undefined,
      });
      const layers = layersAt(t, p.assets, 75);
      expect(layers).toHaveLength(2);
      expect(layers[1].transition).toEqual({ kind, progress: 0.5 });
    },
  );
  it("plans alpha exports and rejects incompatible codecs", () => {
    const { p, t } = fixture();
    expect(renderPlan(p, t, "prores", true).extension).toBe("mov");
    expect(() => renderPlan(p, t, "h264", true)).toThrow("透明");
  });
  it("blocks export if a source has not been relinked", () => {
    const { p, t } = fixture();
    p.assets[0].url = "";
    expect(() => renderPlan(p, t, "h264")).toThrow("重连");
  });
});

describe("word-to-timeline mapping", () => {
  it("maps source words through clip offset, speed and timeline start", () => {
    const { t } = fixture();
    const transcript = {
      id: "tr",
      assetId: "a",
      language: "zh",
      words: [
        {
          id: "w",
          text: "Hello",
          start: 4,
          end: 6,
          speaker: "A",
          deleted: false,
        },
      ],
    };
    const [word] = wordsOnTimeline(transcript, t);
    expect(word.start).toBe(90);
    expect(word.end).toBe(120);
    expect(subtitleCues(transcript, t)[0].duration).toBe(30);
  });
  it("does not put subtitles for deleted or unused source ranges on the timeline", () => {
    const { t } = fixture();
    const transcript = {
      id: "tr",
      assetId: "a",
      language: "zh",
      words: [
        {
          id: "w",
          text: "Hello",
          start: 4,
          end: 6,
          speaker: "A",
          deleted: true,
        },
        {
          id: "outside",
          text: "Out",
          start: 40,
          end: 41,
          speaker: "A",
          deleted: false,
        },
      ],
    };
    expect(subtitleCues(transcript, t)).toEqual([]);
  });
});
