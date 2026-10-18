import { describe, expect, it, vi } from "vitest";
import { guardExternalTools } from "../apps/server/src/external-tools";
import { serveExternalTools } from "../apps/server/src/external-mcp";
import type { AgentTool } from "../packages/agent/src/runner";

const tool = (
  name: string,
  effect: AgentTool["effect"],
  execute: AgentTool["execute"] = vi.fn(async (_args: unknown) => ({
    applied: true,
  })),
): AgentTool => ({
  name,
  effect,
  execute,
  description: name,
  parameters: { type: "object", properties: {}, additionalProperties: false },
});
describe("external runtime application controls", () => {
  it("waits for app approval for management, respects denial and always asks before publishing", async () => {
    const manage = tool("update_app_settings", "manage"),
      publish = tool("publish_video", "publish"),
      denied = tool("generate_image", "generate");
    const approve = vi.fn(async () => false);
    const guarded = guardExternalTools([manage, publish, denied], {
      permissions: { generate: "deny", publish: "allow" },
      signal: new AbortController().signal,
      approve,
    });
    await expect(guarded[0].execute({ name: "change" })).rejects.toThrow(
      /未允许/,
    );
    expect(manage.execute).not.toHaveBeenCalled();
    approve.mockResolvedValue(true);
    await guarded[0].execute({ name: "change" });
    expect(manage.execute).toHaveBeenCalledTimes(1);
    await guarded[1].execute({});
    expect(approve).toHaveBeenCalledTimes(3);
    await expect(guarded[2].execute({})).rejects.toThrow(/禁止/);
    expect(denied.execute).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledTimes(3);
  });
  it("allows a project switch only once per run and aborts before executing another action", async () => {
    const edit = tool("edit", "edit"),
      switchProject = tool(
        "open_project",
        "job",
        vi.fn(async () => ({ _finish: true })),
      );
    const guarded = guardExternalTools([switchProject, edit], {
      permissions: {},
      signal: new AbortController().signal,
      approve: async () => true,
    });
    const switched = guarded[0].execute({}),
      next = expect(guarded[1].execute({})).rejects.toThrow(/项目已切换/);
    await switched;
    await next;
    expect(edit.execute).not.toHaveBeenCalled();
    const abort = new AbortController();
    abort.abort();
    const cancelled = guardExternalTools([edit], {
      permissions: {},
      signal: abort.signal,
      approve: async () => true,
    });
    await expect(cancelled[0].execute({})).rejects.toThrow();
    expect(edit.execute).not.toHaveBeenCalled();
  });
  it("gives Claude a temporary, authenticated catalog for this run and preserves array results", async () => {
    const list = tool(
      "list_assets",
      "read",
      vi.fn(async () => [{ id: "a" }, { id: "b" }]),
    );
    const connection = await serveExternalTools(
      [list],
      new AbortController().signal,
    );
    const call = async (
      method: string,
      params = {},
      token = connection.token,
    ) => {
      const response = await fetch(connection.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return {
        status: response.status,
        body: response.status === 200 ? await response.json() : null,
      };
    };
    try {
      expect((await call("tools/list", {}, "wrong")).status).toBe(401);
      const catalog = await call("tools/list");
      expect(catalog.body.result.tools.map((t: any) => t.name)).toEqual([
        "list_assets",
      ]);
      const value = await call("tools/call", {
        name: "list_assets",
        arguments: {},
      });
      expect(JSON.parse(value.body.result.content[0].text)).toEqual([
        { id: "a" },
        { id: "b" },
      ]);
      const refused = await call("tools/call", {
        name: "shell",
        arguments: {},
      });
      expect(refused.body.result.isError).toBe(true);
    } finally {
      await connection.close();
    }
    await expect(fetch(connection.url)).rejects.toThrow();
  });
});
