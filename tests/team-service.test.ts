import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { makeProject } from "@tadacut/domain";
import { createTeamServer } from "../apps/team/src/server";
describe("team service contracts", () => {
  let dir: string, server: Awaited<ReturnType<typeof createTeamServer>>;
  const admin = "test-admin-token-01234567890123456789";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-team-"));
    server = await createTeamServer({ dataDir: dir, adminToken: admin });
  });
  afterEach(async () => {
    await server.app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const call = (
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
    token = admin,
  ) =>
    server.app.inject({
      method,
      url,
      payload: payload as any,
      headers: { authorization: `Bearer ${token}` },
    });
  const bundle = () => ({
    project: makeProject("local", "Shared story", "2026-10-18T00:00:00Z"),
    blobs: {},
  });
  it("enforces member scopes and optimistic version control", async () => {
    const user = (
      await call("POST", "/v1/members", { name: "Reviewer" })
    ).json();
    expect(user.token).toBeTruthy();
    expect(
      (
        await call("POST", "/v1/projects/project/versions", {
          bundle: bundle(),
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("GET", "/v1/projects/project", undefined, user.token))
        .statusCode,
    ).toBe(403);
    await call("POST", "/v1/projects/project/members", {
      memberId: user.id,
      role: "viewer",
    });
    expect(
      (await call("GET", "/v1/projects/project", undefined, user.token))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          "POST",
          "/v1/projects/project/versions",
          { bundle: bundle(), expectedVersion: 1 },
          user.token,
        )
      ).statusCode,
    ).toBe(403);
    await call("POST", "/v1/projects/project/members", {
      memberId: user.id,
      role: "editor",
    });
    expect(
      (
        await call(
          "POST",
          "/v1/projects/project/versions",
          { bundle: bundle(), expectedVersion: 1 },
          user.token,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          "POST",
          "/v1/projects/project/versions",
          { bundle: bundle(), expectedVersion: 1 },
          user.token,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          "GET",
          "/v1/projects/project/versions",
          undefined,
          user.token,
        )
      ).json(),
    ).toHaveLength(2);
    await call("DELETE", `/v1/members/${user.id}`);
    expect(
      (await call("GET", "/v1/projects", undefined, user.token)).statusCode,
    ).toBe(401);
  });
  it("pins reviews to a version, records timecoded comments and revokes links", async () => {
    await call("POST", "/v1/projects/project/versions", {
      bundle: bundle(),
      expectedVersion: 0,
    });
    const share = (
        await call("POST", "/v1/projects/project/reviews", { days: 1 })
      ).json(),
      token = share.path.split("/").at(-1);
    await call("POST", "/v1/projects/project/versions", {
      bundle: bundle(),
      expectedVersion: 1,
    });
    const view = (await call("GET", `/v1/review/${token}`)).json();
    expect(view.version).toBe(1);
    const comment = await call("POST", `/v1/review/${token}/comments`, {
      name: "Guest",
      text: "Adjust this cut",
      frame: 42,
    });
    expect(comment.statusCode).toBe(200);
    expect(comment.json()).toMatchObject({ frame: 42, version: 1 });
    expect((await call("GET", share.path)).body).toContain("TadaCut 评审");
    await call("DELETE", `/v1/projects/project/reviews/${share.id}`);
    expect((await call("GET", `/v1/review/${token}`)).statusCode).toBe(404);
  });
  it("publishes and searches real catalog entries without synthetic defaults", async () => {
    expect((await call("GET", "/v1/catalog")).json()).toEqual([]);
    const result = await call("POST", "/v1/catalog", {
      title: "Sakura intro",
      kind: "template",
      license: "CC0",
      tags: ["intro"],
      bundle: bundle(),
    });
    expect(result.statusCode).toBe(200);
    expect(
      (await call("GET", "/v1/catalog?q=sakura&kind=template")).json(),
    ).toHaveLength(1);
    expect(
      (await call("GET", `/v1/catalog/${result.json().id}`)).json().bundle
        .project.name,
    ).toBe("Shared story");
  });
  it("checks uploaded content hashes and does not grant access merely from knowing a blob hash", async () => {
    const bytes = Buffer.from("private fixture"),
      hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const put = await server.app.inject({
      method: "POST",
      url: `/v1/blobs/${hash}`,
      payload: bytes,
      headers: {
        authorization: `Bearer ${admin}`,
        "content-type": "application/octet-stream",
      },
    });
    expect(put.statusCode).toBe(200);
    const user = (
      await call("POST", "/v1/members", { name: "Outsider" })
    ).json();
    expect(
      (await call("GET", `/v1/blobs/${hash}`, undefined, user.token))
        .statusCode,
    ).toBe(403);
    const malicious = {
      ...bundle(),
      blobs: { stolen: { hash, extension: ".bin" } },
    };
    expect(
      (
        await call(
          "POST",
          "/v1/projects/steal/versions",
          { bundle: malicious, expectedVersion: 0 },
          user.token,
        )
      ).statusCode,
    ).toBe(403);
  });
});
