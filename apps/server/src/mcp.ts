import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { FastifyInstance } from "fastify";
import type { Command } from "@tadacut/domain";
import type { AgentTool } from "../../../packages/agent/src/runner";
import type { AgentService } from "./agent";
import { Draft } from "./agent-tools/host";
import type { Repository } from "./storage";

/**
 * External agents edit through sessions. A manual session keeps its edits in
 * a draft the agent can read back, and committing turns them into one
 * proposal the user confirms in the studio; an auto session applies each
 * edit as its own undo step. Only reading and editing tools are offered:
 * generation, outside services and publishing stay in the studio, where the
 * user approves them.
 */
export interface EditSession {
  id: string;
  projectId: string;
  mode: "manual" | "auto";
  commands: Command[];
  labels: string[];
  readRevision?: number;
  status: "open" | "committed" | "discarded";
  proposalId?: string;
  createdAt: string;
  updatedAt: string;
}
const hidden = new Set(["ask_user", "skill_subagent", "propose_edit"]);
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export function mountMcp(
  app: FastifyInstance,
  repo: Repository,
  agent: AgentService,
) {
  const sessionTools = [
    {
      name: "list_projects",
      description: "列出 TadaCut 本地项目。",
      inputSchema: object({}),
    },
    {
      name: "begin_edit_session",
      description:
        "开始一个编辑会话。manual：修改先进入草稿，commit_edit_session 后交给用户在工作台确认；auto：每次修改直接应用并可撤销。返回 sessionId，之后的工具都需要它。",
      inputSchema: object(
        {
          projectId: { type: "string" },
          mode: { type: "string", enum: ["manual", "auto"] },
        },
        ["projectId"],
      ),
    },
    {
      name: "get_edit_session",
      description: "查看编辑会话的状态与已做的修改。",
      inputSchema: object({ sessionId: { type: "string" } }, ["sessionId"]),
    },
    {
      name: "review_edit_session",
      description: "列出会话草稿里的修改（按步骤与命令类型），提交前检查。",
      inputSchema: object({ sessionId: { type: "string" } }, ["sessionId"]),
    },
    {
      name: "commit_edit_session",
      description:
        "结束会话：manual 会话的草稿成为一个待用户确认的方案；auto 会话直接结束。",
      inputSchema: object({ sessionId: { type: "string" } }, ["sessionId"]),
    },
    {
      name: "discard_edit_session",
      description: "放弃会话和草稿里的修改。",
      inputSchema: object({ sessionId: { type: "string" } }, ["sessionId"]),
    },
    {
      name: "apply_commands",
      description:
        "在会话中提交任意编辑命令（clip.*、track.*、timeline.*、marker.*、story.*、transcript.*、styles.update、asset.* 等，严格使用 read_project 中的 ID）。",
      inputSchema: object(
        {
          sessionId: { type: "string" },
          label: { type: "string" },
          commands: {
            type: "array",
            items: {
              type: "object",
              properties: { type: { type: "string" } },
              required: ["type"],
              additionalProperties: true,
            },
          },
        },
        ["sessionId", "label", "commands"],
      ),
    },
  ];
  const session = (id: unknown) => {
    const found =
      typeof id === "string"
        ? repo.record<EditSession>("edit-session", id)
        : undefined;
    if (!found) throw new Error("编辑会话不存在，请先 begin_edit_session");
    if (found.status !== "open") throw new Error("编辑会话已结束");
    repo.get(found.projectId);
    return found;
  };
  const save = (s: EditSession) => {
    s.updatedAt = new Date().toISOString();
    repo.save("edit-session", s);
  };
  /** The catalog's read and edit tools, bound to a session's draft or to the live project. */
  const bound = (s: EditSession, signal: AbortSignal) => {
    const draft =
      s.mode === "manual"
        ? new Draft(() => repo.get(s.projectId), {
            commands: s.commands,
            labels: s.labels,
          })
        : undefined;
    const host = agent.host(
      s.projectId,
      signal,
      s.mode === "auto" ? "auto" : "session",
      draft,
    );
    if (s.readRevision !== undefined) host.markRead(s.readRevision);
    const edit = host.edit,
      markRead = host.markRead;
    host.markRead = (revision) => {
      markRead(revision);
      s.readRevision = revision;
      save(s);
    };
    host.edit = (label, commands) => {
      const result = edit(label, commands);
      if (draft) {
        s.commands = [...draft.commands];
        s.labels = [...draft.labels];
      } else {
        s.labels.push(label);
        if (typeof result.revision === "number")
          s.readRevision = result.revision;
      }
      save(s);
      return result;
    };
    return {
      host,
      tools: agent
        .tools(host, undefined)
        .filter(
          (t) =>
            (t.effect === "read" || t.effect === "edit") && !hidden.has(t.name),
        ),
    };
  };
  const schemaOf = (t: AgentTool) => ({
    ...t.parameters,
    properties: {
      ...(t.parameters as any).properties,
      sessionId: { type: "string" },
    },
    required: [...((t.parameters as any).required ?? []), "sessionId"],
  });
  const reply = (value: unknown) => {
    const images: string[] = [];
    if (value && typeof value === "object")
      for (const key of ["_image", "_images"] as const) {
        const v = (value as any)[key];
        if (v) {
          images.push(...(Array.isArray(v) ? v : [v]));
          delete (value as any)[key];
        }
      }
    return {
      content: [
        { type: "text", text: JSON.stringify(value) },
        ...images.map((data) => {
          const [, mimeType, base64] =
            /^data:([^;]+);base64,(.*)$/.exec(data) ?? [];
          return {
            type: "image",
            data: base64 ?? "",
            mimeType: mimeType ?? "image/jpeg",
          };
        }),
      ],
    };
  };
  app.post("/mcp", async (request, raw) => {
    const server = new Server(
      { name: "tadacut", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const controller = new AbortController();
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const first = repo.projects()[0];
      const catalog = first
        ? bound(
            {
              id: "listing",
              projectId: first.id,
              mode: "manual",
              commands: [],
              labels: [],
              status: "open",
              createdAt: "",
              updatedAt: "",
            },
            controller.signal,
          ).tools
        : [];
      return {
        tools: [
          ...sessionTools,
          ...catalog.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: schemaOf(t),
          })),
        ],
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      try {
        const args = { ...(params.arguments ?? {}) } as Record<string, any>;
        switch (params.name) {
          case "list_projects":
            return reply(
              repo
                .projects()
                .filter((p) => !p.trashedAt)
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  revision: p.revision,
                  archived: p.archived,
                })),
            );
          case "begin_edit_session": {
            const p = repo.get(String(args.projectId));
            const s: EditSession = {
              id: crypto.randomUUID(),
              projectId: p.id,
              mode: args.mode === "auto" ? "auto" : "manual",
              commands: [],
              labels: [],
              status: "open",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            save(s);
            return reply({
              sessionId: s.id,
              mode: s.mode,
              revision: p.revision,
            });
          }
          case "get_edit_session":
          case "review_edit_session": {
            const s = session(args.sessionId);
            const types: Record<string, number> = {};
            for (const c of s.commands)
              types[c.type] = (types[c.type] ?? 0) + 1;
            return reply({
              sessionId: s.id,
              projectId: s.projectId,
              mode: s.mode,
              steps: s.labels,
              ...(params.name === "review_edit_session"
                ? { commands: s.commands.length, byType: types }
                : {}),
            });
          }
          case "commit_edit_session": {
            const s = session(args.sessionId);
            let proposalId: string | undefined;
            if (s.mode === "manual" && s.commands.length) {
              const draft = new Draft(() => repo.get(s.projectId), {
                commands: s.commands,
                labels: s.labels,
              });
              proposalId = agent.proposal(
                s.projectId,
                `外部 Agent：${draft.label()}`,
                draft.commands,
                draft.baseRevision,
              ).id;
            }
            s.status = "committed";
            s.proposalId = proposalId;
            save(s);
            return reply({
              committed: true,
              ...(proposalId
                ? { proposalId, note: "方案已提交，等待用户在工作台确认" }
                : {}),
            });
          }
          case "discard_edit_session": {
            const s = session(args.sessionId);
            s.status = "discarded";
            save(s);
            return reply({ discarded: true });
          }
        }
        const s = session(args.sessionId);
        delete args.sessionId;
        const { host, tools } = bound(s, controller.signal);
        if (params.name === "apply_commands") {
          const { parseCommands } = await import("./agent-tools/host");
          return reply(
            host.edit(
              String(args.label ?? "外部 Agent 修改"),
              parseCommands(args.commands),
            ),
          );
        }
        const tool = tools.find((t) => t.name === params.name);
        if (!tool) throw new Error("工具不在开放目录中");
        return reply(await tool.execute(args));
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: e instanceof Error ? e.message : String(e) },
          ],
        };
      }
    });
    raw.hijack();
    await server.connect(transport);
    raw.raw.on("close", () => {
      controller.abort();
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request.raw, raw.raw, request.body);
  });
  app.get("/mcp", async (_request, reply) =>
    reply.code(405).send({ message: "此连接使用无状态 Streamable HTTP POST" }),
  );
}
