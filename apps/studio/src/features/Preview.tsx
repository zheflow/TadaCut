import { MulticamControls } from "./MediaServices";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Expand,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from "lucide-react";
import { activeTimeline, durationInFrames, formatTime } from "@tadacut/domain";
import { remember, setState, useStudio } from "../lib/store";
import {
  markedRange,
  seek,
  step,
  stepEditPoint,
  toggleLoop,
  togglePlay,
} from "../lib/transport";
import { Stage } from "../../../../packages/render/src/Stage";
const zoomChoices: { value: "fit" | number; label: string }[] = [
  { value: "fit", label: "适合窗口" },
  { value: 0.25, label: "25%" },
  { value: 0.5, label: "50%" },
  { value: 1, label: "100%" },
  { value: 2, label: "200%" },
];
/** A button that opens a small menu; closes on outside click or Escape. */
export function MenuButton({
  label,
  title,
  className = "",
  children,
}: {
  label: ReactNode;
  title: string;
  className?: string;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false),
    box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div className={`menu-button ${className}`} ref={box}>
      <button
        className="menu-trigger"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({
  checked,
  onSelect,
  children,
  hint,
}: {
  checked?: boolean;
  onSelect(): void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <button
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      className="menu-item"
      onClick={onSelect}
    >
      <span className="menu-check">{checked && <Check size={13} />}</span>
      {children}
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}
export function Preview() {
  const p = useStudio((s) => s.project)!,
    frame = useStudio((s) => s.playhead),
    playing = useStudio((s) => s.playing),
    rate = useStudio((s) => s.rate),
    loop = useStudio((s) => s.loop),
    zoom = useStudio((s) => s.previewZoom),
    overlays = useStudio((s) => s.overlays),
    timeline = activeTimeline(p),
    marks = useStudio((s) => s.marks[timeline.id]),
    container = useRef<HTMLElement>(null);
  const range = marks ? markedRange(timeline) : null,
    setOverlay = (patch: Partial<typeof overlays>) => {
      const next = { ...overlays, ...patch };
      setState({ overlays: next });
      remember("tadacut-overlays", next);
    };
  const stageStyle = {
    aspectRatio: `${timeline.width}/${timeline.height}`,
    "--preview-ratio": timeline.width / timeline.height,
    ...(zoom === "fit"
      ? {}
      : { width: (timeline.width * zoom) / window.devicePixelRatio }),
  } as React.CSSProperties;
  return (
    <section className="preview-panel" ref={container}>
      <div className="preview-heading">
        <MenuButton label="预览" title="预览选项">
          {() => (
            <>
              <MenuItem
                checked={overlays.safe}
                onSelect={() => setOverlay({ safe: !overlays.safe })}
              >
                安全框
              </MenuItem>
              <MenuItem
                checked={overlays.grid}
                onSelect={() => setOverlay({ grid: !overlays.grid })}
              >
                三分线
              </MenuItem>
              <MenuItem checked={loop} onSelect={toggleLoop}>
                循环播放入出点
              </MenuItem>
            </>
          )}
        </MenuButton>
        <span className="preview-meta">
          {timeline.width} × {timeline.height}
          <i />
          {timeline.fps} FPS
        </span>
        <button
          className="icon-button"
          title="全屏预览"
          onClick={() => void container.current?.requestFullscreen()}
        >
          <Expand size={14} />
        </button>
      </div>
      <MulticamControls />
      <div className={`preview-surface ${zoom === "fit" ? "" : "zoomed"}`}>
        <div
          className="preview-stage"
          style={stageStyle}
          onClick={() => setState({ selectedClipIds: [] })}
        >
          <Stage
            timeline={timeline}
            timelines={p.timelines}
            assets={p.assets}
            frame={frame}
            playing={playing}
            rate={rate}
          />
          {overlays.safe && (
            <>
              <div className="safe-frame action" />
              <div className="safe-frame title" />
            </>
          )}
          {overlays.grid && <div className="thirds-grid" />}
          {playing && rate !== 1 && (
            <span className="shuttle-badge">
              {rate < 0 ? "◀◀" : "▶▶"} {Math.abs(rate)}×
            </span>
          )}
        </div>
      </div>
      <div className="preview-footer">
        <span className="timecode">
          {formatTime(frame, timeline.fps)}
          <small>
            {" "}
            / {formatTime(durationInFrames(timeline), timeline.fps)}
          </small>
        </span>
        <div className="playback">
          <button
            className="icon-button"
            title="回到开头（Home）"
            onClick={() => seek(0)}
          >
            <SkipBack size={15} />
          </button>
          <button
            className="icon-button"
            title="上一帧（←）"
            onClick={() => step(-1)}
          >
            <StepBack size={15} />
          </button>
          <button
            className="play-button"
            title={playing ? "暂停（空格 / K）" : "播放（空格 / L）"}
            onClick={togglePlay}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            title="下一帧（→）"
            onClick={() => step(1)}
          >
            <StepForward size={15} />
          </button>
          <button
            className="icon-button"
            title="下一个剪辑点（↓）"
            onClick={() => stepEditPoint(1)}
          >
            <SkipForward size={15} />
          </button>
          <button
            className={`icon-button ${loop ? "chosen" : ""}`}
            title="循环播放入出点"
            aria-pressed={loop}
            onClick={toggleLoop}
          >
            <Repeat size={14} />
          </button>
        </div>
        <div className="preview-side">
          {range && (
            <span className="range-info" title="I 设入点 · O 设出点 · X 清除">
              入出点 {formatTime(range.end - range.start, timeline.fps)}
            </span>
          )}
          <MenuButton
            className="preview-zoom"
            label={
              zoomChoices.find((z) => z.value === zoom)?.label ?? "适合窗口"
            }
            title="预览缩放"
          >
            {(close) =>
              zoomChoices.map((choice) => (
                <MenuItem
                  key={choice.label}
                  checked={zoom === choice.value}
                  onSelect={() => {
                    setState({ previewZoom: choice.value });
                    close();
                  }}
                >
                  {choice.label}
                </MenuItem>
              ))
            }
          </MenuButton>
        </div>
      </div>
    </section>
  );
}
