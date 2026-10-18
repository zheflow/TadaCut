import {
  defaultPermissions,
  type AgentTool,
  type Permission,
  type ToolEffect,
} from "../../../packages/agent/src/runner";

/** Runtime protocols differ; the app owns the same permission gate for all of them. */
export function guardExternalTools(
  tools: AgentTool[],
  options: {
    signal: AbortSignal;
    permissions: Partial<Record<ToolEffect, Permission>>;
    approve(tool: AgentTool, args: unknown): Promise<boolean>;
  },
): AgentTool[] {
  let finished = false;
  let sequence = Promise.resolve();
  return tools.map((tool) => ({
    ...tool,
    execute: async (args) => {
      const operation = async () => {
        options.signal.throwIfAborted();
        if (finished)
          throw new Error("项目已切换，请结束本轮，下一条消息针对新项目");
        const effect = tool.effect ?? "read";
        let permission =
          options.permissions[effect] ?? defaultPermissions[effect];
        if (effect === "publish" && permission === "allow") permission = "ask";
        if (permission === "deny") throw new Error("用户设置禁止这个操作");
        if (permission === "ask" && !(await options.approve(tool, args)))
          throw new Error("用户未允许执行这个操作");
        options.signal.throwIfAborted();
        const result = await tool.execute(args);
        if (
          result &&
          typeof result === "object" &&
          "_finish" in result &&
          result._finish
        )
          finished = true;
        return result;
      };
      const result = sequence.then(operation);
      sequence = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  }));
}
