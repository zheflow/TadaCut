import { pipeline, env } from "@huggingface/transformers";
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
const progress = (value: any) => {
  if (value.status === "progress")
    self.postMessage({
      type: "progress",
      message: `下载本地模型 ${Math.round(value.progress ?? 0)}%`,
    });
  else if (value.status === "ready")
    self.postMessage({
      type: "progress",
      message: "模型已加载，正在本机处理…",
    });
};
self.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data.type === "transcribe") {
      const asr = await pipeline(
        "automatic-speech-recognition",
        event.data.model ?? "onnx-community/whisper-tiny",
        { dtype: "q8", device: "wasm", progress_callback: progress },
      );
      const result = await asr(event.data.pcm, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: "word",
      });
      const item = Array.isArray(result) ? result[0] : result;
      self.postMessage({
        type: "result",
        result: {
          words: (item.chunks ?? [])
            .filter(
              (c: any) =>
                c.timestamp?.[0] !== null && c.timestamp?.[1] !== null,
            )
            .map((c: any) => ({
              text: c.text.trim(),
              start: c.timestamp[0],
              end: c.timestamp[1],
            })),
        },
      });
      await asr.dispose();
    } else if (event.data.type === "detect-subject") {
      const detector = await pipeline(
        "object-detection",
        "Xenova/detr-resnet-50",
        { dtype: "q8", device: "wasm", progress_callback: progress },
      );
      const result = [];
      for (const image of event.data.images ?? [event.data.image]) {
        result.push(
          await detector(image, { threshold: 0.5, percentage: true }),
        );
        self.postMessage({
          type: "progress",
          message: `本地检测 ${result.length}/${event.data.images?.length ?? 1}`,
        });
      }
      self.postMessage({ type: "result", result });
      await detector.dispose();
    } else if (event.data.type === "audio-labels") {
      const classifier = await pipeline(
        "zero-shot-audio-classification",
        "Xenova/clap-htsat-unfused",
        { dtype: "q8", device: "wasm", progress_callback: progress },
      );
      const result = await classifier(
        event.data.pcm,
        event.data.labels ?? [
          "calm ambient music",
          "energetic electronic music",
          "speech",
          "nature sounds",
        ],
      );
      self.postMessage({ type: "result", result });
      await classifier.dispose();
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
