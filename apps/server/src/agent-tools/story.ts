import {
  entitySchema,
  episodeSchema,
  productionPlan,
  productionStages,
  productionSummary,
  restoreProduction,
  scriptFromShots,
  scriptRowSchema,
  shotSchema,
  shotsFromScript,
  storyOutline,
  type Command,
  type ProductionStage,
} from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { s, timelineOf, tool, type ToolHost } from "./host";

const capabilities = [
  "image",
  "video",
  "speech",
  "music",
  "sfx",
  "image-edit",
  "ref-video",
  "voice-clone",
] as const;
/** Job kinds the agent may run again with the same input. */
const rerunnable = new Set([
  "generate",
  "transcribe",
  "analyze",
  "voice-clean",
  "normalize",
  "silence",
  "multicam",
  "understand",
  "semantic",
  "motion-ai",
  "export",
  "export-clip",
  "export-still",
  "bake-motion",
  "verify-export",
  "translate-captions",
  "scene-detect",
  "voice-isolate",
  "produce",
  "turnaround",
  "cover",
]);
export function generateTools(h: ToolHost): AgentTool[] {
  const g = "generate";
  return [
    tool(
      g,
      "generate",
      "generate_media",
      "用你配置的供应商生成素材：image 图片、video 视频、speech 配音、music 音乐、sfx 音效、image-edit 按指令改图（需 assetId）、ref-video 参考图生视频（需 assetId 或 shotId 的分镜图）。返回后台任务；生成会消耗供应商额度。",
      s.object(
        {
          capability: s.string(
            undefined,
            capabilities.filter((c) => c !== "voice-clone"),
          ),
          prompt: s.string(),
          providerId: s.string(),
          duration: s.number("秒（视频、音乐、音效）"),
          voice: s.string("配音音色"),
          assetId: s.string("改图或参考图的素材"),
          shotId: s.string("生成结果绑定到这个分镜"),
          size: s.string("图片尺寸，如 1536x1024"),
        },
        ["capability", "prompt"],
      ),
      (a) =>
        h.enqueue("generate", `生成${a.capability}`, {
          ...a,
          providerId: h.provider(a.capability, a.providerId),
        }),
    ),
    tool(
      g,
      "generate",
      "rerun_job",
      "按原参数重新运行一个生成、分析或导出任务。",
      s.object({ jobId: s.string() }, ["jobId"]),
      (a) => {
        const job = h.repo.record<any>("job", a.jobId);
        if (!job || job.projectId !== h.projectId)
          throw new Error("任务不存在");
        // Publishing, uploads, imports, desktop control and runs of code or agents
        // each go through their own tool and approval, never a replay.
        if (!rerunnable.has(job.kind))
          throw new Error("这类任务不能直接重跑，请使用对应的工具");
        const { snapshot: _snapshot, ...input } = job.input ?? {};
        return h.enqueue(job.kind, `${job.label}（重跑）`, input);
      },
    ),
    tool(
      g,
      "generate",
      "clone_voice",
      "用一段参考音频在支持音色克隆的供应商创建新音色。",
      s.object(
        { assetId: s.string(), name: s.string(), providerId: s.string() },
        ["assetId", "name"],
      ),
      (a) =>
        h.enqueue("generate", "音色克隆", {
          capability: "voice-clone",
          prompt: a.name,
          assetId: a.assetId,
          providerId: h.provider("voice-clone", a.providerId),
        }),
    ),
  ];
}
export function storyTools(h: ToolHost): AgentTool[] {
  const g = "story";
  /** Video from the storyboard still when a service can, else from the prompt alone. */
  const videoProvider = (chosen?: string) => {
    if (chosen) return chosen;
    try {
      return h.provider("ref-video", undefined);
    } catch {
      return h.provider("video", undefined);
    }
  };
  const shotArgs = {
    id: s.string(),
    number: s.integer(),
    title: s.string(),
    description: s.string("画面内容"),
    dialogue: s.string(),
    duration: s.number("秒"),
    camera: s.string("景别、角度与运动"),
    prompt: s.string("生成用提示词（留空则自动合成）"),
    assetId: s.string(),
    entityIds: s.array(s.string()),
    episodeId: s.string(),
    sceneId: s.string(),
  };
  return [
    tool(
      g,
      "read",
      "story_outline",
      "读取故事全貌：开发设定、人物、分集与场、以及生产进度。",
      s.object({}),
      () => {
        const p = h.project();
        return {
          outline: storyOutline(p).slice(0, 30000),
          production: productionSummary(p),
          script: p.story.script.length,
        };
      },
    ),
    tool(
      g,
      "edit",
      "update_development",
      "更新故事开发设定：premise 前提、theme 主题、genre 类型、tone 基调、audience 受众、world 世界观、synopsis 梗概、format 形式；也可改 title 与 logline。",
      s.object({
        premise: s.string(),
        theme: s.string(),
        genre: s.string(),
        tone: s.string(),
        audience: s.string(),
        world: s.string(),
        synopsis: s.string(),
        format: s.string(),
        sourceAssetId: s.string("改编的原著文字素材"),
        title: s.string(),
        logline: s.string(),
      }),
      (a) => {
        const { title, logline, ...development } = a,
          commands: Command[] = [{ type: "story.development", development }];
        if (title !== undefined || logline !== undefined)
          commands.push({
            type: "story.logline",
            logline: logline ?? h.project().story.logline,
            ...(title ? { title } : {}),
          });
        return h.edit("更新故事设定", commands);
      },
    ),
    tool(
      g,
      "edit",
      "story_entity",
      "新建或更新角色、场景、道具设定：traits 为每个镜头都要保持一致的外观（脸、服装、配色、材质），voice 为角色的声音设定。",
      s.object(
        {
          id: s.string(),
          kind: s.string(undefined, ["character", "scene", "prop"]),
          name: s.string(),
          description: s.string(),
          traits: s.string(),
          voice: s.string(),
          referenceAssetIds: s.array(s.string()),
          confirmed: s.boolean(),
        },
        ["kind", "name"],
      ),
      (a) => {
        const existing = h.project().story.entities.find((e) => e.id === a.id);
        const entity = entitySchema.parse({
          ...existing,
          ...a,
          id: a.id || h.makeId(),
        });
        return {
          entityId: entity.id,
          ...h.edit(`更新设定「${entity.name}」`, [
            { type: "story.entity.upsert", entity },
          ]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "choose_candidate",
      "从实体的候选图中选定一张：作为参考图或三视图（front/side/back），可同时确认设定。",
      s.object(
        {
          entityId: s.string(),
          assetId: s.string(),
          as: s.string(undefined, ["reference", "front", "side", "back"]),
          confirm: s.boolean(),
        },
        ["entityId", "assetId"],
      ),
      (a) => {
        const entity = h
          .project()
          .story.entities.find((e) => e.id === a.entityId);
        if (!entity) throw new Error("设定不存在");
        const next = structuredClone(entity);
        next.candidateAssetIds = next.candidateAssetIds.filter(
          (x) => x !== a.assetId,
        );
        if (!a.as || a.as === "reference")
          next.referenceAssetIds = [
            ...new Set([...next.referenceAssetIds, a.assetId]),
          ];
        else next.views[a.as as "front" | "side" | "back"] = a.assetId;
        if (a.confirm) next.confirmed = true;
        return h.edit(`选定「${entity.name}」的图`, [
          { type: "story.entity.upsert", entity: entitySchema.parse(next) },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "upsert_episode",
      "新建或更新一集及其场（幕/场结构）：每场有标题、摘要、地点、出场设定 entityIds 与节拍 beats。",
      s.object(
        {
          id: s.string(),
          number: s.integer(),
          title: s.string(),
          summary: s.string(),
          scenes: s.array(
            s.object(
              {
                id: s.string(),
                number: s.integer(),
                title: s.string(),
                summary: s.string(),
                location: s.string(),
                entityIds: s.array(s.string()),
                beats: s.array(s.string()),
              },
              ["number", "title"],
            ),
          ),
        },
        ["number", "title"],
      ),
      (a) => {
        const existing = h.project().story.episodes.find((e) => e.id === a.id);
        const episode = episodeSchema.parse({
          ...existing,
          ...a,
          id: a.id || h.makeId(),
          scenes: (a.scenes ?? existing?.scenes ?? []).map((sc: any) => ({
            ...sc,
            id: sc.id || h.makeId(),
          })),
        });
        return {
          episodeId: episode.id,
          ...h.edit(`更新第 ${episode.number} 集`, [
            { type: "story.episode.upsert", episode },
          ]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "remove_episode",
      "删除一集（分镜和脚本对它的引用会被清除）。",
      s.object({ episodeId: s.string() }, ["episodeId"]),
      (a) =>
        h.edit("删除分集", [
          { type: "story.episode.remove", episodeId: a.episodeId },
        ]),
    ),
    tool(
      g,
      "edit",
      "set_script",
      "写入脚本表（逐行：visual 画面、narration 旁白、dialogue 台词、speaker 说话人、duration 秒、sceneId、notes）。mode=replace 整表替换，append 追加，update 按 id 更新。",
      s.object(
        {
          rows: s.array(
            s.object({
              id: s.string(),
              number: s.integer(),
              sceneId: s.string(),
              shotId: s.string(),
              visual: s.string(),
              narration: s.string(),
              dialogue: s.string(),
              speaker: s.string(),
              duration: s.number(),
              notes: s.string(),
            }),
          ),
          mode: s.string(undefined, ["replace", "append", "update"]),
        },
        ["rows"],
      ),
      (a) => {
        const current = h.project().story.script,
          mode = a.mode ?? "replace";
        let rows = (a.rows as any[]).map((r, i) => ({
          ...r,
          id: r.id || h.makeId(),
          number: r.number ?? i + 1,
        }));
        if (mode === "append") {
          const start = Math.max(0, ...current.map((r) => r.number));
          rows = [
            ...current,
            ...rows.map((r, i) => ({ ...r, number: start + i + 1 })),
          ];
        } else if (mode === "update")
          rows = current.map((r) => {
            const patch = rows.find((x) => x.id === r.id);
            return patch ? { ...r, ...patch } : r;
          });
        return h.edit("更新脚本表", [
          {
            type: "story.script.set",
            rows: rows.map((r) => scriptRowSchema.parse(r)),
          },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "shots_from_script",
      "按脚本表生成或更新分镜：每行一个镜头，已关联的行更新原镜头。",
      s.object({ rowIds: s.array(s.string()) }),
      (a) =>
        h.edit(
          "按脚本生成分镜",
          shotsFromScript(h.project(), h.makeId, a.rowIds),
        ),
    ),
    tool(
      g,
      "edit",
      "script_from_shots",
      "把现有分镜整理成脚本表（已有的旁白和备注保留）。",
      s.object({}),
      () =>
        h.edit("从分镜整理脚本", [
          {
            type: "story.script.set",
            rows: scriptFromShots(h.project(), h.makeId),
          },
        ]),
    ),
    tool(
      g,
      "edit",
      "story_shot",
      "新建或更新一个分镜镜头。",
      s.object(shotArgs, ["number", "title", "description", "duration"]),
      (a) => {
        const existing = h.project().story.shots.find((x) => x.id === a.id);
        const shot = shotSchema.parse({
          ...existing,
          ...a,
          id: a.id || h.makeId(),
        });
        return {
          shotId: shot.id,
          ...h.edit(`更新镜头 ${shot.number}`, [
            { type: "story.shot.upsert", shot },
          ]),
        };
      },
    ),
    tool(
      g,
      "edit",
      "remove_shot",
      "删除分镜镜头。",
      s.object({ shotId: s.string() }, ["shotId"]),
      (a) =>
        h.edit("删除镜头", [{ type: "story.shot.remove", shotId: a.shotId }]),
    ),
    tool(
      g,
      "read",
      "production_plan",
      "预览批量生产计划：哪些镜头的分镜图、视频、配音缺失或已过期（输入变了）。",
      s.object({
        stages: s.array(s.string(undefined, productionStages)),
        shotIds: s.array(s.string()),
        force: s.boolean(),
      }),
      (a) => {
        const plan = productionPlan(h.project(), {
          stages: (a.stages?.length
            ? a.stages
            : productionStages) as ProductionStage[],
          shotIds: a.shotIds,
          force: a.force,
        });
        return {
          tasks: plan.length,
          plan: plan.slice(0, 80).map(({ prompt, ...rest }) => ({
            ...rest,
            prompt: prompt.slice(0, 300),
          })),
        };
      },
    ),
    tool(
      g,
      "generate",
      "produce_shots",
      "批量生产分镜：按顺序生成分镜图（frame）、再用分镜图生成视频（video）、为有台词的镜头配音（voice）；跳过已是最新的产物。providerIds 指定各阶段用的供应商。",
      s.object({
        stages: s.array(s.string(undefined, productionStages)),
        shotIds: s.array(s.string()),
        providerIds: s.object({
          frame: s.string(),
          video: s.string(),
          voice: s.string(),
        }),
        force: s.boolean(),
        assemble: s.boolean("完成后把镜头同步到时间线"),
      }),
      (a) => {
        const stages = (
            a.stages?.length ? a.stages : productionStages
          ) as ProductionStage[],
          ids = a.providerIds ?? {},
          providerIds = {
            ...(stages.includes("frame")
              ? { frame: h.provider("image", ids.frame) }
              : {}),
            ...(stages.includes("video")
              ? { video: videoProvider(ids.video) }
              : {}),
            ...(stages.includes("voice")
              ? { voice: h.provider("speech", ids.voice) }
              : {}),
          };
        const plan = productionPlan(h.project(), {
          stages,
          shotIds: a.shotIds,
          providerIds,
          force: a.force,
        });
        if (!plan.length)
          return { note: "所选镜头的产物都是最新的，没有需要生产的内容" };
        return h.enqueue("produce", `批量生产 ${plan.length} 项`, {
          stages,
          shotIds: a.shotIds,
          providerIds,
          force: a.force,
          assemble: a.assemble,
        });
      },
    ),
    tool(
      g,
      "edit",
      "restore_take",
      "把镜头恢复为生产记录里的某个历史版本（图、视频或配音）。",
      s.object({ shotId: s.string(), assetId: s.string() }, [
        "shotId",
        "assetId",
      ]),
      (a) => {
        const shot = h.project().story.shots.find((x) => x.id === a.shotId);
        if (!shot) throw new Error("镜头不存在");
        return h.edit("恢复镜头版本", [
          {
            type: "story.shot.upsert",
            shot: restoreProduction(shot, a.assetId),
          },
        ]);
      },
    ),
    tool(
      g,
      "edit",
      "sync_story",
      "在分镜与时间线之间同步：story-to-timeline 把镜头排到轨道上；timeline-to-story 按时间线更新镜头顺序和时长。",
      s.object(
        {
          direction: s.string(undefined, [
            "story-to-timeline",
            "timeline-to-story",
          ]),
          trackId: s.string(),
          force: s.boolean(),
          timelineId: s.string(),
        },
        ["direction"],
      ),
      (a) => {
        const tl = timelineOf(h.project(), a.timelineId),
          trackId =
            a.trackId ??
            tl.tracks.find((x) => x.kind === "video" && !x.locked)?.id;
        if (!trackId) throw new Error("需要一条画面轨道");
        return h.edit("同步分镜与时间线", [
          {
            type: "story.sync",
            timelineId: tl.id,
            direction: a.direction,
            trackId,
            force: a.force ?? false,
          },
        ]);
      },
    ),
    tool(
      g,
      "generate",
      "character_turnaround",
      "为角色生成三视图（正面、侧面、背面）候选图，保持设定一致；生成后用 choose_candidate 选定。",
      s.object({ entityId: s.string(), providerId: s.string() }, ["entityId"]),
      (a) =>
        h.enqueue("turnaround", "角色三视图", {
          entityId: a.entityId,
          providerId: h.provider("image", a.providerId),
        }),
    ),
    tool(
      g,
      "generate",
      "make_cover",
      "生成视频封面：按项目与故事设定生成图片，可带标题文字。",
      s.object({
        prompt: s.string(),
        title: s.string(),
        providerId: s.string(),
        size: s.string("默认按时间线画幅"),
      }),
      (a) =>
        h.enqueue("cover", "生成封面", {
          ...a,
          providerId: h.provider("image", a.providerId),
        }),
    ),
  ];
}
