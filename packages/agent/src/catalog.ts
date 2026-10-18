import type { AgentTool } from "./runner";

export function searchTerms(query: string) {
  const words = query
    .toLowerCase()
    .split(/[\s,，、。;；:：/|]+/)
    .filter(Boolean);
  const terms = new Set(words);
  for (const word of words)
    if (/[㐀-鿿]/.test(word))
      for (let i = 0; i + 2 <= word.length; i++)
        terms.add(word.slice(i, i + 2));
  return [...terms];
}

export function relevance(query: string, text: string) {
  const haystack = text.toLowerCase();
  return searchTerms(query).reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}

/** A small working set of exact tools, never all siblings in a matching group. */
export function createToolCatalog(
  tools: AgentTool[],
  labels: Record<string, string> = {},
  initialNames: string[] = [],
) {
  const recent: string[] = [];
  const activate = (names: string[]) => {
    for (const name of [...names].reverse()) {
      if (!tools.some((t) => t.name === name)) continue;
      const index = recent.indexOf(name);
      if (index >= 0) recent.splice(index, 1);
      recent.unshift(name);
    }
    recent.splice(12);
  };
  activate(initialNames);
  const core = tools.filter((t) => !t.group || t.group === "core");
  const offered = () => {
    const chosen = [...core];
    let size = JSON.stringify(
      core.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
    ).length;
    for (const name of recent) {
      const tool = tools.find((t) => t.name === name)!;
      if (chosen.includes(tool)) continue;
      const chars =
        JSON.stringify(tool.parameters).length + tool.description.length;
      if (size + chars > 24000) continue;
      chosen.push(tool);
      size += chars;
    }
    return chosen;
  };
  const search: AgentTool = {
    name: "tool_search",
    group: "core",
    effect: "read",
    description:
      "按关键词或精确工具名查找工具。只返回匹配工具的参数定义，每次最多 6 项；用 offset 翻页。先加载合适的技能，再查找其工作流需要的工具。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        offset: { type: "integer", minimum: 0 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args: any) => {
      const query = String(args?.query ?? "").trim();
      const offset = Math.max(0, Math.floor(Number(args?.offset) || 0));
      if (!query) return { tools: [], note: "请输入具体任务、分组或工具名" };
      const ranked = tools
        .map((tool) => ({
          tool,
          score:
            (tool.name.toLowerCase() === query.toLowerCase() ? 1000 : 0) +
            relevance(query, `${tool.name} ${tool.description}`) * 4 +
            relevance(
              query,
              `${tool.group ?? ""} ${labels[tool.group ?? ""] ?? ""}`,
            ),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const selected: AgentTool[] = [];
      let size = 0;
      for (const { tool } of ranked.slice(offset, offset + 6)) {
        const chars =
          JSON.stringify(tool.parameters).length + tool.description.length;
        if (size + chars > 16000 && selected.length) break;
        selected.push(tool);
        size += chars;
      }
      activate(selected.map((t) => t.name));
      return {
        enabled: [...new Set(selected.map((t) => t.group).filter(Boolean))],
        tools: selected.map(({ name, group, description, parameters }) => ({
          name,
          group,
          description,
          parameters,
        })),
        total: ranked.length,
        ...(offset + selected.length < ranked.length
          ? { nextOffset: offset + selected.length }
          : {}),
        note: selected.length
          ? "API 模式可直接调用已加载工具；外部运行时用 call_tool，传入工具名和符合上述定义的 arguments。"
          : "没有匹配工具，请换具体关键词。",
      };
    },
  };
  return { search, activate, offered, names: () => [...recent] };
}

/** Static runtime protocols see only entry points; the full catalog stays in the host. */
export function externalToolGateway(
  tools: AgentTool[],
  labels: Record<string, string>,
) {
  const catalog = createToolCatalog(tools, labels);
  const direct = new Set([
    "read_project",
    "read_app_context",
    "read_skills",
    "load_skill",
    "search_memories",
    "ask_user",
  ]);
  return [
    ...tools.filter((t) => direct.has(t.name)),
    catalog.search,
    {
      name: "call_tool",
      group: "core",
      effect: "read" as const,
      description:
        "执行 tool_search 返回的具体工具。arguments 必须符合该工具的参数定义；宿主仍逐项检查实际工具权限。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
        required: ["name", "arguments"],
        additionalProperties: false,
      },
      execute: async (args: any) => {
        const target = tools.find((t) => t.name === args?.name);
        if (
          !target ||
          (!direct.has(target.name) && !catalog.names().includes(target.name))
        )
          throw new Error("请先用 tool_search 查找这个工具及其参数定义");
        return target.execute(args.arguments ?? {});
      },
    },
  ] satisfies AgentTool[];
}
