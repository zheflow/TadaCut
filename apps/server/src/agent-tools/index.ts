import { teamTools } from "./team";
import { advancedTools } from "./advanced";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { publicJob } from "../jobs";
import { readProjectParameters, readProjectView } from "../project-view";
import { assetImages, timelineImages } from "../frames";
import type { Job } from "../storage";
import { audioTools } from "./audio";
import { exportTools } from "./export";
import { parseCommands, s, timelineOf, tool, type ToolHost } from "./host";
import { mediaTools } from "./media";
import { motionTools } from "./motion";
import { projectTools } from "./project";
import { skillTools, type SubAgent } from "./skills";
import { generateTools, storyTools } from "./story";
import { timelineTools } from "./timeline";
import { visualTools } from "./visual";
import { wordTools } from "./words";
import { applicationTools } from "./application";
import { sessionTools } from "./session";

export const groupLabels: Record<string, string> = {
  team: "团队协作、远程项目、权限、版本、评审链接、共享模板贴纸与音频目录",
  advanced:
    "高级画面、曲线变速、倒放、补帧、蒙版、跟踪、抠像、消除、数字人、HDR、歌词、代理",
  canvas: "画布分组、素材引用、历史、批量操作",
  timeline: "剪辑",
  transcript: "文稿",
  captions: "字幕",
  audio: "音频",
  visual: "画面",
  media: "素材",
  web: "网页",
  generate: "生成",
  story: "故事",
  motion: "动画",
  export: "导出",
  project: "项目",
  memory: "记忆",
  skills: "技能",
  desktop: "应用操作",
  application: "应用管理、页面、设置、模型、项目、技能与扩展",
};
function coreTools(h: ToolHost, desktopSession?: string): AgentTool[] {
  const editHint =
    h.mode === "auto"
      ? "修改会直接应用到项目，每次调用是一个可撤销步骤。"
      : "修改先进入本次草稿（之后读取项目会看到），结束时作为一个方案交给用户确认。";
  const core: AgentTool[] = [
    tool(
      "core",
      "read",
      "read_project",
      "读取项目与版本（不含凭据）。默认返回概览；大型项目用 section 分段、offset/limit 分页。修改前先读取。",
      readProjectParameters,
      (a) => {
        const p = h.project();
        h.markRead(p.revision);
        return readProjectView(p, a);
      },
    ),
    tool(
      "core",
      "edit",
      "propose_edit",
      `提交任意编辑命令（严格使用 read_project 中的 ID）。命令类型见 clip.*、track.*、timeline.*、marker.*、story.*、transcript.*、styles.update、asset.* 等。${editHint}`,
      s.object(
        {
          label: s.string(),
          commands: s.array({
            type: "object",
            properties: { type: s.string() },
            required: ["type"],
            additionalProperties: true,
          }),
        },
        ["label", "commands"],
      ),
      (a) => h.edit(String(a.label), parseCommands(a.commands)),
    ),
    tool(
      "core",
      "read",
      "ask_user",
      "需要创作偏好、素材范围或明确确认时，向用户提一个简短问题并等待回复。",
      s.object({ question: s.string() }, ["question"]),
      (a) => ({
        _wait: true,
        question: a.question,
      }),
    ),
    tool(
      "core",
      "read",
      "view_frames",
      "查看画面：frames 为时间线帧号（按导出效果渲染，含字幕、特效与转场，适合检查结果）；或 assetId + seconds 查看素材原画面。一次最多 6 张。",
      s.object({
        frames: s.array(s.integer()),
        seconds: s.array(s.number()),
        assetId: s.string(),
        timelineId: s.string(),
      }),
      async (a) => {
        if (a.assetId) {
          const asset = h.project().assets.find((x) => x.id === a.assetId);
          if (!asset) throw new Error("素材不存在");
          const shots = await assetImages(
            h.media,
            asset,
            (a.seconds?.length ? a.seconds : [0]).slice(0, 6),
            h.signal,
          );
          return {
            _images: shots.map((x) => x.image),
            seconds: shots.map((x) => x.seconds),
          };
        }
        const p = h.project(),
          tl = timelineOf(p, a.timelineId),
          frames: number[] = a.frames?.length
            ? a.frames
            : (a.seconds ?? [0]).map((x: number) => Math.round(x * tl.fps));
        const shots = await timelineImages(
          h.repo,
          h.root,
          p,
          tl,
          frames.slice(0, 6),
          h.signal,
        );
        return {
          _images: shots.map((x) => x.image),
          frames: shots.map((x) => x.frame),
        };
      },
    ),
    tool(
      "core",
      "read",
      "wait_for_job",
      "等待一个后台任务完成（最多 seconds 秒，默认 60），返回结果。",
      s.object({ jobId: s.string(), seconds: s.number() }, ["jobId"]),
      async (a) => {
        const job = await h.waitJob(a.jobId, Math.min(600, a.seconds ?? 60));
        if (!job) throw new Error("任务不存在");
        return publicJob(job);
      },
    ),
    tool(
      "core",
      "read",
      "read_jobs",
      "读取本项目最近的生成、分析和导出任务。",
      s.object({}),
      () =>
        h.repo
          .list<Job>("job")
          .filter((j) => j.projectId === h.projectId)
          .slice(0, 30)
          .map(({ input: _input, ...job }) => job),
    ),
    tool(
      "core",
      "read",
      "list_providers",
      "列出已配置的模型与服务及其能力（不返回密钥）。",
      s.object({}),
      () =>
        h.repo.providers().map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          model: p.model,
          models: p.models,
          capabilities: p.capabilities,
          enabled: p.enabled,
          hasKey: p.hasKey,
          ...(p.keyUnreadable ? { keyUnreadable: true } : {}),
        })),
    ),
  ];
  if (h.desktop)
    core.push(
      tool(
        "desktop",
        "read",
        "desktop_status",
        "查看应用操作权限与是否有用户开启的操作会话。",
        s.object({}),
        async () => ({
          ...(await h.desktop!.status()),
          session: desktopSession ?? null,
        }),
      ),
      tool(
        "desktop",
        "external",
        "operate_app",
        "在用户已开启的应用操作会话中执行一项界面任务（只操作用户授权的窗口，最多 25 步）。",
        s.object({ task: s.string(), providerId: s.string() }, ["task"]),
        (a) => {
          if (!desktopSession)
            throw new Error(
              "用户还没有开启应用操作会话，请让用户在“应用操作”中选择窗口并开始",
            );
          return h.enqueue("computer-use", "应用操作", {
            sessionId: desktopSession,
            prompt: a.task,
            providerId: h.provider("chat", a.providerId),
          });
        },
      ),
    );
  return core;
}
/** Every tool the agent can use, by group. Core tools are always offered. */
export function buildTools(
  h: ToolHost,
  options: { spawn: SubAgent; depth: number; desktopSession?: string },
): AgentTool[] {
  return [
    ...coreTools(h, options.desktopSession),
    ...applicationTools(h),
    ...timelineTools(h),
    ...advancedTools(h),
    ...teamTools(h),
    ...wordTools(h),
    ...audioTools(h),
    ...visualTools(h),
    ...mediaTools(h),
    ...generateTools(h),
    ...storyTools(h),
    ...motionTools(h),
    ...exportTools(h),
    ...projectTools(h),
    ...skillTools(h, options.spawn, options.depth),
    ...sessionTools(h),
  ];
}
export type { ToolHost } from "./host";
