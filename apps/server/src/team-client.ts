import { exportFile } from "./jobs-extended";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assetSchema,
  makeProject,
  validateProject,
  type Project,
} from "@tadacut/domain";
import {
  createTeamServer,
  teamBundleSchema,
  type TeamBundle,
} from "../../team/src/server";
import type { Repository } from "./storage";
import type { MediaService } from "./media";
import type { ExportRecord } from "./agent-tools/export";
const configSchema = z
  .object({
    name: z.string().max(100).default("团队空间"),
    baseUrl: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }),
  })
  .strict();
type Config = z.infer<typeof configSchema>;
interface TeamContext {
  repo: Repository;
  media: MediaService;
  dataDir: string;
  artifactsDir: string;
  publish(type: string, data: unknown): void;
}
export class TeamClient {
  constructor(private ctx: TeamContext) {}
  config() {
    return {
      ...this.ctx.repo.settings<Config | null>("team", null),
      hasKey: this.ctx.repo.vault.has("team:token"),
    };
  }
  private connection() {
    const config = this.ctx.repo.settings<Config | null>("team", null),
      token = this.ctx.repo.vault.get("team:token");
    if (!config || !token)
      throw new Error("请先连接团队服务或启动本机团队空间");
    return { config, token };
  }
  async response(route: string, method = "GET", body?: unknown, bytes = false) {
    const { config, token } = this.connection();
    const response = await fetch(config.baseUrl.replace(/\/$/, "") + route, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : {
              "Content-Type": bytes
                ? "application/octet-stream"
                : "application/json",
            }),
      },
      body:
        body === undefined
          ? undefined
          : bytes
            ? new Uint8Array(body as Uint8Array)
            : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) {
      let message = "团队服务请求失败";
      try {
        message = ((await response.json()) as { message: string }).message;
      } catch {}
      throw Object.assign(new Error(message), { statusCode: response.status });
    }
    return response;
  }
  async call(route: string, method = "GET", body?: unknown) {
    return (await this.response(route, method, body)).json() as Promise<any>;
  }
  async upload(file: string) {
    const bytes = await fs.readFile(file);
    if (bytes.length > 512 * 1024 * 1024)
      throw new Error("共享素材单文件限 512 MB");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    await this.response(`/v1/blobs/${hash}`, "POST", bytes, true);
    return hash;
  }
  async bundle(project: Project): Promise<TeamBundle> {
    const p = structuredClone(project),
      blobs: TeamBundle["blobs"] = {};
    for (const a of p.assets) {
      delete a.originalPath;
      delete a.proxy;
      delete a.thumbnail;
      if (["video", "audio", "image"].includes(a.kind)) {
        const source = this.ctx.media.file(a),
          hash = await this.upload(source),
          extension = this.ctx.media.extension(a.url);
        blobs[a.id] = { hash, extension };
        a.url = "blob:" + hash;
        a.hash = hash;
      }
    }
    return { project: p, blobs };
  }
  async download(raw: unknown): Promise<Project> {
    const bundle = teamBundleSchema.parse(raw),
      p = structuredClone(bundle.project);
    for (const a of p.assets) {
      delete a.originalPath;
      delete a.proxy;
      delete a.thumbnail;
      const b = bundle.blobs[a.id];
      if (["video", "audio", "image"].includes(a.kind) && !b)
        throw new Error("远程项目缺少媒体");
      if (!b) continue;
      const file = path.join(
        this.ctx.media.dir,
        `team-${b.hash}${b.extension}`,
      );
      let exists = await fs.readFile(file).then(
        (bytes) =>
          crypto.createHash("sha256").update(bytes).digest("hex") === b.hash,
        () => false,
      );
      if (!exists) {
        const response = await this.response(`/v1/blobs/${b.hash}`);
        if (Number(response.headers.get("content-length")) > 512 * 1024 * 1024)
          throw new Error("远程文件过大");
        const reader = response.body?.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 512 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("远程文件过大");
          }
          chunks.push(value);
        }
        const bytes = Buffer.concat(chunks);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== b.hash)
          throw new Error("远程媒体校验失败");
        await fs.writeFile(file, bytes);
      }
      a.url = "/media/" + path.basename(file);
      a.hash = b.hash;
    }
    p.id = crypto.randomUUID();
    p.revision = 0;
    p.updatedAt = p.createdAt = new Date().toISOString();
    delete p.trashedAt;
    return validateProject(p);
  }
}
export function registerTeamRoutes(app: FastifyInstance, ctx: TeamContext) {
  const { repo, publish } = ctx,
    client = new TeamClient(ctx);
  let host: Awaited<ReturnType<typeof createTeamServer>> | undefined;
  app.get("/api/team/config", () => ({
    ...client.config(),
    hosting: Boolean(host),
  }));
  app.post("/api/team/config", (req) => {
    const input = configSchema
        .extend({
          token: z.string().max(1000).optional(),
          clearToken: z.boolean().optional(),
        })
        .strict()
        .parse(req.body),
      before = repo.settings<Config | null>("team", null);
    if (
      before?.baseUrl !== input.baseUrl &&
      repo.vault.has("team:token") &&
      !input.token &&
      !input.clearToken
    )
      throw new Error("更换服务地址时请重新填写访问凭据");
    if (input.clearToken) repo.vault.set("team:token", "");
    if (input.token !== undefined) repo.vault.set("team:token", input.token);
    repo.saveSettings("team", { name: input.name, baseUrl: input.baseUrl });
    return client.config();
  });
  app.post("/api/team/host", async (req) => {
    const input = z
      .object({
        enabled: z.boolean(),
        port: z.number().int().min(1024).max(65535).default(4399),
        allowLan: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    if (host) {
      await host.app.close();
      host = undefined;
    }
    if (!input.enabled) return { hosting: false };
    let token = repo.vault.get("team:host-admin");
    if (!token) {
      token = crypto.randomBytes(32).toString("base64url");
      repo.vault.set("team:host-admin", token);
    }
    host = await createTeamServer({
      dataDir: path.join(ctx.dataDir, "team"),
      adminToken: token,
    });
    try {
      await host.app.listen({
        port: input.port,
        host: input.allowLan ? "0.0.0.0" : "127.0.0.1",
      });
    } catch (e) {
      await host.app.close();
      host = undefined;
      throw e;
    }
    repo.saveSettings("team", {
      name: "本机团队空间",
      baseUrl: `http://127.0.0.1:${input.port}`,
    });
    repo.vault.set("team:token", token);
    return { ...client.config(), hosting: true, allowLan: input.allowLan };
  });
  app.get("/api/team/me", () => client.call("/v1/me"));
  app.get("/api/team/members", () => client.call("/v1/members"));
  app.post("/api/team/members", async (req) => {
    const input = z
        .object({
          name: z.string().min(1).max(100),
          role: z.enum(["member", "admin"]).default("member"),
        })
        .strict()
        .parse(req.body),
      result = await client.call("/v1/members", "POST", input);
    repo.vault.set("team:invite:" + result.id, result.token);
    return {
      id: result.id,
      name: result.name,
      role: result.role,
      hasInvite: true,
    };
  });
  app.get("/api/team/invites/:id", (req) => {
    const id = z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id),
      token = repo.vault.get("team:invite:" + id);
    if (!token) throw new Error("此成员的邀请凭据不在本机");
    return { token };
  });
  app.delete("/api/team/members/:id", async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const value = await client.call(`/v1/members/${id}`, "DELETE");
    repo.vault.set("team:invite:" + id, "");
    return value;
  });
  app.get("/api/team/projects", () => client.call("/v1/projects"));
  app.post("/api/team/projects/push", async (req) => {
    const input = z
        .object({
          projectId: z.string(),
          remoteId: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,180}$/)
            .optional(),
          expectedRevision: z.number().int(),
          expectedVersion: z.number().int().nonnegative().default(0),
        })
        .strict()
        .parse(req.body),
      p = repo.get(input.projectId);
    if (p.revision !== input.expectedRevision)
      throw new Error("本地项目已改变，请刷新后共享");
    const remoteId = input.remoteId ?? crypto.randomUUID(),
      bundle = await client.bundle(p),
      result = await client.call(`/v1/projects/${remoteId}/versions`, "POST", {
        bundle,
        expectedVersion: input.expectedVersion,
      });
    repo.save("team-checkout", {
      id: p.id,
      remoteId,
      remoteVersion: result.version,
      localRevision: p.revision,
    });
    return result;
  });
  app.post("/api/team/projects/:id/pull", async (req) => {
    const id = z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,180}$/)
        .parse((req.params as { id: string }).id),
      input = z
        .object({ version: z.number().int().positive().optional() })
        .strict()
        .parse(req.body ?? {}),
      remote = await client.call(
        `/v1/projects/${id}${input.version ? `/versions/${input.version}` : ""}`,
      ),
      project = await client.download(remote.bundle);
    repo.put(project);
    repo.save("team-checkout", {
      id: project.id,
      remoteId: id,
      remoteVersion: remote.version,
      localRevision: 0,
    });
    publish("projects", repo.projects());
    return { project, remoteVersion: remote.version };
  });
  app.get("/api/team/projects/:id/versions", (req) =>
    client.call(
      `/v1/projects/${encodeURIComponent((req.params as { id: string }).id)}/versions`,
    ),
  );
  app.post("/api/team/projects/:id/members", (req) => {
    const input = z
      .object({
        memberId: z.string(),
        role: z.enum(["editor", "viewer", "remove"]),
      })
      .strict()
      .parse(req.body);
    return client.call(
      `/v1/projects/${encodeURIComponent((req.params as { id: string }).id)}/members`,
      "POST",
      input,
    );
  });
  app.get("/api/team/projects/:id/comments", (req) =>
    client.call(
      `/v1/projects/${encodeURIComponent((req.params as { id: string }).id)}/comments`,
    ),
  );
  app.post("/api/team/projects/:id/comments", (req) => {
    const input = z
      .object({
        text: z.string().min(1).max(4000),
        frame: z.number().int().nonnegative().optional(),
        timelineId: z.string().optional(),
        version: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    return client.call(
      `/v1/projects/${encodeURIComponent((req.params as { id: string }).id)}/comments`,
      "POST",
      input,
    );
  });
  app.post("/api/team/projects/:id/comments/:commentId/resolve", (req) => {
    const { id, commentId } = req.params as { id: string; commentId: string },
      input = z.object({ resolved: z.boolean() }).strict().parse(req.body);
    return client.call(
      `/v1/projects/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/resolve`,
      "POST",
      input,
    );
  });
  app.post("/api/team/projects/:id/reviews", async (req) => {
    const id = (req.params as { id: string }).id,
      input = z
        .object({
          days: z.number().int().min(1).max(90).default(7),
          exportId: z.string().optional(),
          localProjectId: z.string(),
        })
        .strict()
        .parse(req.body);
    let mediaHash: string | undefined;
    if (input.exportId) {
      const e = repo.record<ExportRecord>("export", input.exportId);
      if (
        !e ||
        e.projectId !== input.localProjectId ||
        !e.filename.endsWith(".mp4")
      )
        throw new Error("请选择本项目的 MP4 导出");
      mediaHash = await client.upload(exportFile(ctx.artifactsDir, e));
    }
    const result = await client.call(
      `/v1/projects/${encodeURIComponent(id)}/reviews`,
      "POST",
      { days: input.days, ...(mediaHash ? { mediaHash } : {}) },
    );
    const url = client.config().baseUrl!.replace(/\/$/, "") + result.path;
    repo.save("team-review", {
      ...result,
      id: result.id,
      projectId: input.localProjectId,
      remoteId: id,
      url,
    });
    return { ...result, url };
  });
  app.delete("/api/team/projects/:id/reviews/:reviewId", async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const result = await client.call(
      `/v1/projects/${encodeURIComponent(id)}/reviews/${encodeURIComponent(reviewId)}`,
      "DELETE",
    );
    repo.deleteRecord("team-review", reviewId);
    return result;
  });
  app.get("/api/team/reviews", () => repo.list("team-review"));
  app.get("/api/team/checkouts", () => repo.list("team-checkout"));
  app.get("/api/team/catalog", (req) => {
    const input = z
      .object({
        q: z.string().max(200).default(""),
        kind: z.enum(["template", "sticker", "audio"]).optional(),
      })
      .parse(req.query);
    return client.call(
      `/v1/catalog?q=${encodeURIComponent(input.q)}${input.kind ? `&kind=${input.kind}` : ""}`,
    );
  });
  app.post("/api/team/catalog", async (req) => {
    const input = z
      .object({
        projectId: z.string(),
        expectedRevision: z.number().int(),
        title: z.string().min(1).max(150),
        kind: z.enum(["template", "sticker", "audio"]),
        description: z.string().max(3000).default(""),
        tags: z.array(z.string().max(50)).max(20).default([]),
        license: z.string().min(1).max(300),
        assetId: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    const p = repo.get(input.projectId);
    if (p.revision !== input.expectedRevision)
      throw new Error("项目版本已改变");
    let source = p;
    if (input.kind !== "template") {
      const a = p.assets.find((a) => a.id === input.assetId);
      if (!a) throw new Error("素材不存在");
      source = makeProject(
        crypto.randomUUID(),
        input.title,
        new Date().toISOString(),
      );
      source.assets = [a];
    }
    const bundle = await client.bundle(source);
    const { projectId: _, expectedRevision: __, ...metadata } = input;
    return client.call("/v1/catalog", "POST", { ...metadata, bundle });
  });
  app.delete("/api/team/catalog/:id", (req) =>
    client.call(
      `/v1/catalog/${encodeURIComponent((req.params as { id: string }).id)}`,
      "DELETE",
    ),
  );
  app.post("/api/team/catalog/:id/import", async (req) => {
    const input = z
        .object({
          projectId: z.string(),
          expectedRevision: z.number().int(),
          prepare: z.boolean().default(false),
        })
        .strict()
        .parse(req.body),
      item = await client.call(
        `/v1/catalog/${encodeURIComponent((req.params as { id: string }).id)}`,
      ),
      downloaded = await client.download(item.bundle);
    if (item.kind === "template") {
      repo.put(downloaded);
      publish("projects", repo.projects());
      return { project: downloaded, created: true };
    }
    const original = downloaded.assets.find((a) => a.id === item.assetId);
    if (!original) throw new Error("目录素材不存在");
    const asset = assetSchema.parse({
        ...original,
        id: crypto.randomUUID(),
        source: {
          kind: "stock",
          name: client.config().name ?? "团队素材库",
          license: item.license,
          author: item.author,
        },
      }),
      commands = [{ type: "asset.add" as const, asset }];
    if (input.prepare) return { commands, asset };
    const result = repo.commit(input.projectId, {
      requestId: crypto.randomUUID(),
      expectedRevision: input.expectedRevision,
      label: "导入共享素材",
      commands,
    });
    publish("project", result.project);
    return { project: result.project, asset };
  });
  app.addHook("onClose", async () => {
    if (host) await host.app.close();
  });
}
