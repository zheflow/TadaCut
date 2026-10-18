import Fastify from "fastify";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { projectSchema, validateProject } from "@tadacut/domain";
const hash = (v: string | Buffer) =>
  crypto.createHash("sha256").update(v).digest("hex");
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/);
export const teamBundleSchema = z
  .object({
    project: projectSchema,
    blobs: z.record(
      z.string(),
      z
        .object({
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          extension: z.string().regex(/^\.[a-z0-9]{1,8}$/),
        })
        .strict(),
    ),
  })
  .strict();
export type TeamBundle = z.infer<typeof teamBundleSchema>;
interface Member {
  id: string;
  name: string;
  role: "admin" | "member";
  tokenHash: string;
}
interface SharedProject {
  id: string;
  name: string;
  owner: string;
  members: Record<string, "editor" | "viewer">;
  version: number;
  updatedAt: string;
  bundle: TeamBundle;
}
interface CatalogItem {
  id: string;
  title: string;
  kind: "template" | "sticker" | "audio";
  description: string;
  tags: string[];
  license: string;
  author: string;
  createdAt: string;
  bundle: TeamBundle;
  assetId?: string;
}
interface Review {
  id: string;
  projectId: string;
  version: number;
  tokenHash: string;
  expiresAt: number;
  revoked: boolean;
  mediaHash?: string;
}
const fail = (code: number, message: string) =>
  Object.assign(new Error(message), { statusCode: code });
export async function createTeamServer(options: {
  dataDir: string;
  adminToken: string;
}) {
  if (options.adminToken.length < 24)
    throw new Error("TADACUT_TEAM_ADMIN_TOKEN 至少需要 24 个字符");
  const blobs = path.join(options.dataDir, "blobs");
  await fs.mkdir(blobs, { recursive: true });
  const db = new DatabaseSync(path.join(options.dataDir, "team.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));",
  );
  const read = <T>(kind: string, id: string): T | undefined => {
    const row = db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? JSON.parse(String(row.data)) : undefined;
  };
  const list = <T>(kind: string): T[] =>
    db
      .prepare("SELECT data FROM records WHERE kind=?")
      .all(kind)
      .map((r) => JSON.parse(String(r.data)));
  const put = <T extends { id: string }>(kind: string, value: T) =>
    db
      .prepare(
        "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, value.id, JSON.stringify(value));
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 512 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(
        error instanceof z.ZodError
          ? 400
          : ((error as { statusCode?: number }).statusCode ?? 500),
      )
      .send({ message: (error as Error).message }),
  );
  const member = (header?: string): Member => {
    const token = header?.replace(/^Bearer /, "");
    if (!token) throw fail(401, "需要团队访问凭据");
    const digest = hash(token);
    if (digest === hash(options.adminToken))
      return { id: "admin", name: "管理员", role: "admin", tokenHash: digest };
    const found = list<Member>("member").find((m) => m.tokenHash === digest);
    if (!found) throw fail(401, "团队访问凭据无效");
    return found;
  };
  const permission = (m: Member, id: string, edit = false) => {
    const p = read<SharedProject>("project", id);
    if (!p) throw fail(404, "远程项目不存在");
    if (
      m.role !== "admin" &&
      p.owner !== m.id &&
      (!p.members[m.id] || (edit && p.members[m.id] !== "editor"))
    )
      throw fail(403, "无权访问这个项目");
    return p;
  };
  const validBundle = async (input: unknown, m: Member) => {
    const bundle = teamBundleSchema.parse(input);
    validateProject(bundle.project);
    for (const a of bundle.project.assets) {
      if (a.originalPath) throw fail(400, "共享项目不能包含本机路径");
      if (["image", "video", "audio"].includes(a.kind) && !bundle.blobs[a.id])
        throw fail(400, "项目缺少媒体文件");
    }
    for (const blob of Object.values(bundle.blobs)) {
      if (
        !(await fs.stat(path.join(blobs, blob.hash)).then(
          () => true,
          () => false,
        ))
      )
        throw fail(400, "请先上传媒体文件");
      if (!canReadBlob(m, blob.hash)) throw fail(403, "无权引用这个媒体文件");
    }
    return bundle;
  };
  const projectPublic = (p: SharedProject) => ({
    id: p.id,
    name: p.name,
    owner: p.owner,
    members: p.members,
    version: p.version,
    updatedAt: p.updatedAt,
  });
  const canReadBlob = (m: Member, h: string) =>
    read<{ id: string; owners: string[] }>("blob", h)?.owners.includes(m.id) ||
    list<SharedProject>("project").some(
      (p) =>
        (m.role === "admin" || p.owner === m.id || p.members[m.id]) &&
        Object.values(p.bundle.blobs).some((b) => b.hash === h),
    ) ||
    list<CatalogItem>("catalog").some((c) =>
      Object.values(c.bundle.blobs).some((b) => b.hash === h),
    );
  app.get("/v1/me", (req) => {
    const { tokenHash: _, ...m } = member(req.headers.authorization);
    return m;
  });
  app.get("/v1/members", (req) => {
    member(req.headers.authorization);
    return [
      { id: "admin", name: "管理员", role: "admin" },
      ...list<Member>("member").map(({ tokenHash: _, ...m }) => m),
    ];
  });
  app.post("/v1/members", (req) => {
    const m = member(req.headers.authorization);
    if (m.role !== "admin") throw fail(403, "只有管理员可以创建成员");
    const input = z
        .object({
          name: z.string().min(1).max(100),
          role: z.enum(["member", "admin"]).default("member"),
        })
        .strict()
        .parse(req.body),
      token = crypto.randomBytes(32).toString("base64url"),
      user = { id: crypto.randomUUID(), ...input, tokenHash: hash(token) };
    put("member", user);
    return { id: user.id, name: user.name, role: user.role, token };
  });
  app.delete("/v1/members/:id", (req) => {
    if (member(req.headers.authorization).role !== "admin")
      throw fail(403, "只有管理员可移除成员");
    const { id } = req.params as { id: string };
    db.prepare("DELETE FROM records WHERE kind='member' AND id=?").run(id);
    return { removed: true };
  });
  app.post("/v1/blobs/:hash", async (req) => {
    const m = member(req.headers.authorization),
      h = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse((req.params as { hash: string }).hash);
    if (!Buffer.isBuffer(req.body) || hash(req.body) !== h)
      throw fail(400, "文件校验失败");
    const tmp = path.join(blobs, crypto.randomUUID() + ".tmp");
    await fs.writeFile(tmp, req.body);
    await fs.rename(tmp, path.join(blobs, h));
    const old = read<{ id: string; owners: string[] }>("blob", h);
    put("blob", {
      id: h,
      owners: [...new Set([...(old?.owners ?? []), m.id])],
    });
    return { hash: h, size: req.body.length };
  });
  app.get("/v1/blobs/:hash", async (req, reply) => {
    const m = member(req.headers.authorization),
      h = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse((req.params as { hash: string }).hash);
    if (!canReadBlob(m, h)) throw fail(403, "无权读取文件");
    return reply
      .type("application/octet-stream")
      .send(await fs.readFile(path.join(blobs, h)));
  });
  app.get("/v1/projects", (req) => {
    const m = member(req.headers.authorization);
    return list<SharedProject>("project")
      .filter((p) => m.role === "admin" || p.owner === m.id || p.members[m.id])
      .map(projectPublic);
  });
  app.get("/v1/projects/:id", (req) => {
    const m = member(req.headers.authorization),
      { id } = req.params as { id: string };
    return permission(m, id);
  });
  app.post("/v1/projects/:id/versions", async (req) => {
    const m = member(req.headers.authorization),
      id = idSchema.parse((req.params as { id: string }).id),
      input = z
        .object({
          expectedVersion: z.number().int().nonnegative(),
          bundle: teamBundleSchema,
        })
        .strict()
        .parse(req.body);
    const bundle = await validBundle(input.bundle, m);
    const old = read<SharedProject>("project", id);
    if (old) permission(m, id, true);
    if ((old?.version ?? 0) !== input.expectedVersion)
      throw fail(409, "远程版本已改变，请先拉取或另存为新项目");
    const p: SharedProject = {
      id,
      name: bundle.project.name,
      owner: old?.owner ?? m.id,
      members: old?.members ?? {},
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
      bundle,
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      const latest = read<SharedProject>("project", id);
      if ((latest?.version ?? 0) !== input.expectedVersion)
        throw fail(409, "远程版本冲突");
      put("project", p);
      put("version", { ...p, id: id + ":" + p.version });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return projectPublic(p);
  });
  app.get("/v1/projects/:id/versions", (req) => {
    const m = member(req.headers.authorization),
      { id } = req.params as { id: string };
    permission(m, id);
    return list<SharedProject>("version")
      .filter((v) => v.id.startsWith(id + ":"))
      .map(projectPublic)
      .sort((a, b) => b.version - a.version);
  });
  app.get("/v1/projects/:id/versions/:version", (req) => {
    const m = member(req.headers.authorization),
      { id, version } = req.params as { id: string; version: string };
    permission(m, id);
    const result = read<SharedProject>(
      "version",
      id + ":" + z.coerce.number().int().positive().parse(version),
    );
    if (!result) throw fail(404, "版本不存在");
    return result;
  });
  app.post("/v1/projects/:id/members", (req) => {
    const m = member(req.headers.authorization),
      { id } = req.params as { id: string },
      p = permission(m, id, true);
    if (m.role !== "admin" && p.owner !== m.id)
      throw fail(403, "只有项目所有者可修改成员权限");
    const input = z
      .object({
        memberId: z.string(),
        role: z.enum(["editor", "viewer", "remove"]),
      })
      .strict()
      .parse(req.body);
    if (input.memberId !== "admin" && !read("member", input.memberId))
      throw fail(404, "成员不存在");
    if (input.role === "remove") delete p.members[input.memberId];
    else p.members[input.memberId] = input.role;
    put("project", p);
    return projectPublic(p);
  });
  app.get("/v1/catalog", (req) => {
    member(req.headers.authorization);
    const q = z
      .object({
        q: z.string().max(200).default(""),
        kind: z.enum(["template", "sticker", "audio"]).optional(),
      })
      .parse(req.query);
    return list<CatalogItem>("catalog")
      .filter(
        (c) =>
          (!q.kind || c.kind === q.kind) &&
          `${c.title} ${c.tags.join(" ")} ${c.description}`
            .toLowerCase()
            .includes(q.q.toLowerCase()),
      )
      .map(({ bundle: _, ...c }) => c)
      .slice(0, 200);
  });
  app.get("/v1/catalog/:id", (req) => {
    member(req.headers.authorization);
    const item = read<CatalogItem>(
      "catalog",
      (req.params as { id: string }).id,
    );
    if (!item) throw fail(404, "素材条目不存在");
    return item;
  });
  app.post("/v1/catalog", async (req) => {
    const m = member(req.headers.authorization),
      input = z
        .object({
          title: z.string().min(1).max(150),
          kind: z.enum(["template", "sticker", "audio"]),
          description: z.string().max(3000).default(""),
          tags: z.array(z.string().max(50)).max(20).default([]),
          license: z.string().min(1).max(300),
          bundle: teamBundleSchema,
          assetId: z.string().optional(),
        })
        .strict()
        .parse(req.body);
    input.bundle = await validBundle(input.bundle, m);
    if (input.kind !== "template") {
      const a = input.bundle.project.assets.find((a) => a.id === input.assetId);
      if (
        !a ||
        (input.kind === "audio"
          ? a.kind !== "audio"
          : a.kind !== "image" && a.kind !== "motion")
      )
        throw fail(400, "素材类型与目录不符");
    }
    const item: CatalogItem = {
      ...input,
      id: crypto.randomUUID(),
      author: m.id,
      createdAt: new Date().toISOString(),
    };
    put("catalog", item);
    const { bundle: _, ...value } = item;
    return value;
  });
  app.delete("/v1/catalog/:id", (req) => {
    const m = member(req.headers.authorization),
      id = (req.params as { id: string }).id,
      item = read<CatalogItem>("catalog", id);
    if (!item || (item.author !== m.id && m.role !== "admin"))
      throw fail(403, "只有作者可移除条目");
    db.prepare("DELETE FROM records WHERE kind='catalog' AND id=?").run(id);
    return { removed: true };
  });
  app.get("/v1/projects/:id/comments", (req) => {
    const m = member(req.headers.authorization),
      id = (req.params as { id: string }).id;
    permission(m, id);
    return list<{ id: string; projectId: string }>("comment").filter(
      (c) => c.projectId === id,
    );
  });
  const commentSchema = z
    .object({
      text: z.string().min(1).max(4000),
      frame: z.number().int().nonnegative().optional(),
      timelineId: z.string().optional(),
      version: z.number().int().positive(),
    })
    .strict();
  app.post("/v1/projects/:id/comments", (req) => {
    const m = member(req.headers.authorization),
      id = (req.params as { id: string }).id;
    permission(m, id);
    const input = commentSchema.parse(req.body),
      comment = {
        ...input,
        id: crypto.randomUUID(),
        projectId: id,
        author: m.name,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
    put("comment", comment);
    return comment;
  });
  app.post("/v1/projects/:id/comments/:commentId/resolve", (req) => {
    const m = member(req.headers.authorization),
      { id, commentId } = req.params as { id: string; commentId: string };
    permission(m, id, true);
    const c = read<{ id: string; projectId: string; resolved: boolean }>(
      "comment",
      commentId,
    );
    if (!c || c.projectId !== id) throw fail(404, "评论不存在");
    c.resolved = z
      .object({ resolved: z.boolean() })
      .strict()
      .parse(req.body).resolved;
    put("comment", c);
    return c;
  });
  app.post("/v1/projects/:id/reviews", (req) => {
    const m = member(req.headers.authorization),
      id = (req.params as { id: string }).id,
      p = permission(m, id, true),
      input = z
        .object({
          days: z.number().int().min(1).max(90).default(7),
          mediaHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
    if (input.mediaHash && !canReadBlob(m, input.mediaHash))
      throw fail(403, "评审视频尚未上传");
    const token = crypto.randomBytes(32).toString("base64url"),
      r: Review = {
        id: crypto.randomUUID(),
        projectId: id,
        version: p.version,
        tokenHash: hash(token),
        expiresAt: Date.now() + input.days * 86400000,
        revoked: false,
        mediaHash: input.mediaHash,
      };
    put("review", r);
    return {
      id: r.id,
      path: `/review/${token}`,
      expiresAt: r.expiresAt,
      version: r.version,
    };
  });
  app.delete("/v1/projects/:id/reviews/:reviewId", (req) => {
    const m = member(req.headers.authorization),
      { id, reviewId } = req.params as { id: string; reviewId: string };
    permission(m, id, true);
    const r = read<Review>("review", reviewId);
    if (!r || r.projectId !== id) throw fail(404, "评审不存在");
    r.revoked = true;
    put("review", r);
    return { revoked: true };
  });
  const review = (token: string) => {
    const r = list<Review>("review").find((r) => r.tokenHash === hash(token));
    if (!r || r.revoked || r.expiresAt <= Date.now())
      throw fail(404, "评审链接已过期或撤销");
    return r;
  };
  app.get("/v1/review/:token", (req) => {
    const r = review((req.params as { token: string }).token),
      p = read<SharedProject>("version", r.projectId + ":" + r.version)!;
    return {
      name: p.name,
      version: r.version,
      timelines: p.bundle.project.timelines.map((t) => ({
        id: t.id,
        name: t.name,
        fps: t.fps,
      })),
      hasVideo: Boolean(r.mediaHash),
      comments: list<{ id: string; projectId: string; version: number }>(
        "comment",
      ).filter((c) => c.projectId === r.projectId && c.version === r.version),
    };
  });
  app.get("/v1/review/:token/video", async (req, reply) => {
    const r = review((req.params as { token: string }).token);
    if (!r.mediaHash) throw fail(404, "未附评审视频");
    return reply
      .type("video/mp4")
      .send(await fs.readFile(path.join(blobs, r.mediaHash)));
  });
  app.post("/v1/review/:token/comments", (req) => {
    const r = review((req.params as { token: string }).token),
      input = z
        .object({
          text: z.string().min(1).max(4000),
          name: z.string().min(1).max(80),
          frame: z.number().int().nonnegative().optional(),
          timelineId: z.string().optional(),
        })
        .strict()
        .parse(req.body);
    const c = {
      ...input,
      id: crypto.randomUUID(),
      author: input.name,
      projectId: r.projectId,
      version: r.version,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    put("comment", c);
    return c;
  });
  app.get("/review/:token", (req, reply) => {
    const token = (req.params as { token: string }).token;
    review(token);
    return reply
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; frame-ancestors 'none'",
      )
      .type("text/html; charset=utf-8")
      .send(reviewHtml(token));
  });
  app.addHook("onClose", async () => db.close());
  return { app };
}
function reviewHtml(token: string) {
  const base = "/v1/review/" + encodeURIComponent(token);
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TadaCut 评审</title><style>body{font:15px system-ui;background:#fff9fb;color:#402d35;max-width:960px;margin:40px auto;padding:24px}video{width:100%;background:#17151a;border-radius:14px}input,textarea,button,select{font:inherit;padding:12px;border:1px solid #ecd6df;border-radius:8px;margin:6px 0}textarea{display:block;width:95%}.comment{padding:16px;border-bottom:1px solid #ead5df}small{opacity:.65}</style><h1>TadaCut 评审</h1><p id="title"></p><video controls id="video"></video><p><select id="timeline"></select> <input id="name" placeholder="你的名字" maxlength="80"></p><textarea id="text" placeholder="留下画面意见" maxlength="4000"></textarea><button id="send">在当前时间添加评论</button><p id="message"></p><section id="comments"></section><script>
const base=${JSON.stringify(base)},video=document.querySelector('#video'),timelines=document.querySelector('#timeline');let data;
async function load(){const r=await fetch(base);if(!r.ok)throw Error('链接已失效');data=await r.json();document.querySelector('#title').textContent=data.name+' · 版本 '+data.version;video.hidden=!data.hasVideo;if(data.hasVideo&&!video.getAttribute('src'))video.src=base+'/video';if(!timelines.options.length)data.timelines.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;timelines.append(o)});document.querySelector('#comments').replaceChildren(...data.comments.map(c=>{const d=document.createElement('div');d.className='comment';d.textContent=c.author+' · '+(c.frame===undefined?'':c.frame+' 帧')+' '+c.text+(c.resolved?'（已解决）':'');return d}));}
document.querySelector('#send').onclick=async()=>{try{const name=document.querySelector('#name').value.trim(),text=document.querySelector('#text').value.trim();if(!name||!text)throw Error('请填写名字和意见');const t=data.timelines.find(t=>t.id===timelines.value);const r=await fetch(base+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,text,timelineId:t.id,frame:Math.round(video.currentTime*t.fps)})});if(!r.ok)throw Error((await r.json()).message);document.querySelector('#text').value='';await load()}catch(e){document.querySelector('#message').textContent=e.message}};load().catch(e=>document.querySelector('#message').textContent=e.message);
</script></html>`;
}
