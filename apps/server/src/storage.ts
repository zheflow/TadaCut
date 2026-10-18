import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  applyTransaction,
  DomainError,
  makeProject,
  validateProject,
  type Project,
  type Transaction,
} from "@tadacut/domain";
import {
  providerSchema,
  type Provider,
  type PublicProvider,
} from "@tadacut/providers";

export interface Cipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
const fileCipher = (key: Buffer): Cipher => ({
  encrypt: (value) => {
    const iv = crypto.randomBytes(12),
      enc = crypto.createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([enc.update(value, "utf8"), enc.final()]);
    return Buffer.concat([iv, enc.getAuthTag(), bytes]).toString("base64");
  },
  decrypt: (value) => {
    const bytes = Buffer.from(value, "base64"),
      dec = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    dec.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      dec.update(bytes.subarray(28)),
      dec.final(),
    ]).toString("utf8");
  },
});
/**
 * Secrets sealed by the OS keychain when the host provides it, otherwise by a
 * key file beside the vault. Keychain access can change between launches (a
 * denied prompt, a locked keychain, a re-signed build), so each entry records
 * what sealed it, and one that cannot be opened counts as missing instead of
 * stopping the app.
 */
export class Vault {
  private file: string;
  private keyFile: string;
  private entries: Record<string, string>;
  private local?: Cipher;
  /** Entries that failed to open on this launch. */
  private unreadable = new Set<string>();
  constructor(
    dir: string,
    private system?: Cipher,
  ) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, "vault.json");
    this.keyFile = path.join(dir, "vault.key");
    this.entries = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : {};
  }
  /** The key file is only created when something has to be sealed with it. */
  private fileCipher(create: boolean) {
    if (!this.local && (create || fs.existsSync(this.keyFile))) {
      if (!fs.existsSync(this.keyFile))
        fs.writeFileSync(this.keyFile, crypto.randomBytes(32), {
          mode: 0o600,
          flag: "wx",
        });
      this.local = fileCipher(fs.readFileSync(this.keyFile));
    }
    return this.local;
  }
  private seal(value: string) {
    if (this.system)
      try {
        return "os:" + this.system.encrypt(value);
      } catch {}
    return "file:" + this.fileCipher(true)!.encrypt(value);
  }
  private open(sealed: string) {
    const at = sealed.indexOf(":"),
      scheme = sealed.slice(0, Math.max(0, at)),
      body = sealed.slice(at + 1);
    const ciphers =
      scheme === "os"
        ? [this.system]
        : scheme === "file"
          ? [this.fileCipher(false)]
          : // Entries written before they were labeled.
            [this.system, this.fileCipher(false)];
    for (const cipher of ciphers)
      if (cipher)
        try {
          return cipher.decrypt(body);
        } catch {}
    return undefined;
  }
  get(key: string) {
    return this.read(key) ?? "";
  }
  /** The stored value, "" when there is none, or undefined when it exists but cannot be opened now. */
  read(key: string) {
    if (!this.entries[key]) return "";
    const value = this.open(this.entries[key]);
    if (value === undefined) this.unreadable.add(key);
    else this.unreadable.delete(key);
    return value;
  }
  /** Whether something is stored, without opening it; opening may ask the keychain. */
  has(key: string) {
    return Boolean(this.entries[key]) && !this.unreadable.has(key);
  }
  /** True once the entry has failed to open on this launch. */
  failed(key: string) {
    return this.unreadable.has(key);
  }
  set(key: string, value: string) {
    this.unreadable.delete(key);
    if (value) this.entries[key] = this.seal(value);
    else delete this.entries[key];
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.entries), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
          .join(",") +
        "}"
      : JSON.stringify(value);
/** Undo snapshots are stored deflated; rows written before compression are plain JSON text. */
const pack = (p: Project) => zlib.deflateRawSync(JSON.stringify(p));
const unpack = (value: unknown) =>
  JSON.parse(
    typeof value === "string"
      ? value
      : zlib.inflateRawSync(value as Uint8Array).toString("utf8"),
  );
/** Undo depth per project, and how many request IDs stay known for replay checks. */
const HISTORY_LIMIT = 200,
  REQUEST_LIMIT = 1000;
export interface Proposal {
  id: string;
  projectId: string;
  expectedRevision: number;
  label: string;
  commands: Transaction["commands"];
  status: "pending" | "applied" | "rejected";
  createdAt: string;
}
export interface Job {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  progress: number;
  /** The step a running job reports; the label keeps naming the task. */
  stage?: string;
  input: Record<string, any>;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
  eventVersion?: number;
}
/** A tool the agent ran, as the conversation shows it. */
export interface AgentStep {
  id: string;
  tool: string;
  group?: string;
  status: "running" | "done" | "error" | "denied" | "waiting";
  summary?: string;
}
export interface Message {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  text: string;
  providerId?: string;
  proposalIds?: string[];
  createdAt: string;
  usage?: { input: number | null; output: number | null; reported?: boolean };
  agentContext?: {
    backend: string;
    catalogTools: number;
    offeredTools: number;
    estimatedInputTokens: number;
    compactions: number;
    skills: string[];
    memoryCount: number;
  };
  mode?: "manual" | "auto" | "ask";
  steps?: AgentStep[];
  /** A tool call waiting for the user's approval. */
  approval?: {
    callId: string;
    tool: string;
    effect: string;
    summary: string;
    status: "pending" | "approved" | "denied";
  };
  /** The run stopped before finishing and can be continued. */
  resumable?: boolean;
  /** Why the run failed, as the model service or runtime explained it. */
  error?: string;
  /** A passing state while the run is going, such as a runtime retrying. */
  notice?: string;
}
export interface ProjectVersion {
  id: string;
  projectId: string;
  name: string;
  revision: number;
  createdAt: string;
  size: number;
}
export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  /** Tools the skill may use (SKILL.md allowed-tools); empty means the usual set. */
  tools: string[];
  enabled: boolean;
  builtin?: boolean;
  script?: string;
  /** Support files the agent reads on demand. */
  files?: { path: string; content: string }[];
  /** fork runs the skill as a separate sub-agent. */
  context?: "inline" | "fork";
  /** Slash command name, as in /name. */
  command?: string;
  source?: string;
}
export class Repository {
  readonly db: DatabaseSync;
  constructor(
    public readonly dir: string,
    public readonly vault: Vault,
  ) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dir, "studio.sqlite3"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL, label TEXT NOT NULL, applied INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(project_id TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(project_id,request_id));
      CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, size INTEGER NOT NULL, state BLOB NOT NULL);
    `);
    for (const job of this.list<Job>("job"))
      if (job.status === "running" || job.status === "queued")
        this.save("job", {
          ...job,
          status: "interrupted",
          error: "应用已重启。可以手动重新提交此任务。",
          updatedAt: new Date().toISOString(),
        });
  }
  projects(): Project[] {
    return this.db
      .prepare("SELECT state FROM projects")
      .all()
      .map((row) => validateProject(JSON.parse(String(row.state))));
  }
  get(id: string): Project {
    const row = this.db
      .prepare("SELECT state FROM projects WHERE id=?")
      .get(id);
    if (!row) throw new DomainError("PROJECT_NOT_FOUND", "项目不存在");
    return validateProject(JSON.parse(String(row.state)));
  }
  create(name: string) {
    const p = makeProject(crypto.randomUUID(), name, new Date().toISOString());
    this.put(p);
    return p;
  }
  put(p: Project) {
    validateProject(p);
    this.db
      .prepare(
        "INSERT INTO projects(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      )
      .run(p.id, JSON.stringify(p));
  }
  commit(projectId: string, input: Transaction) {
    const signature = crypto
      .createHash("sha256")
      .update(canonical(input))
      .digest("hex");
    const known = this.db
      .prepare("SELECT * FROM requests WHERE project_id=? AND request_id=?")
      .get(projectId, input.requestId);
    if (known) {
      if (known.signature !== signature)
        throw new DomainError("REQUEST_REUSE", "请求 ID 不能用于不同的编辑");
      return { project: this.get(projectId), replayed: true };
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.get(projectId),
        { project } = applyTransaction(before, input, new Date().toISOString());
      this.db
        .prepare("DELETE FROM history WHERE project_id=? AND applied=0")
        .run(projectId);
      this.db
        .prepare(
          "INSERT INTO history(project_id,before_state,after_state,label,applied) VALUES(?,?,?,?,1)",
        )
        .run(projectId, pack(before), pack(project), input.label);
      this.db
        .prepare(
          "DELETE FROM history WHERE project_id=? AND id NOT IN (SELECT id FROM history WHERE project_id=? ORDER BY id DESC LIMIT ?)",
        )
        .run(projectId, projectId, HISTORY_LIMIT);
      this.put(project);
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?)")
        .run(
          projectId,
          input.requestId,
          signature,
          JSON.stringify({ revision: project.revision }),
        );
      this.db
        .prepare(
          "DELETE FROM requests WHERE project_id=? AND rowid NOT IN (SELECT rowid FROM requests WHERE project_id=? ORDER BY rowid DESC LIMIT ?)",
        )
        .run(projectId, projectId, REQUEST_LIMIT);
      this.db.exec("COMMIT");
      return { project, replayed: false };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  /** A named snapshot of the project, kept apart from undo history. */
  saveVersion(projectId: string, name: string): ProjectVersion {
    const p = this.get(projectId),
      state = pack(p),
      version: ProjectVersion = {
        id: crypto.randomUUID(),
        projectId,
        name: name.slice(0, 120) || `版本 ${p.revision}`,
        revision: p.revision,
        createdAt: new Date().toISOString(),
        size: state.length,
      };
    this.db
      .prepare("INSERT INTO versions VALUES(?,?,?,?,?,?,?)")
      .run(
        version.id,
        projectId,
        version.name,
        version.revision,
        version.createdAt,
        version.size,
        state,
      );
    // Older automatic snapshots go first once a project has many.
    this.db
      .prepare(
        "DELETE FROM versions WHERE project_id=? AND id NOT IN (SELECT id FROM versions WHERE project_id=? ORDER BY created_at DESC LIMIT 60)",
      )
      .run(projectId, projectId);
    return version;
  }
  versions(projectId: string): ProjectVersion[] {
    return this.db
      .prepare(
        "SELECT id,project_id,name,revision,created_at,size FROM versions WHERE project_id=? ORDER BY created_at DESC",
      )
      .all(projectId)
      .map((r) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        name: String(r.name),
        revision: Number(r.revision),
        createdAt: String(r.created_at),
        size: Number(r.size),
      }));
  }
  versionState(projectId: string, versionId: string): Project {
    const row = this.db
      .prepare("SELECT state FROM versions WHERE id=? AND project_id=?")
      .get(versionId, projectId);
    if (!row) throw new DomainError("NOT_FOUND", "版本不存在");
    return validateProject(unpack(row.state));
  }
  deleteVersion(projectId: string, versionId: string) {
    this.db
      .prepare("DELETE FROM versions WHERE id=? AND project_id=?")
      .run(versionId, projectId);
  }
  /** Brings a version back as a new edit, so it can be undone like any other. */
  restoreVersion(
    projectId: string,
    versionId: string,
    expectedRevision: number,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(projectId);
      if (current.revision !== expectedRevision)
        throw new DomainError(
          "REVISION_CONFLICT",
          "项目已发生变化，请刷新后重试",
        );
      const restored = this.versionState(projectId, versionId),
        name = this.versions(projectId).find((v) => v.id === versionId)?.name;
      restored.revision = current.revision + 1;
      restored.updatedAt = new Date().toISOString();
      // The project keeps its identity, name and trash state.
      restored.id = current.id;
      restored.name = current.name;
      restored.trashedAt = current.trashedAt;
      this.db
        .prepare("DELETE FROM history WHERE project_id=? AND applied=0")
        .run(projectId);
      this.db
        .prepare(
          "INSERT INTO history(project_id,before_state,after_state,label,applied) VALUES(?,?,?,?,1)",
        )
        .run(
          projectId,
          pack(current),
          pack(restored),
          `恢复版本「${name ?? ""}」`,
        );
      this.put(restored);
      this.db.exec("COMMIT");
      return restored;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  /** A copy with its own ID and history; media files are shared. */
  duplicate(projectId: string, name?: string) {
    const source = this.get(projectId),
      now = new Date().toISOString(),
      copy: Project = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        name: (name || `${source.name} 副本`).slice(0, 200),
        revision: 0,
        createdAt: now,
        updatedAt: now,
        archived: false,
      };
    delete copy.trashedAt;
    this.put(copy);
    return copy;
  }
  /** Removes a project and everything recorded for it. */
  deleteProject(projectId: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of ["projects", "history", "requests", "versions"])
        this.db
          .prepare(
            `DELETE FROM ${table} WHERE ${table === "projects" ? "id" : "project_id"}=?`,
          )
          .run(projectId);
      for (const kind of [
        "message",
        "proposal",
        "job",
        "agent-thread",
        "edit-session",
        "export",
      ])
        for (const item of this.list<{ id: string; projectId?: string }>(kind))
          if (
            item.projectId === projectId ||
            (kind === "agent-thread" && item.id === projectId)
          )
            this.deleteRecord(kind, item.id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  history(id: string) {
    const rows = this.db
      .prepare(
        "SELECT id,label,applied FROM history WHERE project_id=? ORDER BY id DESC LIMIT 100",
      )
      .all(id);
    return {
      canUndo: rows.some((r) => r.applied === 1),
      canRedo: rows.some((r) => r.applied === 0),
      entries: rows,
    };
  }
  travel(id: string, expectedRevision: number, direction: "undo" | "redo") {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(id);
      if (current.revision !== expectedRevision)
        throw new DomainError("REVISION_CONFLICT", "项目已发生变化，请重试");
      const row = this.db
        .prepare(
          `SELECT * FROM history WHERE project_id=? AND applied=? ORDER BY id ${direction === "undo" ? "DESC" : "ASC"} LIMIT 1`,
        )
        .get(id, direction === "undo" ? 1 : 0);
      if (!row)
        throw new DomainError(
          "NO_HISTORY",
          direction === "undo" ? "没有可撤销的编辑" : "没有可重做的编辑",
        );
      const p = validateProject(
        unpack(row[direction === "undo" ? "before_state" : "after_state"]),
      );
      p.revision = current.revision + 1;
      p.updatedAt = new Date().toISOString();
      this.put(p);
      this.db
        .prepare("UPDATE history SET applied=? WHERE id=?")
        .run(direction === "undo" ? 0 : 1, row.id!);
      this.db.exec("COMMIT");
      return p;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  providers(): PublicProvider[] {
    return this.db
      .prepare("SELECT state FROM providers")
      .all()
      .map((r) => {
        // Listing never opens keys, so showing the model page needs no keychain access.
        const p = JSON.parse(String(r.state)) as Provider,
          key = "provider:" + p.id;
        return {
          ...p,
          hasKey: this.vault.has(key),
          ...(this.vault.failed(key) ? { keyUnreadable: true } : {}),
        };
      });
  }
  provider(id: string): Provider {
    const row = this.db
      .prepare("SELECT state FROM providers WHERE id=?")
      .get(id);
    if (!row) throw new DomainError("PROVIDER_NOT_FOUND", "供应商不存在");
    return JSON.parse(String(row.state));
  }
  saveProvider(value: Provider, apiKey?: string) {
    const p = providerSchema.parse(value);
    this.db
      .prepare(
        "INSERT INTO providers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      )
      .run(p.id, JSON.stringify(p));
    if (apiKey !== undefined) this.vault.set("provider:" + p.id, apiKey);
    return this.providers().find((x) => x.id === p.id)!;
  }
  /** The provider's key, or a clear error when one is saved but cannot be opened now. */
  providerKey(id: string) {
    const key = this.vault.read("provider:" + id);
    if (key === undefined)
      throw new Error(
        "这个服务保存的密钥现在无法读取（系统钥匙串未允许访问）。请在钥匙串提示中允许，或在模型页重新填写密钥。",
      );
    return key;
  }
  deleteProvider(id: string) {
    this.db.prepare("DELETE FROM providers WHERE id=?").run(id);
    this.vault.set("provider:" + id, "");
  }
  save<T extends { id: string }>(kind: string, value: T) {
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET state=excluded.state",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  list<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT state FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((r) => JSON.parse(String(r.state)));
  }
  record<T>(kind: string, id: string): T | undefined {
    const r = this.db
      .prepare("SELECT state FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return r ? JSON.parse(String(r.state)) : undefined;
  }
  deleteRecord(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  settings<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT state FROM settings WHERE id=?").get(key);
    return r ? JSON.parse(String(r.state)) : fallback;
  }
  saveSettings<T>(key: string, value: T) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      )
      .run(key, JSON.stringify(value));
    return value;
  }
  close() {
    this.db.close();
  }
}
