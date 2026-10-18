import { recordingControl } from "./recording-control";
import { activeTimeline } from "@tadacut/domain";
import {
  studioActionSchema,
  type StudioContext,
  type StudioReference,
  type StudioResult,
} from "../../../../packages/platform/src/studio";
import { getState, openProject, remember, setState } from "./store";
import { post } from "./api";
import { setTheme } from "./theme";
import {
  clearMarks,
  markIn,
  markOut,
  pause,
  seek,
  step,
  togglePlay,
} from "./transport";

export const pageNames = {
  studio: "工作台",
  projects: "项目",
  library: "素材库",
  models: "模型",
  skills: "技能",
  extensions: "扩展",
  tasks: "任务",
  settings: "设置",
};
const clientId = crypto.randomUUID();
export function currentStudioContext() {
  const s = getState(),
    p = s.project;
  const clips: StudioReference[] = p
    ? activeTimeline(p)
        .clips.filter((c) => s.selectedClipIds.includes(c.id))
        .map((c) => ({
          kind: "clip",
          id: c.id,
          name:
            c.name || p.assets.find((a) => a.id === c.assetId)?.name || "片段",
          projectId: p.id,
        }))
    : [];
  return {
    clientId,
    page: s.nav,
    workspace: s.mode,
    projectId: p?.id ?? "",
    projectName: p?.name ?? "",
    timelineId: p ? activeTimeline(p).id : undefined,
    frame: s.playhead,
    references: [
      ...new Map(
        [...clips, ...s.references].map((r) => [referenceKey(r), r]),
      ).values(),
    ].slice(0, 100),
    theme: s.theme,
    sakuraEffects: s.sakuraEffects,
    details: {
      ...(s.pageDetails[s.nav] ?? {}),
      ...(s.nav === "studio"
        ? {
            leftPanel: s.leftPanel,
            ...(s.mode === "story" ? { storyView: s.storyView } : {}),
            ...(s.leftPanel === "library"
              ? { resourceSection: s.resourceSection }
              : {}),
          }
        : {}),
      ...(s.modal ? { dialog: s.modal } : {}),
      ...(s.fileRequest ? { filePicker: s.fileRequest.kind } : {}),
    },
    assistant: {
      providerId: s.providerId,
      backend: s.agentBackend,
      mode: s.agentMode,
      skillId: s.skillId,
    },
  };
}
export const referenceKey = (r: StudioReference) =>
  `${r.kind}:${r.projectId ?? ""}:${r.id}`;
export function selectReference(
  reference: StudioReference,
  options: { toggle?: boolean; range?: StudioReference[] } = {},
) {
  const old = getState().references;
  const same = (r: StudioReference) =>
    r.kind === reference.kind &&
    r.id === reference.id &&
    r.projectId === reference.projectId;
  const next = options.range
    ? [...old.filter((r) => r.kind !== reference.kind), ...options.range]
    : options.toggle
      ? old.some(same)
        ? old.filter((r) => !same(r))
        : [...old, reference]
      : [reference];
  setState({
    references: next.slice(0, 100),
    ...(reference.kind === "asset" ? { selectedAssetId: reference.id } : {}),
  });
}
export function describePage(
  page: StudioContext["page"],
  details: Record<string, string>,
) {
  const s = getState();
  setState({
    pageDetails: {
      ...s.pageDetails,
      [page]: Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
          key,
          value.slice(0, 1000),
        ]),
      ),
    },
  });
}
const seen = new Set<string>();
let queue = Promise.resolve();
let confirmAction: {
  id: string;
  projectId: string;
  finish(allowed: boolean): void;
} | null = null;
export function respondToStudioApproval(id: string, allowed: boolean) {
  if (confirmAction?.id === id)
    confirmAction.finish(
      allowed && getState().project?.id === confirmAction.projectId,
    );
}
export function receiveStudioAction(event: {
  id: string;
  projectId: string;
  clientId?: string;
  action: unknown;
  expiresAt: number;
}) {
  if (
    seen.has(event.id) ||
    event.expiresAt < Date.now() ||
    (event.clientId && event.clientId !== clientId) ||
    event.projectId !== getState().project?.id
  )
    return;
  seen.add(event.id);
  if (seen.size > 500) seen.delete(seen.values().next().value!);
  queue = queue
    .then(async () => {
      let result: StudioResult;
      try {
        if (
          event.expiresAt < Date.now() ||
          event.projectId !== getState().project?.id
        )
          throw new Error("页面所属项目已变化，请重新读取界面上下文");
        result = await applyStudioAction(event.action, event);
      } catch (error) {
        result = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      await post(`/api/studio/actions/${event.id}/result`, {
        projectId: event.projectId,
        clientId,
        ...result,
      });
    })
    .catch(() => {});
}
export async function applyStudioAction(
  input: unknown,
  request?: { id: string; expiresAt: number },
): Promise<StudioResult> {
  const action = studioActionSchema.parse(input),
    s = getState();
  let message: string | undefined,
    needsUser = false;
  switch (action.type) {
    case "snapshot":
      break;
    case "recording": {
      setState({ nav: "studio", mode: "record", modal: null });
      const result = await recordingControl(action);
      message = JSON.stringify(result);
      break;
    }
    case "confirm": {
      if (!request || !s.project) throw new Error("缺少确认请求");
      const projectId = s.project.id;
      const allowed = await new Promise<boolean>((resolve) => {
        const finish = (allowed: boolean) => {
          clearTimeout(timer);
          confirmAction = null;
          setState({ externalApproval: null });
          resolve(allowed);
        };
        const timer = setTimeout(
          () => finish(false),
          Math.max(0, request.expiresAt - Date.now()),
        );
        confirmAction = { id: request.id, projectId, finish };
        setState({
          assistantOpen: true,
          externalApproval: {
            id: request.id,
            projectId,
            tool: action.tool,
            effect: action.effect,
            summary: action.summary,
          },
        });
      });
      return {
        status: allowed ? "applied" : "error",
        message: allowed ? "用户允许执行这一次操作" : "用户未允许执行这个操作",
        context: currentStudioContext(),
      };
    }
    case "navigate":
      setState({
        nav: action.page,
        modal: null,
        fileRequest: null,
        ...(action.workspace ? { mode: action.workspace } : {}),
        ...(action.storyView
          ? { mode: "story", storyView: action.storyView }
          : {}),
      });
      break;
    case "appearance":
      if (action.theme) setTheme(action.theme);
      if (action.sakuraEffects !== undefined) {
        remember("tadacut-sakura-effects", action.sakuraEffects);
        setState({ sakuraEffects: action.sakuraEffects });
      }
      break;
    case "open-project":
      await openProject(action.projectId);
      if (getState().project?.id !== action.projectId)
        throw new Error("项目没有打开");
      break;
    case "provider-editor":
      if (!s.providers.some((p) => p.id === action.providerId))
        throw new Error("服务不存在，请先添加公开配置");
      setState({ nav: "models", editingProviderId: action.providerId });
      needsUser = true;
      message =
        "配置面板已打开。密钥请在 API Key 输入框填写，保存在本机凭据库。";
      break;
    case "skill-editor":
      if (!s.skills.some((p) => p.id === action.skillId))
        throw new Error("技能不存在，请先创建技能");
      setState({ nav: "skills", editingSkillId: action.skillId });
      break;
    case "dialog":
      setState({ modal: action.dialog === "none" ? null : action.dialog });
      break;
    case "creative-tool":
      setState({ modal: "tools", creativeTool: action.tool });
      break;
    case "select":
      setState({
        references: action.references,
        selectedClipIds: action.references
          .filter((r) => r.kind === "clip" && r.projectId === s.project?.id)
          .map((r) => r.id),
        selectedAssetId:
          action.references.find((r) => r.kind === "asset")?.id ?? null,
      });
      break;
    case "transport":
      if (action.action === "play" && !s.playing) togglePlay();
      if (action.action === "pause") pause();
      if (action.action === "seek") seek(action.frame ?? 0);
      if (action.action === "step") step(action.delta ?? 1);
      if (action.action === "mark-in") markIn();
      if (action.action === "mark-out") markOut();
      if (action.action === "clear-marks") clearMarks("both");
      break;
    case "view":
      setState({
        ...(action.zoom !== undefined ? { zoom: action.zoom } : {}),
        ...(action.snap !== undefined ? { snap: action.snap } : {}),
        ...(action.inspector !== undefined
          ? { panel: action.inspector ? "inspector" : "agent" }
          : {}),
        ...(action.leftPanel ? { leftPanel: action.leftPanel } : {}),
        ...(action.resourceSection
          ? { leftPanel: "library", resourceSection: action.resourceSection }
          : {}),
        overlays: {
          safe: action.safe ?? s.overlays.safe,
          grid: action.grid ?? s.overlays.grid,
        },
      });
      break;
    case "choose-files":
      setState({
        nav:
          action.kind === "skill"
            ? "skills"
            : action.kind === "extension"
              ? "extensions"
              : action.kind === "project"
                ? "projects"
                : "library",
        fileRequest: { kind: action.kind, assetId: action.assetId },
      });
      needsUser = true;
      message = "已准备文件选择入口，请选择要授权使用的本地文件或目录。";
      break;
    case "mcp-connection":
      setState({ nav: "settings", showMcpConfig: true });
      needsUser = true;
      message = "连接配置在设置页展示，凭据不会进入模型上下文。";
      break;
    case "assistant":
      if (
        action.providerId &&
        !s.providers.some(
          (p) =>
            p.id === action.providerId &&
            p.enabled &&
            p.capabilities.includes("chat"),
        )
      )
        throw new Error("请选择一个已启用对话能力的模型");
      if (
        action.skillId &&
        !s.skills.some((skill) => skill.id === action.skillId && skill.enabled)
      )
        throw new Error("请选择一个启用的技能");
      if (action.providerId !== undefined)
        localStorage.setItem("tadacut-provider", action.providerId);
      if (action.mode) remember("tadacut-agent-mode", action.mode);
      setState({
        ...(action.providerId !== undefined
          ? { providerId: action.providerId, agentBackend: "api" as const }
          : {}),
        ...(action.backend ? { agentBackend: action.backend } : {}),
        ...(action.mode ? { agentMode: action.mode } : {}),
        ...(action.skillId !== undefined ? { skillId: action.skillId } : {}),
      });
      message = "后续消息将使用所选的模型、模式和技能。";
      break;
  }
  // A hidden window gets no animation frames; the timer still answers in time.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });
  return {
    status: needsUser ? "needs-user" : "applied",
    message,
    context: currentStudioContext(),
  };
}
