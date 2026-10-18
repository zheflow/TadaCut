import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Repository } from "./storage";
import type { MediaService } from "./media";
export interface WatchedFolder {
  id: string;
  projectId: string;
  directory: string;
  enabled: boolean;
  error?: string;
  imported: number;
}
export class FolderWatchService {
  private closing = false;
  private watchers = new Map<string, fs.FSWatcher>();
  private timers = new Map<string, NodeJS.Timeout>();
  private busy = new Set<string>();
  private seen = new Map<string, Map<string, string>>();
  constructor(
    private repo: Repository,
    private media: MediaService,
    private permitted: () => string[],
    private publish: (type: string, data: unknown) => void,
  ) {}
  list(projectId?: string) {
    return this.repo
      .list<WatchedFolder>("watch")
      .filter((w) => !projectId || w.projectId === projectId);
  }
  async add(projectId: string, directory: string) {
    const real = await fsp.realpath(directory);
    if (!this.permitted().some((p) => path.resolve(p) === real))
      throw new Error("请使用桌面版文件夹选择器添加目录");
    this.repo.get(projectId);
    const existing = this.list(projectId).find((w) => w.directory === real);
    if (existing) return existing;
    const watch: WatchedFolder = {
      id: crypto.randomUUID(),
      projectId,
      directory: real,
      enabled: true,
      imported: 0,
    };
    this.repo.save("watch", watch);
    this.attach(watch);
    await this.scan(watch);
    return watch;
  }
  async restore() {
    for (const watch of this.list())
      if (watch.enabled && this.permitted().includes(watch.directory)) {
        this.attach(watch);
        await this.scan(watch);
      }
  }
  private attach(watch: WatchedFolder) {
    if (this.watchers.has(watch.id)) return;
    try {
      const watcher = fs.watch(watch.directory, { recursive: true }, () => {
        clearTimeout(this.timers.get(watch.id));
        this.timers.set(
          watch.id,
          setTimeout(() => void this.scan(watch), 1200),
        );
      });
      watcher.on("error", (e) => {
        watch.error = e.message;
        this.repo.save("watch", watch);
        this.publish("watch", watch);
      });
      this.watchers.set(watch.id, watcher);
    } catch (e) {
      watch.error = String(e);
      this.repo.save("watch", watch);
    }
  }
  private async scan(watch: WatchedFolder) {
    if (this.busy.has(watch.id) || !watch.enabled) return;
    this.busy.add(watch.id);
    const seen = this.seen.get(watch.id) ?? new Map<string, string>();
    this.seen.set(watch.id, seen);
    try {
      const entries = await fsp.readdir(watch.directory, {
        recursive: true,
        withFileTypes: true,
      });
      let count = 0;
      for (const entry of entries) {
        if (this.closing || !watch.enabled || ++count > 3000) break;
        if (
          !entry.isFile() ||
          !/\.(mp4|mov|mkv|webm|avi|png|jpe?g|webp|svg|wav|mp3|m4a|flac|ogg|cube)$/i.test(
            entry.name,
          )
        )
          continue;
        const file = path.join(entry.parentPath, entry.name),
          real = await fsp.realpath(file);
        if (!real.startsWith(watch.directory + path.sep)) continue;
        const stat = await fsp.stat(real),
          signature = `${stat.size}:${stat.mtimeMs}`;
        if (seen.get(real) === signature || stat.size > 512 * 1024 * 1024)
          continue;
        const copy = path.join(
          this.media.dir,
          crypto.randomUUID() + this.media.extension(real),
        );
        await fsp.copyFile(real, copy);
        const result = await this.media.register(
          watch.projectId,
          copy,
          entry.name,
          "",
          { folder: path.basename(watch.directory), originalPath: real },
        );
        seen.set(real, signature);
        watch.imported++;
        this.publish("watch-import", {
          watchId: watch.id,
          assetId: result.asset.id,
        });
      }
      delete watch.error;
    } catch (e) {
      watch.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy.delete(watch.id);
      this.repo.save("watch", watch);
      this.publish("watch", watch);
    }
  }
  remove(id: string) {
    const watch = this.repo.record<WatchedFolder>("watch", id);
    if (watch) watch.enabled = false;
    this.watchers.get(id)?.close();
    this.watchers.delete(id);
    clearTimeout(this.timers.get(id));
    this.repo.deleteRecord("watch", id);
  }
  async close() {
    this.closing = true;
    for (const watch of this.list()) watch.enabled = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const watcher of this.watchers.values()) watcher.close();
    while (this.busy.size) await new Promise((r) => setTimeout(r, 10));
  }
}
