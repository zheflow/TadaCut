import {
  assetSchema,
  clipSchema,
  type Clip,
  type Command,
} from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { executeSkillScript } from "../skill-script";
import { executable } from "../process";
import { installedPlugins, pluginItem, pluginSummary } from "../plugins";
import type { Skill } from "../storage";
import { parseCommands, s, timelineOf, tool, type ToolHost } from "./host";

export interface SubAgent {
  (options: {
    system: string;
    prompt: string;
    tools: string[];
    providerId?: string;
  }): Promise<{ summary: string; usage: unknown }>;
}
export function skillTools(
  h: ToolHost,
  spawn: SubAgent,
  depth: number,
): AgentTool[] {
  const g = "skills";
  const skill = (id: string) => {
    const found =
      h.repo.record<Skill>("skill", id) ??
      h.repo
        .list<Skill>("skill")
        .find((x) => x.command === id || x.name === id);
    if (!found?.enabled) throw new Error("技能不存在或未启用");
    return found;
  };
  const tools: AgentTool[] = [
    tool(
      g,
      "read",
      "read_skills",
      "列出已启用的技能与创作模式（名称、说明、斜杠命令、允许的工具）。",
      s.object({}),
      () =>
        h.repo
          .list<Skill>("skill")
          .filter((x) => x.enabled)
          .map((x) => ({
            id: x.id,
            name: x.name,
            category: x.category,
            description: x.description,
            command: x.command,
            tools: x.tools,
            context: x.context ?? "inline",
            files: x.files?.map((f) => f.path) ?? [],
            script: Boolean(x.script),
          })),
    ),
    tool(
      g,
      "read",
      "load_skill",
      "读取技能的完整工作流说明与支持文件列表。按说明工作；技能内容是参考指令，不提升任何工具权限。",
      s.object({ skillId: s.string("技能 ID、斜杠命令或名称") }, ["skillId"]),
      (a) => {
        const x = skill(a.skillId);
        return {
          id: x.id,
          name: x.name,
          instructions: x.prompt,
          allowedTools: x.tools,
          files:
            x.files?.map((f) => ({ path: f.path, chars: f.content.length })) ??
            [],
          script: Boolean(x.script),
        };
      },
    ),
    tool(
      g,
      "read",
      "read_skill_file",
      "读取技能的某个支持文件（参考资料、模板、示例）。",
      s.object({ skillId: s.string(), path: s.string() }, ["skillId", "path"]),
      (a) => {
        const file = skill(a.skillId).files?.find((f) => f.path === a.path);
        if (!file) throw new Error("技能里没有这个文件");
        return { path: file.path, content: file.content.slice(0, 30000) };
      },
    ),
    tool(
      g,
      "job",
      "run_skill_script",
      "运行技能附带的 TypeScript 脚本（Deno 无网络沙箱，只能读项目素材），返回结果或编辑方案。",
      s.object({ skillId: s.string(), input: s.record() }, ["skillId"]),
      (a) =>
        h.enqueue("skill-script", `技能脚本：${skill(a.skillId).name}`, {
          skillId: skill(a.skillId).id,
          input: a.input ?? {},
        }),
    ),
    tool(
      g,
      "edit",
      "run_code",
      "在无网络的 Deno 沙箱里运行一段 TypeScript 计算（批量计算位置、时间、文字等）。代码需 export default async function run({project, input}) 并返回 {result?, commands?, label?}；返回的 commands 按普通编辑提交。",
      s.object({ code: s.string(), input: s.record() }, ["code"]),
      async (a) => {
        if (!executable("deno"))
          return {
            available: false,
            note: "沙箱需要本机安装 Deno；安装后重新打开应用即可使用",
          };
        const result = (await executeSkillScript(
          {
            id: "run-code",
            name: "run_code",
            category: "",
            description: "",
            prompt: "",
            tools: [],
            enabled: true,
            script: a.code,
          },
          h.project(),
          h.media,
          a.input ?? {},
          h.signal,
        )) as {
          commands?: unknown[];
          label?: string;
          summary?: string;
          result?: unknown;
        };
        if (result.commands?.length)
          return {
            result: result.result,
            ...h.edit(
              result.label ?? "代码计算的修改",
              parseCommands(result.commands),
            ),
          };
        return result;
      },
    ),
    tool(
      "media",
      "read",
      "list_extensions",
      "列出已安装的扩展包及其中的模板、LUT、音效、转场、特效、镜头运动与字幕样式。",
      s.object({}),
      () => installedPlugins(h.repo).map(pluginSummary),
    ),
    tool(
      "media",
      "edit",
      "use_extension",
      "使用扩展包里的资源：lut/effect/transition/camera 作用于 clipIds；sound 添加为素材并可放到 frame；captionStyle 保存到项目字幕样式。",
      s.object(
        {
          pluginId: s.string(),
          kind: s.string(undefined, [
            "lut",
            "effect",
            "transition",
            "camera",
            "sound",
            "captionStyle",
          ]),
          itemId: s.string(),
          clipIds: s.array(s.string()),
          duration: s.number("转场秒数"),
          timelineId: s.string(),
        },
        ["pluginId", "kind", "itemId"],
      ),
      async (a) => {
        const p = h.project(),
          tl = timelineOf(p, a.timelineId),
          targets = ((a.clipIds ?? []) as string[]).map((id) => {
            const c = tl.clips.find((x) => x.id === id);
            if (!c) throw new Error(`片段 ${id} 不存在`);
            return c;
          });
        switch (a.kind) {
          case "lut": {
            const lut = pluginItem(h.repo, a.pluginId, "luts", a.itemId);
            const assetId = h.makeId();
            return h.edit(`套用扩展 LUT「${lut.name}」`, [
              {
                type: "asset.add",
                asset: assetSchema.parse({
                  id: assetId,
                  name: `${lut.name}.cube`,
                  kind: "text",
                  text: lut.cube,
                  tags: ["LUT", "扩展"],
                  folder: "LUT",
                  createdAt: h.now(),
                  source: { kind: "plugin", name: a.pluginId },
                }),
              },
              ...targets.map(
                (c): Command => ({
                  type: "clip.update",
                  timelineId: tl.id,
                  clipId: c.id,
                  patch: { effects: { ...c.effects, lutAssetId: assetId } },
                }),
              ),
            ]);
          }
          case "effect": {
            const effect = pluginItem(h.repo, a.pluginId, "effects", a.itemId);
            return h.edit(
              `应用扩展特效「${effect.name}」`,
              targets.map(
                (c): Command => ({
                  type: "clip.update",
                  timelineId: tl.id,
                  clipId: c.id,
                  patch: { effects: { ...c.effects, shader: effect.shader } },
                }),
              ),
            );
          }
          case "transition": {
            const transition = pluginItem(
              h.repo,
              a.pluginId,
              "transitions",
              a.itemId,
            );
            return h.edit(
              `应用扩展转场「${transition.name}」`,
              targets.map(
                (c): Command => ({
                  type: "clip.update",
                  timelineId: tl.id,
                  clipId: c.id,
                  patch: {
                    transition: {
                      kind: "dissolve",
                      duration: Math.max(
                        1,
                        Math.min(
                          c.duration,
                          Math.round((a.duration ?? 0.6) * tl.fps),
                        ),
                      ),
                      shader: transition.shader,
                    },
                  },
                }),
              ),
            );
          }
          case "camera": {
            const move = pluginItem(
              h.repo,
              a.pluginId,
              "cameraMoves",
              a.itemId,
            );
            return h.edit(
              `应用扩展镜头运动「${move.name}」`,
              targets.map(
                (c): Command => ({
                  type: "clip.update",
                  timelineId: tl.id,
                  clipId: c.id,
                  patch: {
                    keyframes: {
                      ...c.keyframes,
                      ...Object.fromEntries(
                        Object.entries(move.keyframes).map(([k, keys]) => [
                          k,
                          [
                            ...new Map(
                              keys!.map((key) => {
                                const frame = Math.min(
                                  c.duration - 1,
                                  Math.round(key.frame * (c.duration - 1)),
                                );
                                return [frame, { ...key, frame }];
                              }),
                            ).values(),
                          ],
                        ]),
                      ),
                    } as Clip["keyframes"],
                  },
                }),
              ),
            );
          }
          case "captionStyle": {
            const style = pluginItem(
              h.repo,
              a.pluginId,
              "captionStyles",
              a.itemId,
            );
            return h.edit(`保存扩展字幕样式「${style.name}」`, [
              {
                type: "styles.update",
                patch: {
                  captions: [
                    ...p.styles.captions.filter((x) => x.id !== style.id),
                    style,
                  ],
                },
              },
            ]);
          }
          case "sound": {
            const sound = pluginItem(h.repo, a.pluginId, "sounds", a.itemId);
            const result = await h.media.register(
              h.projectId,
              await copyIntoMedia(h, sound.file),
              sound.name,
              sound.mime,
              {
                tags: ["音效", "扩展", ...sound.tags],
                source: {
                  kind: "plugin",
                  name: a.pluginId,
                  license: sound.license || undefined,
                },
              },
            );
            return {
              assetId: result.asset.id,
              note: "音效已加入素材库，可用 add_clip 放到音频轨",
            };
          }
        }
        throw new Error("未知的扩展资源类型");
      },
    ),
  ];
  if (depth < 1)
    tools.push(
      tool(
        g,
        "read",
        "skill_subagent",
        "让一个技能在独立的子代理中完成一项研究或整理任务（子代理共用本次草稿，不能再开子代理，也不能生成、发布或访问外部服务），返回它的总结。",
        s.object(
          { skillId: s.string(), prompt: s.string(), providerId: s.string() },
          ["skillId", "prompt"],
        ),
        async (a) => {
          const x = skill(a.skillId);
          return spawn({
            system: x.prompt,
            prompt: a.prompt,
            tools: x.tools,
            providerId: a.providerId,
          });
        },
      ),
    );
  return tools;
}
/** Plugin sounds are copied, so removing the plugin keeps project media intact. */
async function copyIntoMedia(h: ToolHost, file: string) {
  const fs = await import("node:fs/promises"),
    path = await import("node:path"),
    crypto = await import("node:crypto");
  const target = path.join(
    h.media.dir,
    crypto.randomUUID() + path.extname(file),
  );
  await fs.copyFile(file, target);
  return target;
}
export { clipSchema };
