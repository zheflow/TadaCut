import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  blendModes,
  portraitPresets,
  canvasNodeSchema,
  canvasRelations,
  clipAdvancedSchema,
  colorCurvesSchema,
  hslBandSchema,
  beautySchema,
  importSubtitleCommands,
  maskSchema,
  mediaOperationSchema,
  processingFeatures,
  subtitleFormats,
  timelineProfileSchema,
  type Command,
} from "@tadacut/domain";
import { processResultCommands } from "../media-processing";
import { advancedCapabilities } from "../advanced-routes";
import { s, timelineOf, tool, type ToolHost } from "./host";
const json = (schema: z.ZodTypeAny) =>
  zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
const selection = {
  clipIds: z.array(z.string()).min(1).max(200),
  timelineId: z.string().optional(),
};
export function advancedTools(h: ToolHost) {
  const editVisual = (title: string, schema: z.ZodTypeAny, field: string) =>
    tool(
      "advanced",
      "edit",
      title,
      `${field}：批量调整所选片段；使用现有 ID，每次调用可撤销。`,
      json(schema),
      (raw) => {
        const a = schema.parse(raw),
          t = timelineOf(h.project(), a.timelineId);
        return h.edit(
          field,
          a.clipIds.map((id: string) => {
            const c = t.clips.find((c) => c.id === id);
            if (!c) throw new Error("片段不存在");
            const value = Object.fromEntries(
              Object.entries(a).filter(
                ([k]) => !["clipIds", "timelineId"].includes(k),
              ),
            );
            return {
              type: "clip.update",
              timelineId: t.id,
              clipId: id,
              patch: {
                advanced: clipAdvancedSchema.parse({ ...c.advanced, ...value }),
              },
            };
          }),
        );
      },
    );
  return [
    tool(
      "advanced",
      "read",
      "list_portrait_presets",
      "列出本机人像调整预设及具体数值；应用时用 set_portrait_adjustments，并根据画面指定区域。",
      s.object({}),
      () => portraitPresets,
    ),
    tool(
      "advanced",
      "edit",
      "remove_proxy",
      "移除素材的代理关联，恢复原始素材预览，可撤销。",
      s.object({ assetIds: s.array(s.string()) }, ["assetIds"]),
      (a) =>
        h.edit(
          "恢复原始素材预览",
          z
            .array(z.string())
            .min(1)
            .max(200)
            .parse(a.assetIds)
            .map((assetId) => ({ type: "asset.proxy.clear", assetId })),
        ),
    ),
    tool(
      "advanced",
      "read",
      "advanced_capabilities",
      "查看高级媒体处理的本机支持和已配置模型，包含不可用原因。",
      s.object({}),
      () => advancedCapabilities(h.repo),
    ),
    editVisual(
      "set_clip_blend",
      z.object({ ...selection, blend: z.enum(blendModes) }).strict(),
      "图层混合模式",
    ),
    editVisual(
      "set_clip_masks",
      z.object({ ...selection, masks: z.array(maskSchema).max(8) }).strict(),
      "蒙版（形状/路径/笔刷，羽化、反向、组合与动画）",
    ),
    editVisual(
      "set_color_curves",
      z.object({ ...selection, curves: colorCurvesSchema }).strict(),
      "RGB 与主曲线",
    ),
    editVisual(
      "set_selective_hsl",
      z.object({ ...selection, hsl: z.array(hslBandSchema).max(16) }).strict(),
      "选择性色相、饱和度、明度",
    ),
    editVisual(
      "set_portrait_adjustments",
      z.object({ ...selection, beauty: beautySchema }).strict(),
      "人像局部磨皮、提亮、瘦脸、大眼和身形（手动区域）",
    ),
    tool(
      "advanced",
      "edit",
      "set_timeline_profile",
      "设置有理数帧率、丢帧时间码、工作和输出色彩空间、峰值亮度、代理预览。preserveTime 默认保持时长并重采样动画。",
      json(
        z
          .object({
            timelineId: z.string().optional(),
            profile: timelineProfileSchema,
            preserveTime: z.boolean().default(true),
          })
          .strict(),
      ),
      (raw) => {
        const a = z
          .object({
            timelineId: z.string().optional(),
            profile: timelineProfileSchema,
            preserveTime: z.boolean().default(true),
          })
          .strict()
          .parse(raw);
        return h.edit("时间线格式", [
          {
            type: "timeline.profile",
            timelineId: timelineOf(h.project(), a.timelineId).id,
            profile: a.profile,
            preserveTime: a.preserveTime,
          },
        ]);
      },
    ),
    ...processingFeatures.map((f) => {
      const operation = mediaOperationSchema.options.find(
        (o) => o.shape.type.value === f.type,
      )!;
      const schema = z
        .object({
          assetId: z.string().optional(),
          clipId: z.string().optional(),
          timelineId: z.string().optional(),
          ...Object.fromEntries(
            Object.entries(operation.shape).filter(([k]) => k !== "type"),
          ),
        })
        .strict();
      return tool(
        "advanced",
        f.local ? "job" : "generate",
        f.tool,
        `${f.name}。创建真实处理任务；完成后用 apply_media_result 应用候选结果（可撤销）。原始素材保留。${f.type === "inpaint" ? "maskAssetId 的蒙版黑色为移除区域、白色为保留区域。" : ""}${f.type === "speed-curve" ? "points 的 position 是源片段比例，speed 是该处速度，端点须为 0 和 1。" : ""}`,
        json(schema),
        (raw) => {
          const a = schema.parse(raw),
            { assetId, clipId, timelineId, ...params } = a;
          const selected =
            clipId ??
            (!assetId
              ? h.studioContext?.references.find((r) => r.kind === "clip")?.id
              : undefined);
          return h.enqueue("process-media", f.name, {
            assetId,
            clipId: selected,
            timelineId: timelineId ?? h.studioContext?.timelineId,
            expectedRevision: h.project().revision,
            operation: { ...params, type: f.type },
          });
        },
      );
    }),
    tool(
      "advanced",
      "edit",
      "apply_media_result",
      "把已完成的媒体处理结果应用到项目；校验原片段和素材指纹，发生修改时拒绝覆盖。一次撤销恢复。",
      s.object({ jobId: s.string() }, ["jobId"]),
      (a) => {
        const result = processResultCommands(h.repo, h.projectId, a.jobId);
        return {
          ...h.edit(result.label, result.commands),
          warnings: result.warnings,
        };
      },
    ),
    tool(
      "advanced",
      "edit",
      "import_subtitle_file",
      "导入 SRT/VTT/LRC/ASS 的文本内容到独立字幕或歌词轨道，保留时间、换行、可支持的 ASS 样式和卡拉 OK 时间。lyrics=true 使用歌词样式。",
      json(
        z
          .object({
            text: z.string().max(2000000),
            format: z.enum(subtitleFormats),
            timelineId: z.string().optional(),
            name: z.string().optional(),
            offset: z.number().optional(),
            styleId: z.string().optional(),
            lyrics: z.boolean().optional(),
            duration: z.number().optional(),
          })
          .strict(),
      ),
      (raw) => {
        const a = z
          .object({
            text: z.string(),
            format: z.enum(subtitleFormats),
            timelineId: z.string().optional(),
            name: z.string().optional(),
            offset: z.number().optional(),
            styleId: z.string().optional(),
            lyrics: z.boolean().optional(),
            duration: z.number().optional(),
          })
          .strict()
          .parse(raw);
        const result = importSubtitleCommands(
          h.project(),
          timelineOf(h.project(), a.timelineId),
          a,
          h.makeId,
          h.now(),
        );
        return {
          ...h.edit("导入字幕", result.commands),
          count: result.count,
          warnings: result.warnings,
        };
      },
    ),
    tool(
      "canvas",
      "read",
      "query_canvas",
      "查询画布分组、节点引用、素材历史、时间线使用位置和分镜生成历史。",
      s.object({ nodeId: s.string(), kind: s.string(), parentId: s.string() }),
      (a) => {
        const p = h.project();
        return a.nodeId
          ? canvasRelations(p, a.nodeId)
          : p.canvas.filter(
              (n) =>
                (!a.kind || n.kind === a.kind) &&
                (!a.parentId || n.parentId === a.parentId),
            );
      },
    ),
    tool(
      "canvas",
      "edit",
      "update_canvas_nodes",
      "批量创建或更新画布类型、分组、位置和引用；node 为完整节点，先 query_canvas 再修改。支持音频、视频、图片、角色、场景、道具。",
      json(
        z.object({ nodes: z.array(canvasNodeSchema).min(1).max(200) }).strict(),
      ),
      (raw) => {
        const { nodes } = z
          .object({ nodes: z.array(canvasNodeSchema).min(1).max(200) })
          .parse(raw);
        return h.edit(
          "更新画布",
          nodes.map((node) => ({ type: "canvas.upsert", node })),
        );
      },
    ),
    tool(
      "canvas",
      "edit",
      "batch_canvas_operation",
      "对节点执行分组、移动、批量替换素材或恢复素材历史；替换和恢复都追加历史。",
      json(
        z
          .object({
            nodeIds: z.array(z.string()).min(1).max(200),
            operation: z.enum(["move", "group", "replace", "restore"]),
            dx: z.number().optional(),
            dy: z.number().optional(),
            groupId: z.string().optional(),
            assetId: z.string().optional(),
            historyIndex: z.number().int().nonnegative().optional(),
          })
          .strict(),
      ),
      (raw) => {
        const a = z
          .object({
            nodeIds: z.array(z.string()).min(1).max(200),
            operation: z.enum(["move", "group", "replace", "restore"]),
            dx: z.number().optional(),
            dy: z.number().optional(),
            groupId: z.string().optional(),
            assetId: z.string().optional(),
            historyIndex: z.number().int().nonnegative().optional(),
          })
          .strict()
          .parse(raw);
        const p = h.project(),
          commands: Command[] = a.nodeIds.map((id: string) => {
            const found = p.canvas.find((n) => n.id === id);
            if (!found) throw new Error("画布节点不存在");
            const node = structuredClone(found);
            if (a.operation === "move") {
              node.x += Number(a.dx ?? 0);
              node.y += Number(a.dy ?? 0);
            }
            if (a.operation === "group") node.parentId = a.groupId || undefined;
            if (a.operation === "replace" || a.operation === "restore") {
              const assetId =
                a.operation === "restore"
                  ? node.history?.[a.historyIndex ?? 0]?.assetId
                  : a.assetId;
              if (!p.assets.some((x) => x.id === assetId))
                throw new Error("素材或历史版本不存在");
              const history = [...(node.history ?? [])];
              if (
                node.referenceId &&
                p.assets.some((x) => x.id === node.referenceId)
              )
                history.push({
                  assetId: node.referenceId,
                  at: h.now(),
                  reason: a.operation,
                });
              node.referenceId = assetId;
              node.history = history.slice(-200);
            }
            return {
              type: "canvas.upsert",
              node: canvasNodeSchema.parse(node),
            };
          });
        return h.edit("画布批量操作", commands);
      },
    ),
  ];
}
