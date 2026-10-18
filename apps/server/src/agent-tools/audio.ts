import {
  beatSlideshow,
  beatsOnTimeline,
  duckMusic,
  fitMusicClip,
  snapCutsToBeats,
  transitionKinds,
  type Command,
} from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { audioAnalysis } from "../analysis-cache";
import { s, timelineOf, tool, type ToolHost } from "./host";

const timelineId = s.string("时间线 ID，默认当前时间线");
export function audioTools(h: ToolHost): AgentTool[] {
  const t = (id?: string) => timelineOf(h.project(), id);
  const g = "audio";
  const analyze = async (assetId: string) => {
    const asset = h.project().assets.find((a) => a.id === assetId);
    if (!asset) throw new Error("素材不存在");
    return audioAnalysis(h.repo, h.media, h.projectId, asset, h.signal);
  };
  /** The music clip to follow: the one given, else the first clip on a music track. */
  const musicClip = (tid: string | undefined, clipId?: string) => {
    const tl = t(tid);
    const c = clipId
      ? tl.clips.find((x) => x.id === clipId)
      : tl.clips.find((x) => {
          const track = tl.tracks.find((tr) => tr.id === x.trackId);
          return (
            track?.kind === "audio" && (track.role === "music" || !track.role)
          );
        });
    if (!c) throw new Error("没有找到配乐片段，请指定 musicClipId");
    return c;
  };
  return [
    tool(
      g,
      "read",
      "analyze_audio",
      "分析音频或视频素材的节拍（BPM、拍点）、静音段和每秒响度；结果会缓存供卡点使用。",
      s.object({ assetId: s.string() }, ["assetId"]),
      async (a) => {
        const r = await analyze(a.assetId);
        return {
          duration: r.duration,
          bpm: r.bpm,
          beatConfidence: r.beatConfidence,
          beats: r.beats.slice(0, 400),
          silence: r.silence.slice(0, 200),
          loudness: r.rmsDb,
          energy: r.energy
            .slice(0, 600)
            .map((v) => Math.round(v * 1000) / 1000),
        };
      },
    ),
    tool(
      g,
      "edit",
      "duck_music",
      "自动闪避：有人说话时压低配乐。根据文稿（或用途为对白/旁白的轨道）找出说话时段。depth 为说话时的音量比例（默认 0.25）。",
      s.object({
        depth: s.number(),
        attack: s.number("秒"),
        release: s.number("秒"),
        clipIds: s.array(s.string("配乐片段")),
        timelineId,
      }),
      (a) => h.edit("配乐自动闪避", duckMusic(h.project(), t(a.timelineId), a)),
    ),
    tool(
      g,
      "edit",
      "set_volume",
      "设置片段音量与淡入淡出（秒）。volume 1 为原音量。",
      s.object(
        {
          clipIds: s.array(s.string()),
          volume: s.number(),
          fadeIn: s.number(),
          fadeOut: s.number(),
          timelineId,
        },
        ["clipIds"],
      ),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(
          "调整音量",
          (a.clipIds as string[]).map(
            (clipId): Command => ({
              type: "clip.update",
              timelineId: tl.id,
              clipId,
              patch: {
                ...(a.volume !== undefined
                  ? { volume: Math.max(0, Math.min(4, a.volume)) }
                  : {}),
                ...(a.fadeIn !== undefined
                  ? { fadeIn: Math.max(0, Math.round(a.fadeIn * tl.fps)) }
                  : {}),
                ...(a.fadeOut !== undefined
                  ? { fadeOut: Math.max(0, Math.round(a.fadeOut * tl.fps)) }
                  : {}),
              },
            }),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "snap_to_beats",
      "卡点：把画面轨道上相邻片段之间的剪辑点移到最近的节拍上（滚动编辑，总长不变）。",
      s.object(
        {
          trackId: s.string("画面轨道"),
          musicClipId: s.string(),
          tolerance: s.integer("最多移动的帧数，默认 8"),
          timelineId,
        },
        ["trackId"],
      ),
      async (a) => {
        const tl = t(a.timelineId),
          music = musicClip(a.timelineId, a.musicClipId),
          analysis = await analyze(music.assetId),
          beats = beatsOnTimeline(tl, music, analysis.beats),
          { commands, moved } = snapCutsToBeats(
            h.project(),
            tl,
            a.trackId,
            beats,
            a.tolerance ?? 8,
          );
        if (!moved) return { moved: 0, note: "没有在容差内可对齐的剪辑点" };
        return {
          moved,
          bpm: analysis.bpm,
          ...h.edit("剪辑点对齐节拍", commands),
        };
      },
    ),
    tool(
      g,
      "edit",
      "beat_slideshow",
      "图片或视频随音乐卡点：每隔 beatsPerShot 个节拍换一张，放到指定画面轨道。",
      s.object(
        {
          assetIds: s.array(s.string()),
          trackId: s.string(),
          musicClipId: s.string(),
          beatsPerShot: s.integer("默认 2"),
          startSeconds: s.number(),
          transition: s.string(undefined, transitionKinds),
          loop: s.boolean("素材不够时循环使用"),
          timelineId,
        },
        ["assetIds", "trackId"],
      ),
      async (a) => {
        const tl = t(a.timelineId),
          music = musicClip(a.timelineId, a.musicClipId),
          analysis = await analyze(music.assetId),
          beats = beatsOnTimeline(tl, music, analysis.beats);
        return h.edit(
          "音乐卡点相册",
          beatSlideshow(
            h.project(),
            tl,
            a.assetIds,
            beats,
            a.trackId,
            h.makeId,
            {
              beatsPerShot: a.beatsPerShot,
              start:
                a.startSeconds !== undefined
                  ? Math.round(a.startSeconds * tl.fps)
                  : undefined,
              transition: a.transition
                ? {
                    kind: a.transition,
                    duration: Math.max(2, Math.round(tl.fps / 4)),
                  }
                : undefined,
              loop: a.loop,
            },
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "fit_music",
      "把配乐按整小节剪短到目标时长：保留前奏和结尾，优先去掉安静的小节，接缝处加短淡化。",
      s.object(
        {
          clipId: s.string("配乐片段"),
          targetSeconds: s.number(),
          beatsPerBar: s.integer("默认 4"),
          timelineId,
        },
        ["targetSeconds"],
      ),
      async (a) => {
        const tl = t(a.timelineId),
          music = musicClip(a.timelineId, a.clipId),
          analysis = await analyze(music.assetId),
          { commands, keptSeconds } = fitMusicClip(
            tl,
            music.id,
            analysis,
            a.targetSeconds,
            h.makeId,
            a.beatsPerBar,
          );
        return { keptSeconds, ...h.edit("按小节剪短配乐", commands) };
      },
    ),
    tool(
      g,
      "job",
      "normalize_loudness",
      "本机响度归一（生成新的音频素材），默认 -14 LUFS。",
      s.object({ assetId: s.string(), targetLufs: s.number() }, ["assetId"]),
      (a) => h.enqueue("normalize", "响度归一", a),
    ),
    tool(
      g,
      "job",
      "denoise_voice",
      "本机人声降噪（高低通与频谱降噪，生成新素材）。",
      s.object({ assetId: s.string() }, ["assetId"]),
      (a) => h.enqueue("voice-clean", "人声降噪", a),
    ),
    tool(
      g,
      "external",
      "isolate_voice",
      "用供应商的人声分离服务把人声和背景音乐、噪声分开（生成新素材）。",
      s.object({ assetId: s.string(), providerId: s.string() }, ["assetId"]),
      (a) =>
        h.enqueue("voice-isolate", "人声分离", {
          assetId: a.assetId,
          providerId: h.provider("voice-isolation", a.providerId),
        }),
    ),
  ];
}
