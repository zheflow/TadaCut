import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activeTimeline, assetSchema, clipSchema } from "@tadacut/domain";
import { Repository, Vault, type Cipher } from "../apps/server/src/storage";
import { readProjectView, VIEW_LIMIT } from "../apps/server/src/project-view";
import { toolResultText } from "../packages/agent/src/runner";
describe("project storage and model views", () => {
  let dir: string, repo: Repository;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-store-"));
    repo = new Repository(dir, new Vault(dir));
  });
  afterEach(async () => {
    repo.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const rename = (id: string, revision: number, name: string) =>
    repo.commit(id, {
      requestId: `rename-${revision}`,
      expectedRevision: revision,
      label: "Rename",
      commands: [{ type: "project.rename", name }],
    }).project;
  it("keeps a bounded, compressed undo history that still restores edits", () => {
    const p = repo.create("History");
    let revision = p.revision;
    for (let i = 0; i < 205; i++)
      revision = rename(p.id, revision, `Name ${i}`).revision;
    const rows = repo.db
      .prepare(
        "SELECT before_state FROM history WHERE project_id=? ORDER BY id DESC",
      )
      .all(p.id);
    expect(rows).toHaveLength(200);
    expect(rows[0].before_state).toBeInstanceOf(Uint8Array);
    const undone = repo.travel(p.id, revision, "undo");
    expect(undone.name).toBe("Name 203");
    expect(repo.travel(p.id, undone.revision, "redo").name).toBe("Name 204");
  });
  it("still restores history rows written as plain JSON", () => {
    const p = repo.create("Legacy"),
      next = rename(p.id, p.revision, "After");
    repo.db
      .prepare("UPDATE history SET before_state=? WHERE project_id=?")
      .run(JSON.stringify(p), p.id);
    expect(repo.travel(p.id, next.revision, "undo").name).toBe("Legacy");
  });
  it("pages a large project instead of cutting the document", () => {
    const p = repo.create("Large"),
      t = activeTimeline(p);
    p.assets.push(
      assetSchema.parse({
        id: "img",
        name: "Still.png",
        kind: "image",
        url: "/media/still.png",
        description: "x".repeat(2000),
        waveform: Array.from({ length: 1000 }, () => 0.5),
        createdAt: p.createdAt,
      }),
    );
    for (let i = 0; i < 900; i++)
      t.clips.push(
        clipSchema.parse({
          id: `clip-${i}`,
          assetId: "img",
          trackId: t.tracks[0].id,
          start: i * 10,
          duration: 10,
          name: `Clip ${i}`,
        }),
      );
    const overview = readProjectView(p) as any;
    expect(JSON.stringify(overview).length).toBeLessThanOrEqual(VIEW_LIMIT);
    expect(overview.timeline.clipCount).toBe(900);
    expect(overview.note).toContain("分页");
    expect(overview.assets[0].waveform).toBeUndefined();
    let offset: number | undefined = 0,
      seen = 0;
    while (offset !== undefined) {
      const view = readProjectView(p, { section: "timeline", offset }) as any;
      expect(JSON.stringify(view).length).toBeLessThanOrEqual(VIEW_LIMIT);
      seen += view.timeline.clips.items.length;
      offset = view.timeline.clips.nextOffset;
    }
    expect(seen).toBe(900);
    // Defaults are left out of each clip.
    const first = (readProjectView(p, { section: "timeline", limit: 1 }) as any)
      .timeline.clips.items[0];
    expect(Object.keys(first).sort()).toEqual(
      ["assetId", "duration", "id", "name", "start", "trackId"].sort(),
    );
  });
  // Behaves like Electron safeStorage, which refuses data it did not seal.
  const keychain: Cipher = {
    encrypt: (value) => Buffer.from("v10" + value).toString("base64"),
    decrypt: (value) => {
      const text = Buffer.from(value, "base64").toString();
      if (!text.startsWith("v10"))
        throw new Error("Ciphertext does not appear to be encrypted.");
      return text.slice(3);
    },
  };
  const vaultFile = async () =>
    JSON.parse(await fs.readFile(path.join(dir, "vault.json"), "utf8"));
  it("opens secrets after keychain access changes between launches", async () => {
    new Vault(dir).set("mcp", "token-from-key-file");
    // The keychain becomes available on the next launch.
    const withKeychain = new Vault(dir, keychain);
    expect(withKeychain.get("mcp")).toBe("token-from-key-file");
    withKeychain.set("provider:cloud", "key-from-keychain");
    expect(await vaultFile()).toMatchObject({
      mcp: expect.stringMatching(/^file:/),
      "provider:cloud": expect.stringMatching(/^os:/),
    });
    // And is denied on the one after.
    const denied = new Vault(dir);
    expect(denied.get("mcp")).toBe("token-from-key-file");
    expect(denied.read("provider:cloud")).toBeUndefined();
    expect(denied.get("provider:cloud")).toBe("");
  });
  it("still opens vault entries written before they were labeled", async () => {
    new Vault(dir).set("a", "sealed-by-file");
    new Vault(dir, keychain).set("b", "sealed-by-keychain");
    const entries = await vaultFile();
    await fs.writeFile(
      path.join(dir, "vault.json"),
      JSON.stringify({
        a: entries.a.replace(/^file:/, ""),
        b: entries.b.replace(/^os:/, ""),
      }),
    );
    const vault = new Vault(dir, keychain);
    expect([vault.get("a"), vault.get("b")]).toEqual([
      "sealed-by-file",
      "sealed-by-keychain",
    ]);
  });
  it("marks an oversized tool result as truncated", () => {
    const text = toolResultText({ data: "y".repeat(50000) });
    expect(text.length).toBeLessThanOrEqual(40000);
    expect(JSON.parse(text)).toMatchObject({ truncated: true });
  });
});
