import { useState } from "react";
import { X } from "lucide-react";
import { agentApi, useRemote } from "../lib/studio-api";
import { post } from "../lib/api";
import { notify, setState } from "../lib/store";
import type { AgentService } from "../../../server/src/agent";

const stepNames = {
  pending: "待办",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "受阻",
};
export function AgentContext({
  projectId,
  running,
}: {
  projectId: string;
  running: boolean;
}) {
  const state = useRemote<ReturnType<AgentService["workingState"]>>(
    `/api/projects/${projectId}/agent/state`,
    "agent-state",
  );
  const [busy, setBusy] = useState(false);
  const value = state.value?.id === projectId ? state.value : undefined;
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      state.refresh();
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agent-context-manager" aria-label="上下文管理">
      <div className="agent-context-actions">
        <button
          className="secondary-button"
          disabled={busy || running}
          onClick={() => void action(() => agentApi.compact(projectId))}
        >
          压缩旧对话
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setState({ nav: "settings" });
            requestAnimationFrame(() =>
              document
                .getElementById("agent-memories")
                ?.scrollIntoView({ block: "start" }),
            );
          }}
        >
          记忆设置
        </button>
      </div>
      {state.error && <p className="error-text">{state.error}</p>}
      {!value ? (
        <p>读取上下文…</p>
      ) : (
        <>
          <p>
            预算约 {value.inputBudget.toLocaleString()} tokens · 压缩{" "}
            {value.thread.compactions} 次 · {value.thread.messages} 条上下文消息
          </p>
          <p>
            连接：{value.thread.connection?.backend ?? "尚未开始"} ·
            技能和计划保存在本项目中
          </p>
          <strong>已加载技能</strong>
          {!value.loadedSkills.length ? (
            <p>尚未加载；助手按任务搜索并加载技能。</p>
          ) : (
            value.loadedSkills.map((skill) => (
              <div className="agent-loaded-skill" key={skill.id}>
                <span>
                  {skill.name}
                  {!skill.available
                    ? " · 已停用"
                    : skill.stale
                      ? " · 内容已更新，需重载"
                      : ""}
                </span>
                <button
                  className="icon-button"
                  title={`卸载技能 ${skill.name}`}
                  disabled={busy || running}
                  onClick={() =>
                    void action(() =>
                      post(`/api/projects/${projectId}/agent/skills/unload`, {
                        skillId: skill.id,
                      }),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))
          )}
          <strong>当前任务</strong>
          <p>{value.goal || "尚未建立多步任务计划"}</p>
          {value.constraints.length > 0 && (
            <p>{value.constraints.join("；")}</p>
          )}
          {value.steps.length > 0 && (
            <ol className="agent-plan-steps">
              {value.steps.map((step) => (
                <li key={step.id} data-status={step.status}>
                  <span>{stepNames[step.status]}</span> {step.title}
                </li>
              ))}
            </ol>
          )}
          {value.notes && <p className="agent-working-notes">{value.notes}</p>}
          <small>
            工作记录用于续跑，不会自动成为长期记忆。压缩保留当前要求和待确认操作，执行结果仍以项目为准。
          </small>
        </>
      )}
    </section>
  );
}
