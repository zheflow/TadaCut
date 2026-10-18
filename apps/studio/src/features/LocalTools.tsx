import { useEffect, useRef, useState } from "react";
import {
  activeTimeline,
  framePresets,
  reframeTimeline,
  type FramePreset,
  type Project,
  type SubjectBox,
  type SubjectSample,
  type Timeline,
} from "@tadacut/domain";
import { Modal } from "./Pages";
import { commit, notify, setState, useStudio } from "../lib/store";
import { readLocalPcm, localInference } from "../lib/local-models";
export function LocalAudioLabels({ close }: { close(): void }) {
  const p = useStudio((s) => s.project)!,
    [assetId, setAssetId] = useState(
      p.assets.find((a) => ["video", "audio"].includes(a.kind))?.id ?? "",
    ),
    [labels, setLabels] = useState(
      "calm ambient music\nenergetic electronic music\nspeech\nnature sounds",
    ),
    [status, setStatus] = useState(""),
    [results, setResults] = useState<{ label: string; score: number }[]>([]),
    [busy, setBusy] = useState(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async () => {
    setBusy(true);
    controller.current = new AbortController();
    try {
      setStatus("提取前 30 秒音频…");
      const pcm = await readLocalPcm(p.id, assetId, 48000, 30);
      const result = await localInference(
        "audio-labels",
        { pcm, labels: labels.split("\n").filter(Boolean) },
        setStatus,
        controller.current.signal,
      );
      setResults(result);
      setStatus("本地分类完成");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="本地音频语义分类"
      subtitle="CLAP · 比较音频与候选描述的相似程度"
      close={close}
    >
      <div className="modal-body">
        <label className="form-field">
          音视频素材
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {p.assets
              .filter((a) => ["audio", "video"].includes(a.kind))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="form-field">
          候选描述（一行一个）
          <textarea
            className="field-textarea"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
          />
        </label>
        <p className="small-description">
          首次使用下载 CLAP 模型；选择素材的前 30 秒在本机处理。
        </p>
        {status && <p>{status}</p>}
        {results.map((r) => (
          <div className="memory-card" key={r.label}>
            <strong>{r.label}</strong>
            <small>{(r.score * 100).toFixed(1)}%</small>
          </div>
        ))}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          关闭
        </button>
        {results.length > 0 && (
          <button
            className="secondary-button"
            onClick={async () => {
              const a = p.assets.find((a) => a.id === assetId)!;
              await commit(
                [
                  {
                    type: "asset.update",
                    assetId,
                    patch: {
                      tags: [
                        ...new Set([
                          ...a.tags,
                          ...results
                            .filter((r) => r.score > 0.2)
                            .map((r) => r.label),
                        ]),
                      ],
                    },
                  },
                ],
                "保存音频语义标签",
                p.id,
              );
              notify("分类标签已保存");
            }}
          >
            保存标签
          </button>
        )}
        <button
          className="primary-button"
          disabled={!assetId}
          onClick={() => (busy ? controller.current?.abort() : void run())}
        >
          {busy ? "停止" : "下载模型并开始分类"}
        </button>
      </div>
    </Modal>
  );
}
/** Multi-format reframing. A new timeline keeps the original; the optional subject
 * detector runs locally in the browser, and no image leaves the machine. */
export function ReframeDialog({
  close,
  detect: detectInitially = false,
}: {
  close(): void;
  detect?: boolean;
}) {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p),
    current = t.width / t.height,
    [presetId, setPresetId] = useState<FramePreset["id"]>(
      framePresets.find((f) => Math.abs(f.width / f.height - current) > 0.01)!
        .id,
    ),
    [detect, setDetect] = useState(detectInitially),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const preset = framePresets.find((f) => f.id === presetId)!,
    covered = t.clips.filter((c) => {
      const asset = p.assets.find((a) => a.id === c.assetId);
      return (
        asset && ["image", "video"].includes(asset.kind) && c.fit === "cover"
      );
    });
  const run = async () => {
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    try {
      const subjects: Record<string, SubjectSample[]> = {};
      if (detect && covered.length) {
        // One worker run for every sampled frame, so the detector loads once.
        const samples: { clipId: string; frame: number }[] = [],
          images: string[] = [];
        for (const c of covered) {
          const asset = p.assets.find((a) => a.id === c.assetId)!;
          const frames =
            asset.kind === "image"
              ? [0]
              : Array.from(
                  {
                    length: Math.min(
                      12,
                      Math.max(1, Math.ceil(c.duration / t.fps / 2)),
                    ),
                  },
                  (_, i) => Math.min(c.duration - 1, Math.round(i * t.fps * 2)),
                );
          for (const frame of frames) {
            signal.throwIfAborted();
            setStatus(`读取 ${asset.name} · ${(frame / t.fps).toFixed(1)} 秒`);
            images.push(
              await mediaFrame(
                asset.url,
                asset.kind,
                c.sourceOffset + (frame / t.fps) * c.speed,
              ),
            );
            samples.push({ clipId: c.id, frame });
          }
        }
        const detections: any[][] = await localInference(
          "detect-subject",
          { images },
          setStatus,
          signal,
        );
        samples.forEach(({ clipId, frame }, index) => {
          const found = [...(detections[index] ?? [])].sort(
            (a, b) => b.score - a.score,
          );
          const best = found.find((r) => r.label === "person") ?? found[0];
          // Shots without a detection keep the middle of the frame.
          (subjects[clipId] ??= []).push({
            frame,
            x: best ? (best.box.xmin + best.box.xmax) / 2 : 0.5,
            y: best ? (best.box.ymin + best.box.ymax) / 2 : 0.5,
          });
        });
      }
      signal.throwIfAborted();
      const timeline = reframeTimeline(
        t,
        p.assets,
        {
          id: crypto.randomUUID(),
          name: `${t.name} · ${preset.name}`,
          width: preset.width,
          height: preset.height,
        },
        subjects,
      );
      const done = await commit(
        [{ type: "timeline.create", timeline }],
        `重构为${preset.name}`,
        p.id,
      );
      if (done) {
        setState({ selectedClipIds: [] });
        close();
        notify(
          `已创建「${timeline.name}」，原时间线保持不变${detect ? "；主体位置已写入关键帧" : ""}`,
        );
      }
    } catch (e) {
      if (!signal.aborted)
        notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };
  return (
    <Modal
      title="多画幅重构"
      subtitle="复制当前时间线为新的画幅，原时间线保持不变"
      close={close}
    >
      <div className="modal-body">
        <div className="frame-presets" role="radiogroup" aria-label="目标画幅">
          {framePresets.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={presetId === f.id}
              className={`frame-preset ${presetId === f.id ? "selected" : ""}`}
              onClick={() => setPresetId(f.id)}
            >
              <i
                style={{
                  aspectRatio: `${f.width}/${f.height}`,
                }}
              />
              <strong>{f.name}</strong>
              <small>
                {f.width} × {f.height}
              </small>
            </button>
          ))}
        </div>
        <p className="small-description">
          位置按比例换算，文字保持相对短边的大小，铺满画面的素材按新画幅裁切。
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={detect}
            disabled={!covered.length}
            onChange={(e) => setDetect(e.target.checked)}
          />
          本地检测主体，让裁切跟随人物（{covered.length}{" "}
          个画面片段，首次使用需下载模型）
        </label>
        {status && <p className="small-description">{status}</p>}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          关闭
        </button>
        <button
          className="primary-button"
          onClick={() => (busy ? controller.current?.abort() : void run())}
        >
          {busy ? "停止" : `创建${preset.name}时间线`}
        </button>
      </div>
    </Modal>
  );
}
/**
 * People the local detector finds in the topmost picture under each timeline
 * frame, as boxes in fractions of that picture (taken to fill the frame).
 */
export async function subjectsUnder(
  p: Project,
  t: Timeline,
  frames: number[],
  status: (text: string) => void,
  ignore: (clipId: string) => boolean = () => false,
): Promise<{ boxes: SubjectBox[]; checked: number }> {
  // Later tracks draw on top, so the first picture found from the top is what shows.
  const pictures = [...t.tracks]
      .reverse()
      .filter((x) => x.kind === "video" && !x.hidden),
    images: string[] = [],
    found: number[] = [];
  status("读取画面…");
  for (const frame of frames) {
    const under = pictures
      .flatMap((track) =>
        t.clips.filter(
          (x) =>
            x.trackId === track.id &&
            !ignore(x.id) &&
            x.start <= frame &&
            x.start + x.duration > frame,
        ),
      )
      .find((x) =>
        ["video", "image"].includes(
          p.assets.find((a) => a.id === x.assetId)?.kind ?? "",
        ),
      );
    if (!under) continue;
    const asset = p.assets.find((a) => a.id === under.assetId)!;
    images.push(
      await mediaFrame(
        asset.url,
        asset.kind,
        under.sourceOffset + ((frame - under.start) / t.fps) * under.speed,
      ),
    );
    found.push(frame);
  }
  if (!images.length) return { boxes: [], checked: 0 };
  const detections: {
    label: string;
    score: number;
    box: { xmin: number; ymin: number; xmax: number; ymax: number };
  }[][] = await localInference("detect-subject", { images }, status);
  return {
    checked: images.length,
    boxes: found.flatMap((frame, i) =>
      (detections[i] ?? [])
        .filter((d) => d.label === "person")
        .map((d) => ({
          frame,
          x: d.box.xmin,
          y: d.box.ymin,
          width: d.box.xmax - d.box.xmin,
          height: d.box.ymax - d.box.ymin,
        })),
    ),
  };
}
/** One source frame of an image or video as a data URL, read in the browser. */
export async function mediaFrame(url: string, kind: string, seconds: number) {
  const element = document.createElement(kind === "video" ? "video" : "img") as
    | HTMLVideoElement
    | HTMLImageElement;
  element.crossOrigin = "anonymous";
  element.src = url;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("读取画面超时")), 20000);
    element.onerror = () => {
      clearTimeout(timer);
      reject(new Error("无法读取源画面"));
    };
    if (element instanceof HTMLVideoElement) {
      element.onloadeddata = () => {
        if (Math.abs(seconds) < 0.001) {
          clearTimeout(timer);
          resolve();
        } else
          element.currentTime = Math.min(
            seconds,
            Math.max(0, element.duration - 0.01),
          );
      };
      element.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
    } else
      element.onload = () => {
        clearTimeout(timer);
        resolve();
      };
  });
  const width =
      element instanceof HTMLVideoElement
        ? element.videoWidth
        : element.naturalWidth,
    height =
      element instanceof HTMLVideoElement
        ? element.videoHeight
        : element.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = Math.round((height / width) * 640);
  canvas
    .getContext("2d")!
    .drawImage(element, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL("image/jpeg", 0.85);
  element.src = "";
  return image;
}
