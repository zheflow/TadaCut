import {
  applyLayout,
  applyTimelineMarkdown,
  clipSchema,
  closeGaps,
  diffClips,
  duplicateClips,
  exportTimelineMarkdown,
  framePresets,
  insertEdit,
  keyframeProperties,
  layouts,
  makeTimeline,
  markerSchema,
  moveClips,
  nestClips,
  newTrack,
  overwriteEdit,
  placeAsset,
  reframeTimeline,
  rippleDelete,
  rippleDeleteGap,
  rippleTrim,
  rollEdit,
  slideClip,
  slipClip,
  trackSchema,
  transitionKinds,
  trimBounds,
  watermarkSchema,
  withLinked,
  type Clip,
  type Command,
} from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { s, timeArgs, timelineOf, toFrames, tool, type ToolHost } from "./host";

const timelineId = s.string("时间线 ID，默认当前时间线");
const clipIds = s.array(s.string(), "片段 ID 列表");
export function timelineTools(h: ToolHost): AgentTool[] {
  const t = (id?: string) => timelineOf(h.project(), id);
  const clipOf = (tid: string | undefined, id: string) => {
    const c = t(tid).clips.find((x) => x.id === id);
    if (!c) throw new Error(`片段 ${id} 不存在`);
    return c;
  };
  const g = "timeline";
  return [
    tool(
      g,
      "edit",
      "add_clip",
      "把素材放到时间线。mode=place（默认）放到不覆盖其他片段的位置；insert 在该帧插入并把后面的内容推后；overwrite 覆盖该位置原有内容。",
      s.object(
        {
          assetId: s.string(),
          ...timeArgs,
          trackId: s.string("目标轨道；insert/overwrite 必填"),
          duration: s.number("秒，默认素材时长"),
          sourceStart: s.number("从素材第几秒开始"),
          mode: s.string("放置方式", ["place", "insert", "overwrite"]),
          timelineId,
        },
        ["assetId"],
      ),
      (a) => {
        const p = h.project(),
          tl = t(a.timelineId),
          asset = p.assets.find((x) => x.id === a.assetId);
        if (!asset) throw new Error("素材不存在");
        const at = toFrames(tl, a.frame, a.seconds) ?? 0;
        if (!a.mode || a.mode === "place") {
          const { clip, commands } = placeAsset(
            p,
            tl,
            asset,
            at,
            h.makeId,
            a.trackId,
          );
          if (a.duration || a.sourceStart) {
            const add = commands.find((c) => c.type === "clip.add") as Extract<
              Command,
              { type: "clip.add" }
            >;
            add.clip = clipSchema.parse({
              ...add.clip,
              ...(a.duration
                ? { duration: Math.max(1, Math.round(a.duration * tl.fps)) }
                : {}),
              ...(a.sourceStart
                ? { sourceOffset: Math.max(0, a.sourceStart) }
                : {}),
            });
          }
          return {
            clipId: clip.id,
            ...h.edit(`添加「${asset.name}」`, commands),
          };
        }
        if (!a.trackId) throw new Error("插入或覆盖需要 trackId");
        const clip = clipSchema.parse({
          id: h.makeId(),
          assetId: asset.id,
          trackId: a.trackId,
          start: at,
          duration: Math.max(
            1,
            Math.round((a.duration ?? asset.duration ?? 5) * tl.fps),
          ),
          sourceOffset: Math.max(0, a.sourceStart ?? 0),
          name: asset.name,
          ...(asset.text ? { text: asset.text } : {}),
        });
        const commands =
          a.mode === "insert"
            ? insertEdit(p, tl, [clip], h.makeId)
            : overwriteEdit(p, tl, [clip], h.makeId);
        return {
          clipId: clip.id,
          ...h.edit(
            `${a.mode === "insert" ? "插入" : "覆盖"}「${asset.name}」`,
            commands,
          ),
        };
      },
    ),
    tool(
      g,
      "edit",
      "update_clips",
      "修改片段属性（位置 x/y、scale、scaleX/scaleY、rotation、opacity、volume、speed、fadeIn/fadeOut、fit、crop、radius、name、text、textStyle、effects 等）。每项给 clipId 和 patch，只写要改的字段。",
      s.object(
        {
          updates: s.array(
            s.object({ clipId: s.string(), patch: s.record("片段字段") }, [
              "clipId",
              "patch",
            ]),
          ),
          label: s.string(),
          timelineId,
        },
        ["updates"],
      ),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(
          a.label || "修改片段",
          a.updates.map(
            (u: any): Command => ({
              type: "clip.update",
              timelineId: tl.id,
              clipId: u.clipId,
              patch: u.patch,
            }),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "move_clips",
      "移动片段（连同链接的音画）。frames 为平移帧数（可负），或用 toFrame 把最早的片段移到该帧；tracks 为上下移动的轨道数。",
      s.object(
        {
          clipIds,
          frames: s.integer(),
          toFrame: s.integer(),
          tracks: s.integer(),
          timelineId,
        },
        ["clipIds"],
      ),
      (a) => {
        const p = h.project(),
          tl = t(a.timelineId),
          ids = withLinked(tl, a.clipIds),
          first = Math.min(
            ...tl.clips.filter((c) => ids.includes(c.id)).map((c) => c.start),
          ),
          shift = Number.isFinite(a.toFrame)
            ? a.toFrame - first
            : (a.frames ?? 0);
        const result = moveClips(p, tl, ids, shift, a.tracks ?? 0);
        if ("error" in result) throw new Error(result.error);
        return h.edit(
          "移动片段",
          result.moves.map(
            (m): Command => ({
              type: "clip.update",
              timelineId: tl.id,
              clipId: m.clipId,
              patch: { start: m.start, trackId: m.trackId },
            }),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "split_clips",
      "在某一帧切开片段：给 clipIds 只切这些片段，否则切开该帧上所有未锁定轨道的片段。",
      s.object({ ...timeArgs, clipIds, timelineId }),
      (a) => {
        const tl = t(a.timelineId),
          at = toFrames(tl, a.frame, a.seconds);
        if (at === undefined) throw new Error("请给出 frame 或 seconds");
        const locked = new Set(
          tl.tracks.filter((x) => x.locked).map((x) => x.id),
        );
        const targets = tl.clips.filter(
          (c) =>
            (a.clipIds?.length
              ? a.clipIds.includes(c.id)
              : !locked.has(c.trackId)) &&
            c.start < at &&
            at < c.start + c.duration,
        );
        if (!targets.length) throw new Error("这一帧没有可切开的片段");
        const created: string[] = [];
        const result = h.edit(
          "切开片段",
          targets.map((c): Command => {
            const newClipId = h.makeId();
            created.push(newClipId);
            return {
              type: "clip.split",
              timelineId: tl.id,
              clipId: c.id,
              at,
              newClipId,
            };
          }),
        );
        return { ...result, newClipIds: created };
      },
    ),
    tool(
      g,
      "edit",
      "delete_clips",
      "删除片段（默认连同链接的音画）。ripple=true 时后面的内容前移补上空隙（同步锁定的轨道一起前移）。",
      s.object(
        {
          clipIds,
          ripple: s.boolean(),
          includeLinked: s.boolean("默认 true"),
          timelineId,
        },
        ["clipIds"],
      ),
      (a) => {
        const tl = t(a.timelineId);
        if (a.ripple)
          return h.edit("波纹删除", rippleDelete(tl, a.clipIds, h.makeId));
        const ids =
          a.includeLinked === false ? a.clipIds : withLinked(tl, a.clipIds);
        return h.edit(
          "删除片段",
          ids.map(
            (clipId: string): Command => ({
              type: "clip.remove",
              timelineId: tl.id,
              clipId,
              ripple: false,
            }),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "trim_clip",
      "修剪片段的开头或结尾。frames 为正表示剪掉（开头）或延长（结尾）。ripple=true 时后面的内容跟着移动。",
      s.object(
        {
          clipId: s.string(),
          edge: s.string("start 或 end", ["start", "end"]),
          frames: s.integer(),
          ripple: s.boolean(),
          timelineId,
        },
        ["clipId", "edge", "frames"],
      ),
      (a) => {
        const p = h.project(),
          tl = t(a.timelineId);
        if (a.ripple)
          return h.edit(
            "波纹修剪",
            rippleTrim(p, tl, a.clipId, a.edge, a.frames, h.makeId),
          );
        const c = clipOf(tl.id, a.clipId),
          asset = p.assets.find((x) => x.id === c.assetId)!,
          bounds = trimBounds(tl, c, asset);
        let patch: Partial<Clip>;
        if (a.edge === "end") {
          const end = Math.max(
            c.start + 1,
            Math.min(bounds.maxEnd, c.start + c.duration + a.frames),
          );
          patch = { duration: end - c.start };
        } else {
          const start = Math.min(
              c.start + c.duration - 1,
              Math.max(bounds.minStart, c.start + a.frames),
            ),
            d = start - c.start;
          patch = {
            start,
            duration: c.duration - d,
            sourceOffset: Math.max(0, c.sourceOffset + (d / tl.fps) * c.speed),
          };
        }
        if (patch.duration !== undefined)
          patch.keyframes = Object.fromEntries(
            Object.entries(c.keyframes).map(([k, keys]) => [
              k,
              keys!
                .map((key) => ({
                  ...key,
                  frame: key.frame - ((patch.start ?? c.start) - c.start),
                }))
                .filter((key) => key.frame >= 0 && key.frame < patch.duration!),
            ]),
          ) as Clip["keyframes"];
        return h.edit("修剪片段", [
          { type: "clip.update", timelineId: tl.id, clipId: c.id, patch },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "slip_clip",
      "滑移：片段位置和长度不变，改为显示素材更早或更晚的部分（frames 正数向后）。",
      s.object({ clipId: s.string(), frames: s.integer(), timelineId }, [
        "clipId",
        "frames",
      ]),
      (a) =>
        h.edit(
          "滑移片段",
          slipClip(h.project(), t(a.timelineId), a.clipId, a.frames),
        ),
    ),
    tool(
      g,
      "edit",
      "roll_edit",
      "滚动编辑：移动相邻两个片段之间的剪辑点，总长度不变。",
      s.object(
        {
          leftClipId: s.string(),
          rightClipId: s.string(),
          frames: s.integer(),
          timelineId,
        },
        ["leftClipId", "rightClipId", "frames"],
      ),
      (a) =>
        h.edit(
          "滚动编辑",
          rollEdit(
            h.project(),
            t(a.timelineId),
            a.leftClipId,
            a.rightClipId,
            a.frames,
          ),
        ),
    ),
    tool(
      g,
      "edit",
      "slide_clip",
      "滑动编辑：片段在左右邻居之间移动，邻居让出或补上帧数。",
      s.object({ clipId: s.string(), frames: s.integer(), timelineId }, [
        "clipId",
        "frames",
      ]),
      (a) =>
        h.edit(
          "滑动编辑",
          slideClip(h.project(), t(a.timelineId), a.clipId, a.frames),
        ),
    ),
    tool(
      g,
      "edit",
      "close_gaps",
      "关闭轨道上的所有空隙（默认所有未锁定轨道），保持顺序。",
      s.object({ trackIds: s.array(s.string()), timelineId }),
      (a) => {
        const commands = closeGaps(t(a.timelineId), a.trackIds);
        if (!commands.length) return { note: "没有需要关闭的空隙" };
        return h.edit("关闭空隙", commands);
      },
    ),
    tool(
      g,
      "edit",
      "remove_gap",
      "删除某条轨道上某一帧所在的空隙，后面的内容前移。",
      s.object({ trackId: s.string(), ...timeArgs, timelineId }, ["trackId"]),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(
          "删除空隙",
          rippleDeleteGap(
            tl,
            a.trackId,
            toFrames(tl, a.frame, a.seconds) ?? 0,
            h.makeId,
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "duplicate_clips",
      "复制片段到指定帧（默认这些轨道的末尾），保持相对时间与链接关系。",
      s.object({ clipIds, ...timeArgs, timelineId }, ["clipIds"]),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(
          "复制片段",
          duplicateClips(
            tl,
            a.clipIds,
            h.makeId,
            toFrames(tl, a.frame, a.seconds),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "link_clips",
      "链接或解除链接片段（如画面与它的声音），链接后移动、删除、滑移会一起进行。",
      s.object({ clipIds, link: s.boolean(), timelineId }, ["clipIds", "link"]),
      (a) =>
        h.edit(a.link ? "链接片段" : "解除链接", [
          {
            type: "clip.link",
            timelineId: t(a.timelineId).id,
            clipIds: a.clipIds,
            linkId: a.link ? h.makeId() : null,
          },
        ]),
    ),
    tool(
      g,
      "edit",
      "group_clips",
      "编组或取消编组片段。",
      s.object({ clipIds, group: s.boolean(), timelineId }, [
        "clipIds",
        "group",
      ]),
      (a) =>
        h.edit(a.group ? "编组" : "取消编组", [
          {
            type: "clip.group",
            timelineId: t(a.timelineId).id,
            clipIds: a.clipIds,
            groupId: a.group ? h.makeId() : null,
          },
        ]),
    ),
    tool(
      g,
      "edit",
      "update_track",
      "修改轨道：name、muted、hidden、locked、volume、syncLock（同步锁定）、role（dialogue/music/effects/voiceover/other）。",
      s.object({ trackId: s.string(), patch: s.record(), timelineId }, [
        "trackId",
        "patch",
      ]),
      (a) =>
        h.edit("修改轨道", [
          {
            type: "track.update",
            timelineId: t(a.timelineId).id,
            trackId: a.trackId,
            patch: trackSchema.partial().omit({ id: true }).parse(a.patch),
          },
        ]),
    ),
    tool(
      g,
      "edit",
      "add_track",
      "新增轨道。",
      s.object(
        {
          kind: s.string(undefined, ["video", "audio", "text", "motion"]),
          name: s.string(),
          role: s.string(undefined, [
            "dialogue",
            "music",
            "effects",
            "voiceover",
            "other",
          ]),
          timelineId,
        },
        ["kind"],
      ),
      (a) => {
        const tl = t(a.timelineId),
          track = trackSchema.parse({
            ...newTrack(tl, a.kind, h.makeId()),
            ...(a.name ? { name: a.name } : {}),
            ...(a.role ? { role: a.role } : {}),
          });
        return {
          trackId: track.id,
          ...h.edit("新增轨道", [
            { type: "track.add", timelineId: tl.id, track },
          ]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "add_marker",
      "添加标记（可带时长与备注），用于章节、节拍、待办或高光。",
      s.object(
        {
          ...timeArgs,
          label: s.string(),
          color: s.string(),
          duration: s.number("秒"),
          note: s.string(),
          timelineId,
        },
        ["label"],
      ),
      (a) => {
        const tl = t(a.timelineId),
          marker = markerSchema.parse({
            id: h.makeId(),
            frame: toFrames(tl, a.frame, a.seconds) ?? 0,
            label: a.label,
            color: a.color ?? "#d3ba85",
            duration: Math.max(0, Math.round((a.duration ?? 0) * tl.fps)),
            note: a.note ?? "",
          });
        return {
          markerId: marker.id,
          ...h.edit("添加标记", [
            { type: "marker.add", timelineId: tl.id, marker },
          ]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "update_marker",
      "修改标记的名称、颜色、位置、时长或备注；remove=true 删除。",
      s.object(
        {
          markerId: s.string(),
          patch: s.record(),
          remove: s.boolean(),
          timelineId,
        },
        ["markerId"],
      ),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(a.remove ? "删除标记" : "修改标记", [
          a.remove
            ? { type: "marker.remove", timelineId: tl.id, markerId: a.markerId }
            : {
                type: "marker.update",
                timelineId: tl.id,
                markerId: a.markerId,
                patch: markerSchema
                  .partial()
                  .omit({ id: true })
                  .parse(a.patch ?? {}),
              },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "create_timeline",
      "新建时间线（可指定画幅与帧率），并切换过去。",
      s.object(
        {
          name: s.string(),
          width: s.integer(),
          height: s.integer(),
          fps: s.integer(),
        },
        ["name"],
      ),
      (a) => {
        const timeline = makeTimeline(
          h.makeId(),
          a.name,
          a.fps ?? 30,
          a.width ?? 1920,
          a.height ?? 1080,
        );
        return {
          timelineId: timeline.id,
          ...h.edit("新建时间线", [{ type: "timeline.create", timeline }]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "switch_timeline",
      "切换当前时间线，或改名、改画幅。",
      s.object(
        {
          timelineId: s.string(),
          name: s.string(),
          width: s.integer(),
          height: s.integer(),
        },
        ["timelineId"],
      ),
      (a) => {
        const commands: Command[] = [
          { type: "timeline.activate", timelineId: a.timelineId },
        ];
        if (a.name)
          commands.push({
            type: "timeline.rename",
            timelineId: a.timelineId,
            name: a.name,
          });
        if (a.width && a.height)
          commands.push({
            type: "timeline.resize",
            timelineId: a.timelineId,
            width: a.width,
            height: a.height,
          });
        return h.edit("切换时间线", commands);
      },
    ),
    tool(
      g,
      "edit",
      "reframe_timeline",
      "把时间线复制成另一种画幅（9:16、1:1、4:5、16:9），按比例保留位置与字幕大小，原时间线不变。",
      s.object(
        {
          preset: s.string(
            undefined,
            framePresets.map((f) => f.id),
          ),
          timelineId,
        },
        ["preset"],
      ),
      (a) => {
        const p = h.project(),
          source = t(a.timelineId),
          preset = framePresets.find((f) => f.id === a.preset);
        if (!preset) throw new Error("未知画幅");
        const timeline = reframeTimeline(source, p.assets, {
          id: h.makeId(),
          name: `${source.name} · ${preset.name}`,
          width: preset.width,
          height: preset.height,
        });
        return {
          timelineId: timeline.id,
          ...h.edit(`重构为${preset.name}`, [
            { type: "timeline.create", timeline },
          ]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "nest_clips",
      "把选中的片段打包成嵌套序列（复合片段）：它们移到一条新时间线，原位置换成一个可整体移动、调色、加转场的片段。",
      s.object({ clipIds, name: s.string(), timelineId }, ["clipIds"]),
      (a) => {
        const nested = nestClips(
          t(a.timelineId),
          a.clipIds,
          h.makeId,
          h.now(),
          a.name || "嵌套序列",
        );
        return {
          clipId: nested.clipId,
          nestedTimelineId: nested.timelineId,
          ...h.edit("打包为嵌套序列", nested.commands),
        };
      },
    ),
    tool(
      g,
      "edit",
      "set_watermark",
      "设置或移除时间线水印：图片素材（assetId）或文字，位置为四角或居中。传 remove=true 移除。",
      s.object({
        assetId: s.string(),
        text: s.string(),
        position: s.string(undefined, [
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
          "center",
        ]),
        opacity: s.number("0–1"),
        scale: s.number("宽度占画面比例"),
        remove: s.boolean(),
        background: s.string("同时修改时间线背景色"),
        timelineId,
      }),
      (a) =>
        h.edit(a.remove ? "移除水印" : "设置水印", [
          {
            type: "timeline.update",
            timelineId: t(a.timelineId).id,
            patch: {
              ...(a.background ? { background: a.background } : {}),
              watermark: a.remove
                ? null
                : watermarkSchema.parse({
                    ...(a.assetId ? { assetId: a.assetId } : {}),
                    ...(a.text ? { text: a.text } : {}),
                    ...(a.position ? { position: a.position } : {}),
                    ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
                    ...(a.scale !== undefined ? { scale: a.scale } : {}),
                  }),
            },
          },
        ]),
    ),
    tool(
      g,
      "edit",
      "apply_layout",
      "排版：画中画（四角）、左右/上下分屏、三栏、四宫格、九宫格或全屏。clipIds 按顺序填入各格（画中画第一个是背景）。",
      s.object(
        {
          clipIds,
          layout: s.string(undefined, layouts),
          gap: s.number("格间距，占画面比例 0–0.1"),
          radius: s.number("圆角像素"),
          timelineId,
        },
        ["clipIds", "layout"],
      ),
      (a) =>
        h.edit(
          "画面排版",
          applyLayout(t(a.timelineId), a.clipIds, a.layout, {
            gap: a.gap,
            radius: a.radius,
          }),
        ),
    ),
    tool(
      g,
      "edit",
      "set_keyframes",
      `设置片段属性的关键帧（帧号为片段内的帧）。属性：${keyframeProperties.join("、")}。easing 可为 linear、ease-in、ease-out、ease-in-out、hold、bezier（配合 bezier:[x1,y1,x2,y2]）。replace=false 时与已有关键帧合并。`,
      s.object(
        {
          clipId: s.string(),
          property: s.string(undefined, keyframeProperties),
          keyframes: s.array(
            s.object(
              {
                frame: s.integer(),
                value: s.number(),
                easing: s.string(),
                bezier: s.array(s.number()),
              },
              ["frame", "value"],
            ),
          ),
          replace: s.boolean(),
          timelineId,
        },
        ["clipId", "property", "keyframes"],
      ),
      (a) => {
        const tl = t(a.timelineId),
          c = clipOf(tl.id, a.clipId),
          existing =
            a.replace === false
              ? (c.keyframes[a.property as keyof Clip["keyframes"]] ?? [])
              : [],
          merged = [
            ...new Map(
              [...existing, ...a.keyframes].map((k: any) => [k.frame, k]),
            ).values(),
          ].sort((x: any, y: any) => x.frame - y.frame);
        return h.edit("设置关键帧", [
          {
            type: "clip.update",
            timelineId: tl.id,
            clipId: c.id,
            patch: { keyframes: { ...c.keyframes, [a.property]: merged } },
          },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "set_transition",
      `设置片段结尾到下一个相邻片段的转场。kind：${transitionKinds.join("、")}；remove=true 移除。`,
      s.object(
        {
          clipIds,
          kind: s.string(undefined, transitionKinds),
          duration: s.number("秒，默认 0.5"),
          direction: s.string(undefined, ["left", "right", "up", "down"]),
          remove: s.boolean(),
          timelineId,
        },
        ["clipIds"],
      ),
      (a) => {
        const tl = t(a.timelineId),
          before = (a.clipIds as string[]).map((id) => clipOf(tl.id, id)),
          after = before.map((c): Clip => {
            if (a.remove) {
              const { transition: _drop, ...rest } = c;
              return rest as Clip;
            }
            return {
              ...c,
              transition: {
                kind: a.kind ?? "dissolve",
                duration: Math.max(
                  1,
                  Math.min(
                    c.duration,
                    Math.round((a.duration ?? 0.5) * tl.fps),
                  ),
                ),
                ...(a.direction ? { direction: a.direction } : {}),
              },
            };
          });
        return h.edit(
          a.remove ? "移除转场" : "设置转场",
          diffClips(tl.id, before, after),
        );
      },
    ),
    tool(
      g,
      "edit",
      "set_speed",
      "改变片段播放速度。keepSource=true（默认）保持同一段素材，片段长度随速度变化。",
      s.object(
        {
          clipId: s.string(),
          speed: s.number("0.05–16"),
          keepSource: s.boolean(),
          timelineId,
        },
        ["clipId", "speed"],
      ),
      (a) => {
        const tl = t(a.timelineId),
          c = clipOf(tl.id, a.clipId),
          speed = Math.max(0.05, Math.min(16, a.speed)),
          duration =
            a.keepSource === false
              ? c.duration
              : Math.max(1, Math.round((c.duration * c.speed) / speed));
        return h.edit("调整速度", [
          {
            type: "clip.update",
            timelineId: tl.id,
            clipId: c.id,
            patch: {
              speed,
              duration,
              keyframes: Object.fromEntries(
                Object.entries(c.keyframes).map(([k, keys]) => [
                  k,
                  [
                    ...new Map(
                      keys!.map((key) => {
                        const frame = Math.min(
                          duration - 1,
                          Math.round((key.frame * duration) / c.duration),
                        );
                        return [frame, { ...key, frame }];
                      }),
                    ).values(),
                  ],
                ]),
              ) as Clip["keyframes"],
            },
          },
        ]);
      },
    ),
    tool(
      g,
      "read",
      "timeline_markdown",
      "把时间线导出为可编辑的 Markdown 表格（含片段 ID），用于整体检查。",
      s.object({ timelineId }),
      (a) => ({
        markdown: exportTimelineMarkdown(h.project(), t(a.timelineId)),
      }),
    ),
    tool(
      g,
      "edit",
      "apply_timeline_markdown",
      "按编辑后的时间线 Markdown 表格修改片段的轨道、起点、时长和文字；没有 ID 的行按素材名新增片段；removeMissing=true 删除表格中不存在的片段。",
      s.object(
        { markdown: s.string(), removeMissing: s.boolean(), timelineId },
        ["markdown"],
      ),
      (a) => {
        const commands = applyTimelineMarkdown(
          h.project(),
          t(a.timelineId),
          a.markdown,
          h.makeId,
          { removeMissing: a.removeMissing },
        );
        if (!commands.length) return { note: "表格与时间线一致，没有修改" };
        return h.edit("按表格修改时间线", commands);
      },
    ),
    tool(
      g,
      "read",
      "read_history",
      "读取最近的修改历史（可撤销列表）。",
      s.object({}),
      () =>
        h.repo
          .history(h.projectId)
          .entries.slice(0, 40)
          .map((e: any) => ({ label: e.label, applied: e.applied === 1 })),
    ),
  ];
}
