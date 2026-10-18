import { describe, expect, it } from "vitest";
import {
  activeTimeline,
  applyLayout,
  applyTransaction,
  assetSchema,
  avoidSubjects,
  buildCaptionClips,
  captionCues,
  captionPresets,
  clipSchema,
  closeGaps,
  cubicBezier,
  duplicateClips,
  effectParams,
  effectPresets,
  exportTimelineMarkdown,
  applyTimelineMarkdown,
  fillerWords,
  findInTranscript,
  energyOnTimeline,
  fitMusic,
  fitMusicClip,
  fitSafeZone,
  freeAreaPatch,
  layerSize,
  generateLook,
  histogram,
  insertEdit,
  looks,
  makeProject,
  nestClips,
  overwriteEdit,
  parseCube,
  productionPlan,
  rangesTimeline,
  recordProduction,
  replaceInTranscript,
  restoreProduction,
  rippleDelete,
  rollEdit,
  safeZones,
  scriptRowSchema,
  serializeCube,
  shotSchema,
  shotsFromScript,
  slideClip,
  slipClip,
  snapCutsToBeats,
  stableHash,
  textStyleSchema,
  translateCaptions,
  type Clip,
  type Command,
  type LookId,
  type Project,
  type Transcript,
} from "@tadacut/domain";
import { renderConcurrency } from "../packages/render/src/plan";

const now = "2026-10-15T00:00:00Z";
const ids = (prefix = "n") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};
/** A project with two 60 s videos, a 60 s voice track, a still and a text asset. */
function fixture() {
  const p = makeProject("features", "Features", now),
    t = activeTimeline(p);
  for (const [id, kind, duration] of [
    ["v1", "video", 60],
    ["v2", "video", 60],
    ["au", "audio", 60],
    ["img", "image", undefined],
  ] as const)
    p.assets.push(
      assetSchema.parse({
        id,
        name: id.toUpperCase(),
        kind,
        url: `/media/${id}`,
        duration,
        createdAt: now,
      }),
    );
  p.assets.push(
    assetSchema.parse({
      id: "tx",
      name: "TX",
      kind: "text",
      text: "字幕",
      createdAt: now,
    }),
  );
  const [video, audio, text] = t.tracks.map((x) => x.id);
  return { p, t, video, audio, text };
}
const clip = (
  id: string,
  assetId: string,
  trackId: string,
  start: number,
  duration: number,
  extra: Partial<Clip> = {},
) => clipSchema.parse({ id, assetId, trackId, start, duration, ...extra });
const edit = (p: Project, commands: Command[]) =>
  applyTransaction(
    p,
    { requestId: "r", expectedRevision: p.revision, label: "test", commands },
    now,
  ).project;
const onTrack = (p: Project, trackId: string) =>
  activeTimeline(p)
    .clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
const spans = (clips: Clip[]) => clips.map((c) => [c.start, c.duration]);
const patchOf = (c: Command) => (c as { patch: Record<string, unknown> }).patch;

describe("ripple, insert and overwrite edits", () => {
  it("moves sync-locked tracks with a ripple delete", () => {
    const { p, t, video, audio } = fixture();
    t.tracks[1].syncLock = true;
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90),
      clip("C", "v1", video, 180, 90),
      clip("M", "au", audio, 0, 300),
    );
    const after = edit(p, rippleDelete(t, ["B"], ids()));
    expect(spans(onTrack(after, video))).toEqual([
      [0, 90],
      [90, 90],
    ]);
    const music = onTrack(after, audio);
    expect(spans(music)).toEqual([
      [0, 90],
      [90, 120],
    ]);
    // The music after the cut continues from where it was heard before.
    expect(music[1].sourceOffset).toBeCloseTo(6);
  });
  it("refuses a ripple that would pull sync-locked tracks out of alignment", () => {
    const { t, video, audio } = fixture();
    t.tracks[2].syncLock = true;
    t.clips.push(clip("B", "v2", video, 90, 90), clip("N", "au", audio, 0, 60));
    expect(() => rippleDelete(t, ["B", "N"], ids())).toThrow(/同步锁定/);
  });
  it("deletes linked clips together", () => {
    const { p, t, video, audio } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90, { linkId: "L" }),
      clip("BA", "au", audio, 90, 90, { linkId: "L" }),
      clip("C", "v1", video, 180, 60),
    );
    const after = edit(p, rippleDelete(t, ["B"], ids()));
    expect(onTrack(after, audio)).toEqual([]);
    expect(spans(onTrack(after, video))).toEqual([
      [0, 90],
      [90, 60],
    ]);
  });
  it("inserts by pushing later material right and splitting what it lands in", () => {
    const { p, t, video } = fixture();
    t.clips.push(clip("A", "v1", video, 0, 90), clip("B", "v2", video, 90, 90));
    const after = edit(
      p,
      insertEdit(p, t, [clip("I", "img", video, 45, 30)], ids()),
    );
    const clips = onTrack(after, video);
    expect(clips.map((c) => c.id)).toEqual(["A", "I", "n1", "B"]);
    expect(spans(clips)).toEqual([
      [0, 45],
      [45, 30],
      [75, 45],
      [120, 90],
    ]);
    expect(clips[2].sourceOffset).toBeCloseTo(1.5);
  });
  it("rejects inserted clips that start on different frames", () => {
    const { p, t, video } = fixture();
    expect(() =>
      insertEdit(
        p,
        t,
        [clip("I", "img", video, 0, 30), clip("J", "img", video, 10, 30)],
        ids(),
      ),
    ).toThrow(/同一帧/);
  });
  it("overwrites without moving anything else", () => {
    const { p, t, video } = fixture();
    t.clips.push(clip("A", "v1", video, 0, 90), clip("B", "v2", video, 90, 90));
    const after = edit(
      p,
      overwriteEdit(p, t, [clip("O", "img", video, 45, 90)], ids()),
    );
    const clips = onTrack(after, video);
    expect(clips.map((c) => c.id)).toEqual(["A", "O", "B"]);
    expect(spans(clips)).toEqual([
      [0, 45],
      [45, 90],
      [135, 45],
    ]);
    expect(clips[2].sourceOffset).toBeCloseTo(1.5);
  });
});

describe("trim tools", () => {
  it("slips the source inside the clip and stops at the media edges", () => {
    const { p, t, video } = fixture();
    t.clips.push(clip("A", "v1", video, 30, 90, { sourceOffset: 2 }));
    let after = edit(p, slipClip(p, t, "A", 30));
    expect(onTrack(after, video)[0]).toMatchObject({
      start: 30,
      duration: 90,
      sourceOffset: 3,
    });
    after = edit(after, slipClip(after, activeTimeline(after), "A", -3000));
    expect(onTrack(after, video)[0].sourceOffset).toBe(0);
    after = edit(after, slipClip(after, activeTimeline(after), "A", 99999));
    // 60 s of media, 3 s shown.
    expect(onTrack(after, video)[0].sourceOffset).toBeCloseTo(57);
  });
  it("only slips clips with a source range", () => {
    const { p, t, video } = fixture();
    t.clips.push(clip("S", "img", video, 0, 60));
    expect(() => slipClip(p, t, "S", 10)).toThrow(/滑移/);
  });
  it("rolls a cut between adjacent clips", () => {
    const { p, t, video } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90, { sourceOffset: 10 }),
    );
    const after = edit(p, rollEdit(p, t, "A", "B", 15));
    const [a, b] = onTrack(after, video);
    expect([a.start, a.duration]).toEqual([0, 105]);
    expect([b.start, b.duration]).toEqual([105, 75]);
    expect(b.sourceOffset).toBeCloseTo(10.5);
    expect(() => rollEdit(p, t, "B", "A", 5)).toThrow(/相邻/);
  });
  it("rolls back no further than the right clip's media allows", () => {
    const { p, t, video } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90, { sourceOffset: 0.5 }),
    );
    const after = edit(p, rollEdit(p, t, "A", "B", -60));
    const [a, b] = onTrack(after, video);
    // B can only reveal 0.5 s (15 frames) earlier.
    expect(a.duration).toBe(75);
    expect([b.start, b.sourceOffset]).toEqual([75, 0]);
  });
  it("slides a clip between its neighbors", () => {
    const { p, t, video } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90, { sourceOffset: 10 }),
      clip("C", "v1", video, 180, 90, { sourceOffset: 5 }),
    );
    const after = edit(p, slideClip(p, t, "B", 15));
    const [a, b, c] = onTrack(after, video);
    expect(spans([a, b, c])).toEqual([
      [0, 105],
      [105, 90],
      [195, 75],
    ]);
    expect(b.sourceOffset).toBe(10);
    expect(c.sourceOffset).toBeCloseTo(5.5);
    expect(() => slideClip(p, t, "A", 5)).toThrow(/两侧/);
  });
});

describe("arranging clips", () => {
  it("closes gaps and brings linked clips on other tracks along", () => {
    const { p, t, video, audio } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 120, 90, { linkId: "L" }),
      clip("BA", "au", audio, 120, 90, { linkId: "L" }),
    );
    const after = edit(p, closeGaps(t, [video]));
    expect(onTrack(after, video)[1].start).toBe(90);
    expect(onTrack(after, audio)[0].start).toBe(90);
  });
  it("duplicates clips after the material on their tracks with fresh links", () => {
    const { t, video, audio } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90, { linkId: "K" }),
      clip("AA", "au", audio, 0, 90, { linkId: "K" }),
    );
    const commands = duplicateClips(t, ["A", "AA"], ids("copy"));
    const copies = commands.map((c) => (c as { clip: Clip }).clip);
    expect(copies.map((c) => c.start)).toEqual([90, 90]);
    expect(copies[0].linkId).toBe(copies[1].linkId);
    expect(copies[0].linkId).not.toBe("K");
    expect(copies.map((c) => c.id)).not.toContain("A");
  });
  it("lays clips out side by side, each filling its half", () => {
    const { t, video } = fixture();
    t.clips.push(clip("A", "v1", video, 0, 90), clip("B", "v2", video, 0, 90));
    const [left, right] = applyLayout(t, ["A", "B"], "side-by-side").map(
      patchOf,
    );
    expect(left).toMatchObject({
      x: -480,
      y: 0,
      scale: 1,
      fit: "cover",
      radius: 0,
    });
    expect(right).toMatchObject({ x: 480, y: 0 });
    expect(left.crop).toEqual({ left: 0.25, right: 0.25, top: 0, bottom: 0 });
  });
});

describe("nested sequences", () => {
  function nested() {
    const { p, t, video, audio } = fixture();
    t.clips.push(
      clip("A", "v1", video, 30, 90),
      clip("B", "v2", video, 120, 90),
      clip("AA", "au", audio, 0, 90),
    );
    const result = nestClips(t, ["A", "B"], ids(), now, "开场");
    return { ...result, p: edit(p, result.commands), mainId: t.id, video };
  }
  it("replaces the clips with one clip that plays a new timeline", () => {
    const { p, clipId, timelineId, assetId, mainId, video } = nested();
    expect(p.activeTimelineId).toBe(mainId);
    const main = activeTimeline(p),
      inner = p.timelines.find((x) => x.id === timelineId)!;
    expect(main.clips.map((c) => c.id).sort()).toEqual(["AA", clipId].sort());
    expect(main.clips.find((c) => c.id === clipId)).toMatchObject({
      assetId,
      trackId: video,
      start: 30,
      duration: 180,
    });
    expect(spans([...inner.clips].sort((a, b) => a.start - b.start))).toEqual([
      [0, 90],
      [90, 90],
    ]);
    expect(p.assets.find((a) => a.id === assetId)).toMatchObject({
      kind: "sequence",
      sequenceTimelineId: timelineId,
      duration: 6,
    });
  });
  it("refuses a sequence that contains itself", () => {
    const { p, timelineId, assetId } = nested();
    const inner = p.timelines.find((x) => x.id === timelineId)!;
    expect(() =>
      edit(p, [
        {
          type: "clip.add",
          timelineId,
          clip: clip("loop", assetId, inner.tracks[0].id, 400, 30),
        },
      ]),
    ).toThrow(/不能包含自己/);
  });
  it("keeps a timeline that is still played as a sequence", () => {
    const { p, timelineId } = nested();
    expect(() => edit(p, [{ type: "timeline.remove", timelineId }])).toThrow(
      /仍在使用/,
    );
  });
});

describe("effects and looks", () => {
  const preset = effectPresets.find((e) => e.params.length)!;
  it("fills defaults and rejects unknown or out-of-range parameters", () => {
    const defaults = Object.fromEntries(
      preset.params.map((x) => [x.key, x.default]),
    );
    expect(effectParams(preset.id)).toEqual(defaults);
    expect(() => effectParams("no-such-effect")).toThrow(/没有这个特效/);
    expect(() => effectParams(preset.id, { nope: 1 })).toThrow(/没有参数/);
    const param = preset.params[0];
    expect(() =>
      effectParams(preset.id, { [param.key]: param.max + 1 }),
    ).toThrow(/之间/);
  });
  it("makes an identity LUT at zero intensity and round-trips through .cube", () => {
    const id = Object.keys(looks)[0] as LookId,
      size = 5,
      identity = generateLook(id, size, 0);
    expect(identity.values.length).toBe(size ** 3 * 3);
    let i = 0;
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++)
          for (const v of [r, g, b])
            expect(identity.values[i++]).toBeCloseTo(v / (size - 1), 5);
    const full = generateLook(id, size, 1);
    expect(
      full.values.some((v, k) => Math.abs(v - identity.values[k]) > 1e-3),
    ).toBe(true);
    const parsed = parseCube(serializeCube(full));
    expect(parsed.size).toBe(size);
    parsed.values.forEach((v, k) => expect(v).toBeCloseTo(full.values[k], 4));
  });
  it("evaluates bezier easing curves", () => {
    expect(cubicBezier([0, 0, 1, 1], 0.5)).toBeCloseTo(0.5, 4);
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier([0.42, 0, 1, 1], 0.5)).toBeLessThan(0.5);
    expect(cubicBezier([0.25, 0.1, 0.25, 1], 0)).toBeCloseTo(0, 5);
    expect(cubicBezier([0.25, 0.1, 0.25, 1], 1)).toBeCloseTo(1, 5);
  });
  it("normalizes histograms to the tallest bin and skips transparent pixels", () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255,
      255, 0,
    ]);
    const h = histogram(rgba);
    expect(Math.max(...h.r)).toBe(1);
    expect(h.r[0]).toBe(1);
    expect(h.r[63]).toBeCloseTo(1 / 3);
    expect(h.luma[0]).toBe(1);
  });
});

describe("captions", () => {
  function spoken() {
    const f = fixture();
    f.t.clips.push(clip("M", "au", f.audio, 0, 300));
    const words = (
      [
        ["大家好", 0, 0.5],
        ["今天", 0.5, 0.9],
        ["学剪辑。", 0.9, 1.5],
        ["第二句", 3, 3.6],
        ["开始。", 3.6, 4],
      ] as const
    ).map(([text, start, end], i) => ({
      id: `w${i}`,
      text,
      start,
      end,
      speaker: "说话人 1",
      deleted: false,
    }));
    const transcript: Transcript = {
      id: "tr",
      assetId: "au",
      language: "zh",
      words,
    };
    f.p.transcripts.push(transcript);
    return { ...f, transcript };
  }
  it("splits speech into cues at sentence ends and pauses", () => {
    const { t, transcript } = spoken();
    const cues = captionCues(transcript, t);
    expect(cues.map((c) => [c.start, c.duration, c.text])).toEqual([
      [0, 45, "大家好今天学剪辑"],
      [90, 30, "第二句开始"],
    ]);
    expect(cues[0].words.map((w) => [w.text, w.start, w.end])).toEqual([
      ["大家好", 0, 15],
      ["今天", 15, 27],
      ["学剪辑", 27, 45],
    ]);
    expect(captionCues(transcript, t, { keepPunctuation: true })[0].text).toBe(
      "大家好今天学剪辑。",
    );
  });
  it("builds caption clips and replaces them without leaving old assets", () => {
    const { p, t, text, transcript } = spoken();
    const first = buildCaptionClips(p, t, transcript, ids("a"), now);
    expect(first.count).toBe(2);
    expect(first.trackId).toBe(text);
    let after = edit(p, first.commands);
    const captions = onTrack(after, text);
    expect(captions.map((c) => c.caption?.styleId)).toEqual([
      captionPresets[0].id,
      captionPresets[0].id,
    ]);
    expect(() =>
      buildCaptionClips(
        after,
        activeTimeline(after),
        transcript,
        ids("b"),
        now,
      ),
    ).toThrow(/已有内容/);
    after = edit(
      after,
      buildCaptionClips(
        after,
        activeTimeline(after),
        transcript,
        ids("c"),
        now,
        {
          replace: true,
        },
      ).commands,
    );
    expect(onTrack(after, text)).toHaveLength(2);
    expect(after.assets.filter((a) => a.folder === "字幕")).toHaveLength(1);
  });
  it("translates captions and keeps the first original", () => {
    const { p, t, text, transcript } = spoken();
    let after = edit(
      p,
      buildCaptionClips(p, t, transcript, ids(), now).commands,
    );
    const target = onTrack(after, text)[0];
    after = edit(
      after,
      translateCaptions(
        activeTimeline(after),
        [{ clipId: target.id, text: "Hello everyone" }],
        "en",
      ),
    );
    after = edit(
      after,
      translateCaptions(
        activeTimeline(after),
        [{ clipId: target.id, text: "Hi all" }],
        "en",
      ),
    );
    const translated = onTrack(after, text)[0];
    expect(translated.text).toBe("Hi all");
    expect(translated.caption).toMatchObject({
      original: "大家好今天学剪辑",
      language: "en",
    });
    expect(translated.caption?.words).toBeUndefined();
  });
  it("moves captions into a platform's safe area", () => {
    const style = textStyleSchema.parse({ bottom: 0.05, top: 0.01 });
    const fitted = fitSafeZone(style, "douyin");
    expect(fitted.bottom).toBeGreaterThanOrEqual(
      safeZones.douyin.bottom + 0.02,
    );
    expect(fitted.top).toBeGreaterThanOrEqual(safeZones.douyin.top + 0.02);
    expect(fitted.maxWidth).toBeLessThanOrEqual(
      1 - 2 * safeZones.douyin.right + 1e-9,
    );
    // Already inside stays where it is.
    expect(
      fitSafeZone(textStyleSchema.parse({ bottom: 0.4 }), "youtube").bottom,
    ).toBe(0.4);
  });
  it("moves a caption to the top only while a subject covers the bottom", () => {
    const { p, t, text } = fixture();
    t.clips.push(
      clip("cap", "tx", text, 0, 60, {
        text: "字幕",
        textStyle: textStyleSchema.parse({}),
      }),
    );
    const low = { frame: 10, x: 0.3, y: 0.5, width: 0.4, height: 0.45 },
      high = { frame: 10, x: 0.3, y: 0, width: 0.4, height: 0.3 };
    expect(avoidSubjects(t, ["cap"], [high])).toEqual([]);
    // Subjects outside the clip's time do not count.
    expect(avoidSubjects(t, ["cap"], [{ ...low, frame: 90 }])).toEqual([]);
    const after = edit(p, avoidSubjects(t, ["cap"], [low]));
    expect(onTrack(after, text)[0].textStyle?.top).toBe(0.08);
  });
});

describe("transcript editing", () => {
  const transcript = (texts: string[]): Transcript => ({
    id: "tr",
    assetId: "au",
    language: "zh",
    words: texts.map((text, i) => ({
      id: `w${i}`,
      text,
      start: i * 0.5,
      end: i * 0.5 + 0.4,
      speaker: "说话人 1",
      deleted: false,
    })),
  });
  it("finds fillers, repeats and filler phrases", () => {
    const found = fillerWords(
      transcript(["嗯", "我们", "我们", "那个", "开始"]),
    );
    expect(found.map((f) => [f.reason, f.wordIds])).toEqual([
      ["sound", ["w0"]],
      ["repeat", ["w1"]],
      ["phrase", ["w3"]],
    ]);
  });
  it("finds and replaces text across word boundaries", () => {
    const tr = transcript(["Hello", "world", "hello", "there"]);
    expect(findInTranscript(tr, "hello")).toHaveLength(2);
    expect(findInTranscript(tr, "hello", { caseSensitive: true })).toHaveLength(
      1,
    );
    expect(findInTranscript(tr, "h\\w+o", { regex: true })).toHaveLength(2);
    expect(() => findInTranscript(tr, "(", { regex: true })).toThrow(/无效/);
    const { transcript: next, count } = replaceInTranscript(
      tr,
      "world hello",
      "everyone",
    );
    expect(count).toBe(1);
    expect(next.words.map((w) => w.text)).toEqual([
      "Hello",
      "everyone",
      "there",
    ]);
    // The merged word spans the time of the words it replaced.
    expect(next.words[1]).toMatchObject({ start: 0.5, end: 1.4 });
  });
});

describe("story production", () => {
  function story() {
    const p = makeProject("story", "Story", now);
    p.story.shots.push(
      shotSchema.parse({
        id: "s1",
        number: 1,
        title: "开场",
        description: "城市清晨",
        duration: 3,
      }),
      shotSchema.parse({
        id: "s2",
        number: 2,
        title: "相遇",
        description: "咖啡店门口",
        dialogue: "你好",
        duration: 4,
      }),
    );
    return p;
  }
  it("hashes inputs stably", () => {
    expect(stableHash({ a: 1 })).toBe(stableHash({ a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(stableHash("x")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("plans missing outputs in shot order and skips voices without dialogue", () => {
    const plan = productionPlan(story(), {
      stages: ["frame", "video", "voice"],
    });
    expect(plan.map((x) => [x.shotId, x.stage, x.reason])).toEqual([
      ["s1", "frame", "missing"],
      ["s1", "video", "missing"],
      ["s2", "frame", "missing"],
      ["s2", "video", "missing"],
      ["s2", "voice", "missing"],
    ]);
  });
  it("records outputs, notices stale inputs and restores earlier takes", () => {
    const p = story();
    const [task] = productionPlan(p, { stages: ["frame"], shotIds: ["s1"] });
    const framed = recordProduction(p.story.shots[0], "frame", {
      assetId: "f1",
      provider: "img",
      prompt: task.prompt,
      fingerprint: task.fingerprint,
      at: now,
    });
    expect(framed).toMatchObject({
      frameAssetId: "f1",
      assetId: "f1",
      status: "ready",
      production: { stage: "frame" },
    });
    p.story.shots[0] = framed;
    expect(productionPlan(p, { stages: ["frame"], shotIds: ["s1"] })).toEqual(
      [],
    );
    expect(
      productionPlan(p, { stages: ["frame"], shotIds: ["s1"], force: true })[0]
        .reason,
    ).toBe("stale");
    // The video starts from the recorded frame.
    expect(
      productionPlan(p, { stages: ["video"], shotIds: ["s1"] })[0].references,
    ).toEqual(["f1"]);
    p.story.shots[0] = { ...framed, description: "城市黄昏" };
    expect(
      productionPlan(p, { stages: ["frame"], shotIds: ["s1"] })[0].reason,
    ).toBe("stale");
    const retaken = recordProduction(p.story.shots[0], "frame", {
      assetId: "f2",
      provider: "img",
      prompt: "",
      fingerprint: "",
      at: now,
    });
    const restored = restoreProduction(retaken, "f1");
    expect(restored.frameAssetId).toBe("f1");
    expect(restored.production.history).toHaveLength(3);
    expect(() => restoreProduction(retaken, "missing")).toThrow(/生产记录/);
  });
  it("turns script rows into linked shots", () => {
    const p = story();
    p.story.shots = [];
    p.story.script = [
      scriptRowSchema.parse({
        id: "r1",
        number: 1,
        visual: "街角的咖啡店，清晨",
        dialogue: "早上好",
        speaker: "小林",
        duration: 4,
      }),
    ];
    const after = edit(p, shotsFromScript(p, ids("shot")));
    const [shot] = after.story.shots;
    expect(shot).toMatchObject({
      number: 1,
      title: "街角的咖啡店",
      description: "街角的咖啡店，清晨",
      dialogue: "小林：早上好",
      duration: 4,
    });
    expect(after.story.script[0].shotId).toBe(shot.id);
    // Running it again updates the linked shot instead of adding one.
    const again = edit(after, shotsFromScript(after, ids("other")));
    expect(again.story.shots).toHaveLength(1);
  });
});

describe("music", () => {
  it("rolls cuts onto nearby beats only", () => {
    const { p, t, video } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90, { sourceOffset: 10 }),
    );
    const beats = [0, 30, 60, 96, 150];
    expect(snapCutsToBeats(p, t, video, beats, 4)).toEqual({
      commands: [],
      moved: 0,
    });
    const { commands, moved } = snapCutsToBeats(p, t, video, beats, 8);
    expect(moved).toBe(1);
    const [a, b] = onTrack(edit(p, commands), video);
    expect([a.duration, b.start, b.duration]).toEqual([96, 96, 84]);
    expect(b.sourceOffset).toBeCloseTo(10.2);
  });
  it("shortens a song by whole bars from the middle, keeping intro and outro", () => {
    const beats = Array.from({ length: 121 }, (_, i) => i * 0.5);
    expect(fitMusic(beats, 60, 80)).toEqual([[0, 60]]);
    const keep = fitMusic(beats, 60, 50);
    expect(keep).toEqual([
      [0, 24],
      [34, 60],
    ]);
    expect(() => fitMusic([0, 0.5, 1], 60, 30)).toThrow(/节拍太少/);
  });
});

describe("timeline as Markdown", () => {
  it("round-trips without changes and applies edited rows", () => {
    const { p, t, video, text } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 45),
      clip("B", "v2", video, 45, 7, { name: "B | 特写" }),
      clip("T", "tx", text, 10, 30, { text: "你好" }),
    );
    const markdown = exportTimelineMarkdown(p, t);
    expect(
      applyTimelineMarkdown(p, t, markdown, ids(), { removeMissing: true }),
    ).toEqual([]);
    const moved = markdown.replace("| 0.000 | 1.500 |", "| 1.000 | 1.500 |");
    expect(applyTimelineMarkdown(p, t, moved, ids())).toEqual([
      {
        type: "clip.update",
        timelineId: t.id,
        clipId: "A",
        patch: { start: 30 },
      },
    ]);
    const dropped = markdown
      .split("\n")
      .filter((line) => !line.endsWith("| T |"))
      .join("\n");
    expect(
      applyTimelineMarkdown(p, t, dropped, ids(), { removeMissing: true }),
    ).toEqual([
      { type: "clip.remove", timelineId: t.id, clipId: "T", ripple: false },
    ]);
  });
});

describe("render threads", () => {
  const gb = 2 ** 30;
  it("fit the machine's memory, with 4K taking more room per thread", () => {
    expect(
      renderConcurrency(4, 1920, 1080, { free: 16 * gb, total: 32 * gb }),
    ).toBe(4);
    // An 8 GB Mac reports little free memory; a share of the total still counts.
    expect(
      renderConcurrency(6, 3840, 2160, { free: 0.2 * gb, total: 8 * gb }),
    ).toBe(2);
    expect(renderConcurrency(8, 1920, 1080, { free: 0, total: 2 * gb })).toBe(
      1,
    );
    expect(
      renderConcurrency(0, 1920, 1080, { free: 64 * gb, total: 64 * gb }),
    ).toBe(1);
    expect(
      renderConcurrency(20, 1280, 720, { free: 64 * gb, total: 64 * gb }),
    ).toBe(8);
  });
});

describe("music clips and highlight reels", () => {
  const beats = Array.from({ length: 121 }, (_, i) => i * 0.5);
  it("shortens a music clip by bars, keeping its start and end", () => {
    const { p, t, audio } = fixture();
    t.clips.push(clip("M", "au", audio, 0, 1800));
    const { commands, keptSeconds } = fitMusicClip(
      t,
      "M",
      { beats },
      50,
      ids(),
    );
    expect(keptSeconds).toBeCloseTo(50);
    const pieces = onTrack(edit(p, commands), audio);
    expect(spans(pieces)).toEqual([
      [0, 720],
      [720, 780],
    ]);
    expect(pieces[1].sourceOffset).toBeCloseTo(34);
    expect(pieces[0].fadeOut).toBeGreaterThan(0);
    expect(pieces[1].fadeIn).toBeGreaterThan(0);
    expect(() => fitMusicClip(t, "M", { beats }, 80, ids())).toThrow(/不长于/);
  });
  it("counts a sped-up music clip in timeline seconds", () => {
    const { p, t, audio } = fixture();
    t.clips.push(clip("M", "au", audio, 0, 900, { speed: 2 }));
    const { commands, keptSeconds } = fitMusicClip(
      t,
      "M",
      { beats },
      25,
      ids(),
    );
    expect(keptSeconds).toBeCloseTo(25);
    const pieces = onTrack(edit(p, commands), audio);
    expect(pieces.reduce((sum, c) => sum + c.duration, 0)).toBe(750);
  });
  it("lays per-second loudness of the source onto timeline seconds", () => {
    const { t, audio } = fixture();
    const energy = Array.from({ length: 20 }, (_, i) => i);
    expect(
      energyOnTimeline(
        t,
        clip("M", "au", audio, 30, 90, { sourceOffset: 2 }),
        energy,
      ),
    ).toEqual([0, 2, 3, 4]);
    expect(
      energyOnTimeline(
        t,
        clip("M", "au", audio, 30, 90, { sourceOffset: 2, speed: 2 }),
        energy,
      ),
    ).toEqual([0, 2, 4, 6]);
  });
  it("builds a reel of ranges on a new timeline and leaves the source alone", () => {
    const { p, t, video, audio } = fixture();
    t.clips.push(
      clip("A", "v1", video, 0, 90),
      clip("B", "v2", video, 90, 90, { sourceOffset: 10 }),
      clip("M", "au", audio, 0, 180),
    );
    const reel = rangesTimeline(
      t,
      [
        [60, 120],
        [150, 180],
      ],
      ids(),
      "精华版",
    );
    const after = edit(p, [{ type: "timeline.create", timeline: reel }]);
    expect(after.activeTimelineId).toBe(reel.id);
    const [newVideo, newAudio] = reel.tracks.map((x) => x.id);
    expect(spans(onTrack(after, newVideo))).toEqual([
      [0, 30],
      [30, 30],
      [60, 30],
    ]);
    expect(onTrack(after, newVideo).map((c) => c.sourceOffset)).toEqual([
      2, 10, 12,
    ]);
    expect(spans(onTrack(after, newAudio))).toEqual([
      [0, 60],
      [60, 30],
    ]);
    expect(after.timelines.find((x) => x.id === t.id)!.clips).toHaveLength(3);
    expect(() => rangesTimeline(t, [[500, 600]], ids(), "空")).toThrow(
      /没有片段/,
    );
  });
});

describe("placing graphics clear of people", () => {
  it("measures a layer from its asset, fit and scale", () => {
    const { t, video } = fixture();
    const wide = assetSchema.parse({
      id: "wide",
      name: "W",
      kind: "image",
      width: 1000,
      height: 500,
      createdAt: now,
    });
    // Cover fills the scaled frame box; contain shows the whole picture inside it.
    expect(
      layerSize(t, clip("L", "wide", video, 0, 30, { scale: 0.5 }), wide),
    ).toEqual({ width: 0.5, height: 0.5 });
    expect(
      layerSize(
        t,
        clip("L", "wide", video, 0, 30, { scale: 0.5, fit: "contain" }),
        wide,
      ),
    ).toEqual({
      width: 0.5,
      height: (500 * 1.92 * 0.5) / 1080,
    });
    expect(
      layerSize(
        t,
        clip("L", "wide", video, 0, 30, {
          scale: 0.5,
          crop: { left: 0.2, right: 0, top: 0, bottom: 0.5 },
        }),
        wide,
      ),
    ).toEqual({ width: 0.4, height: 0.25 });
    // Animations draw anywhere in their box, so they get a typical graphic size.
    expect(
      layerSize(t, clip("L", "img", video, 0, 30), { kind: "motion" }),
    ).toEqual({ width: 0.3, height: 0.2 });
  });
  it("moves a graphic away from a person and refuses full-frame layers", () => {
    const { t, video } = fixture();
    const person = { x: 0, y: 0, width: 0.5, height: 1 };
    const { patch, covered } = freeAreaPatch(
      t,
      clip("L", "img", video, 0, 30, { scale: 0.3 }),
      { kind: "image" },
      [person],
    );
    expect(covered).toBe(0);
    expect(patch.x).toBeGreaterThan(0);
    const full = { kind: "video" as const, width: 1920, height: 1080 };
    expect(() =>
      freeAreaPatch(t, clip("F", "v1", video, 0, 30), full, [person]),
    ).toThrow(/铺满/);
  });
  it("places text by its style box, above a person in the lower half", () => {
    const { t, text } = fixture();
    const title = clip("T", "tx", text, 0, 30, {
      text: "标题",
      textStyle: textStyleSchema.parse({}),
    });
    const { patch } = freeAreaPatch(t, title, { kind: "text" }, [
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ]);
    expect(patch).toMatchObject({ x: 0, y: 0 });
    expect(patch.textStyle!.top).toBeLessThan(0.5);
  });
});
