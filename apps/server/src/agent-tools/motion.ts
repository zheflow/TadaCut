import {
  assetSchema,
  brandSchema,
  placeAsset,
  type Command,
} from "@tadacut/domain";
import {
  findTemplate,
  instantiateTemplate,
  templateCatalog,
  templateCategories,
} from "../../../../packages/motion/src/catalog";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { pluginTemplates } from "../plugins";
import { s, timeArgs, timelineOf, toFrames, tool, type ToolHost } from "./host";

export function motionTools(h: ToolHost): AgentTool[] {
  const g = "motion";
  const all = () => [...templateCatalog, ...pluginTemplates(h.repo)];
  return [
    tool(
      g,
      "read",
      "list_templates",
      "检索动态图形模板（人物条、标题、数据图表、要点、倒计时、片尾等），可按关键词或分类筛选，返回参数说明。",
      s.object({
        query: s.string(),
        category: s.string(undefined, Object.keys(templateCategories)),
      }),
      (a) => {
        const q = String(a.query ?? "").toLowerCase();
        return all()
          .filter(
            (t) =>
              (!a.category || t.category === a.category) &&
              (!q ||
                `${t.name} ${t.tags.join(" ")} ${t.id}`
                  .toLowerCase()
                  .includes(q)),
          )
          .map((t) => ({
            id: t.id,
            name: t.name,
            category: templateCategories[t.category] ?? t.category,
            duration: t.duration,
            params: t.params.map(
              (x) =>
                `${x.key}（${x.name}，${x.type}）默认 ${JSON.stringify(x.default)}`,
            ),
          }));
      },
    ),
    tool(
      g,
      "edit",
      "add_template",
      "把动态图形模板加到时间线：params 填写文字、颜色、数值或列表；不填的颜色和字体使用品牌设定。",
      s.object(
        {
          templateId: s.string(),
          params: s.record(),
          ...timeArgs,
          duration: s.number("秒"),
          trackId: s.string(),
          timelineId: s.string(),
        },
        ["templateId"],
      ),
      (a) => {
        const template = all().find((t) => t.id === a.templateId);
        if (!template) throw new Error("模板不存在");
        const p = h.project(),
          tl = timelineOf(p, a.timelineId),
          asset = assetSchema.parse({
            id: h.makeId(),
            name: template.name,
            kind: "motion",
            code: instantiateTemplate(template, a.params ?? {}, p.styles.brand),
            duration: a.duration ?? template.duration,
            folder: "动画",
            tags: ["模板", ...template.tags.slice(0, 3)],
            createdAt: h.now(),
          }),
          track =
            a.trackId ??
            tl.tracks.find((x) => x.kind === "motion" && !x.locked)?.id,
          { clip, commands } = placeAsset(
            p,
            tl,
            asset,
            toFrames(tl, a.frame, a.seconds) ?? 0,
            h.makeId,
            track,
          );
        return {
          assetId: asset.id,
          clipId: clip.id,
          ...h.edit(`添加模板「${template.name}」`, commands),
        };
      },
    ),
    tool(
      g,
      "edit",
      "edit_motion_code",
      "替换动画素材的 React 代码（default export 组件，props 为 frame、fps、width、height，只用 React 与内联样式）。",
      s.object({ assetId: s.string(), code: s.string() }, ["assetId", "code"]),
      (a) => {
        if (!/export\s+default/.test(a.code))
          throw new Error("代码需要 default export 一个组件");
        if (
          /\bimport\s|require\(|fetch\(|XMLHttpRequest|WebSocket/.test(a.code)
        )
          throw new Error(
            "动画代码只能使用 React 和内联样式，不能引入模块或访问网络",
          );
        return h.edit("修改动画代码", [
          { type: "asset.update", assetId: a.assetId, patch: { code: a.code } },
        ]);
      },
    ),
    tool(
      g,
      "job",
      "write_motion",
      "用对话模型按描述编写新的代码动画素材。",
      s.object({ prompt: s.string(), providerId: s.string() }, ["prompt"]),
      (a) =>
        h.enqueue("motion-ai", "AI 代码动画", {
          prompt: a.prompt,
          providerId: h.provider("chat", a.providerId),
        }),
    ),
    tool(
      g,
      "job",
      "bake_motion",
      "把动画片段渲染成带透明背景的视频素材（便于在其他软件使用或减轻预览负担）。",
      s.object(
        {
          clipId: s.string(),
          codec: s.string(undefined, ["prores", "vp9"]),
          timelineId: s.string(),
        },
        ["clipId"],
      ),
      (a) =>
        h.enqueue("bake-motion", "动画转视频", {
          clipId: a.clipId,
          codec: a.codec ?? "prores",
          timelineId: timelineOf(h.project(), a.timelineId).id,
        }),
    ),
    tool(
      g,
      "read",
      "brand_kit",
      "读取项目的品牌设定（名称、颜色、字体、Logo、语气）。",
      s.object({}),
      () => h.project().styles.brand,
    ),
    tool(
      g,
      "edit",
      "set_brand",
      "设置品牌：colors（第一色为主色）、fonts、logoAssetId、tone（语气）；模板和字幕会优先使用这些设定。",
      s.object({
        name: s.string(),
        colors: s.array(s.string()),
        fonts: s.array(s.string()),
        logoAssetId: s.string(),
        tone: s.string(),
      }),
      (a) => {
        const brand = brandSchema.parse({ ...h.project().styles.brand, ...a });
        const commands: Command[] = [
          { type: "styles.update", patch: { brand } },
        ];
        return h.edit("更新品牌设定", commands);
      },
    ),
  ];
}
export { findTemplate };
