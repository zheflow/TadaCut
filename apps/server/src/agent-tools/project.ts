import { completeChat } from "@tadacut/providers";
import type { Command } from "@tadacut/domain";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { s, tool, type ToolHost } from "./host";

/** A preference that applies across projects. */
export interface GlobalMemory {
  id: string;
  text: string;
  tags: string[];
  source: "user" | "agent" | "learned";
  updatedAt: string;
}
/** A preference noticed in conversation, waiting for the user to keep or discard it. */
export interface MemoryCandidate {
  id: string;
  projectId: string;
  text: string;
  tags: string[];
  reason: string;
  createdAt: string;
}
export const globalMemories = (h: Pick<ToolHost, "repo">) =>
  h.repo.list<GlobalMemory>("memory");
export function projectTools(h: ToolHost): AgentTool[] {
  const g = "project",
    m = "memory";
  return [
    tool(
      g,
      "edit",
      "rename_project",
      "重命名项目。",
      s.object({ name: s.string() }, ["name"]),
      (a) => h.edit("重命名项目", [{ type: "project.rename", name: a.name }]),
    ),
    tool(
      g,
      "read",
      "list_versions",
      "列出项目保存过的版本快照。",
      s.object({}),
      () => h.repo.versions(h.projectId).slice(0, 40),
    ),
    tool(
      g,
      "job",
      "save_version",
      "保存当前项目为一个命名版本，之后可以恢复。",
      s.object({ name: s.string() }, ["name"]),
      (a) => {
        const v = h.repo.saveVersion(h.projectId, a.name);
        h.publish("versions", { projectId: h.projectId });
        return v;
      },
    ),
    tool(
      g,
      "edit",
      "restore_version",
      "把项目恢复到某个版本（恢复本身可以撤销）。仅自动模式可用；手动模式请让用户在“版本”面板操作。",
      s.object({ versionId: s.string() }, ["versionId"]),
      (a) => {
        if (h.mode !== "auto")
          throw new Error(
            "手动模式下不能直接恢复版本，请让用户在“版本”面板中恢复",
          );
        const p = h.repo.restoreVersion(
          h.projectId,
          a.versionId,
          h.project().revision,
        );
        h.publish("project", p);
        h.markRead(p.revision);
        return { restored: true, revision: p.revision };
      },
    ),
    tool(
      m,
      "read",
      "list_memories",
      "列出记忆：本项目的记忆与跨项目的长期偏好。",
      s.object({}),
      () => ({
        project: h.project().memories,
        global: globalMemories(h),
      }),
    ),
    tool(
      m,
      "edit",
      "remember",
      "记住用户明确表达的偏好或项目约定。scope=project 只用于本项目；global 用于今后所有项目（只记稳定偏好，如风格、字幕习惯、常用平台）。",
      s.object(
        {
          text: s.string(),
          tags: s.array(s.string()),
          scope: s.string(undefined, ["project", "global"]),
          id: s.string("更新已有记忆时填写"),
        },
        ["text"],
      ),
      (a) => {
        const now = h.now();
        if (a.scope === "global") {
          const memory: GlobalMemory = {
            id: a.id || h.makeId(),
            text: String(a.text).slice(0, 1000),
            tags: a.tags ?? [],
            source: "agent",
            updatedAt: now,
          };
          h.repo.save("memory", memory);
          h.publish("memories", globalMemories(h));
          return { memoryId: memory.id, scope: "global" };
        }
        const id = a.id || h.makeId();
        return {
          memoryId: id,
          ...h.edit("记住偏好", [
            {
              type: "memory.upsert",
              memory: { id, text: a.text, tags: a.tags ?? [], updatedAt: now },
            },
          ]),
        };
      },
    ),
    tool(
      m,
      "edit",
      "forget",
      "删除一条记忆。",
      s.object(
        {
          memoryId: s.string(),
          scope: s.string(undefined, ["project", "global"]),
        },
        ["memoryId"],
      ),
      (a) => {
        if (a.scope === "global") {
          h.repo.deleteRecord("memory", a.memoryId);
          h.publish("memories", globalMemories(h));
          return { removed: true };
        }
        return h.edit("删除记忆", [
          { type: "memory.remove", memoryId: a.memoryId },
        ]);
      },
    ),
    tool(
      m,
      "edit",
      "consolidate_memories",
      "整理记忆：合并重复、删除过时或互相矛盾的条目（以较新的为准）。",
      s.object({
        providerId: s.string(),
        scope: s.string(undefined, ["project", "global"]),
      }),
      async (a) => {
        const scope = a.scope ?? "project",
          items =
            scope === "global"
              ? globalMemories(h).map((x) => ({
                  id: x.id,
                  text: x.text,
                  tags: x.tags,
                  updatedAt: x.updatedAt,
                }))
              : h.project().memories;
        if (items.length < 2) return { note: "记忆太少，不需要整理" };
        let text = "";
        await completeChat(
          h.context(h.provider("chat", a.providerId)),
          "整理以下记忆条目：合并说的是同一件事的条目，删除被更新条目推翻的旧条目，保留原意，不新增内容。输出 JSON：{keep:[{text,tags}]}。",
          [{ role: "user", content: JSON.stringify(items) }],
          [],
          (d) => (text += d),
        );
        let keep: { text: string; tags?: string[] }[];
        try {
          keep = JSON.parse(
            text
              .trim()
              .replace(/^```(?:json)?\s*/, "")
              .replace(/\s*```$/, ""),
          ).keep;
          if (!Array.isArray(keep) || !keep.length) throw new Error();
        } catch {
          throw new Error("模型没有返回可用的整理结果");
        }
        const now = h.now();
        if (scope === "global") {
          for (const old of globalMemories(h))
            h.repo.deleteRecord("memory", old.id);
          for (const item of keep)
            h.repo.save("memory", {
              id: h.makeId(),
              text: String(item.text).slice(0, 1000),
              tags: item.tags ?? [],
              source: "agent",
              updatedAt: now,
            } satisfies GlobalMemory);
          h.publish("memories", globalMemories(h));
          return { before: items.length, after: keep.length };
        }
        const commands: Command[] = [
          ...items.map(
            (x): Command => ({ type: "memory.remove", memoryId: x.id }),
          ),
          ...keep.map(
            (item): Command => ({
              type: "memory.upsert",
              memory: {
                id: h.makeId(),
                text: String(item.text),
                tags: item.tags ?? [],
                updatedAt: now,
              },
            }),
          ),
        ];
        return {
          before: items.length,
          after: keep.length,
          ...h.edit("整理记忆", commands),
        };
      },
    ),
  ];
}
