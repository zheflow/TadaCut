import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import {
  agentStateView,
  planUpdateSchema,
  requestCompaction,
  unloadSkill,
  updateAgentPlan,
} from "../agent-state";
import { s, tool, type ToolHost } from "./host";

export function sessionTools(h: ToolHost): AgentTool[] {
  return [
    tool(
      "skills",
      "read",
      "read_agent_state",
      "读取当前任务的目标、约束、步骤、工作笔记和已加载技能。工作记录独立保存，不受聊天压缩影响。",
      s.object({}),
      () => agentStateView(h.repo, h.projectId),
    ),
    tool(
      "skills",
      "job",
      "update_agent_plan",
      "保存或更新多步任务计划及工作笔记。先读 read_agent_state 获取 revision；完成步骤须有实际结果。清空目标/步骤仅清工作记录，不修改项目与长期记忆。",
      zodToJsonSchema(planUpdateSchema) as Record<string, unknown>,
      (a) => updateAgentPlan(h, a),
    ),
    tool(
      "skills",
      "job",
      "unload_skill",
      "卸载当前对话不再需要的技能，释放上下文；不删除技能定义。",
      s.object({ skillId: s.string() }, ["skillId"]),
      (a) => unloadSkill(h, String(a.skillId)),
    ),
    tool(
      "skills",
      "job",
      "request_context_compaction",
      "请求压缩旧上下文。API 在下一次模型请求前处理；外部 CLI 在下一轮用户消息前处理。保留当前要求、任务计划、技能引用与待确认调用。",
      s.object({}),
      () => {
        requestCompaction(h);
        return {
          requested: true,
          note: "已安排应用上下文压缩；CLI 单次运行内部由运行时自行管理。",
        };
      },
    ),
  ];
}
