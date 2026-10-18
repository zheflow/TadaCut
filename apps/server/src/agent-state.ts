import crypto from "node:crypto";
import { z } from "zod";
import { DomainError } from "@tadacut/domain";
import type { Repository, Skill } from "./storage";

export const planStepSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(300),
    status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  })
  .strict();
export const planUpdateSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    goal: z.string().max(1600).optional(),
    constraints: z.array(z.string().max(300)).max(12).optional(),
    steps: z.array(planStepSchema).max(16).optional(),
    notes: z.string().max(2400).optional(),
  })
  .strict();
export interface LoadedSkill {
  id: string;
  name: string;
  fingerprint: string;
  loadedAt: string;
  offsets: number[];
  files: { path: string; offset: number }[];
}
export interface AgentWorkingState {
  id: string;
  revision: number;
  goal: string;
  constraints: string[];
  steps: z.infer<typeof planStepSchema>[];
  notes: string;
  loadedSkills: LoadedSkill[];
  compactRequested: boolean;
  updatedAt: string;
}
export type StateHost = {
  repo: Repository;
  projectId: string;
  publish(type: string, data: unknown): void;
};
export function readAgentState(
  repo: Repository,
  projectId: string,
): AgentWorkingState {
  repo.get(projectId);
  return (
    repo.record<AgentWorkingState>("agent-state", projectId) ?? {
      id: projectId,
      revision: 0,
      goal: "",
      constraints: [],
      steps: [],
      notes: "",
      loadedSkills: [],
      compactRequested: false,
      updatedAt: new Date().toISOString(),
    }
  );
}
function save(host: StateHost, state: AgentWorkingState) {
  const next = {
    ...state,
    revision: state.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  host.repo.save("agent-state", next);
  host.publish("agent-state", {
    projectId: host.projectId,
    revision: next.revision,
  });
  return next;
}
export function updateAgentPlan(host: StateHost, input: unknown) {
  const { expectedRevision, ...patch } = planUpdateSchema.parse(input),
    state = readAgentState(host.repo, host.projectId);
  if (expectedRevision !== state.revision)
    throw new DomainError(
      "REVISION_CONFLICT",
      "任务计划已变化，请重新读取后修改",
    );
  if (
    patch.steps &&
    (new Set(patch.steps.map((s) => s.id)).size !== patch.steps.length ||
      patch.steps.filter((s) => s.status === "in_progress").length > 1)
  )
    throw new Error("计划步骤 ID 必须唯一，同一时刻仅一个步骤标为进行中");
  return save(host, { ...state, ...patch });
}
export const skillFingerprint = (skill: Skill) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        prompt: skill.prompt,
        files: skill.files,
        tools: skill.tools,
      }),
    )
    .digest("hex");
export function retainSkill(
  host: StateHost,
  skill: Skill,
  offset: number,
  file?: string,
) {
  const state = readAgentState(host.repo, host.projectId),
    fingerprint = skillFingerprint(skill);
  const previous = state.loadedSkills.find(
    (s) => s.id === skill.id && s.fingerprint === fingerprint,
  );
  const loaded: LoadedSkill = previous
    ? { ...previous, name: skill.name, loadedAt: new Date().toISOString() }
    : {
        id: skill.id,
        name: skill.name,
        fingerprint,
        loadedAt: new Date().toISOString(),
        offsets: [],
        files: [],
      };
  if (file)
    loaded.files = [
      ...loaded.files.filter((f) => f.path !== file || f.offset !== offset),
      { path: file, offset },
    ].slice(-8);
  else loaded.offsets = [...new Set([...loaded.offsets, offset])].slice(-8);
  return save(host, {
    ...state,
    loadedSkills: [
      ...state.loadedSkills.filter((s) => s.id !== skill.id),
      loaded,
    ].slice(-3),
  });
}
export function unloadSkill(host: StateHost, skillId: string) {
  const state = readAgentState(host.repo, host.projectId);
  return save(host, {
    ...state,
    loadedSkills: state.loadedSkills.filter((s) => s.id !== skillId),
  });
}
export function requestCompaction(host: StateHost, requested = true) {
  return save(host, {
    ...readAgentState(host.repo, host.projectId),
    compactRequested: requested,
  });
}
export function agentStateView(repo: Repository, projectId: string) {
  const state = readAgentState(repo, projectId);
  return {
    ...state,
    loadedSkills: state.loadedSkills.map((loaded) => {
      const skill = repo.record<Skill>("skill", loaded.id);
      return {
        ...loaded,
        available: Boolean(skill?.enabled),
        stale: !skill || skillFingerprint(skill) !== loaded.fingerprint,
      };
    }),
  };
}
/** Working notes and loaded references survive transcript compaction, with a separate bound. */
export function agentStateContext(repo: Repository, projectId: string) {
  const state = agentStateView(repo, projectId);
  const plan =
    state.goal || state.steps.length || state.notes
      ? `任务工作记录（不是长期记忆；完成状态须以实际结果验证；详细内容用 read_agent_state）：${JSON.stringify({ goal: state.goal.slice(0, 800), constraints: state.constraints.slice(0, 6).map((s) => s.slice(0, 200)), steps: state.steps.map((s) => ({ ...s, title: s.title.slice(0, 80) })), notes: state.notes.slice(0, 600) })}`
      : "";
  const sliceBudget = Math.floor(6000 / Math.max(1, state.loadedSkills.length));
  const skills = state.loadedSkills.map((loaded) => {
    if (!loaded.available || loaded.stale)
      return `技能 ${loaded.id} 已停用或内容变更；旧加载内容失效，需要重新选择或 load_skill。`;
    const skill = repo.record<Skill>("skill", loaded.id)!;
    const offset = loaded.offsets.at(-1) ?? 0;
    const instructions = skill.prompt.slice(offset, offset + sliceBudget);
    return `已加载技能「${skill.name}」(${skill.id})，offset=${offset}：\n${instructions}${offset + sliceBudget < skill.prompt.length ? `\n（正文还有后续，load_skill offset=${offset + sliceBudget} 读取）` : ""}\n已读参考文件：${loaded.files.map((f) => `${f.path}@${f.offset}`).join("、") || "无"}。需要细节用 read_skill_file 重新读取。`;
  });
  return [plan, ...skills].filter(Boolean).join("\n\n");
}
