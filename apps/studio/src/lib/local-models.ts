export async function readLocalPcm(
  projectId: string,
  assetId: string,
  sampleRate = 16000,
  seconds = 1200,
) {
  const response = await fetch(
    `/api/projects/${projectId}/assets/${assetId}/audio?rate=${sampleRate}&seconds=${seconds}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.message ?? "音频提取未完成");
  }
  return new Float32Array(await response.arrayBuffer());
}
export async function localInference(
  type: "transcribe" | "audio-labels" | "detect-subject",
  input: Record<string, unknown>,
  progress: (message: string) => void,
  signal?: AbortSignal,
): Promise<any> {
  signal?.throwIfAborted();
  const worker = new Worker(
    new URL("../workers/local-models.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      worker.terminate();
    };
    const stop = () => {
      cleanup();
      reject(new Error("本地模型任务已停止"));
    };
    const timer = setTimeout(
      () => {
        cleanup();
        reject(new Error("本地模型任务超时"));
      },
      25 * 60 * 1000,
    );
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (e) => {
      if (e.data.type === "progress") progress(e.data.message);
      if (e.data.type === "result") {
        cleanup();
        resolve(e.data.result);
      }
      if (e.data.type === "error") {
        cleanup();
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message));
    };
    const transfer =
      input.pcm instanceof Float32Array
        ? [input.pcm.buffer as ArrayBuffer]
        : [];
    worker.postMessage({ type, ...input }, transfer);
  });
}
