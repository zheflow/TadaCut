import {
  assetSchema,
  autoGrade,
  cameraKeyframes,
  cameraMoveNames,
  cameraMoves,
  colorStats,
  effectCategories,
  effectParams,
  effectPresets,
  freeAreaPatch,
  generateLook,
  layerSize,
  layoutNames,
  looks,
  serializeCube,
  transitionList,
  type Clip,
  type Command,
  type LookId,
} from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { assetPixels } from "../frames";
import { s, timelineOf, tool, type ToolHost } from "./host";

const timelineId = s.string("时间线 ID，默认当前时间线");
const clipIds = s.array(s.string(), "片段 ID 列表");
export function visualTools(h: ToolHost): AgentTool[] {
  const t = (id?: string) => timelineOf(h.project(), id);
  const clips = (tid: string | undefined, ids: string[]) => {
    const tl = t(tid);
    return ids.map((id) => {
      const c = tl.clips.find((x) => x.id === id);
      if (!c) throw new Error(`片段 ${id} 不存在`);
      return c;
    });
  };
  const g = "visual";
  /** A frame of the clip's source (seconds into the clip) for color checks. */
  const pixels = async (c: Clip, at?: number) => {
    const tl = t(),
      asset = h.project().assets.find((a) => a.id === c.assetId);
    if (!asset) throw new Error("素材不存在");
    const local = at ?? c.duration / tl.fps / 2;
    return assetPixels(
      h.media,
      asset,
      c.sourceOffset + local * c.speed,
      h.signal,
    );
  };
  return [
    tool(
      g,
      "read",
      "list_effects",
      "列出可用的特效（含参数范围）、转场、LUT 风格、镜头运动与排版。",
      s.object({ category: s.string() }),
      (a) => ({
        effects: effectPresets
          .filter((e) => !a.category || e.category === a.category)
          .map((e) => ({
            id: e.id,
            name: e.name,
            category: effectCategories[e.category],
            description: e.description,
            params: e.params.map(
              (p) =>
                `${p.key}（${p.name}）${p.min}–${p.max}，默认 ${p.default}`,
            ),
          })),
        transitions: transitionList.map((x) => ({
          kind: x.kind,
          name: x.name,
          directional: Boolean(x.directional),
        })),
        looks: Object.entries(looks).map(([id, l]) => ({
          id,
          name: l.name,
          description: l.description,
        })),
        cameraMoves: cameraMoves.map((id) => ({
          id,
          name: cameraMoveNames[id],
        })),
        layouts: layoutNames,
      }),
    ),
    tool(
      g,
      "edit",
      "apply_effect",
      "给片段添加或修改库特效（按顺序叠加，最多 8 个）；remove=true 移除该特效。参数用 list_effects 查看。",
      s.object(
        {
          clipIds,
          effectId: s.string(),
          params: s.record('参数，如 {"amount":0.5}'),
          remove: s.boolean(),
          timelineId,
        },
        ["clipIds", "effectId"],
      ),
      (a) => {
        if (!a.remove) effectParams(a.effectId, a.params ?? {});
        const tl = t(a.timelineId);
        return h.edit(
          a.remove ? "移除特效" : "添加特效",
          clips(a.timelineId, a.clipIds).map((c): Command => {
            const others = c.effects.presets.filter((p) => p.id !== a.effectId);
            const presets = a.remove
              ? others
              : [
                  ...c.effects.presets.map((p) =>
                    p.id === a.effectId
                      ? { id: p.id, params: a.params ?? p.params }
                      : p,
                  ),
                  ...(c.effects.presets.some((p) => p.id === a.effectId)
                    ? []
                    : [{ id: a.effectId, params: a.params ?? {} }]),
                ];
            if (presets.length > 8)
              throw new Error("每个片段最多叠加 8 个特效");
            return {
              type: "clip.update",
              timelineId: tl.id,
              clipId: c.id,
              patch: { effects: { ...c.effects, presets } },
            };
          }),
        );
      },
    ),
    tool(
      g,
      "edit",
      "color_adjust",
      "调整片段的色彩与抠像：brightness、contrast、saturation（1 为原样）、blur、gamma、black/white（黑白点）、lift/gain（RGB 三元组）、chromaKey（如 #00ff00）与 chromaSimilarity、lumaKey。只写要改的字段。",
      s.object({ clipIds, adjust: s.record(), timelineId }, [
        "clipIds",
        "adjust",
      ]),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(
          "调色",
          clips(a.timelineId, a.clipIds).map(
            (c): Command => ({
              type: "clip.update",
              timelineId: tl.id,
              clipId: c.id,
              patch: { effects: { ...c.effects, ...a.adjust } },
            }),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "apply_look",
      "套用程序生成的 LUT 风格（如 teal-orange、warm-film、fresh-japan），intensity 0–1。会在项目里生成对应的 .cube 素材。",
      s.object(
        {
          clipIds,
          look: s.string(undefined, Object.keys(looks)),
          intensity: s.number(),
          timelineId,
        },
        ["clipIds", "look"],
      ),
      (a) => {
        const look = looks[a.look as LookId];
        if (!look) throw new Error("没有这个风格");
        const intensity = Math.max(0, Math.min(1, a.intensity ?? 1)),
          name = `${look.name}${intensity < 1 ? ` ${Math.round(intensity * 100)}%` : ""}.cube`,
          p = h.project(),
          tl = t(a.timelineId),
          existing = p.assets.find(
            (x) => x.name === name && x.text?.startsWith("TITLE"),
          ),
          commands: Command[] = [];
        let assetId = existing?.id;
        if (!assetId) {
          const asset = assetSchema.parse({
            id: h.makeId(),
            name,
            kind: "text",
            text: serializeCube(generateLook(a.look as LookId, 25, intensity)),
            folder: "LUT",
            tags: ["LUT", "风格"],
            description: look.description,
            createdAt: h.now(),
          });
          assetId = asset.id;
          commands.push({ type: "asset.add", asset });
        }
        for (const c of clips(a.timelineId, a.clipIds))
          commands.push({
            type: "clip.update",
            timelineId: tl.id,
            clipId: c.id,
            patch: { effects: { ...c.effects, lutAssetId: assetId } },
          });
        return h.edit(`套用风格「${look.name}」`, commands);
      },
    ),
    tool(
      g,
      "read",
      "check_color",
      "检查片段画面的曝光与色彩：平均亮度、高光溢出、暗部死黑、饱和度、冷暖，并给出建议。",
      s.object(
        {
          clipId: s.string(),
          seconds: s.number("片段内第几秒，默认中间"),
          timelineId,
        },
        ["clipId"],
      ),
      async (a) => {
        const [c] = clips(a.timelineId, [a.clipId]),
          { rgba } = await pixels(c, a.seconds);
        return { ...colorStats(rgba), suggestion: autoGrade(rgba) };
      },
    ),
    tool(
      g,
      "edit",
      "auto_color",
      "按画面统计自动校正黑白点与色偏（只做技术校正，不改变创作风格）。",
      s.object({ clipIds, timelineId }, ["clipIds"]),
      async (a) => {
        const tl = t(a.timelineId),
          commands: Command[] = [];
        for (const c of clips(a.timelineId, a.clipIds)) {
          const { rgba } = await pixels(c),
            grade = autoGrade(rgba);
          commands.push({
            type: "clip.update",
            timelineId: tl.id,
            clipId: c.id,
            patch: { effects: { ...c.effects, ...grade } },
          });
        }
        return h.edit("自动校色", commands);
      },
    ),
    tool(
      g,
      "edit",
      "camera_move",
      `给片段加虚拟镜头运动（生成关键帧）。move：${cameraMoves.join("、")}；intensity 默认 1；可用 fromSeconds、lengthSeconds 只作用于片段的一段。`,
      s.object(
        {
          clipIds,
          move: s.string(undefined, cameraMoves),
          intensity: s.number(),
          fromSeconds: s.number(),
          lengthSeconds: s.number(),
          timelineId,
        },
        ["clipIds", "move"],
      ),
      (a) => {
        const tl = t(a.timelineId);
        return h.edit(
          `镜头运动：${cameraMoveNames[a.move as keyof typeof cameraMoveNames] ?? a.move}`,
          clips(a.timelineId, a.clipIds).map(
            (c): Command => ({
              type: "clip.update",
              timelineId: tl.id,
              clipId: c.id,
              patch: {
                keyframes: cameraKeyframes(tl, c, a.move, {
                  intensity: a.intensity,
                  from:
                    a.fromSeconds !== undefined
                      ? a.fromSeconds * tl.fps
                      : undefined,
                  length:
                    a.lengthSeconds !== undefined
                      ? a.lengthSeconds * tl.fps
                      : undefined,
                }),
              },
            }),
          ),
        );
      },
    ),
    tool(
      g,
      "edit",
      "crop_clip",
      "裁切片段四边（0–0.95，占画面比例）并可设圆角（像素）。",
      s.object(
        {
          clipId: s.string(),
          left: s.number(),
          top: s.number(),
          right: s.number(),
          bottom: s.number(),
          radius: s.number(),
          timelineId,
        },
        ["clipId"],
      ),
      (a) => {
        const [c] = clips(a.timelineId, [a.clipId]),
          crop = {
            left: a.left ?? c.crop?.left ?? 0,
            top: a.top ?? c.crop?.top ?? 0,
            right: a.right ?? c.crop?.right ?? 0,
            bottom: a.bottom ?? c.crop?.bottom ?? 0,
          };
        return h.edit("裁切画面", [
          {
            type: "clip.update",
            timelineId: t(a.timelineId).id,
            clipId: c.id,
            patch: {
              crop,
              ...(a.radius !== undefined ? { radius: a.radius } : {}),
            },
          },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "place_in_free_area",
      "把图形或文字片段移到画面中不遮挡主体的空白区域。subjects 为主体框（0–1 坐标，可从 view_frames 观察得到），size 为图形占画面的宽高比例。",
      s.object(
        {
          clipId: s.string(),
          subjects: s.array(
            s.object(
              {
                x: s.number(),
                y: s.number(),
                width: s.number(),
                height: s.number(),
              },
              ["x", "y", "width", "height"],
            ),
          ),
          width: s.number("占画面宽度比例，默认按素材与缩放计算"),
          height: s.number("占画面高度比例，默认按素材与缩放计算"),
          timelineId,
        },
        ["clipId", "subjects"],
      ),
      (a) => {
        const tl = t(a.timelineId),
          [c] = clips(a.timelineId, [a.clipId]),
          asset = h.project().assets.find((x) => x.id === c.assetId);
        if (!asset) throw new Error("素材不存在");
        const size = layerSize(tl, c, asset),
          { patch, covered } = freeAreaPatch(tl, c, asset, a.subjects, {
            width: a.width ?? size.width,
            height: a.height ?? size.height,
          });
        return {
          covered,
          ...h.edit("放入空白区域", [
            { type: "clip.update", timelineId: tl.id, clipId: c.id, patch },
          ]),
        };
      },
    ),
  ];
}
