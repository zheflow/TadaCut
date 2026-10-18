import { useRef, useSyncExternalStore } from "react";
import type {
  StudioReference,
  storyViews,
  resourceSections,
} from "../../../../packages/platform/src/studio";
import { receiveStudioAction, respondToStudioApproval } from "./studio-control";
import type { RuntimeStatus } from "../../../server/src/runtime-status";
import {
  activeTimeline,
  clipSchema,
  isLutAsset,
  makeTimeline,
  pasteClips,
  placeAsset,
  placementIssue,
  rippleDelete,
  type Asset,
  type ClipboardContent,
  type Command,
  type Project,
} from "@tadacut/domain";
import {
  post,
  request,
  upload,
  type Job,
  type Message,
  type Proposal,
  type PublicProvider,
  type Skill,
} from "./api";
export type WorkspaceMode =
  | "edit"
  | "story"
  | "transcript"
  | "record"
  | "canvas";
/** In and out marks of a timeline: `in` is the first frame, `out` the frame after the last one. */
export interface Marks {
  in?: number;
  out?: number;
}
export type Theme = "system" | "light" | "dark";
export type Nav =
  | "studio"
  | "projects"
  | "library"
  | "models"
  | "skills"
  | "extensions"
  | "tasks"
  | "settings";
interface State {
  loading: boolean;
  project: Project | null;
  projects: Project[];
  providers: PublicProvider[];
  runtimes: RuntimeStatus[];
  jobs: Job[];
  skills: Skill[];
  messages: Message[];
  proposals: Proposal[];
  nav: Nav;
  mode: WorkspaceMode;
  storyView: (typeof storyViews)[number];
  resourceSection: (typeof resourceSections)[number];
  selectedClipIds: string[];
  selectedAssetId: string | null;
  playhead: number;
  playing: boolean;
  /** Shuttle speed; negative values play backwards. */
  rate: number;
  /** Repeat playback between the in and out marks. */
  loop: boolean;
  /** In and out marks by timeline ID. */
  marks: Record<string, Marks>;
  tool: "select" | "blade" | "slip" | "slide" | "roll";
  theme: Theme;
  /** Preview scale: "fit" follows the panel, a number is device pixels per frame pixel. */
  previewZoom: "fit" | number;
  overlays: { safe: boolean; grid: boolean };
  zoom: number;
  snap: boolean;
  panel: "agent" | "inspector";
  assistantOpen: boolean;
  agentDrafts: Record<string, string>;
  sakuraEffects: boolean;
  references: StudioReference[];
  pageDetails: Record<string, Record<string, string>>;
  editingProviderId: string | null;
  editingSkillId: string | null;
  creativeTool: string | null;
  fileRequest: { kind: string; assetId?: string } | null;
  showMcpConfig: boolean;
  externalApproval: {
    id: string;
    projectId: string;
    tool: string;
    effect: string;
    summary: string;
  } | null;
  busy: number;
  connected: boolean;
  toast: { id: number; text: string; error: boolean } | null;
  providerId: string;
  agentBackend: "api" | "codex" | "claude" | "copilot";
  skillId: string | null;
  modal: "export" | "tools" | "title" | "project" | null;
  /** Number of clips on the in-app clipboard. */
  clipboard: number;
  ask: { id: number; title: string; value: string; multiline: boolean } | null;
  /** Manual drafts edits for one confirmation; auto applies each step; ask only reads. */
  agentMode: "manual" | "auto" | "ask";
  /** Draft, pending approval and “continue” state of the project's conversation. */
  thread: import("./studio-api").ThreadSummary | null;
  /** Counters the server bumps when a list changes, so open pages reload it. */
  ticks: Record<string, number>;
  /** Which part of the left panel shows: project media or the effects library. */
  leftPanel: "media" | "library";
}
/** Per-viewer preferences that survive reloads; storage can be unavailable. */
function stored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}
export function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
let state: State = {
  loading: true,
  project: null,
  projects: [],
  providers: [],
  runtimes: [],
  jobs: [],
  skills: [],
  messages: [],
  proposals: [],
  nav: "studio",
  mode: "edit",
  storyView: "board",
  resourceSection: stored("tadacut-resource-section", "templates"),
  selectedClipIds: [],
  selectedAssetId: null,
  playhead: 60,
  playing: false,
  rate: 1,
  loop: stored("tadacut-loop", false),
  marks: stored("tadacut-marks", {}),
  tool: "select",
  theme: stored<Theme>("tadacut-theme", "light"),
  previewZoom: "fit",
  overlays: stored("tadacut-overlays", { safe: true, grid: false }),
  zoom: 36,
  snap: true,
  panel: "agent",
  assistantOpen: stored("tadacut-assistant-open", true),
  agentDrafts: {},
  sakuraEffects: stored("tadacut-sakura-effects", false),
  references: [],
  pageDetails: {},
  editingProviderId: null,
  editingSkillId: null,
  creativeTool: null,
  fileRequest: null,
  showMcpConfig: false,
  externalApproval: null,
  busy: 0,
  connected: false,
  toast: null,
  providerId: localStorage.getItem("tadacut-provider") ?? "",
  agentBackend: "api",
  skillId: null,
  modal: null,
  clipboard: 0,
  ask: null,
  agentMode: stored<State["agentMode"]>("tadacut-agent-mode", "manual"),
  thread: null,
  ticks: {},
  leftPanel: stored<State["leftPanel"]>("tadacut-left-panel", "media"),
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export function useStudio<T>(selector: (state: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
/** The playhead for panels that only need it while paused; they skip the per-frame updates of playback. */
export function useIdlePlayhead() {
  const last = useRef(state.playhead);
  return useStudio((s) =>
    s.playing ? last.current : (last.current = s.playhead),
  );
}
export const getState = () => state;
export const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
export function notify(text: string, error = false) {
  const id = Date.now();
  setState({ toast: { id, text, error } });
  setTimeout(() => {
    if (state.toast?.id === id) setState({ toast: null });
  }, 4500);
}
function acceptProject(project: Project) {
  const known = state.projects.find((p) => p.id === project.id);
  if (known && known.revision > project.revision) return;
  setState({
    projects: state.projects.some((p) => p.id === project.id)
      ? state.projects.map((p) => (p.id === project.id ? project : p))
      : [project, ...state.projects],
    ...(state.project?.id === project.id ? { project } : {}),
  });
}
export function acceptJob(job: Job) {
  const previous = state.jobs.find((j) => j.id === job.id);
  if (previous && (previous.eventVersion ?? 0) > (job.eventVersion ?? 0))
    return;
  setState({ jobs: [job, ...state.jobs.filter((j) => j.id !== job.id)] });
}
let queue = Promise.resolve();
/** Edits run in order. A function receives the project as it is when its turn comes, so rapid edits build on each other. */
export async function commit(
  commands: Command[] | ((project: Project) => Command[]),
  label: string,
  projectId = state.project?.id,
) {
  if (!projectId) return false;
  setState({ busy: state.busy + 1 });
  const operation = queue.then(async () => {
    const current =
      state.project?.id === projectId
        ? state.project
        : await request<Project>(`/api/projects/${projectId}`);
    const list = typeof commands === "function" ? commands(current) : commands;
    if (!list.length) return;
    const result = await post<{ project: Project }>(
      `/api/projects/${projectId}/commands`,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: current.revision,
        label,
        commands: list,
      },
    );
    acceptProject(result.project);
  });
  queue = operation.catch(() => {});
  try {
    await operation;
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : "编辑未完成", true);
    if (state.project?.id === projectId)
      acceptProject(await request<Project>(`/api/projects/${projectId}`));
    return false;
  } finally {
    setState({ busy: Math.max(0, state.busy - 1) });
  }
}
let answer: ((value: string | null) => void) | undefined,
  asked = 0;
/** In-app text input; Electron does not implement window.prompt. Resolves null when cancelled. */
export function askText(title: string, value = "", multiline = false) {
  answer?.(null);
  return new Promise<string | null>((resolve) => {
    answer = resolve;
    setState({ ask: { id: ++asked, title, value, multiline } });
  });
}
export function answerText(value: string | null) {
  const resolve = answer;
  answer = undefined;
  setState({ ask: null });
  resolve?.(value);
}
let openSequence = 0;
export async function openProject(id: string) {
  if (state.externalApproval) {
    respondToStudioApproval(state.externalApproval.id, false);
  }
  const sequence = ++openSequence;
  setState({ loading: true, playing: false });
  try {
    const [project, messages, proposals, thread] = await Promise.all([
      request<Project>(`/api/projects/${id}`),
      request<Message[]>(`/api/projects/${id}/messages`),
      request<Proposal[]>(`/api/projects/${id}/proposals`),
      request<import("./studio-api").ThreadSummary>(
        `/api/projects/${id}/agent`,
      ).catch(() => null),
    ]);
    if (sequence !== openSequence) return;
    localStorage.setItem("tadacut-project", id);
    setState({
      project,
      messages,
      proposals,
      thread,
      mode: "edit",
      panel: "agent",
      selectedAssetId: null,
      references: [],
      selectedClipIds: [],
      playhead: id === "demo-city" ? 60 : 0,
      nav: "studio",
      loading: false,
    });
  } catch (error) {
    notify(String(error), true);
    setState({ loading: false });
  }
}
export async function bootstrap() {
  try {
    const [projects, providers, jobs, skills] = await Promise.all([
      request<Project[]>("/api/projects"),
      request<PublicProvider[]>("/api/providers"),
      request<Job[]>("/api/jobs"),
      request<Skill[]>("/api/skills"),
    ]);
    setState({ projects, providers, jobs, skills });
    const id = localStorage.getItem("tadacut-project");
    await openProject(projects.find((p) => p.id === id)?.id ?? projects[0].id);
    const stream = new EventSource("/api/events");
    stream.onopen = () => setState({ connected: true });
    stream.onerror = () => setState({ connected: false });
    stream.addEventListener("update", (e) => {
      const event = JSON.parse((e as MessageEvent).data);
      if (event.type === "project") acceptProject(event.data);
      if (event.type === "job") {
        acceptJob(event.data);
        const approval = state.externalApproval;
        if (
          ["cancelled", "failed"].includes(event.data.status) &&
          event.data.kind === "agent" &&
          approval &&
          approval.projectId === event.data.projectId
        ) {
          respondToStudioApproval(approval.id, false);
        }
      }
      if (
        event.type === "message" &&
        event.data.projectId === state.project?.id
      )
        setState({
          messages: [
            ...state.messages.filter((m) => m.id !== event.data.id),
            event.data,
          ],
        });
      if (
        event.type === "proposal" &&
        event.data.projectId === state.project?.id
      )
        setState({
          proposals: [
            event.data,
            ...state.proposals.filter((p) => p.id !== event.data.id),
          ],
        });
      if (event.type === "providers") setState({ providers: event.data });
      if (event.type === "skills") setState({ skills: event.data });
      if (event.type === "studio-action") receiveStudioAction(event.data);
      if (
        event.type === "agent-thread" &&
        event.data.projectId === state.project?.id
      )
        setState({ thread: event.data });
      if (
        [
          "exports",
          "versions",
          "plugins",
          "memories",
          "memory-candidates",
          "settings",
          "agent-settings",
        ].includes(event.type)
      )
        setState({
          ticks: {
            ...state.ticks,
            [event.type]: (state.ticks[event.type] ?? 0) + 1,
          },
        });
      if (event.type === "project-deleted") {
        const projects = state.projects.filter((p) => p.id !== event.data.id);
        setState({ projects });
        if (state.project?.id === event.data.id && projects[0])
          void openProject(projects[0].id);
      }
    });
  } catch (e) {
    notify(e instanceof Error ? e.message : "无法连接工作台", true);
    setState({ loading: false });
  }
}
export async function travel(direction: "undo" | "redo") {
  const projectId = state.project?.id;
  if (!projectId) return;
  const operation = queue.then(async () => {
    const p =
      state.project?.id === projectId
        ? state.project
        : await request<Project>(`/api/projects/${projectId}`);
    acceptProject(
      await post<Project>(`/api/projects/${projectId}/${direction}`, {
        expectedRevision: p.revision,
      }),
    );
  });
  queue = operation.catch(() => {});
  try {
    await operation;
  } catch (e) {
    notify(String(e), true);
  }
}
export async function createProject(name: string) {
  try {
    const p = await post<Project>("/api/projects", { name });
    acceptProject(p);
    await openProject(p.id);
    setState({ modal: null });
    notify("新项目已创建");
  } catch (e) {
    notify(String(e), true);
  }
}
export async function importFiles(
  files: File[],
  projectId = state.project?.id,
) {
  if (!projectId || !files.length) return;
  setState({ busy: state.busy + 1 });
  try {
    const results = await upload(projectId, files);
    results.forEach((r) => acceptProject(r.project));
    notify(`已导入 ${results.length} 个素材`);
    return true;
  } catch (e) {
    notify(String(e), true);
    return false;
  } finally {
    setState({ busy: Math.max(0, state.busy - 1) });
  }
}
const newId = () => crypto.randomUUID();
/** Adds an asset at a frame, on the given track when it has room there, otherwise on a free track of the same kind or a new one. */
export async function addAssetToTimeline(
  asset: Asset,
  at = state.playhead,
  trackId?: string,
) {
  if (!state.project) return;
  if (isLutAsset(asset)) {
    notify(placementIssue("video", asset)!, true);
    return;
  }
  let clipId = "";
  const added = await commit((p) => {
    const placed = placeAsset(p, activeTimeline(p), asset, at, newId, trackId);
    clipId = placed.clip.id;
    return placed.commands;
  }, "添加素材");
  if (added) setState({ selectedClipIds: [clipId] });
}
/** Multiple selected materials are placed in order in one undoable transaction. */
export async function addAssetsToTimeline(
  assets: Asset[],
  at = state.playhead,
  trackId?: string,
) {
  if (!assets.length) return;
  let clipIds: string[] = [];
  const added = await commit((p) => {
    const t = activeTimeline(p);
    let cursor = 0;
    const clips = assets.map((asset) => {
      const duration = Math.max(1, Math.round((asset.duration || 5) * t.fps));
      const clip = clipSchema.parse({
        id: newId(),
        assetId: asset.id,
        trackId: trackId ?? "unplaced",
        start: cursor,
        duration,
        name: asset.name,
        text: asset.text,
      });
      cursor += duration;
      return clip;
    });
    const placed = pasteClips(p, t, { clips, assets }, at, newId);
    clipIds = placed.clipIds;
    return placed.commands;
  }, "添加多个素材");
  if (added) setState({ selectedClipIds: clipIds });
}
let clipboard: ClipboardContent | null = null;
function selection() {
  const p = state.project;
  if (!p) return null;
  const t = activeTimeline(p),
    clips = t.clips.filter((c) => state.selectedClipIds.includes(c.id));
  if (!clips.length) return null;
  const used = new Set(
    clips.flatMap((c) => [c.assetId, c.effects.lutAssetId ?? ""]),
  );
  return {
    t,
    content: structuredClone({
      clips,
      assets: p.assets.filter((a) => used.has(a.id)),
    }),
  };
}
export function copySelected() {
  const current = selection();
  if (!current) return;
  clipboard = current.content;
  setState({ clipboard: clipboard.clips.length });
  notify(`已复制 ${clipboard.clips.length} 个片段`);
}
export async function cutSelected() {
  const current = selection();
  if (!current) return;
  clipboard = current.content;
  setState({ clipboard: clipboard.clips.length });
  const cut = await commit(
    current.content.clips.map((c) => ({
      type: "clip.remove" as const,
      timelineId: current.t.id,
      clipId: c.id,
      ripple: false,
    })),
    "剪切片段",
  );
  if (cut) setState({ selectedClipIds: [] });
}
/** Pastes at the playhead (or after the copied clips for duplicates) and moves the playhead past the pasted clips. */
async function paste(
  content: ClipboardContent,
  at: () => number,
  label: string,
) {
  let clipIds: string[] = [];
  const pasted = await commit((p) => {
    const result = pasteClips(p, activeTimeline(p), content, at(), newId);
    clipIds = result.clipIds;
    // Set before the request so a queued second paste starts after this one.
    setState({ playhead: result.end });
    return result.commands;
  }, label);
  if (pasted) setState({ selectedClipIds: clipIds });
}
export async function pasteClipboard() {
  if (!clipboard) {
    notify("剪贴板里还没有片段，先选择片段并复制");
    return;
  }
  await paste(clipboard, () => state.playhead, "粘贴片段");
}
export async function duplicateSelected() {
  const current = selection();
  if (!current) return;
  const end = Math.max(
    ...current.content.clips.map((c) => c.start + c.duration),
  );
  await paste(current.content, () => end, "创建片段副本");
}
export function selectAllClips() {
  if (state.project)
    setState({
      selectedClipIds: activeTimeline(state.project).clips.map((c) => c.id),
    });
}
export async function splitSelected() {
  const p = state.project;
  if (!p) return;
  const t = activeTimeline(p);
  const commands = state.selectedClipIds.map((id) => ({
    type: "clip.split" as const,
    timelineId: t.id,
    clipId: id,
    at: Math.round(state.playhead),
    newClipId: crypto.randomUUID(),
  }));
  if (commands.length) await commit(commands, "分割片段");
}
export async function deleteSelected(ripple = false) {
  if (!state.project || !state.selectedClipIds.length) return;
  const ids = state.selectedClipIds;
  // A ripple delete closes the gap on the edited tracks and on sync-locked tracks; linked clips go too.
  const done = await commit(
    (p) => {
      const t = activeTimeline(p);
      return ripple
        ? rippleDelete(t, ids, newId)
        : ids.map((id) => ({
            type: "clip.remove" as const,
            timelineId: t.id,
            clipId: id,
            ripple: false,
          }));
    },
    ripple ? "波纹删除" : "删除片段",
  );
  if (done) setState({ selectedClipIds: [] });
}
export async function newTimeline() {
  if (!state.project) return;
  await commit(
    [
      {
        type: "timeline.create",
        timeline: makeTimeline(
          crypto.randomUUID(),
          `时间线 ${state.project.timelines.length + 1}`,
        ),
      },
    ],
    "创建时间线",
  );
  setState({ playhead: 0, selectedClipIds: [] });
}
export async function startJob(
  kind: string,
  label: string,
  input: Record<string, unknown>,
) {
  if (!state.project) return;
  try {
    const job = await post<Job>("/api/jobs", {
      projectId: state.project.id,
      kind,
      label,
      input,
    });
    acceptJob(job);
    notify(`${label}已加入任务列表`);
    return job;
  } catch (e) {
    notify(String(e), true);
  }
}
/** Resolves with a job once it has finished, from the job events the store already receives. */
export function jobDone(jobId: string) {
  return new Promise<Job>((resolve) => {
    const check = () => {
      const job = state.jobs.find((j) => j.id === jobId);
      if (job && !["queued", "running"].includes(job.status)) {
        stop();
        resolve(job);
      }
    };
    const stop = subscribe(check);
    check();
  });
}
export async function respondProposal(id: string, apply: boolean) {
  const p = state.project;
  if (!p) return;
  try {
    const result = await post<{ project?: Project; proposal: Proposal }>(
      `/api/proposals/${id}`,
      { apply },
    );
    if (result.project) acceptProject(result.project);
    setState({
      proposals: state.proposals.map((x) =>
        x.id === id ? result.proposal : x,
      ),
    });
  } catch (e) {
    notify(String(e), true);
  }
}
