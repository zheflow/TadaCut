import crypto from "node:crypto";
import {
  activeTimeline,
  applyTransaction,
  commandSchema,
  DomainError,
  type Command,
  type Project,
  type Timeline,
} from "@tadacut/domain";
import type { ProviderContext } from "@tadacut/providers";
import type {
  AgentTool,
  ToolEffect,
} from "../../../../packages/agent/src/runner";
import type { DesktopPort } from "../../../../packages/platform/src/contract";
import type { JobQueue } from "../jobs";
import type { MediaService } from "../media";
import type { Job, Repository } from "../storage";
import type { Artifacts } from "../artifacts";
import type {
  ApplicationBridge,
  StudioContext,
} from "../../../../packages/platform/src/studio";

/**
 * Edits made during an agent run collect in a draft: the model reads its own
 * changes, and the user reviews them as one proposal (one undo step). When
 * the live project changes meanwhile (a finished generation, the user's own
 * edit) the draft replays its commands on top, so nothing is lost.
 */
export class Draft {
  private project: Project;
  private base: number;
  readonly commands: Command[] = [];
  readonly labels: string[] = [];
  constructor(
    private live: () => Project,
    initial?: { commands: Command[]; labels: string[] },
  ) {
    const p = live();
    this.project = p;
    this.base = p.revision;
    if (initial?.commands.length) {
      this.commands.push(...initial.commands);
      this.labels.push(...initial.labels);
      this.project = this.replay(p) ?? p;
    }
  }
  private replay(onto: Project) {
    if (!this.commands.length) return onto;
    try {
      return applyTransaction(
        onto,
        {
          requestId: "draft",
          expectedRevision: onto.revision,
          label: "草稿",
          commands: this.commands,
        },
        new Date().toISOString(),
      ).project;
    } catch {
      return undefined;
    }
  }
  /** The draft on top of the latest live project. */
  current() {
    const live = this.live();
    if (live.revision !== this.base) {
      const replayed = this.replay(live);
      if (!replayed)
        throw new DomainError(
          "DRAFT_CONFLICT",
          "项目在 Agent 工作期间被修改，草稿无法合并；请重新读取项目后再修改",
        );
      this.project = replayed;
      this.base = live.revision;
    }
    return this.project;
  }
  apply(label: string, commands: Command[]) {
    const p = this.current();
    this.project = applyTransaction(
      p,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: p.revision,
        label,
        commands,
      },
      new Date().toISOString(),
    ).project;
    this.commands.push(...commands);
    this.labels.push(label);
    return this.project;
  }
  get baseRevision() {
    this.current();
    return this.base;
  }
  get empty() {
    return !this.commands.length;
  }
  label() {
    const unique = [...new Set(this.labels)];
    const text = unique.slice(0, 6).join("、");
    return (
      (unique.length > 6 ? `${text} 等 ${unique.length} 项` : text).slice(
        0,
        280,
      ) || "Agent 修改"
    );
  }
  clear() {
    this.commands.length = 0;
    this.labels.length = 0;
  }
}

export type EditMode = "manual" | "auto" | "session";
export interface ToolHost {
  application?: ApplicationBridge;
  studioContext?: StudioContext;
  repo: Repository;
  jobs: JobQueue;
  media: MediaService;
  publish(type: string, data: unknown): void;
  projectId: string;
  signal: AbortSignal;
  desktop?: DesktopPort;
  root: string;
  artifactsDir: string;
  artifacts: Artifacts;
  /** Folders the user granted; local file tools stay inside them. */
  allowedDirectories(): string[];
  mode: EditMode;
  /** The project as tools see it: the draft in manual and session mode, else the live project. */
  project(): Project;
  /** Remembers the revision the model read; automatic edits are checked against it. */
  markRead(revision: number): void;
  /** Applies (auto) or drafts (manual, session) validated commands. */
  edit(label: string, commands: Command[]): Record<string, unknown>;
  context(providerId: string): ProviderContext;
  /** The first enabled provider with a capability, or the one asked for. */
  provider(capability: string, providerId?: string): string;
  enqueue(
    kind: string,
    label: string,
    input: Record<string, unknown>,
  ): Record<string, unknown>;
  /** Waits for a job to settle, up to a limit, and returns it. */
  waitJob(jobId: string, seconds: number): Promise<Job | undefined>;
  makeId(): string;
  now(): string;
}
const schema = {
  object: (properties: Record<string, unknown>, required: string[] = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }),
  string: (description?: string, values?: readonly string[]) => ({
    type: "string",
    ...(description ? { description } : {}),
    ...(values ? { enum: [...values] } : {}),
  }),
  number: (description?: string) => ({
    type: "number",
    ...(description ? { description } : {}),
  }),
  integer: (description?: string) => ({
    type: "integer",
    ...(description ? { description } : {}),
  }),
  boolean: (description?: string) => ({
    type: "boolean",
    ...(description ? { description } : {}),
  }),
  array: (items: unknown, description?: string) => ({
    type: "array",
    items,
    ...(description ? { description } : {}),
  }),
  record: (description?: string) => ({
    type: "object",
    additionalProperties: true,
    ...(description ? { description } : {}),
  }),
};
export const s = schema;
/** Builds a tool; parameters are JSON schema and arguments arrive parsed. */
export const tool = (
  group: string,
  effect: ToolEffect,
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  execute: (args: any) => Promise<unknown> | unknown,
): AgentTool => ({
  name,
  description,
  parameters,
  group,
  effect,
  execute: async (args) => execute(args ?? {}),
});
export const timelineOf = (p: Project, timelineId?: string): Timeline => {
  if (!timelineId) return activeTimeline(p);
  const t = p.timelines.find((x) => x.id === timelineId);
  if (!t) throw new DomainError("NOT_FOUND", "时间线不存在");
  return t;
};
export const parseCommands = (input: unknown) => {
  if (!Array.isArray(input) || !input.length || input.length > 500)
    throw new Error("需要 1–500 条命令");
  return input.map((c) => commandSchema.parse(c));
};
/** Seconds or frames from the model: frames win when both are given. */
export const toFrames = (t: Timeline, frames?: number, seconds?: number) =>
  Number.isFinite(frames)
    ? Math.round(frames!)
    : Number.isFinite(seconds)
      ? Math.round(seconds! * t.fps)
      : undefined;
export const timeArgs = {
  frame: s.integer("时间线帧"),
  seconds: s.number("时间线秒数（不填 frame 时使用）"),
};
