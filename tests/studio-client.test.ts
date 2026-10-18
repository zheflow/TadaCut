import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";

describe("studio HTTP client", () => {
  let server: Awaited<ReturnType<typeof createStudioServer>>, dir: string;
  let client: typeof import("../apps/studio/src/lib/api");
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-client-"));
    server = await createStudioServer({
      root: process.cwd(),
      dataDir: dir,
      port: 0,
    });
    const origin = await server.listen(),
      nativeFetch = globalThis.fetch;
    let cookie = "";
    // Supply the browser's relative URL and cookie handling; requests still go
    // through the real client, HTTP parser, session checks, routes and storage.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (cookie) headers.set("cookie", cookie);
      const response = await nativeFetch(new URL(url, origin), {
        ...init,
        headers,
      });
      const session = response.headers.getSetCookie()[0];
      if (session) cookie = session.split(";")[0];
      return response;
    });
    vi.resetModules();
    client = await import("../apps/studio/src/lib/api");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("installs and removes an extension with the same requests as the UI", async () => {
    const pack = {
      format: "tadacut-plugin@1",
      id: "client-fixture",
      name: "Client fixture",
      version: "1.0.0",
      contents: {
        captionStyles: [
          { id: "gold", name: "Gold", textStyle: { color: "#ffd400" } },
        ],
      },
    };
    const body = new FormData();
    body.append(
      "file",
      new Blob([JSON.stringify(pack)], { type: "application/json" }),
      "pack.json",
    );
    await client.request("/api/plugins/install", { method: "POST", body });
    expect(await client.request("/api/plugins")).toHaveLength(1);
    await expect(
      client.request("/api/plugins/client-fixture", { method: "DELETE" }),
    ).resolves.toEqual({ removed: true });
    expect(await client.request("/api/plugins")).toEqual([]);
  });
  it("still sends JSON bodies when creating a memory, then removes it", async () => {
    const memory = await client.post<{ id: string; text: string }>(
      "/api/memories",
      { text: "默认竖屏", tags: ["画幅"] },
    );
    expect(memory.text).toBe("默认竖屏");
    await client.request(`/api/memories/${memory.id}`, { method: "DELETE" });
    expect(await client.request("/api/memories")).toEqual([]);
  });
});
