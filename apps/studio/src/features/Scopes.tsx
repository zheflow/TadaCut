import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import {
  activeTimeline,
  colorStats,
  histogram,
  vectorscope,
  waveform,
} from "@tadacut/domain";
import { useIdlePlayhead, useStudio } from "../lib/store";

export interface FramePixels {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** The rendered frame as an object URL, for thumbnails. */
  url: string;
}
/** A timeline frame rendered like the export, as pixels. */
export async function framePixels(
  projectId: string,
  timelineId: string,
  frame: number,
  scale = 0.3,
): Promise<FramePixels> {
  const response = await fetch(
    `/api/projects/${projectId}/frame?frame=${Math.max(0, Math.round(frame))}&timelineId=${encodeURIComponent(timelineId)}&scale=${scale}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? "无法渲染这一帧");
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  return {
    rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
    height: canvas.height,
    url,
  };
}
function Grid({
  values,
  columns,
  rows,
  className,
  color,
}: {
  /** Row-major intensities 0–1, row 0 at the top. */
  values: number[];
  columns: number;
  rows: number;
  className: string;
  color: [number, number, number];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(columns, rows);
    values.forEach((v, i) => {
      const a = Math.min(1, Math.sqrt(v) * 1.6);
      image.data[i * 4] = color[0];
      image.data[i * 4 + 1] = color[1];
      image.data[i * 4 + 2] = color[2];
      image.data[i * 4 + 3] = Math.round(a * 255);
    });
    ctx.putImageData(image, 0, 0);
  }, [values, columns, rows, color]);
  return (
    <canvas ref={canvas} className={className} width={columns} height={rows} />
  );
}
const path = (values: number[]) =>
  values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / (values.length - 1)) * 100).toFixed(2)} ${(100 - v * 100).toFixed(2)}`,
    )
    .join(" ") + " L100 100 L0 100 Z";
export function ScopesPanel() {
  const p = useStudio((s) => s.project)!,
    frame = useIdlePlayhead(),
    t = activeTimeline(p);
  const [mode, setMode] = useState<"histogram" | "waveform" | "vector">(
      "waveform",
    ),
    [pixels, setPixels] = useState<FramePixels | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [at, setAt] = useState<number | null>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await framePixels(p.id, t.id, frame);
      setPixels((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return next;
      });
      setAt(frame);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () =>
      setPixels((old) => (old && URL.revokeObjectURL(old.url), null));
    // Loads once when opened; later frames load on request, since each render takes a moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stats = pixels && colorStats(pixels.rgba);
  return (
    <div className="scopes">
      <div className="scopes-head">
        <div className="segmented">
          {(
            [
              ["waveform", "波形"],
              ["histogram", "直方图"],
              ["vector", "矢量"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={mode === id ? "active" : ""}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          title="分析播放头所在帧"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <RefreshCw size={13} />
          )}
        </button>
      </div>
      {error && <p className="small-description error-text">{error}</p>}
      {pixels && (
        <>
          {mode === "histogram" ? (
            (() => {
              const h = histogram(pixels.rgba);
              return (
                <svg
                  className="scope histogram"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <path d={path(h.r)} className="r" />
                  <path d={path(h.g)} className="g" />
                  <path d={path(h.b)} className="b" />
                  <path d={path(h.luma)} className="y" />
                </svg>
              );
            })()
          ) : mode === "waveform" ? (
            (() => {
              const grid = waveform(
                pixels.rgba,
                pixels.width,
                pixels.height,
                96,
                64,
              );
              // Columns of levels, black at the bottom, as a top-down image.
              const values: number[] = [];
              for (let level = 63; level >= 0; level--)
                for (let column = 0; column < 96; column++)
                  values.push(grid[column][level]);
              return (
                <div className="scope waveform">
                  <Grid
                    values={values}
                    columns={96}
                    rows={64}
                    className="scope-canvas"
                    color={[132, 222, 176]}
                  />
                  <i style={{ top: "0%" }}>100</i>
                  <i style={{ top: "50%" }}>50</i>
                  <i style={{ top: "100%" }}>0</i>
                </div>
              );
            })()
          ) : (
            <div className="scope vector">
              <Grid
                values={vectorscope(pixels.rgba, 64)}
                columns={64}
                rows={64}
                className="scope-canvas"
                color={[180, 230, 255]}
              />
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r="30" />
                <circle cx="32" cy="32" r="15" />
                {/* Skin tones fall near this line. */}
                <line x1="32" y1="32" x2="14" y2="7" />
              </svg>
            </div>
          )}
          {stats && (
            <div className="scope-stats">
              <span>平均亮度 {Math.round(stats.meanLuma * 100)}%</span>
              <span>饱和 {Math.round(stats.saturation * 100)}%</span>
              <span>
                {stats.warmth > 0.04
                  ? "偏暖"
                  : stats.warmth < -0.04
                    ? "偏冷"
                    : "中性"}
              </span>
              {stats.notes.length > 0 && <p>{stats.notes.join("；")}</p>}
              {at !== null && at !== frame && (
                <p className="muted">
                  显示的是第 {at} 帧，点右上角刷新分析当前帧
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
