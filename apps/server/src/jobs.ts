import crypto from "node:crypto";
import type { Job, Repository } from "./storage";
export function publicJob(job: Job): Job {
  const { snapshot, ...input } = job.input;
  return { ...job, input };
}
export interface JobContext {
  job: Job;
  signal: AbortSignal;
  progress(value: number, label?: string): void;
}
export class JobQueue {
  private running = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private handlers = new Map<string, (ctx: JobContext) => Promise<unknown>>();
  private closing = false;
  constructor(
    private repo: Repository,
    private publish: (type: string, data: unknown) => void,
    private concurrency = 2,
  ) {}
  register(kind: string, handler: (ctx: JobContext) => Promise<unknown>) {
    this.handlers.set(kind, handler);
  }
  enqueue(
    projectId: string,
    kind: string,
    label: string,
    input: Record<string, unknown>,
  ) {
    if (!this.handlers.has(kind)) throw new Error("未知任务类型");
    this.repo.get(projectId);
    const now = new Date().toISOString();
    const job: Job = {
      id: crypto.randomUUID(),
      projectId,
      kind,
      label,
      input:
        kind === "export"
          ? { ...input, snapshot: this.repo.get(projectId) }
          : input,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.update(job);
    this.drain();
    return job;
  }
  private update(job: Job) {
    job.eventVersion = (job.eventVersion ?? 0) + 1;
    job.updatedAt = new Date().toISOString();
    this.repo.save("job", job);
    this.publish("job", publicJob(job));
  }
  private drain() {
    if (this.closing) return;
    for (const job of this.repo
      .list<Job>("job")
      .filter((j) => j.status === "queued")
      .reverse()) {
      if (this.running.size >= this.concurrency) return;
      const controller = new AbortController();
      job.status = "running";
      this.update(job);
      const promise = Promise.resolve()
        .then(() =>
          this.handlers.get(job.kind)!({
            job,
            signal: controller.signal,
            progress: (value, label) => {
              job.progress = Math.min(99, Math.max(0, value));
              if (label) job.stage = label;
              this.update(job);
            },
          }),
        )
        .then((result) => {
          job.result = result;
          job.status = controller.signal.aborted ? "cancelled" : "completed";
          job.progress = job.status === "completed" ? 100 : job.progress;
          if (job.status === "completed") delete job.stage;
        })
        .catch((e) => {
          job.status = controller.signal.aborted ? "cancelled" : "failed";
          job.error = String(e?.message ?? e).slice(0, 1000);
        })
        .finally(() => {
          this.update(job);
          this.running.delete(job.id);
          this.drain();
        });
      this.running.set(job.id, { controller, promise });
    }
  }
  cancel(id: string) {
    const job = this.repo.record<Job>("job", id);
    if (!job) throw new Error("任务不存在");
    this.running.get(id)?.controller.abort(new Error("任务已取消"));
    if (job.status === "queued") {
      job.status = "cancelled";
      this.update(job);
    }
    return job;
  }
  async stop() {
    this.closing = true;
    for (const entry of this.running.values())
      entry.controller.abort(new Error("应用关闭"));
    await Promise.allSettled([...this.running.values()].map((x) => x.promise));
  }
}
