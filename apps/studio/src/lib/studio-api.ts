import { useEffect, useState } from "react";
import type { Command } from "@tadacut/domain";
import type { AgentMode, AgentSettings } from "../../../server/src/agent";
import type { ExportRecord } from "../../../server/src/agent-tools/export";
import type {
  GlobalMemory,
  MemoryCandidate,
} from "../../../server/src/agent-tools/project";
import type { pluginSummary } from "../../../server/src/plugins";
import type { ProjectVersion } from "../../../server/src/storage";
import type { StockItem } from "../../../../packages/providers/src/services";
import { post, request, type Job } from "./api";
import { acceptJob, getState, notify, setState, useStudio } from "./store";
import { currentStudioContext } from "./studio-control";

export type {
  AgentMode,
  AgentSettings,
  ExportRecord,
  GlobalMemory,
  MemoryCandidate,
  ProjectVersion,
  StockItem,
};
export type PluginInfo = ReturnType<typeof pluginSummary>;
/** The conversation state the agent panel shows: draft, pending approval, continue. */
export interface ThreadSummary {
  projectId: string;
  messages: number;
  draft: number;
  draftLabels: string[];
  pending: {
    kind: "approval" | "question";
    callId?: string;
    tool?: string;
    effect?: string;
    summary?: string;
    messageId: string;
    providerId: string;
    mode: AgentMode;
  } | null;
  resumable: boolean;
  activeGroups: string[];
}
export const del = <T>(url: string) => request<T>(url, { method: "DELETE" });
/** Server events that mean a list on screen is stale. */
export type Tick =
  | "exports"
  | "versions"
  | "plugins"
  | "memories"
  | "settings"
  | "agent-settings"
  | "memory-candidates";
export function bump(kind: Tick) {
  const ticks = getState().ticks;
  setState({ ticks: { ...ticks, [kind]: (ticks[kind] ?? 0) + 1 } });
}
/** Loads a list and reloads it when the server says it changed. */
export function useRemote<T>(url: string | null, tick?: Tick, initial?: T) {
  const version = useStudio((s) => (tick ? (s.ticks[tick] ?? 0) : 0));
  const [value, setValue] = useState<T | undefined>(initial),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    request<T>(url)
      .then((v) => {
        if (live) {
          setValue(v);
          setError("");
        }
      })
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
  }, [url, version, reload]);
  return { value, error, refresh: () => setReload((n) => n + 1) };
}
async function run<T>(action: () => Promise<T>, done?: string) {
  try {
    const result = await action();
    if (done) notify(done);
    return result;
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), true);
    return undefined;
  }
}
const projectId = () => getState().project?.id ?? "";
export const agentApi = {
  thread: (id = projectId()) =>
    request<ThreadSummary>(`/api/projects/${id}/agent`).then((thread) => {
      if (id === projectId()) setState({ thread });
      return thread;
    }),
  approve: (callId: string, approve: boolean) =>
    run(async () => {
      const job = await post<Job>(
        `/api/projects/${projectId()}/agent/approve`,
        { callId, approve, studioContext: currentStudioContext() },
      );
      acceptJob(job);
      return job;
    }),
  continue: (providerId?: string, mode?: AgentMode) =>
    run(async () => {
      const job = await post<Job>(
        `/api/projects/${projectId()}/agent/continue`,
        {
          studioContext: currentStudioContext(),
          ...(providerId ? { providerId } : {}),
          ...(mode ? { mode } : {}),
        },
      );
      acceptJob(job);
      return job;
    }),
  draft: (action: "finalize" | "discard") =>
    run(
      () =>
        post<{ proposalId?: string | null }>(
          `/api/projects/${projectId()}/agent/draft`,
          { action },
        ),
      action === "finalize" ? "草稿已整理为待确认的方案" : "草稿已放弃",
    ),
  reset: () =>
    run(async () => {
      const result = await del<{ proposalId: string | null }>(
        `/api/projects/${projectId()}/agent/thread`,
      );
      setState({ messages: [] });
      await request(`/api/projects/${projectId()}/messages`, {
        method: "DELETE",
      }).catch(() => {});
      return result;
    }, "已开始新的对话"),
  settings: () => request<AgentSettings>("/api/agent/settings"),
  saveSettings: (patch: Partial<AgentSettings>) =>
    run(
      () => post<AgentSettings>("/api/agent/settings", patch),
      "Agent 设置已保存",
    ),
};
export const versionsApi = {
  save: (name: string, id = projectId()) =>
    run(
      () => post<ProjectVersion>(`/api/projects/${id}/versions`, { name }),
      "版本已保存",
    ),
  restore: (versionId: string, id = projectId()) =>
    run(async () => {
      const current =
        getState().projects.find((p) => p.id === id) ?? getState().project;
      return post(`/api/projects/${id}/versions/${versionId}/restore`, {
        expectedRevision: current?.revision ?? 0,
      });
    }, "已恢复到这个版本，可以撤销"),
  remove: (versionId: string, id = projectId()) =>
    run(() => del(`/api/projects/${id}/versions/${versionId}`), "版本已删除"),
};
export const exportsApi = {
  verify: (exportId: string) =>
    run(async () => {
      const job = await post<Job>(`/api/exports/${exportId}/verify`, {});
      acceptJob(job);
      return job;
    }, "已开始校验导出文件"),
  publish: (
    exportId: string,
    body: {
      providerId: string;
      title: string;
      description?: string;
      platforms: string[];
    },
  ) =>
    run(async () => {
      const job = await post<Job>(`/api/exports/${exportId}/publish`, body);
      acceptJob(job);
      return job;
    }, "已开始发布"),
};
export const pluginsApi = {
  install: (input: File | string) =>
    run(async () => {
      if (typeof input === "string")
        return post<PluginInfo>("/api/plugins/install", { url: input });
      const form = new FormData();
      form.append("file", input);
      return request<PluginInfo>("/api/plugins/install", {
        method: "POST",
        body: form,
      });
    }, "扩展已安装"),
  remove: (id: string) => run(() => del(`/api/plugins/${id}`), "扩展已移除"),
  item: <T>(pluginId: string, kind: string, itemId: string) =>
    request<T>(
      `/api/plugins/${pluginId}/items/${kind}/${encodeURIComponent(itemId)}`,
    ),
};
/** Beats (seconds into the source), pauses and per-second loudness of a sound. */
export interface AudioAnalysis {
  duration: number;
  bpm: number;
  beats: number[];
  beatConfidence: number;
  silence: { start: number; end: number }[];
  energy: number[];
  rmsDb: number;
  createdAt: string;
}
/** Analysed on this computer the first time, then served from the cache. */
export const audioAnalysis = (assetId: string, id = projectId()) =>
  request<AudioAnalysis>(
    `/api/projects/${id}/assets/${encodeURIComponent(assetId)}/audio-analysis`,
  );
/** Fonts on this computer, loaded once. */
let fonts: Promise<{ family: string; file: string }[]> | undefined;
export const localFonts = () =>
  (fonts ??= request<{ family: string; file: string }[]>("/api/fonts").catch(
    () => [],
  ));
/** Readable names for edit commands, shown in proposals. */
export const commandNames: Record<Command["type"] | string, string> = {
  "clip.add": "添加片段",
  "clip.update": "调整片段",
  "clip.remove": "删除片段",
  "clip.split": "分割片段",
  "clip.keyframe": "添加关键帧",
  "clip.keyframe.remove": "删除关键帧",
  "clip.group": "片段编组",
  "clip.link": "链接片段",
  "track.add": "添加轨道",
  "track.update": "调整轨道",
  "track.remove": "删除轨道",
  "timeline.create": "新建时间线",
  "timeline.activate": "切换时间线",
  "timeline.resize": "调整画幅",
  "timeline.update": "时间线设置",
  "timeline.remove": "删除时间线",
  "asset.add": "添加素材",
  "asset.update": "整理素材",
  "asset.remove": "移除素材",
  "marker.add": "添加标记",
  "marker.update": "修改标记",
  "marker.remove": "删除标记",
  "story.shot.upsert": "更新分镜",
  "story.shot.remove": "删除分镜",
  "story.entity.upsert": "更新设定",
  "story.entity.remove": "删除设定",
  "story.sync": "同步分镜与时间线",
  "story.development": "更新故事设定",
  "story.episode.upsert": "更新分集",
  "story.episode.remove": "删除分集",
  "story.script.set": "更新剧本",
  "story.logline": "更新故事梗概",
  "transcript.set": "更新文稿",
  "transcript.cut": "文稿剪辑",
  "transcript.gaps": "压缩停顿",
  "styles.update": "更新样式与品牌",
  "project.rename": "项目改名",
  "project.archive": "归档项目",
  "project.trash": "移到回收站",
  "multicam.create": "多机位同步",
  "memory.upsert": "记住偏好",
  "memory.remove": "删除记忆",
  "timeline.rename": "时间线改名",
  "track.reorder": "调整轨道顺序",
  "transcript.speaker": "说话人改名",
  "canvas.upsert": "更新画布",
  "canvas.remove": "删除画布节点",
  "multicam.switch": "切换机位",
  "multicam.remove": "解除多机位",
};
