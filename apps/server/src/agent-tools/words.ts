import {
  applyCaptionStyle,
  avoidSubjects,
  buildCaptionClips,
  captionAnimationNames,
  captionAnimations,
  captionPresets,
  captionStyleSchema,
  exportSrt,
  findCaptionStyle,
  findInTranscript,
  fillerWords,
  fitSafeZone,
  pauseRanges,
  replaceInTranscript,
  safeZones,
  textStyleSchema,
  type Command,
  type Project,
} from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { s, timelineOf, tool, type ToolHost } from "./host";

const timelineId = s.string("时间线 ID，默认当前时间线");
const transcriptId = s.string("文稿 ID，默认第一份文稿");
const transcriptOf = (p: Project, id?: string) => {
  const transcript = id
    ? p.transcripts.find((t) => t.id === id)
    : p.transcripts[0];
  if (!transcript) throw new Error("没有文稿，请先转写音视频");
  return transcript;
};
export function wordTools(h: ToolHost): AgentTool[] {
  const t = (id?: string) => timelineOf(h.project(), id);
  const captionClips = (tid?: string, ids?: string[]) =>
    t(tid).clips.filter((c) =>
      ids?.length ? ids.includes(c.id) : Boolean(c.caption),
    );
  return [
    tool(
      "transcript",
      "edit",
      "cut_words",
      "按词删除：从时间线上剪掉这些词对应的音视频，并在文稿中标记为已删除。",
      s.object({ transcriptId, wordIds: s.array(s.string()), timelineId }, [
        "wordIds",
      ]),
      (a) => {
        const p = h.project();
        return h.edit("按文稿删除", [
          {
            type: "transcript.cut",
            transcriptId: transcriptOf(p, a.transcriptId).id,
            wordIds: a.wordIds,
            timelineId: t(a.timelineId).id,
          },
        ]);
      },
    ),
    tool(
      "transcript",
      "read",
      "find_in_transcript",
      "在文稿中查找文字（可跨词、可用正则），返回匹配的词 ID 与时间。",
      s.object(
        {
          transcriptId,
          query: s.string(),
          regex: s.boolean(),
          caseSensitive: s.boolean(),
        },
        ["query"],
      ),
      (a) => {
        const matches = findInTranscript(
          transcriptOf(h.project(), a.transcriptId),
          a.query,
          a,
        );
        return {
          count: matches.length,
          matches: matches.slice(0, 200).map((m) => ({
            text: m.text,
            wordIds: m.wordIds,
            start: m.start,
            end: m.end,
          })),
        };
      },
    ),
    tool(
      "transcript",
      "edit",
      "replace_in_transcript",
      "替换文稿中的文字（修正错字、统一称呼）；跨词的匹配合并成一个词，时间保持对齐。",
      s.object(
        {
          transcriptId,
          query: s.string(),
          replacement: s.string(),
          regex: s.boolean(),
          caseSensitive: s.boolean(),
        },
        ["query", "replacement"],
      ),
      (a) => {
        const source = transcriptOf(h.project(), a.transcriptId),
          { transcript, count } = replaceInTranscript(
            source,
            a.query,
            a.replacement,
            a,
          );
        if (!count) return { count: 0, note: "没有找到匹配的文字" };
        return {
          count,
          ...h.edit(`替换「${a.query}」`, [
            { type: "transcript.set", transcript },
          ]),
        };
      },
    ),
    tool(
      "transcript",
      "edit",
      "remove_fillers",
      "删除口癖：嗯、呃、啊等语气声和结巴重复（phrase 包含“那个”“就是说”等可能是正常用语的词，默认不删）。dryRun=true 只列出不删除。",
      s.object({
        transcriptId,
        include: s.array(s.string(undefined, ["sound", "repeat", "phrase"])),
        dryRun: s.boolean(),
        timelineId,
      }),
      (a) => {
        const transcript = transcriptOf(h.project(), a.transcriptId),
          kinds: string[] = a.include?.length ? a.include : ["sound", "repeat"],
          found = fillerWords(transcript).filter((f) =>
            kinds.includes(f.reason),
          );
        if (a.dryRun || !found.length)
          return { count: found.length, fillers: found.slice(0, 200) };
        return {
          count: found.length,
          ...h.edit("删除口癖", [
            {
              type: "transcript.cut",
              transcriptId: transcript.id,
              wordIds: found.flatMap((f) => f.wordIds),
              timelineId: t(a.timelineId).id,
            },
          ]),
        };
      },
    ),
    tool(
      "transcript",
      "edit",
      "compress_pauses",
      "压缩停顿：把词与词之间超过 maxGap 秒的空白缩短到 maxGap。dryRun=true 只统计。",
      s.object({
        transcriptId,
        maxGap: s.number("秒，默认 0.4"),
        dryRun: s.boolean(),
        timelineId,
      }),
      (a) => {
        const transcript = transcriptOf(h.project(), a.transcriptId),
          maxGap = Math.max(0.05, Math.min(10, a.maxGap ?? 0.4)),
          ranges = pauseRanges(transcript.words, maxGap),
          seconds = ranges.reduce((sum, [x, y]) => sum + y - x, 0);
        if (a.dryRun || !ranges.length)
          return { pauses: ranges.length, seconds };
        return {
          pauses: ranges.length,
          seconds,
          ...h.edit("压缩停顿", [
            {
              type: "transcript.gaps",
              transcriptId: transcript.id,
              timelineId: t(a.timelineId).id,
              maxGap,
            },
          ]),
        };
      },
    ),
    tool(
      "transcript",
      "edit",
      "rename_speaker",
      "把文稿中的说话人改名。",
      s.object({ transcriptId, from: s.string(), to: s.string() }, [
        "from",
        "to",
      ]),
      (a) =>
        h.edit("修改说话人", [
          {
            type: "transcript.speaker",
            transcriptId: transcriptOf(h.project(), a.transcriptId).id,
            from: a.from,
            to: a.to,
          },
        ]),
    ),
    tool(
      "transcript",
      "job",
      "transcribe_media",
      "对音视频素材做词级转写（使用支持转写的供应商）。",
      s.object({ assetId: s.string(), providerId: s.string() }, ["assetId"]),
      (a) =>
        h.enqueue("transcribe", "语音转写", {
          assetId: a.assetId,
          providerId: h.provider("transcription", a.providerId),
        }),
    ),
    tool(
      "captions",
      "edit",
      "generate_captions",
      `根据文稿在字幕轨生成字幕：按句子与停顿分行，保留逐词时间，可直接用逐词动画。styleId 可用 list_caption_styles 查看。动画：${captionAnimations.join("、")}。`,
      s.object({
        transcriptId,
        styleId: s.string(),
        animation: s.string(undefined, captionAnimations),
        trackId: s.string(),
        replace: s.boolean("替换该轨道上已有字幕"),
        maxChars: s.integer("每行最多字数，默认 18"),
        maxWords: s.integer(),
        timelineId,
      }),
      (a) => {
        const p = h.project(),
          { commands, count, trackId } = buildCaptionClips(
            p,
            t(a.timelineId),
            transcriptOf(p, a.transcriptId),
            h.makeId,
            h.now(),
            a,
          );
        return { cues: count, trackId, ...h.edit("生成字幕", commands) };
      },
    ),
    tool(
      "captions",
      "read",
      "list_caption_styles",
      "列出内置与项目的字幕样式和可用动画。",
      s.object({}),
      () => ({
        presets: captionPresets.map((c) => ({
          id: c.id,
          name: c.name,
          animation: c.animation,
        })),
        project: h.project().styles.captions.map((c) => ({
          id: c.id,
          name: c.name,
          animation: c.animation,
        })),
        animations: captionAnimationNames,
        safeZones: Object.fromEntries(
          Object.entries(safeZones).map(([k, v]) => [k, v.name]),
        ),
      }),
    ),
    tool(
      "captions",
      "edit",
      "style_captions",
      "把字幕样式应用到字幕片段（默认当前时间线所有字幕）。",
      s.object(
        { styleId: s.string(), clipIds: s.array(s.string()), timelineId },
        ["styleId"],
      ),
      (a) => {
        const chosen = findCaptionStyle(h.project(), a.styleId);
        if (!chosen) throw new Error("字幕样式不存在");
        const clips = captionClips(a.timelineId, a.clipIds);
        if (!clips.length) throw new Error("没有字幕片段");
        return h.edit(
          `应用字幕样式「${chosen.name}」`,
          applyCaptionStyle(
            t(a.timelineId),
            clips.map((c) => c.id),
            chosen,
          ),
        );
      },
    ),
    tool(
      "captions",
      "edit",
      "save_caption_style",
      "保存一个命名字幕样式到项目（textStyle 字段：fontSize、color、align、bottom、top、background、fontFamily、fontWeight、strokeColor、strokeWidth、shadow、letterSpacing、lineHeight、maxWidth、uppercase、padding、boxRadius）。",
      s.object(
        {
          id: s.string(),
          name: s.string(),
          textStyle: s.record(),
          animation: s.string(undefined, captionAnimations),
          highlight: s.string(),
        },
        ["name", "textStyle"],
      ),
      (a) => {
        const p = h.project(),
          style = captionStyleSchema.parse({
            id: a.id || h.makeId(),
            name: a.name,
            textStyle: textStyleSchema.parse(a.textStyle),
            animation: a.animation ?? "none",
            ...(a.highlight ? { highlight: a.highlight } : {}),
          });
        return {
          styleId: style.id,
          ...h.edit("保存字幕样式", [
            {
              type: "styles.update",
              patch: {
                captions: [
                  ...p.styles.captions.filter((c) => c.id !== style.id),
                  style,
                ],
              },
            },
          ]),
        };
      },
    ),
    tool(
      "captions",
      "edit",
      "place_captions",
      "调整字幕位置：safeZone 让字幕避开平台界面（抖音、小红书等）；position 放到画面上方或下方；avoid 给出主体框（帧号与 0–1 坐标）时，遮挡主体的字幕自动移到上方。",
      s.object({
        clipIds: s.array(s.string()),
        safeZone: s.string(undefined, Object.keys(safeZones)),
        position: s.string(undefined, ["top", "bottom"]),
        avoid: s.array(
          s.object(
            {
              frame: s.integer(),
              x: s.number(),
              y: s.number(),
              width: s.number(),
              height: s.number(),
            },
            ["frame", "x", "y", "width", "height"],
          ),
        ),
        timelineId,
      }),
      (a) => {
        const tl = t(a.timelineId),
          clips = captionClips(a.timelineId, a.clipIds);
        if (!clips.length) throw new Error("没有字幕片段");
        if (a.avoid?.length)
          return h.edit(
            "字幕避让主体",
            avoidSubjects(
              tl,
              clips.map((c) => c.id),
              a.avoid,
            ),
          );
        return h.edit(
          "调整字幕位置",
          clips.map((c): Command => {
            let style = c.textStyle ?? textStyleSchema.parse({});
            if (a.position === "top") style = { ...style, top: 0.08 };
            else if (a.position === "bottom") {
              const { top: _top, ...rest } = style;
              style = { ...rest } as typeof style;
            }
            if (a.safeZone) style = fitSafeZone(style, a.safeZone);
            return {
              type: "clip.update",
              timelineId: tl.id,
              clipId: c.id,
              patch: { textStyle: style },
            };
          }),
        );
      },
    ),
    tool(
      "captions",
      "job",
      "translate_captions",
      "用所选对话模型把字幕翻译成目标语言，原文保留在字幕里，可随时还原。",
      s.object(
        {
          language: s.string("目标语言，如 English、日本語"),
          providerId: s.string(),
          clipIds: s.array(s.string()),
          timelineId,
        },
        ["language"],
      ),
      (a) =>
        h.enqueue("translate-captions", `翻译字幕为${a.language}`, {
          language: a.language,
          providerId: h.provider("chat", a.providerId),
          clipIds: a.clipIds,
          timelineId: t(a.timelineId).id,
        }),
    ),
    tool(
      "captions",
      "read",
      "export_srt",
      "导出当前时间线的 SRT 字幕文本。",
      s.object({ timelineId }),
      (a) => ({
        srt: exportSrt(h.project(), t(a.timelineId)).slice(0, 30000),
      }),
    ),
  ];
}
