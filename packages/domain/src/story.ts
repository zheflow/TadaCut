import type { Command } from "./commands";
import {
  scriptRowSchema,
  shotSchema,
  type Entity,
  type Project,
  type ScriptRow,
  type Shot,
} from "./model";

/**
 * The creative pipeline: development → episodes and scenes → script → shots
 * → produced frames, videos and voices. Prompts and fingerprints are built
 * here so the agent, the studio and the batch jobs agree on them.
 */
export type ProductionStage = "frame" | "video" | "voice";
export const productionStages: ProductionStage[] = ["frame", "video", "voice"];
export const stageNames: Record<
  ProductionStage | "planned" | "assembled",
  string
> = {
  planned: "待生产",
  frame: "分镜图",
  video: "视频",
  voice: "配音",
  assembled: "已成片",
};

/** FNV-1a: a short, stable fingerprint for prompt inputs. Not a security hash. */
export function stableHash(value: unknown) {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
const shotEntities = (p: Project, s: Shot) =>
  p.story.entities.filter((e) => s.entityIds.includes(e.id));
/** Reference images that keep an entity consistent: confirmed views first, then confirmed references. */
export function entityReferences(e: Entity) {
  if (!e.confirmed) return [];
  return [
    ...new Set(
      [
        e.views.front,
        e.views.side,
        e.views.back,
        ...e.referenceAssetIds,
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
}
export function shotReferences(p: Project, s: Shot, limit = 4) {
  return [...new Set(shotEntities(p, s).flatMap(entityReferences))]
    .filter((id) => p.assets.some((a) => a.id === id && a.kind === "image"))
    .slice(0, limit);
}
const line = (label: string, value: string | undefined) =>
  value?.trim() ? `${label}：${value.trim()}` : "";
/**
 * The prompt a shot's stage is generated from. An explicit shot prompt wins;
 * otherwise it is assembled from the shot, its camera, its entities' visual
 * traits and the project's look.
 */
export function shotPrompt(p: Project, s: Shot, stage: ProductionStage) {
  const d = p.story.development,
    entities = shotEntities(p, s);
  if (stage === "voice")
    return [
      s.dialogue.trim(),
      ...entities
        .filter((e) => e.voice)
        .map((e) => `（${e.name} 的声音：${e.voice}）`),
    ]
      .filter(Boolean)
      .join("\n");
  const base = s.prompt.trim() || s.description.trim();
  return [
    base,
    line("镜头", s.camera),
    entities.length
      ? "画面中的设定保持一致：\n" +
        entities
          .map(
            (e) =>
              `- ${e.name}：${[e.traits, e.description].filter(Boolean).join("；")}`,
          )
          .join("\n")
      : "",
    line("风格", [d.genre, d.tone].filter(Boolean).join("，")),
    line("世界观", d.world.slice(0, 300)),
    stage === "video" && s.dialogue.trim()
      ? `人物在说：“${s.dialogue.trim().slice(0, 200)}”`
      : "",
    stage === "video"
      ? `时长约 ${Math.round(s.duration)} 秒，动作连贯自然。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
/** What a stage's output depends on. A changed fingerprint means the output is stale. */
export function productionFingerprint(
  p: Project,
  s: Shot,
  stage: ProductionStage,
  providerId = "",
) {
  return stableHash([
    stage,
    providerId,
    shotPrompt(p, s, stage),
    stage === "voice" ? [] : shotReferences(p, s),
    stage === "video" ? (s.frameAssetId ?? null) : null,
    stage === "video" ? s.duration : null,
  ]);
}
const stageAsset = (s: Shot, stage: ProductionStage) =>
  stage === "frame"
    ? s.frameAssetId
    : stage === "video"
      ? s.videoAssetId
      : s.voiceAssetId;
export interface ProductionTask {
  shotId: string;
  number: number;
  stage: ProductionStage;
  reason: "missing" | "stale";
  prompt: string;
  references: string[];
  fingerprint: string;
}
/**
 * The work a batch should do, in shot order: each requested stage that has no
 * output or whose inputs changed since its output was made. A video waits for
 * its frame when frames are part of the batch; voices need dialogue.
 */
export function productionPlan(
  p: Project,
  options: {
    stages: ProductionStage[];
    shotIds?: string[];
    providerIds?: Partial<Record<ProductionStage, string>>;
    /** Redo outputs that are current too. */
    force?: boolean;
  },
): ProductionTask[] {
  const shots = [...p.story.shots]
    .filter((s) => !options.shotIds || options.shotIds.includes(s.id))
    .sort((a, b) => a.number - b.number);
  const tasks: ProductionTask[] = [];
  for (const s of shots)
    for (const stage of productionStages) {
      if (!options.stages.includes(stage)) continue;
      if (stage === "voice" && !s.dialogue.trim()) continue;
      const fingerprint = productionFingerprint(
          p,
          s,
          stage,
          options.providerIds?.[stage],
        ),
        asset = stageAsset(s, stage),
        latest = [...s.production.history]
          .reverse()
          .find((h) => h.stage === stage && h.assetId === asset);
      const reason = !asset
        ? "missing"
        : options.force || latest?.fingerprint !== fingerprint
          ? "stale"
          : null;
      if (!reason) continue;
      tasks.push({
        shotId: s.id,
        number: s.number,
        stage,
        reason,
        prompt: shotPrompt(p, s, stage),
        references:
          stage === "video" && s.frameAssetId
            ? [s.frameAssetId]
            : stage === "voice"
              ? []
              : shotReferences(p, s),
        fingerprint,
      });
    }
  return tasks;
}
/** A shot with a produced output recorded, its stage advanced and its timeline asset chosen. */
export function recordProduction(
  s: Shot,
  stage: ProductionStage,
  output: {
    assetId: string;
    provider: string;
    prompt: string;
    fingerprint: string;
    at: string;
  },
): Shot {
  const history = [...s.production.history, { stage, ...output }].slice(-40);
  const next: Shot = {
    ...s,
    status: "ready",
    production: {
      ...s.production,
      history,
      stage:
        stage === "voice"
          ? s.production.stage === "assembled"
            ? "assembled"
            : "voice"
          : stage === "video"
            ? "video"
            : s.production.stage === "planned"
              ? "frame"
              : s.production.stage,
      error: undefined,
    },
  };
  if (stage === "frame") {
    next.frameAssetId = output.assetId;
    // The still stands in on the timeline until a video exists.
    if (!s.videoAssetId) next.assetId = output.assetId;
  } else if (stage === "video") {
    next.videoAssetId = output.assetId;
    next.assetId = output.assetId;
  } else next.voiceAssetId = output.assetId;
  return shotSchema.parse(next);
}
/** Picks an earlier output from a shot's history again. */
export function restoreProduction(s: Shot, assetId: string): Shot {
  const entry = s.production.history.find((h) => h.assetId === assetId);
  if (!entry) throw new Error("这个版本不在该镜头的生产记录里");
  return recordProduction(s, entry.stage, entry);
}

/**
 * Shots for script rows: rows already linked update their shot, others get a
 * new shot. Returns the commands plus the rows with their shot links.
 */
export function shotsFromScript(
  p: Project,
  makeId: () => string,
  rowIds?: string[],
): Command[] {
  const rows = p.story.script.filter((r) => !rowIds || rowIds.includes(r.id)),
    commands: Command[] = [],
    links = new Map<string, string>();
  let number = Math.max(0, ...p.story.shots.map((s) => s.number));
  const scenes = new Map(
    p.story.episodes.flatMap((e) =>
      e.scenes.map((sc) => [sc.id, { episodeId: e.id, scene: sc }] as const),
    ),
  );
  for (const row of rows) {
    const existing = p.story.shots.find((s) => s.id === row.shotId),
      place = row.sceneId ? scenes.get(row.sceneId) : undefined,
      shot = shotSchema.parse({
        ...existing,
        id: existing?.id ?? makeId(),
        number: existing?.number ?? ++number,
        title:
          existing?.title ||
          row.visual.split(/[，。,.\n]/)[0].slice(0, 30) ||
          `镜头 ${number}`,
        description: row.visual,
        dialogue:
          [row.speaker && row.dialogue ? `${row.speaker}：` : "", row.dialogue]
            .join("")
            .trim() || row.narration,
        duration: row.duration,
        entityIds: existing?.entityIds ?? place?.scene.entityIds ?? [],
        ...(place
          ? { episodeId: place.episodeId, sceneId: place.scene.id }
          : {}),
      });
    links.set(row.id, shot.id);
    commands.push({ type: "story.shot.upsert", shot });
  }
  commands.push({
    type: "story.script.set",
    rows: p.story.script.map((r) =>
      links.has(r.id) ? { ...r, shotId: links.get(r.id) } : r,
    ),
  });
  return commands;
}
/** Script rows that mirror the shots, for projects that started from a storyboard. */
export function scriptFromShots(p: Project, makeId: () => string): ScriptRow[] {
  const linked = new Map(
    p.story.script.filter((r) => r.shotId).map((r) => [r.shotId!, r]),
  );
  return [...p.story.shots]
    .sort((a, b) => a.number - b.number)
    .map((s, i) => {
      const row = linked.get(s.id);
      return scriptRowSchema.parse({
        ...row,
        id: row?.id ?? makeId(),
        number: i + 1,
        shotId: s.id,
        ...(s.sceneId ? { sceneId: s.sceneId } : {}),
        visual: s.description,
        dialogue: s.dialogue,
        duration: s.duration,
      });
    });
}
/** Counts for the production board. */
export function productionSummary(p: Project) {
  const shots = p.story.shots;
  return {
    shots: shots.length,
    framed: shots.filter((s) => s.frameAssetId).length,
    filmed: shots.filter((s) => s.videoAssetId).length,
    voiced: shots.filter((s) => s.voiceAssetId).length,
    needVoice: shots.filter((s) => s.dialogue.trim()).length,
    failed: shots.filter((s) => s.status === "error").length,
    seconds: shots.reduce((sum, s) => sum + s.duration, 0),
    confirmedEntities: p.story.entities.filter((e) => e.confirmed).length,
    entities: p.story.entities.length,
  };
}
/** A text outline of the story, for the agent and for exports. */
export function storyOutline(p: Project) {
  const d = p.story.development;
  const parts = [
    `# ${p.story.title || p.name}`,
    p.story.logline,
    [
      line("主题", d.theme),
      line("类型", d.genre),
      line("基调", d.tone),
      line("受众", d.audience),
      line("形式", d.format),
    ]
      .filter(Boolean)
      .join("\n"),
    d.premise && `## 前提\n${d.premise}`,
    d.world && `## 世界观\n${d.world}`,
    d.synopsis && `## 梗概\n${d.synopsis}`,
    p.story.entities.length
      ? "## 设定\n" +
        p.story.entities
          .map(
            (e) =>
              `- [${e.kind === "character" ? "角色" : e.kind === "scene" ? "场景" : "道具"}] ${e.name}${e.confirmed ? "（已确认）" : ""}：${[e.description, e.traits].filter(Boolean).join("；")}`,
          )
          .join("\n")
      : "",
    ...p.story.episodes.map(
      (e) =>
        `## 第 ${e.number} 集 ${e.title}\n${e.summary}\n` +
        e.scenes
          .map(
            (sc) =>
              `### 场 ${sc.number} ${sc.title}${sc.location ? ` · ${sc.location}` : ""}\n${sc.summary}${sc.beats.length ? "\n" + sc.beats.map((b) => `- ${b}`).join("\n") : ""}`,
          )
          .join("\n"),
    ),
  ];
  return parts.filter(Boolean).join("\n\n");
}
