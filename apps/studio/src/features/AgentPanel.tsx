import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Ban,
  FileStack,
  Hourglass,
  Layers,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldQuestion,
  Sparkles,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { post, type Message } from "../lib/api";
import { RuntimeConnection } from "./RuntimeConnection";
import { AgentContext } from "./AgentContext";
import { agentApi, commandNames, type AgentMode } from "../lib/studio-api";
import {
  getState,
  remember,
  respondProposal,
  setState,
  startJob,
  useStudio,
} from "../lib/store";
import {
  pageNames,
  currentStudioContext,
  referenceKey,
  respondToStudioApproval,
} from "../lib/studio-control";

const modes: { id: AgentMode; label: string; hint: string }[] = [
  {
    id: "manual",
    label: "手动",
    hint: "修改先进入草稿，完成后由你确认，一次撤销",
  },
  {
    id: "auto",
    label: "自动",
    hint: "项目编辑直接应用并可撤销；应用管理依权限确认",
  },
  { id: "ask", label: "问答", hint: "只读取和回答，不修改项目" },
];
const effectNames: Record<string, string> = {
  read: "读取",
  edit: "编辑",
  job: "后台任务",
  manage: "应用管理",
  generate: "生成素材（会消耗额度）",
  external: "访问外部服务",
  publish: "公开发布",
};
const quickStarts = [
  { command: "clean", label: "去口癖和拖沓停顿", icon: WandSparkles },
  { command: "captions", label: "生成好看的字幕", icon: Layers },
  { command: "beat", label: "让画面卡在节拍上", icon: Sparkles },
  { command: "highlights", label: "切出适合短视频的高光", icon: FileStack },
];
function StepList({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  const steps = m.steps ?? [];
  if (!steps.length) return null;
  const failed = steps.filter((s) => s.status === "error").length,
    running = steps.some((s) => s.status === "running");
  return (
    <div className="agent-steps">
      <button className="agent-steps-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {running ? "正在执行" : "执行了"} {steps.length} 个步骤
        {failed > 0 && (
          <span className="agent-steps-failed">{failed} 个未成功</span>
        )}
      </button>
      {open && (
        <ol>
          {steps.map((s) => (
            <li key={s.id} className={`agent-step ${s.status}`}>
              {s.status === "running" ? (
                <LoaderCircle className="spin" size={11} />
              ) : s.status === "done" ? (
                <CircleCheck size={11} />
              ) : s.status === "error" ? (
                <CircleAlert size={11} />
              ) : s.status === "denied" ? (
                <Ban size={11} />
              ) : (
                <Hourglass size={11} />
              )}
              <code>{s.tool}</code>
              {s.group && <small>{s.group}</small>}
              {s.summary && <span title={s.summary}>{s.summary}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
function ApprovalCard({ m, busy }: { m: Message; busy: boolean }) {
  const a = m.approval!;
  return (
    <div className={`approval-card ${a.status}`}>
      <div className="approval-title">
        <ShieldQuestion size={14} />
        {a.status === "pending"
          ? "需要你确认"
          : a.status === "approved"
            ? "已允许"
            : "已拒绝"}
        <span className="quiet-badge">{effectNames[a.effect] ?? a.effect}</span>
      </div>
      <p>
        <code>{a.tool}</code>
        {a.summary && <span>{a.summary}</span>}
      </p>
      {a.status === "pending" && (
        <div className="approval-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void agentApi.approve(a.callId, false)}
          >
            <X size={12} />
            不要执行
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void agentApi.approve(a.callId, true)}
          >
            <Check size={12} />
            允许这一次
          </button>
        </div>
      )}
    </div>
  );
}
export function AgentPanel() {
  const p = useStudio((s) => s.project)!,
    messages = useStudio((s) => s.messages),
    proposals = useStudio((s) => s.proposals),
    providers = useStudio((s) => s.providers),
    providerId = useStudio((s) => s.providerId),
    backend = useStudio((s) => s.agentBackend),
    selected = useStudio((s) => s.selectedClipIds),
    skillId = useStudio((s) => s.skillId),
    skills = useStudio((s) => s.skills),
    jobs = useStudio((s) => s.jobs),
    mode = useStudio((s) => s.agentMode),
    thread = useStudio((s) => s.thread),
    nav = useStudio((s) => s.nav),
    workspace = useStudio((s) => s.mode);
  const externalApproval = useStudio((s) => s.externalApproval);
  useStudio((s) => s.references);
  const context = currentStudioContext();
  const [text, updateText] = useState(() => getState().agentDrafts[p.id] ?? ""),
    [modelsOpen, setModelsOpen] = useState(false),
    [contextOpen, setContextOpen] = useState(false),
    [commandIndex, setCommandIndex] = useState(0);
  const setText = (value: string) => {
    updateText(value);
    setState({ agentDrafts: { ...getState().agentDrafts, [p.id]: value } });
  };
  const bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const running = jobs.find(
    (j) =>
      j.projectId === p.id &&
      j.kind === "agent" &&
      ["queued", "running"].includes(j.status),
  );
  const model = providers.find((pr) => pr.id === providerId),
    selectedSkill = skills.find((s) => s.id === skillId);
  const offline = backend === "api" && !model;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [
    messages.map((m) => m.text.length + (m.steps?.length ?? 0)).join(","),
    proposals.length,
    thread?.draft,
  ]);
  useEffect(() => {
    void agentApi.thread(p.id).catch(() => {});
  }, [p.id]);
  // Slash commands: the skills that answer to what has been typed after “/”
  // (commands can be Chinese, since imported SKILL.md names become commands).
  const slash =
    /^\/([\p{L}\p{N}_-]*)$/u.exec(text.trim()) && !text.includes(" ");
  const commands = useMemo(() => {
    if (!slash) return [];
    const q = text.trim().slice(1).toLowerCase();
    return skills
      .filter((s) => s.enabled && s.command)
      .filter(
        (s) =>
          !q ||
          s.command!.toLowerCase().startsWith(q) ||
          s.name.includes(q) ||
          s.id.includes(q),
      )
      .slice(0, 8);
  }, [slash, text, skills]);
  useEffect(() => setCommandIndex(0), [text]);
  const send = async (message = text) => {
    if (!message.trim() || running) return;
    setText("");
    await startJob("agent", "Agent 创作", {
      message: message.trim(),
      providerId,
      backend,
      mode,
      selectedClipIds: selected,
      frame: getState().playhead,
      skillId,
      studioContext: currentStudioContext(),
    });
  };
  const chooseCommand = (command: string) => {
    setText(`/${command} `);
    input.current?.focus();
  };
  const setMode = (next: AgentMode) => {
    setState({ agentMode: next });
    remember("tadacut-agent-mode", next);
  };
  const pending = proposals.filter((pr) => pr.status === "pending"),
    last = messages[messages.length - 1],
    canContinue =
      !running &&
      (thread?.resumable || (last?.role === "assistant" && last.resumable)) &&
      thread?.pending?.kind !== "approval";
  return (
    <div className="agent-panel">
      <div className="panel-heading">
        <span>
          <Sparkles size={15} />
          创作助手
        </span>
        <div className="agent-heading-tools">
          <div
            className="agent-modes"
            role="radiogroup"
            aria-label="Agent 模式"
          >
            {modes.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                className={mode === m.id ? "active" : ""}
                title={m.hint}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            title="管理上下文"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen(!contextOpen)}
          >
            <Layers size={14} />
          </button>
          <button
            className="icon-button"
            title="新对话（未确认的草稿会先整理成方案）"
            disabled={
              Boolean(running) || (!messages.length && !thread?.messages)
            }
            onClick={() => {
              if (
                confirm(
                  "开始新的对话？当前对话记录会清空，未确认的草稿会先整理成方案。",
                )
              )
                void agentApi.reset();
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <div
        className="assistant-context"
        title="助手会自动感知当前页面与选中的对象"
      >
        <span className="assistant-context-dot" />
        <strong>{p.name}</strong>
        <ChevronRight size={11} />
        <span>
          {pageNames[nav]}
          {nav === "studio"
            ? ` · ${{ edit: "剪辑", story: "分镜", transcript: "文稿", record: "应用录制", canvas: "创作画布" }[workspace]}`
            : ""}
        </span>
      </div>
      {contextOpen && (
        <AgentContext projectId={p.id} running={Boolean(running)} />
      )}
      <div className="agent-messages">
        {!messages.length && (
          <>
            <div className="agent-welcome">
              <div className="agent-emblem">
                <Sparkles size={20} />
              </div>
              <span className="assistant-eyebrow">YOUR CREATIVE PARTNER</span>
              <h3>从灵感，到每一处细节。</h3>
              <p>
                {offline ? (
                  "当前为离线指令模式，没有连接 AI 模型。仅支持时长、淡入淡出等固定指令；连接模型后可以自由对话。"
                ) : (
                  <>
                    剪辑、素材、技能与设置，都可以在这里交给我。输入{" "}
                    <code>/</code> 选择技能。
                  </>
                )}
                <br />
                {modes.find((m) => m.id === mode)?.hint}。
              </p>
            </div>
            <div className="suggestions">
              {offline ? (
                nav === "studio" ? (
                  ["调整为 15 秒", "添加淡入淡出", "从时间线整理分镜"].map(
                    (prompt) => (
                      <button
                        key={prompt}
                        onClick={() => {
                          setText(prompt);
                          input.current?.focus();
                        }}
                      >
                        <WandSparkles size={13} />
                        <span>{prompt}</span>
                        <ChevronRight size={13} />
                      </button>
                    ),
                  )
                ) : (
                  <button onClick={() => setState({ nav: "models" })}>
                    <Sparkles size={13} />
                    <span>连接模型，开启自由对话</span>
                    <ChevronRight size={13} />
                  </button>
                )
              ) : nav === "studio" ? (
                quickStarts
                  .filter((q) =>
                    skills.some((s) => s.enabled && s.command === q.command),
                  )
                  .map((q) => (
                    <button
                      key={q.command}
                      onClick={() => void send(`/${q.command}`)}
                    >
                      <q.icon size={13} />
                      <span>{q.label}</span>
                      <small>/{q.command}</small>
                      <ChevronRight size={13} />
                    </button>
                  ))
              ) : (
                {
                  projects: ["帮我整理这些项目", "为当前项目保存一个版本"],
                  library: [
                    "给选中的素材补充描述和标签",
                    "把这些素材用到当前项目",
                  ],
                  models: [
                    "帮我检查这些模型的配置",
                    "把选中的服务设为默认对话模型",
                  ],
                  skills: ["解释选中技能的用法", "帮我改进这个技能的指令"],
                  extensions: [
                    "看看已安装的扩展能做什么",
                    "打开资源库，挑选字幕样式",
                  ],
                  tasks: ["看看这些任务的执行情况", "取消选中的任务"],
                  settings: [
                    "帮我切换浅色或深色外观",
                    "帮我调整创作助手的默认设置",
                  ],
                }[nav].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setText(prompt);
                      input.current?.focus();
                    }}
                  >
                    <Sparkles size={13} />
                    <span>{prompt}</span>
                    <ChevronRight size={13} />
                  </button>
                ))
              )}
            </div>
            <div className="agent-note">
              <i />
              你决定方向；生成、联网与发布都会先问你。
            </div>
          </>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message ${m.role}`}>
            <div className="message-role">
              {m.role === "assistant" ? (
                <>
                  <Sparkles size={12} />
                  TadaCut
                  {m.mode && m.mode !== "manual" && (
                    <span className="quiet-badge">
                      {modes.find((x) => x.id === m.mode)?.label}
                    </span>
                  )}
                </>
              ) : (
                "你"
              )}
            </div>
            {m.role === "assistant" && <StepList m={m} />}
            {(m.text || (!m.approval && !m.error)) && (
              <div className="message-text">
                {m.text || <span className="typing-indicator">正在思考…</span>}
              </div>
            )}
            {m.notice && (
              <div className="message-notice">
                <LoaderCircle className="spin" size={12} />
                {m.notice}
              </div>
            )}
            {m.error && (
              <div className="message-error" role="alert">
                <CircleAlert size={14} />
                <div>
                  <b>没有完成</b>
                  <p>{m.error}</p>
                </div>
              </div>
            )}
            {m.approval && <ApprovalCard m={m} busy={Boolean(running)} />}
            {m.usage && (
              <div
                className="message-usage"
                title="本轮多次模型请求的累计 token 用量，不是单次上下文大小"
              >
                {m.usage.input === null || m.usage.output === null ? (
                  "运行时未提供用量"
                ) : (
                  <>
                    {m.usage.reported ? "" : "约 "}
                    {m.usage.input.toLocaleString()} 累计输入 ·{" "}
                    {m.usage.output.toLocaleString()} 累计输出
                  </>
                )}
              </div>
            )}
            {m.agentContext && (
              <details className="message-usage agent-context-details">
                <summary>上下文与技能</summary>
                <div>
                  本次发送 {m.agentContext.offeredTools} 个工具定义，完整目录{" "}
                  {m.agentContext.catalogTools} 项
                </div>
                <div>
                  应用上下文约{" "}
                  {m.agentContext.estimatedInputTokens.toLocaleString()} tokens
                  · 已压缩 {m.agentContext.compactions} 次
                </div>
                <div>
                  加载技能：{m.agentContext.skills.join("、") || "未加载"} ·
                  预载记忆 {m.agentContext.memoryCount} 条
                </div>
                {m.agentContext.backend !== "api" && (
                  <div>CLI 会话内的压缩由该运行时管理</div>
                )}
              </details>
            )}
          </div>
        ))}
        {thread?.pending?.kind === "question" && !running && (
          <div className="agent-hint">
            <ShieldQuestion size={13} />
            助手在等你的回答，直接在下面回复即可。
          </div>
        )}
        {thread && thread.draft > 0 && !running && (
          <div className="draft-card">
            <div className="proposal-title">
              <FileStack size={14} />
              草稿里有 {thread.draft} 项修改
            </div>
            <p>{thread.draftLabels.slice(-4).join("、") || "Agent 修改"}</p>
            <div>
              <button
                className="secondary-button"
                onClick={() => {
                  if (confirm("放弃草稿里的修改？"))
                    void agentApi.draft("discard");
                }}
              >
                放弃草稿
              </button>
              <button
                className="primary-button"
                onClick={() => void agentApi.draft("finalize")}
              >
                <Check size={13} />
                整理成方案
              </button>
            </div>
          </div>
        )}
        {pending.map((pr) => {
          const counts = pr.commands.reduce<Record<string, number>>(
            (acc, c) => {
              acc[c.type] = (acc[c.type] ?? 0) + 1;
              return acc;
            },
            {},
          );
          return (
            <div className="proposal-card" key={pr.id}>
              <div className="proposal-title">
                <WandSparkles size={14} />
                {pr.label}
              </div>
              <p>{pr.commands.length} 项修改 · 应用后可一次撤销</p>
              <details>
                <summary>查看修改内容</summary>
                <ul>
                  {Object.entries(counts).map(([type, n]) => (
                    <li key={type}>
                      {commandNames[type] ?? type}
                      {n > 1 ? ` × ${n}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
              <div>
                <button
                  className="secondary-button"
                  onClick={() => void respondProposal(pr.id, false)}
                >
                  暂不应用
                </button>
                <button
                  className="primary-button"
                  onClick={() => void respondProposal(pr.id, true)}
                >
                  <Check size={13} />
                  应用修改
                </button>
              </div>
            </div>
          );
        })}
        {running && (
          <div className="agent-working">
            <LoaderCircle className="spin" size={13} />
            {running.stage ?? running.label}
            <button
              title="停止"
              onClick={() => void post(`/api/jobs/${running.id}/cancel`, {})}
            >
              <CircleStop size={14} />
            </button>
          </div>
        )}
        {canContinue && (
          <button
            className="secondary-button continue-button"
            onClick={() =>
              void agentApi.continue(providerId || undefined, mode)
            }
          >
            <Play size={12} />
            继续完成
          </button>
        )}
        <div ref={bottom} />
      </div>
      <div className="agent-input-section">
        {externalApproval?.projectId === p.id && (
          <div className="approval-card pending external-approval" role="alert">
            <div className="approval-title">
              <ShieldQuestion size={14} />
              需要你确认
              <span className="quiet-badge">
                {effectNames[externalApproval.effect]}
              </span>
            </div>
            <p>
              <code>{externalApproval.tool}</code>
              <span>{externalApproval.summary}</span>
            </p>
            <div className="approval-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  respondToStudioApproval(externalApproval.id, false)
                }
              >
                不要执行
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  respondToStudioApproval(externalApproval.id, true)
                }
              >
                允许这一次
              </button>
            </div>
          </div>
        )}
        {selectedSkill && (
          <div className="context-chip">
            <Sparkles size={12} />
            {selectedSkill.name}
            {selectedSkill.command && <small>/{selectedSkill.command}</small>}
            <button
              title="取消技能"
              onClick={() => setState({ skillId: null })}
            >
              <X size={11} />
            </button>
          </div>
        )}
        {context.references.length > 0 && (
          <div className="assistant-references" aria-label="引用的对象">
            <div className="reference-summary">
              <span>已引用 {context.references.length} 项</span>
              <button
                onClick={() =>
                  setState({
                    references: [],
                    selectedClipIds: [],
                    selectedAssetId: null,
                  })
                }
              >
                清空
              </button>
            </div>
            {context.references.map((r) => (
              <div
                className="context-chip"
                key={referenceKey(r)}
                title={`${{ clip: "片段", asset: "素材", project: "项目", skill: "技能", provider: "模型", job: "任务", extension: "扩展" }[r.kind]} · ${r.name}`}
              >
                <Layers size={11} />
                <span>{r.name}</span>
                <button
                  title={`移除引用「${r.name}」`}
                  onClick={() => {
                    const s = getState();
                    setState({
                      references: s.references.filter(
                        (x) => referenceKey(x) !== referenceKey(r),
                      ),
                      ...(r.kind === "clip"
                        ? {
                            selectedClipIds: s.selectedClipIds.filter(
                              (id) => id !== r.id,
                            ),
                          }
                        : {}),
                    });
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input">
          {commands.length > 0 && (
            <div className="slash-menu" role="listbox">
              {commands.map((s, i) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={i === commandIndex}
                  className={i === commandIndex ? "active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseCommand(s.command!);
                  }}
                >
                  <code>/{s.command}</code>
                  <span>{s.name}</span>
                  <small>{s.description}</small>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            placeholder={
              offline
                ? "输入固定指令，例如“调整为 15 秒”…"
                : mode === "ask"
                  ? "问我关于当前页面或所选对象的问题…"
                  : `说说要如何${nav === "studio" ? "创作" : "调整"}，已感知${pageNames[nav]}…`
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (commands.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setCommandIndex(
                    (i) =>
                      (i + (e.key === "ArrowDown" ? 1 : -1) + commands.length) %
                      commands.length,
                  );
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  chooseCommand(commands[commandIndex].command!);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="chat-input-footer">
            <button
              className="icon-button"
              title="选择技能"
              onClick={() => setState({ nav: "skills" })}
            >
              <Sparkles size={15} />
            </button>
            {pending.length > 0 && (
              <span className="quiet-badge green">
                {pending.length} 个方案待确认
              </span>
            )}
            <span>↵ 发送 · / 技能</span>
            <button
              className="send-button"
              disabled={!text.trim() || Boolean(running)}
              title="发送"
              onClick={() => void send()}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
        <div className="model-picker">
          <button onClick={() => setModelsOpen(!modelsOpen)}>
            <i
              className={providerId || backend !== "api" ? "configured" : ""}
            />
            {backend !== "api"
              ? backend === "codex"
                ? "Codex"
                : backend === "claude"
                  ? "Claude Code"
                  : "Copilot"
              : model
                ? model.name + (model.model ? ` · ${model.model}` : "")
                : "离线指令（无模型）"}
            <ChevronDown size={11} />
          </button>
          <button
            title="配置供应商与本地模型"
            onClick={() => setState({ nav: "models" })}
          >
            模型设置 ↗
          </button>
          {modelsOpen && (
            <div className="model-menu">
              <button
                onClick={() => {
                  setState({ providerId: "", agentBackend: "api" });
                  localStorage.setItem("tadacut-provider", "");
                  setModelsOpen(false);
                }}
              >
                离线指令（无模型）
                <small>不连接模型，只处理简单的时长与淡入淡出指令</small>
              </button>
              {providers
                .filter((x) => x.enabled && x.capabilities.includes("chat"))
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() => {
                      setState({ providerId: x.id, agentBackend: "api" });
                      localStorage.setItem("tadacut-provider", x.id);
                      setModelsOpen(false);
                    }}
                  >
                    {x.name}
                    <small>{x.model || "尚未选择模型"}</small>
                  </button>
                ))}
              {(["codex", "claude", "copilot"] as const).map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    setState({ agentBackend: id });
                    setModelsOpen(false);
                  }}
                >
                  {id === "claude"
                    ? "Claude Code"
                    : id === "codex"
                      ? "Codex"
                      : "Copilot"}
                  <small>使用本机已登录的运行时，遵循相同的助手权限</small>
                </button>
              ))}
            </div>
          )}
        </div>
        {backend !== "api" && <RuntimeConnection id={backend} />}
        <p className="model-footnote">
          {mode === "auto" ? (
            <>
              <Undo2 size={10} /> 项目编辑可撤销，应用管理按权限确认
            </>
          ) : model || backend !== "api" ? (
            "素材只在你发起任务时交给所选服务"
          ) : (
            "配置模型，开启自由对话与 AI 生成"
          )}
        </p>
      </div>
    </div>
  );
}
