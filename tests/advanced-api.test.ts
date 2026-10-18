import { exportManagedColor } from "../apps/server/src/color-export";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  activeTimeline,
  applyTransaction,
  newTrack,
  assetSchema,
  clipSchema,
  timelineProfileSchema,
  type MediaOperation,
} from "@tadacut/domain";
import { createStudioServer } from "../apps/server/src/server";
import { runProcess } from "../apps/server/src/process";
import { mediaBinary } from "../apps/server/src/media";
import type { Job } from "../apps/server/src/storage";
import { Draft } from "../apps/server/src/agent-tools/host";
import {
  prepareMediaProcess,
  processResultCommands,
} from "../apps/server/src/media-processing";

describe("advanced media and conversation API", () => {
  let dir: string,
    server: Awaited<ReturnType<typeof createStudioServer>>,
    projectId: string,
    cookie: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-advanced-"));
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    await server.app.ready();
    const r = await server.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1" },
    });
    cookie = r.headers["set-cookie"]!.toString().split(";")[0];
    // A two-second, 64px generated signal fixture; never user footage or a project export.
    const file = path.join(server.media.dir, "fixture.mkv"),
      rgb = Buffer.alloc(64 * 64 * 3 * 24),
      pcm = Buffer.alloc(48000 * 2 * 2);
    for (let f = 0; f < 24; f++)
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const at = (f * 64 * 64 + y * 64 + x) * 3;
          rgb[at] = f * 10;
          rgb[at + 1] = x * 4;
          rgb[at + 2] = y * 4;
        }
    for (let i = 0; i < 96000; i++)
      pcm.writeInt16LE(
        Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 10000),
        i * 2,
      );
    const raw = path.join(dir, "fixture.rgb"),
      tone = path.join(dir, "fixture.pcm");
    await fs.writeFile(raw, rgb);
    await fs.writeFile(tone, pcm);
    await runProcess(mediaBinary("ffmpeg")!, [
      "-v",
      "error",
      "-y",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgb24",
      "-video_size",
      "64x64",
      "-framerate",
      "12",
      "-i",
      raw,
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-i",
      tone,
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-shortest",
      file,
    ]);
    const p = server.repo.create("Media processing test"),
      t = activeTimeline(p);
    projectId = p.id;
    t.fps = 12;
    t.width = 64;
    t.height = 64;
    p.assets.push(
      assetSchema.parse({
        id: "fixture",
        name: "Synthetic signal",
        kind: "video",
        url: "/media/fixture.mkv",
        hash: crypto
          .createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
        width: 64,
        height: 64,
        duration: 2,
        createdAt: new Date().toISOString(),
      }),
    );
    t.clips.push(
      clipSchema.parse({
        id: "clip",
        assetId: "fixture",
        trackId: t.tracks[0].id,
        start: 0,
        duration: 24,
      }),
    );
    server.repo.put(p);
  }, 30000);
  afterAll(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const invoke = (
    name: string,
    args: unknown,
    mode: "auto" | "manual" = "auto",
    draft?: Draft,
  ) => {
    const h = server.agent.host(
      projectId,
      new AbortController().signal,
      mode,
      draft,
    );
    h.markRead(h.project().revision);
    return server.agent
      .tools(h, undefined)
      .find((t) => t.name === name)!
      .execute(args);
  };
  const processFixture = async (operation: MediaOperation) => {
    const p = server.repo.get(projectId),
      t = activeTimeline(p),
      queued = server.jobs.enqueue(projectId, "process-media", operation.type, {
        clipId: "clip",
        timelineId: t.id,
        expectedRevision: p.revision,
        operation,
      });
    const deadline = Date.now() + 20000;
    let job: Job;
    do {
      await new Promise((r) => setTimeout(r, 30));
      job = server.repo.record<Job>("job", queued.id)!;
      if (Date.now() > deadline) throw new Error("Processing timed out");
    } while (["queued", "running"].includes(job.status));
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("completed");
    return job;
  };
  it("executes actual local reverse, freeze, ramp, voice, interpolation, stabilization and proxy processing", async () => {
    const operations: MediaOperation[] = [
      { type: "reverse" },
      { type: "freeze", at: 0.5, seconds: 0.5 },
      {
        type: "speed-curve",
        points: [
          { position: 0, speed: 2 },
          { position: 1, speed: 2 },
        ],
      },
      { type: "voice", semitones: 3, pan: -1, preset: "radio" },
      { type: "interpolate", fps: 24, method: "blend" },
      { type: "stabilize", strength: 16, crop: false },
      { type: "proxy", width: 160 },
    ];
    for (const op of operations) {
      const job = await processFixture(op),
        result = processResultCommands(server.repo, projectId, job.id);
      expect(result.commands[0].type).toBe("project.assert");
      const output = path.join(server.media.dir, path.basename(result.url!));
      const probe = JSON.parse(
        (
          await runProcess(mediaBinary("ffprobe")!, [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            output,
          ])
        ).stdout.toString(),
      );
      expect(probe.streams.some((s: any) => s.codec_type === "video")).toBe(
        true,
      );
      expect(Number(probe.format.duration)).toBeCloseTo(
        op.type === "freeze" ? 0.5 : op.type === "speed-curve" ? 1 : 2,
        0,
      );
    }
    expect(server.repo.get(projectId).revision).toBe(0);
  }, 90000);
  it("writes real 10-bit HDR pixels, color tags and mixed audio", async () => {
    const job = await processFixture({
      type: "color-convert",
      input: "rec709",
      output: "rec2020-pq",
      peakNits: 1000,
    });
    const first = processResultCommands(server.repo, projectId, job.id),
      file = path.join(server.media.dir, path.basename(first.url!));
    const inspect = async (file: string) =>
      JSON.parse(
        (
          await runProcess(mediaBinary("ffprobe")!, [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            file,
          ])
        ).stdout.toString(),
      );
    const probe = await inspect(file);
    expect(probe.streams[0]).toMatchObject({
      color_transfer: "smpte2084",
      color_primaries: "bt2020",
    });
    expect(probe.streams[0].pix_fmt).toContain("10");
    const p = server.repo.get(projectId),
      t = activeTimeline(p);
    // The second voice stops halfway through: the remaining voice must keep its gain.
    const mixTrack = newTrack(t, "audio", "mix-track");
    t.tracks.push(mixTrack);
    p.assets.push(
      assetSchema.parse({ ...p.assets[0], id: "mix-audio", kind: "audio" }),
    );
    t.clips.push(
      clipSchema.parse({
        id: "mix-clip",
        assetId: "mix-audio",
        trackId: mixTrack.id,
        start: 0,
        duration: t.fps,
      }),
    );
    t.profile = timelineProfileSchema.parse({
      rate: { numerator: 12, denominator: 1 },
      workingSpace: "rec2020-pq",
      outputSpace: "rec2020-pq",
    });
    const output = path.join(dir, "hdr-output");
    await fs.mkdir(output);
    const result = await exportManagedColor({
      project: p,
      timeline: t,
      media: server.media,
      codec: "prores",
      transparent: false,
      crf: 18,
      root: process.cwd(),
      output,
      baseUrl: "http://127.0.0.1",
      signal: new AbortController().signal,
      progress: () => {},
    });
    const actual = await inspect(path.join(output, result.filename));
    expect(
      actual.streams.find((s: any) => s.codec_type === "video"),
    ).toMatchObject({ color_transfer: "smpte2084", color_primaries: "bt2020" });
    expect(actual.streams.some((s: any) => s.codec_type === "audio")).toBe(
      true,
    );
    expect(Number(actual.format.duration)).toBeCloseTo(2, 1);
    const { stdout: samples } = await runProcess(mediaBinary("ffmpeg")!, [
      "-v",
      "error",
      "-i",
      path.join(output, result.filename),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "s16le",
      "pipe:1",
    ]);
    const rms = (start: number, end: number) => {
      let sum = 0;
      for (let i = start * 48000; i < end * 48000; i++)
        sum += samples.readInt16LE(i * 2) ** 2;
      return Math.sqrt(sum / ((end - start) * 48000));
    };
    const sourceRms = 10000 / Math.sqrt(2);
    expect(rms(0.25, 0.75) / sourceRms).toBeCloseTo(2, 1);
    expect(rms(1.25, 1.75) / sourceRms).toBeCloseTo(1, 1);
  }, 30000);
  it("keeps manual processing results in the draft and rejects changes made after processing", async () => {
    const job = await processFixture({ type: "reverse" });
    const p = server.repo.get(projectId),
      draft = new Draft(() => server.repo.get(projectId));
    const applied = await invoke(
      "apply_media_result",
      { jobId: job.id },
      "manual",
      draft,
    );
    expect(applied).toMatchObject({ drafted: true });
    expect(server.repo.get(projectId).assets.length).toBe(1);
    expect(draft.current().assets.length).toBe(2);
    server.repo.commit(projectId, {
      requestId: crypto.randomUUID(),
      expectedRevision: p.revision,
      label: "move",
      commands: [
        {
          type: "clip.update",
          timelineId: activeTimeline(p).id,
          clipId: "clip",
          patch: { x: 5 },
        },
      ],
    });
    await expect(
      invoke("apply_media_result", { jobId: job.id }),
    ).rejects.toThrow(/原素材/);
  });
  it("applies visual edits and canvas transactions through concrete tools and rejects arbitrary parameters", async () => {
    await invoke("set_clip_blend", { clipIds: ["clip"], blend: "screen" });
    expect(
      activeTimeline(server.repo.get(projectId)).clips[0].advanced?.blend,
    ).toBe("screen");
    await expect(
      invoke("set_clip_blend", {
        clipIds: ["clip"],
        blend: "screen",
        shell: "echo nope",
      }),
    ).rejects.toThrow();
    await invoke("update_canvas_nodes", {
      nodes: [
        { id: "group", kind: "group", label: "Group", x: 10, y: 10 },
        {
          id: "video",
          kind: "video",
          label: "Source",
          x: 20,
          y: 30,
          parentId: "group",
          referenceId: "fixture",
        },
      ],
    });
    const result: any = await invoke("query_canvas", { nodeId: "group" });
    expect(result.members).toHaveLength(1);
  });
  it("publishes all concrete tools and truthful model availability", async () => {
    const h = server.agent.host(
        projectId,
        new AbortController().signal,
        "auto",
      ),
      tools = server.agent.tools(h, undefined);
    for (const name of [
      "retime_clip",
      "set_clip_masks",
      "transcribe_lyrics",
      "track_motion",
      "create_avatar",
      "control_recording",
      "push_team_project",
      "search_shared_catalog",
    ])
      expect(tools.some((t) => t.name === name)).toBe(true);
    const result = await server.app.inject({
      url: "/api/advanced/capabilities",
      headers: { host: "127.0.0.1", cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().find((r: any) => r.type === "avatar")).toMatchObject({
      available: false,
      providers: [],
    });
    const bad = await server.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/process`,
      payload: {
        assetId: "fixture",
        expectedRevision: -1,
        operation: { type: "reverse" },
      },
      headers: { host: "127.0.0.1", cookie },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
  });
  it("processes the current manual draft and applies results into the same undo proposal", async () => {
    const before = server.repo.get(projectId),
      draft = new Draft(() => server.repo.get(projectId)),
      h = server.agent.host(
        projectId,
        new AbortController().signal,
        "manual",
        draft,
      );
    const tools = server.agent.tools(h, undefined),
      invoke = (name: string, args: unknown) =>
        tools.find((t) => t.name === name)!.execute(args);
    await invoke("set_clip_blend", { clipIds: ["clip"], blend: "multiply" });
    const queued = (await invoke("reverse_clip", { clipId: "clip" })) as {
      jobId: string;
    };
    const job = await h.waitJob(queued.jobId, 20);
    expect(job?.error).toBeUndefined();
    expect(job?.status).toBe("completed");
    expect(
      await invoke("apply_media_result", { jobId: queued.jobId }),
    ).toMatchObject({ drafted: true });
    expect(server.repo.get(projectId).revision).toBe(before.revision);
    expect(activeTimeline(draft.current()).clips[0].advanced?.blend).toBe(
      "multiply",
    );
    const applied = server.repo.commit(projectId, {
      requestId: crypto.randomUUID(),
      expectedRevision: before.revision,
      label: "Manual composite edit",
      commands: draft.commands,
    });
    expect(applied.project.revision).toBe(before.revision + 1);
  });

  it("prepares title prerenders and protects the full composition from stale cache application", () => {
    const p = server.repo.get(projectId),
      t = activeTimeline(p),
      track = newTrack(t, "text", "title-track");
    t.tracks.push(track);
    p.assets.push(
      assetSchema.parse({
        id: "title-asset",
        kind: "text",
        name: "Title",
        text: "Cache title",
        createdAt: new Date().toISOString(),
      }),
    );
    t.clips.push(
      clipSchema.parse({
        id: "title-clip",
        assetId: "title-asset",
        trackId: track.id,
        start: 0,
        duration: 12,
        text: "Cache title",
      }),
    );
    server.repo.put(p);
    const prepared = prepareMediaProcess(server.repo, p.id, {
      clipId: "title-clip",
      timelineId: t.id,
      expectedRevision: p.revision,
      operation: { type: "prerender" },
    });
    expect(
      prepared.snapshot.dependencies.some((d) => d.kind === "timeline-content"),
    ).toBe(true);
    const changed = structuredClone(p);
    activeTimeline(changed).clips[0].x += 1;
    expect(() =>
      applyTransaction(
        changed,
        {
          requestId: "cache-conflict",
          expectedRevision: changed.revision,
          label: "cache",
          commands: [
            {
              type: "project.assert",
              dependencies: prepared.snapshot.dependencies,
            },
          ],
        },
        new Date().toISOString(),
      ),
    ).toThrow(/原素材/);
    expect(() =>
      prepareMediaProcess(server.repo, p.id, {
        assetId: "title-asset",
        expectedRevision: p.revision,
        operation: { type: "reverse" },
      }),
    ).toThrow(/素材类型/);
  });
});
