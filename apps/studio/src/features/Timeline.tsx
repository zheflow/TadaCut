import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  ArrowLeftRight,
  Bookmark,
  ChevronDown,
  ClipboardPaste,
  Columns2,
  Copy,
  CornerLeftUp,
  Eye,
  EyeOff,
  Film,
  Group,
  Layers,
  Link2,
  ListPlus,
  LockKeyhole,
  Magnet,
  Minus,
  MoveHorizontal,
  MousePointer2,
  Music2,
  Plus,
  Redo2,
  Replace,
  Scissors,
  Slice,
  Trash2,
  Type,
  Undo2,
  UnlockKeyhole,
  Volume2,
  VolumeX,
  WandSparkles,
} from "lucide-react";
import {
  activeTimeline,
  clipSchema,
  closeGaps,
  duplicateClips,
  durationInFrames,
  formatTime,
  hasSourceRange,
  insertEdit,
  markerSchema,
  moveClips,
  nestClips,
  newTrack,
  overwriteEdit,
  placementIssue,
  rippleDelete,
  rollEdit,
  sliceKeyframes,
  slideClip,
  slipClip,
  trimBounds,
  type Asset,
  type Clip,
  type Command,
  type Marker,
  type Project,
  type Timeline,
} from "@tadacut/domain";
import {
  addAssetToTimeline,
  addAssetsToTimeline,
  askText,
  commit,
  copySelected,
  deleteSelected,
  getState,
  newTimeline,
  notify,
  pasteClipboard,
  setState,
  splitSelected,
  travel,
  useStudio,
} from "../lib/store";
import { marksOf, moveMark, seek } from "../lib/transport";
import { ContextMenu } from "./ContextMenu";
import { referenceSchema } from "../../../../packages/platform/src/studio";
type Draft = {
  start?: number;
  duration?: number;
  sourceOffset?: number;
  trackId?: string;
  invalid?: boolean;
};
type DragMode = "move" | "left" | "right";
/** Width of the sticky track header column. */
const HEADER = 152;
/** Seconds between ruler labels, chosen so labels stay at least ~70px apart. */
const labelStep = (zoom: number) =>
  [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * zoom >= 70) ?? 600;
const markerColors = [
  "#7fd1ae",
  "#7db3e8",
  "#e8c46a",
  "#e88f7d",
  "#c49be8",
  "#9aa3ad",
];
/** Right-click menu of a timeline marker: color, name, note, range and delete. */
function MarkerMenu({
  t,
  marker,
  at,
  close,
}: {
  t: Timeline;
  marker: Marker;
  at: { x: number; y: number };
  close(): void;
}) {
  const playhead = Math.round(getState().playhead);
  const update = (patch: Partial<Omit<Marker, "id">>, label: string) =>
    void commit(
      [{ type: "marker.update", timelineId: t.id, markerId: marker.id, patch }],
      label,
    );
  const ask = async (
    title: string,
    value: string,
    multiline: boolean,
    apply: (v: string) => void,
  ) => {
    close();
    const next = await askText(title, value, multiline);
    if (next !== null && next !== value) apply(next);
  };
  return (
    <ContextMenu at={at} close={close} label={`标记「${marker.label}」`}>
      <div className="marker-colors">
        {markerColors.map((color) => (
          <button
            key={color}
            className={marker.color === color ? "active" : ""}
            style={{ background: color }}
            title="标记颜色"
            onClick={() => {
              close();
              if (color !== marker.color) update({ color }, "标记颜色");
            }}
          />
        ))}
      </div>
      <button
        onClick={() =>
          void ask(
            "标记名称",
            marker.label,
            false,
            (label) =>
              label.trim() && update({ label: label.trim() }, "修改标记"),
          )
        }
      >
        改名…
      </button>
      <button
        onClick={() =>
          void ask("标记备注", marker.note, true, (note) =>
            update({ note }, "标记备注"),
          )
        }
      >
        备注…<small>{marker.note ? "已填写" : ""}</small>
      </button>
      {playhead > marker.frame && (
        <button
          onClick={() => {
            close();
            update({ duration: playhead - marker.frame }, "标记范围");
          }}
        >
          范围到播放头
          <small>{formatTime(playhead - marker.frame, t.fps)}</small>
        </button>
      )}
      {marker.duration > 0 && (
        <button
          onClick={() => {
            close();
            update({ duration: 0 }, "清除标记范围");
          }}
        >
          清除范围
        </button>
      )}
      <button
        className="danger"
        onClick={() => {
          close();
          void commit(
            [{ type: "marker.remove", timelineId: t.id, markerId: marker.id }],
            "删除标记",
          );
        }}
      >
        <Trash2 size={14} />
        删除标记
      </button>
    </ContextMenu>
  );
}
export function TimelineEditor() {
  const p = useStudio((s) => s.project)!,
    selected = useStudio((s) => s.selectedClipIds),
    zoom = useStudio((s) => s.zoom),
    snap = useStudio((s) => s.snap),
    copied = useStudio((s) => s.clipboard),
    tool = useStudio((s) => s.tool),
    t = activeTimeline(p);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [dropTarget, setDropTarget] = useState<{
      trackId: string;
      frame: number;
      valid: boolean;
      label: string;
    } | null>(null),
    [hint, setHint] = useState<{ clipId: string; text: string } | null>(null),
    [menu, setMenu] = useState(false),
    [markerMenu, setMarkerMenu] = useState<{
      id: string;
      x: number;
      y: number;
    } | null>(null),
    [height, setHeight] = useState(282),
    scroll = useRef<HTMLDivElement>(null),
    inner = useRef<HTMLDivElement>(null),
    blade = useRef<HTMLDivElement>(null);
  const seconds = Math.max(
      30,
      Math.ceil(durationInFrames(t) / t.fps / 10) * 10 + 10,
    ),
    width = Math.max(900, seconds * zoom),
    every = labelStep(zoom);
  const frameAt = (clientX: number) => {
    const rect = inner.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.round(((clientX - rect.left - HEADER) / zoom) * t.fps),
    );
  };
  const resize = (e: React.PointerEvent) => {
    const y = e.clientY,
      initial = height;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) =>
      setHeight(Math.max(210, Math.min(520, initial + y - event.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  /** Pointer drags that move the playhead; also used by the ruler and empty track space. */
  const scrub = (e: React.PointerEvent) => {
    seek(frameAt(e.clientX));
    const move = (ev: PointerEvent) => seek(frameAt(ev.clientX));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const split = (item: Clip, at: number) => {
    if (at <= item.start || at >= item.start + item.duration) return;
    void commit(
      [
        {
          type: "clip.split",
          timelineId: t.id,
          clipId: item.id,
          at,
          newClipId: crypto.randomUUID(),
        },
      ],
      "刀片分割",
    );
  };
  /** Slip, slide and roll: drag sideways, then the edit is planned and committed once. */
  function trimTool(e: React.PointerEvent, item: Clip, mode: DragMode) {
    const kind = getState().tool as "slip" | "slide" | "roll";
    let left: Clip | undefined, right: Clip | undefined;
    if (kind === "roll") {
      const neighbors = t.clips.filter(
        (c) => c.trackId === item.trackId && c.id !== item.id,
      );
      if (mode === "left") {
        right = item;
        left = neighbors.find((c) => c.start + c.duration === item.start);
      } else {
        left = item;
        right = neighbors.find((c) => c.start === item.start + item.duration);
      }
      if (!left || !right) {
        notify("卷动编辑需要拖动两个相邻片段之间的剪辑点", true);
        return;
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setState({ selectedClipIds: [item.id] });
    const originalX = e.clientX;
    let frames = 0;
    const label = { slip: "滑移", slide: "滑动", roll: "卷动" }[kind];
    const move = (ev: PointerEvent) => {
      frames = Math.round(((ev.clientX - originalX) / zoom) * t.fps);
      setHint({
        clipId: item.id,
        text: `${label} ${frames > 0 ? "+" : ""}${frames} 帧（${(frames / t.fps).toFixed(2)} 秒）`,
      });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setHint(null);
      if (!frames) return;
      void commit((project) => {
        const timeline = activeTimeline(project);
        return kind === "slip"
          ? slipClip(project, timeline, item.id, frames)
          : kind === "slide"
            ? slideClip(project, timeline, item.id, frames)
            : rollEdit(project, timeline, left!.id, right!.id, frames);
      }, `${label}编辑`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  function drag(e: React.PointerEvent, item: Clip, mode: DragMode) {
    if (e.button !== 0) return;
    if (t.tracks.find((tr) => tr.id === item.trackId)?.locked) return;
    e.stopPropagation();
    if (getState().tool === "blade") {
      split(item, frameAt(e.clientX));
      return;
    }
    const current = getState().tool;
    if (mode === "move" && (e.metaKey || e.ctrlKey)) {
      setState({
        selectedClipIds: selected.includes(item.id)
          ? selected.filter((id) => id !== item.id)
          : [...selected, item.id],
      });
      return;
    }
    if (
      current === "slip" ||
      current === "slide" ||
      (current === "roll" && mode !== "move")
    ) {
      trimTool(e, item, mode);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    let ids = e.shiftKey
      ? [...new Set([...selected, item.id])]
      : selected.includes(item.id)
        ? selected
        : [item.id];
    const groups = new Set(
      t.clips
        .filter((c) => ids.includes(c.id) && c.groupId)
        .map((c) => c.groupId),
    );
    if (mode === "move")
      ids = [
        ...new Set([
          ...ids,
          ...t.clips
            .filter(
              (c) =>
                groups.has(c.groupId) &&
                !t.tracks.find((tr) => tr.id === c.trackId)?.locked,
            )
            .map((c) => c.id),
        ]),
      ];
    setState({ selectedClipIds: ids });
    const originalX = e.clientX,
      originalY = e.clientY,
      asset = p.assets.find((a) => a.id === item.assetId)!,
      bounds = trimBounds(t, item, asset),
      origin = t.tracks.findIndex((tr) => tr.id === item.trackId),
      earliest = Math.min(
        ...t.clips.filter((c) => ids.includes(c.id)).map((c) => c.start),
      ),
      marks = marksOf(t),
      // Clip edges, the playhead and the in/out marks attract a dragged clip.
      targets = [
        0,
        getState().playhead,
        ...[marks.in, marks.out].filter((m): m is number => m !== undefined),
        ...t.clips
          .filter((c) => !ids.includes(c.id))
          .flatMap((c) => [c.start, c.start + c.duration]),
      ];
    // Rows render in track order, so the row under the pointer is the target track index.
    const rowAt = (y: number) => {
      const rows = [
        ...inner.current!.querySelectorAll<HTMLElement>(".track-row"),
      ].map((row) => row.getBoundingClientRect());
      if (!rows.length || y < rows[0].top) return 0;
      const index = rows.findIndex((r) => y >= r.top && y < r.bottom);
      return index < 0 ? rows.length - 1 : index;
    };
    let latest: Draft | null = null,
      planned: ReturnType<typeof moveClips> | null = null,
      rows = 0,
      changed = false;
    const move = (ev: PointerEvent) => {
      const delta = Math.round(((ev.clientX - originalX) / zoom) * t.fps);
      if (
        Math.abs(ev.clientX - originalX) > 3 ||
        (mode === "move" && Math.abs(ev.clientY - originalY) > 3)
      )
        changed = true;
      if (!changed) return;
      if (mode === "move") {
        let shift = Math.max(-earliest, delta);
        if (snap) {
          const threshold = (t.fps * 6) / zoom;
          let pull: number | undefined;
          for (const n of targets)
            for (const edge of [item.start, item.start + item.duration]) {
              const d = n - (edge + shift);
              if (
                Math.abs(d) < threshold &&
                (pull === undefined || Math.abs(d) < Math.abs(pull))
              )
                pull = d;
            }
          if (pull !== undefined) shift = Math.max(-earliest, shift + pull);
        }
        rows = rowAt(ev.clientY) - origin;
        planned = moveClips(p, t, ids, shift, rows);
        const invalid = "error" in planned;
        const target = t.tracks[origin + rows];
        setDropTarget({
          trackId: target.id,
          frame: item.start + shift,
          valid: !invalid,
          label:
            "error" in planned
              ? planned.error
              : `${ids.length > 1 ? `${ids.length} 个片段 → ` : ""}${target.name} · ${formatTime(item.start + shift, t.fps)}`,
        });
        setDrafts(
          Object.fromEntries(
            t.clips
              .filter((c) => ids.includes(c.id))
              .map((c) => [
                c.id,
                {
                  start: c.start + shift,
                  trackId:
                    t.tracks[
                      t.tracks.findIndex((tr) => tr.id === c.trackId) + rows
                    ]?.id ?? c.trackId,
                  invalid,
                },
              ]),
          ),
        );
      } else if (mode === "left") {
        const start = Math.min(
            item.start + item.duration - 1,
            Math.max(bounds.minStart, item.start + delta),
          ),
          shift = start - item.start;
        latest = {
          start,
          duration: item.duration - shift,
          sourceOffset: hasSourceRange(asset)
            ? Math.max(0, item.sourceOffset + (shift / t.fps) * item.speed)
            : item.sourceOffset,
        };
        setDrafts({ [item.id]: latest });
      } else {
        latest = {
          duration: Math.max(
            1,
            Math.min(bounds.maxEnd - item.start, item.duration + delta),
          ),
        };
        setDrafts({ [item.id]: latest });
      }
    };
    const end = (event?: PointerEvent | KeyboardEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", cancel);
      setDrafts({});
      setDropTarget(null);
      if (event?.type === "pointercancel" || event?.type === "keydown") return;
      if (!changed) return;
      if (mode === "move") {
        if (!planned) return;
        if ("error" in planned) {
          notify(planned.error, true);
          return;
        }
        const moves = planned.moves.filter((m) => {
          const c = t.clips.find((c) => c.id === m.clipId)!;
          return c.start !== m.start || c.trackId !== m.trackId;
        });
        if (moves.length)
          void commit(
            moves.map((m) => ({
              type: "clip.update" as const,
              timelineId: t.id,
              clipId: m.clipId,
              patch: rows
                ? { start: m.start, trackId: m.trackId }
                : { start: m.start },
            })),
            rows ? "移动片段到其他轨道" : "移动片段",
          );
      } else if (latest) {
        const delta = (latest.start ?? item.start) - item.start,
          duration = latest.duration ?? item.duration;
        const keyframes = sliceKeyframes(item, delta, duration);
        void commit(
          [
            {
              type: "clip.update",
              timelineId: t.id,
              clipId: item.id,
              patch: { ...latest, keyframes },
            },
          ],
          "修剪片段",
        );
      }
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        end(event);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
    window.addEventListener("keydown", cancel);
  }
  // Clips are memoized; a stable handler keeps unchanged clips from re-rendering.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const onClipPointer = useCallback(
    (e: React.PointerEvent, item: Clip, mode: DragMode) =>
      dragRef.current(e, item, mode),
    [],
  );
  const openClip = useCallback((item: Clip) => {
    const project = getState().project;
    const asset = project?.assets.find((a) => a.id === item.assetId);
    if (asset?.kind === "sequence" && asset.sequenceTimelineId) {
      void commit(
        [{ type: "timeline.activate", timelineId: asset.sequenceTimelineId }],
        "打开嵌套序列",
      );
      setState({ playhead: 0, selectedClipIds: [] });
    } else setState({ panel: "inspector" });
  }, []);
  // The timeline that plays this one as a nested sequence, for the way back.
  const parent = useMemo(() => {
    const sequence = p.assets.find(
      (a) => a.kind === "sequence" && a.sequenceTimelineId === t.id,
    );
    return sequence
      ? p.timelines.find((x) => x.clips.some((c) => c.assetId === sequence.id))
      : undefined;
  }, [p.assets, p.timelines, t.id]);
  const run = (
    label: string,
    plan: (project: Project, timeline: Timeline) => Command[],
  ) => {
    setMenu(false);
    void commit((project) => plan(project, activeTimeline(project)), label);
  };
  const editAsset = (kind: "insert" | "overwrite") => {
    const asset = p.assets.find((a) => a.id === getState().selectedAssetId);
    if (!asset) {
      notify("请先在素材库里选择一个素材", true);
      return;
    }
    const want =
      asset.kind === "audio"
        ? "audio"
        : asset.kind === "text"
          ? "text"
          : asset.kind === "motion"
            ? "motion"
            : "video";
    run(kind === "insert" ? "插入编辑" : "覆盖编辑", (project, timeline) => {
      const track =
        timeline.tracks.find((x) => x.kind === want && !x.locked) ??
        timeline.tracks.find((x) => x.kind === "video" && !x.locked);
      if (!track) throw new Error("没有可用的轨道");
      const clip = clipSchema.parse({
        id: crypto.randomUUID(),
        assetId: asset.id,
        trackId: track.id,
        start: Math.round(getState().playhead),
        duration: Math.max(1, Math.round((asset.duration || 5) * timeline.fps)),
        name: asset.name,
        text: asset.text,
      });
      return (kind === "insert" ? insertEdit : overwriteEdit)(
        project,
        timeline,
        [clip],
        () => crypto.randomUUID(),
      );
    });
  };
  const addMarker = async () => {
    const label = await askText("标记名称", `标记 ${t.markers.length + 1}`);
    if (label === null) return;
    void commit(
      [
        {
          type: "marker.add",
          timelineId: t.id,
          marker: markerSchema.parse({
            id: crypto.randomUUID(),
            frame: Math.round(getState().playhead),
            label: label.trim() || `标记 ${t.markers.length + 1}`,
            color: "#7fd1ae",
          }),
        },
      ],
      "添加标记",
    );
  };
  const guide = (e: React.PointerEvent) => {
    const line = blade.current;
    if (!line) return;
    const rect = inner.current!.getBoundingClientRect(),
      x = e.clientX - rect.left;
    line.style.display = x > HEADER ? "block" : "none";
    line.style.transform = `translateX(${HEADER + (frameAt(e.clientX) / t.fps) * zoom}px)`;
  };
  const addTrack = () =>
    void commit(
      [
        {
          type: "track.add",
          timelineId: t.id,
          track: newTrack(t, "video", crypto.randomUUID()),
        },
      ],
      "添加轨道",
    );
  const closeMarkerMenu = useCallback(() => setMarkerMenu(null), []);
  // M adds a marker; the shortcut lives with the other keys in the workspace.
  const markerRef = useRef(addMarker);
  markerRef.current = addMarker;
  useEffect(() => {
    const listener = () => void markerRef.current();
    window.addEventListener("tadacut-add-marker", listener);
    return () => window.removeEventListener("tadacut-add-marker", listener);
  }, []);
  const assetsById = useMemo(
    () => new Map(p.assets.map((a) => [a.id, a])),
    [p.assets],
  );
  const ticks = useMemo(
    () =>
      Array.from({ length: Math.floor(seconds / every) + 1 }, (_, i) => (
        <span
          className="ruler-tick"
          key={i}
          style={{ left: HEADER + i * every * zoom }}
        >
          {formatTime(i * every * t.fps, t.fps).slice(0, 5)}
        </span>
      )),
    [seconds, every, zoom, t.fps],
  );
  return (
    <section className="timeline-editor" style={{ height }}>
      <div className="timeline-resizer" onPointerDown={resize} />
      <div className="timeline-toolbar">
        <select
          className="timeline-select"
          aria-label="切换时间线"
          value={t.id}
          onChange={(e) => {
            void commit(
              [{ type: "timeline.activate", timelineId: e.target.value }],
              "切换时间线",
            );
            setState({ playhead: 0, selectedClipIds: [] });
          }}
        >
          {p.timelines.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          title="新建时间线"
          onClick={() => void newTimeline()}
        >
          <Plus size={14} />
        </button>
        {parent && (
          <button
            className="subtle-button back-button"
            title={`返回「${parent.name}」`}
            onClick={() => {
              void commit(
                [{ type: "timeline.activate", timelineId: parent.id }],
                "返回上级时间线",
              );
              setState({ playhead: 0, selectedClipIds: [] });
            }}
          >
            <CornerLeftUp size={13} />
            {parent.name}
          </button>
        )}
        <span className="vertical-rule" />
        <div className="tool-group" role="radiogroup" aria-label="时间线工具">
          <button
            className={`tool-button ${tool === "select" ? "selected" : ""}`}
            role="radio"
            aria-checked={tool === "select"}
            title="选择工具（V）"
            onClick={() => setState({ tool: "select" })}
          >
            <MousePointer2 size={15} />
          </button>
          <button
            className={`tool-button ${tool === "blade" ? "selected" : ""}`}
            role="radio"
            aria-checked={tool === "blade"}
            title="刀片工具（B）：点击片段在该处分割"
            onClick={() => setState({ tool: "blade" })}
          >
            <Slice size={15} />
          </button>
          <button
            className={`tool-button ${tool === "slip" ? "selected" : ""}`}
            role="radio"
            aria-checked={tool === "slip"}
            title="滑移（Y）：位置与长度不变，左右拖动换用素材里的另一段"
            onClick={() => setState({ tool: "slip" })}
          >
            <MoveHorizontal size={15} />
          </button>
          <button
            className={`tool-button ${tool === "slide" ? "selected" : ""}`}
            role="radio"
            aria-checked={tool === "slide"}
            title="滑动（U）：移动片段，相邻片段自动收放，总长不变"
            onClick={() => setState({ tool: "slide" })}
          >
            <ArrowLeftRight size={15} />
          </button>
          <button
            className={`tool-button ${tool === "roll" ? "selected" : ""}`}
            role="radio"
            aria-checked={tool === "roll"}
            title="卷动（N）：拖动两个相邻片段之间的剪辑点"
            onClick={() => setState({ tool: "roll" })}
          >
            <Columns2 size={15} />
          </button>
        </div>
        <button
          className="icon-button"
          title="在播放头分割（S）"
          disabled={!selected.length}
          onClick={() => void splitSelected()}
        >
          <Scissors size={16} />
        </button>
        <button
          className="icon-button"
          title="删除片段（Delete）"
          disabled={!selected.length}
          onClick={() => void deleteSelected()}
        >
          <Trash2 size={15} />
        </button>
        <button
          className="icon-button"
          title="复制片段（⌘ C）"
          disabled={!selected.length}
          onClick={copySelected}
        >
          <Copy size={15} />
        </button>
        <button
          className="icon-button"
          title="粘贴到播放头（⌘ V）"
          disabled={!copied}
          onClick={() => void pasteClipboard()}
        >
          <ClipboardPaste size={15} />
        </button>
        <button
          className="icon-button"
          title="将片段编组"
          disabled={selected.length < 2}
          onClick={() =>
            void commit(
              [
                {
                  type: "clip.group",
                  timelineId: t.id,
                  clipIds: selected,
                  groupId: crypto.randomUUID(),
                },
              ],
              "片段编组",
            )
          }
        >
          <Group size={16} />
        </button>
        <button
          className="icon-button"
          title="在播放头添加标记（M）"
          onClick={() => void addMarker()}
        >
          <Bookmark size={15} />
        </button>
        <div className="menu-anchor">
          <button
            className="subtle-button"
            title="更多剪辑操作"
            onClick={() => setMenu(!menu)}
          >
            剪辑
            <ChevronDown size={12} />
          </button>
          {menu && (
            <div
              className="dropdown timeline-menu"
              onMouseLeave={() => setMenu(false)}
            >
              <button onClick={() => editAsset("insert")}>
                <ListPlus size={14} />
                插入所选素材<small>后面的片段后移</small>
              </button>
              <button onClick={() => editAsset("overwrite")}>
                <Replace size={14} />
                覆盖所选素材<small>替换播放头处的内容</small>
              </button>
              <button
                disabled={!selected.length}
                onClick={() =>
                  run("波纹删除", (_project, timeline) =>
                    rippleDelete(timeline, selected, () => crypto.randomUUID()),
                  )
                }
              >
                <Trash2 size={14} />
                波纹删除<small>删除并补齐空隙（⇧ Delete）</small>
              </button>
              <button
                onClick={() =>
                  run("删除空隙", (_project, timeline) => closeGaps(timeline))
                }
              >
                <Minus size={14} />
                删除全部空隙
              </button>
              <button
                disabled={!selected.length}
                onClick={() =>
                  run("创建副本", (_project, timeline) =>
                    duplicateClips(timeline, selected, () =>
                      crypto.randomUUID(),
                    ),
                  )
                }
              >
                <Copy size={14} />
                创建副本
              </button>
              <button
                disabled={selected.length < 2}
                onClick={() =>
                  run("链接片段", (_project, timeline) => [
                    {
                      type: "clip.link",
                      timelineId: timeline.id,
                      clipIds: selected,
                      linkId: crypto.randomUUID(),
                    },
                  ])
                }
              >
                <Link2 size={14} />
                链接片段<small>画面和声音一起移动、修剪</small>
              </button>
              <button
                disabled={
                  !t.clips.some((c) => selected.includes(c.id) && c.linkId)
                }
                onClick={() =>
                  run("取消链接", (_project, timeline) => [
                    {
                      type: "clip.link",
                      timelineId: timeline.id,
                      clipIds: selected,
                      linkId: null,
                    },
                  ])
                }
              >
                <Link2 size={14} />
                取消链接
              </button>
              <button
                disabled={!selected.length}
                onClick={async () => {
                  setMenu(false);
                  const name = await askText("嵌套序列名称", "嵌套序列");
                  if (name === null) return;
                  void commit(
                    (project) =>
                      nestClips(
                        activeTimeline(project),
                        selected,
                        () => crypto.randomUUID(),
                        new Date().toISOString(),
                        name.trim() || "嵌套序列",
                      ).commands,
                    "打包为嵌套序列",
                  ).then((ok) => ok && setState({ selectedClipIds: [] }));
                }}
              >
                <Layers size={14} />
                打包为嵌套序列<small>双击序列片段进入编辑</small>
              </button>
            </div>
          )}
        </div>
        <span className="vertical-rule" />
        <button
          className="icon-button"
          title="撤销（⌘ Z）"
          onClick={() => void travel("undo")}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-button"
          title="重做（⌘ ⇧ Z）"
          onClick={() => void travel("redo")}
        >
          <Redo2 size={15} />
        </button>
        <div className="toolbar-spacer" />
        <button
          className={`icon-button ${snap ? "chosen" : ""}`}
          title="磁吸"
          aria-pressed={snap}
          onClick={() => setState({ snap: !snap })}
        >
          <Magnet size={16} />
        </button>
        <span className="vertical-rule" />
        <button
          className="icon-button"
          title="缩小时间线"
          onClick={() => setState({ zoom: Math.max(10, zoom - 10) })}
        >
          <Minus size={14} />
        </button>
        <input
          className="zoom-range"
          aria-label="时间线缩放"
          type="range"
          min="10"
          max="120"
          value={zoom}
          onChange={(e) => setState({ zoom: Number(e.target.value) })}
        />
        <button
          className="icon-button"
          title="放大时间线"
          onClick={() => setState({ zoom: Math.min(120, zoom + 10) })}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="timeline-scroll" ref={scroll}>
        <div
          className={`timeline-inner ${tool === "blade" ? "blade-mode" : ""}`}
          ref={inner}
          style={{ width: width + HEADER }}
          onPointerMove={tool === "blade" ? guide : undefined}
          onPointerLeave={() => {
            if (blade.current) blade.current.style.display = "none";
          }}
        >
          <div className="timeline-ruler" onPointerDown={scrub}>
            <div className="ruler-name">
              <button
                title="添加轨道"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={addTrack}
              >
                <Plus size={12} />
                添加轨道
              </button>
            </div>
            {ticks}
            <MarkRange t={t} zoom={zoom} frameAt={frameAt} />
          </div>
          {t.tracks.map((track) => (
            <div
              key={track.id}
              className={`track-row ${track.locked ? "locked" : ""} ${dropTarget?.trackId === track.id ? (dropTarget.valid ? "drop-valid" : "drop-invalid") : ""}`}
              data-track-id={track.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("application/tadacut-asset"))
                  return;
                e.preventDefault();
                e.dataTransfer.dropEffect = track.locked ? "none" : "copy";
                setDropTarget({
                  trackId: track.id,
                  frame: frameAt(e.clientX),
                  valid: !track.locked,
                  label: track.locked
                    ? "目标轨道已锁定"
                    : `${track.name} · ${formatTime(frameAt(e.clientX), t.fps)}`,
                });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                try {
                  const data = e.dataTransfer.getData(
                    "application/tadacut-assets",
                  );
                  const references = data
                    ? referenceSchema.array().max(100).parse(JSON.parse(data))
                    : [
                        {
                          id: e.dataTransfer.getData(
                            "application/tadacut-asset",
                          ),
                          projectId: p.id,
                        },
                      ];
                  const sources = getState().projects;
                  const materials = references
                    .map((r) =>
                      sources
                        .find((p) => p.id === r.projectId)
                        ?.assets.find((a) => a.id === r.id),
                    )
                    .filter((a): a is Asset => Boolean(a));
                  if (!materials.length) return;
                  if (track.locked) throw new Error("目标轨道已锁定");
                  const issue = materials
                    .map((a) => placementIssue(track.kind, a))
                    .find(Boolean);
                  if (issue) throw new Error(issue);
                  void addAssetsToTimeline(
                    materials,
                    frameAt(e.clientX),
                    track.id,
                  );
                } catch (error) {
                  notify(String(error), true);
                }
              }}
            >
              <div className="track-label">
                <div>
                  <span className={`track-type ${track.kind}`}>
                    {track.kind === "audio" ? (
                      <Music2 size={12} />
                    ) : track.kind === "text" ? (
                      <Type size={12} />
                    ) : track.kind === "motion" ? (
                      <WandSparkles size={12} />
                    ) : (
                      <Film size={12} />
                    )}
                  </span>
                  <span>{track.name}</span>
                </div>
                <div className="track-controls">
                  <button
                    title={
                      track.syncLock
                        ? "关闭同步锁定"
                        : "同步锁定：其他轨道波纹编辑时这条轨道一起移动"
                    }
                    aria-pressed={track.syncLock}
                    className={track.syncLock ? "on" : ""}
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "track.update",
                            timelineId: t.id,
                            trackId: track.id,
                            patch: { syncLock: !track.syncLock },
                          },
                        ],
                        "轨道同步锁定",
                      )
                    }
                  >
                    <Anchor size={12} />
                  </button>
                  <button
                    title={track.muted ? "取消静音" : "静音"}
                    aria-pressed={track.muted}
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "track.update",
                            timelineId: t.id,
                            trackId: track.id,
                            patch: { muted: !track.muted },
                          },
                        ],
                        "轨道静音",
                      )
                    }
                  >
                    {track.muted ? (
                      <VolumeX size={12} />
                    ) : (
                      <Volume2 size={12} />
                    )}
                  </button>
                  <button
                    title={track.hidden ? "显示轨道" : "隐藏轨道"}
                    aria-pressed={track.hidden}
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "track.update",
                            timelineId: t.id,
                            trackId: track.id,
                            patch: { hidden: !track.hidden },
                          },
                        ],
                        "轨道显示",
                      )
                    }
                  >
                    {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    title={track.locked ? "解锁轨道" : "锁定轨道"}
                    aria-pressed={track.locked}
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "track.update",
                            timelineId: t.id,
                            trackId: track.id,
                            patch: { locked: !track.locked },
                          },
                        ],
                        "轨道锁定",
                      )
                    }
                  >
                    {track.locked ? (
                      <LockKeyhole size={12} />
                    ) : (
                      <UnlockKeyhole size={12} />
                    )}
                  </button>
                </div>
              </div>
              <div
                className="track-clips"
                style={{ backgroundSize: `${every * zoom}px 100%` }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    setState({ selectedClipIds: [] });
                    scrub(e);
                  }
                }}
              >
                {dropTarget?.trackId === track.id && (
                  <div
                    className={`drop-guide ${dropTarget.valid ? "" : "invalid"}`}
                    style={{ left: (dropTarget.frame / t.fps) * zoom }}
                  >
                    <span>{dropTarget.label}</span>
                  </div>
                )}
                {t.clips
                  .filter(
                    (c) => (drafts[c.id]?.trackId ?? c.trackId) === track.id,
                  )
                  .map((item) => {
                    const draft = drafts[item.id];
                    return (
                      <TimelineClip
                        key={item.id}
                        clip={draft ? { ...item, ...draft } : item}
                        source={item}
                        asset={assetsById.get(item.assetId)!}
                        fps={t.fps}
                        zoom={zoom}
                        selected={selected.includes(item.id)}
                        dragging={Boolean(draft)}
                        invalid={Boolean(draft?.invalid)}
                        onPointer={onClipPointer}
                        onOpen={openClip}
                        hint={hint?.clipId === item.id ? hint.text : undefined}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
          <Playhead t={t} zoom={zoom} frameAt={frameAt} scroll={scroll} />
          <div className="blade-guide" ref={blade} />
          {t.markers.map((m) => (
            <span key={m.id}>
              {m.duration > 0 && (
                <i
                  className="timeline-marker-range"
                  style={{
                    left: HEADER + (m.frame / t.fps) * zoom,
                    width: (m.duration / t.fps) * zoom,
                    background: m.color,
                  }}
                />
              )}
              <button
                className="timeline-marker"
                style={{
                  left: HEADER + (m.frame / t.fps) * zoom,
                  color: m.color,
                }}
                title={`${m.label}${m.note ? `\n${m.note}` : ""}\n单击跳转 · 双击改名 · 右键更多`}
                onClick={() => seek(m.frame)}
                onDoubleClick={async () => {
                  const label = await askText("标记名称", m.label);
                  if (label === null || label === m.label) return;
                  void commit(
                    [
                      {
                        type: "marker.update",
                        timelineId: t.id,
                        markerId: m.id,
                        patch: { label: label.trim() || m.label },
                      },
                    ],
                    "修改标记",
                  );
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMarkerMenu({ id: m.id, x: e.clientX, y: e.clientY });
                }}
              >
                ◆
              </button>
            </span>
          ))}
          {markerMenu &&
            (() => {
              const marker = t.markers.find((x) => x.id === markerMenu.id);
              return marker ? (
                <MarkerMenu
                  t={t}
                  marker={marker}
                  at={markerMenu}
                  close={closeMarkerMenu}
                />
              ) : null;
            })()}
        </div>
      </div>
      <div className="timeline-bottom">
        <span>{t.tracks.length} 条轨道</span>
        <span>
          {tool === "blade"
            ? "刀片工具 · 点击片段分割 · V 回到选择工具"
            : tool === "slip"
              ? "滑移 · 左右拖动片段换用素材的另一段 · V 回到选择工具"
              : tool === "slide"
                ? "滑动 · 拖动片段，相邻片段自动收放 · V 回到选择工具"
                : tool === "roll"
                  ? "卷动 · 拖动片段边缘移动剪辑点 · V 回到选择工具"
                  : selected.length
                    ? `${selected.length} 个片段已选择 · ⌘C 复制 · ⌘V 粘贴到播放头`
                    : "拖动移动，上下拖到同类轨道 · 边缘修剪 · J/K/L 穿梭 · I/O 入出点"}
        </span>
        <span>
          {formatTime(durationInFrames(t), t.fps)} <small>总时长</small>
        </span>
      </div>
    </section>
  );
}
const TimelineClip = memo(function TimelineClip({
  clip: c,
  source,
  asset,
  fps,
  zoom,
  selected,
  dragging,
  invalid,
  onPointer,
  onOpen,
  hint,
}: {
  clip: Clip;
  source: Clip;
  asset: Asset;
  fps: number;
  zoom: number;
  selected: boolean;
  dragging: boolean;
  invalid: boolean;
  onPointer(e: React.PointerEvent, item: Clip, mode: DragMode): void;
  onOpen(item: Clip): void;
  hint?: string;
}) {
  const wave = useMemo(
    () =>
      asset.waveform?.length
        ? asset.waveform
            .map(
              (v, i) =>
                `M${(i / asset.waveform!.length) * 400} ${14 - Math.min(1, v * 3) * 13}v${Math.min(1, v * 3) * 26}`,
            )
            .join(" ")
        : "M0 14H400",
    [asset.waveform],
  );
  const strip =
    asset.kind === "image"
      ? asset.thumbnail || asset.url
      : asset.kind === "video"
        ? asset.thumbnail
        : undefined;
  return (
    <div
      className={`timeline-clip ${asset.kind} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${invalid ? "invalid" : ""}`}
      style={
        {
          transform: `translateX(${(c.start / fps) * zoom}px)`,
          width: Math.max(6, (c.duration / fps) * zoom),
          "--clip-color": asset.color,
        } as React.CSSProperties
      }
      onPointerDown={(e) => onPointer(e, source, "move")}
      onDoubleClick={() => onOpen(source)}
      title={`${c.name || asset.name} · ${formatTime(c.duration, fps)}`}
    >
      <div className="clip-label">
        {asset.kind === "audio" ? (
          <Music2 size={11} />
        ) : asset.kind === "text" ? (
          <Type size={11} />
        ) : (
          <Film size={11} />
        )}
        <span>{c.name || asset.name}</span>
        {Object.keys(c.keyframes).length > 0 && (
          <span className="keyframe-mark">◇</span>
        )}
        {c.linkId && <Link2 size={10} className="clip-link" />}
        {c.effects.presets.length > 0 && <span className="clip-fx">fx</span>}
      </div>
      {hint && <span className="clip-hint">{hint}</span>}
      {strip && (
        <div
          className="clip-thumbnails"
          style={{ backgroundImage: `url("${strip}")` }}
        />
      )}
      {asset.kind === "audio" && (
        <svg
          className="clip-waveform"
          viewBox="0 0 400 28"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wave} stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      <i
        className="trim-handle left"
        onPointerDown={(e) => onPointer(e, source, "left")}
      />
      <i
        className="trim-handle right"
        onPointerDown={(e) => onPointer(e, source, "right")}
      />
      {c.transition && (
        <span className="clip-transition" title="转场">
          ⋈
        </span>
      )}
    </div>
  );
});
/** The only part of the timeline that follows every playback frame. */
function Playhead({
  t,
  zoom,
  frameAt,
  scroll,
}: {
  t: Timeline;
  zoom: number;
  frameAt(clientX: number): number;
  scroll: React.RefObject<HTMLDivElement | null>;
}) {
  const frame = useStudio((s) => s.playhead),
    playing = useStudio((s) => s.playing),
    x = HEADER + (frame / t.fps) * zoom;
  useEffect(() => {
    const view = scroll.current;
    if (!playing || !view) return;
    // While playing, page the view so the playhead stays visible.
    const left = view.scrollLeft + HEADER,
      right = view.scrollLeft + view.clientWidth;
    if (x < left || x > right - 24)
      view.scrollLeft = Math.max(0, x - HEADER - 48);
  }, [x, playing, scroll]);
  return (
    <div className="playhead" style={{ transform: `translateX(${x}px)` }}>
      <button
        className="playhead-handle"
        title="拖动播放头"
        aria-label="播放头"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => seek(frameAt(ev.clientX));
          const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", end);
        }}
      />
    </div>
  );
}
/** The in/out range on the ruler; its edges can be dragged. */
function MarkRange({
  t,
  zoom,
  frameAt,
}: {
  t: Timeline;
  zoom: number;
  frameAt(clientX: number): number;
}) {
  const marks = useStudio((s) => s.marks[t.id]);
  if (!marks || (marks.in === undefined && marks.out === undefined))
    return null;
  const end = Math.max(durationInFrames(t), marks.out ?? 0),
    from = marks.in ?? 0,
    to = marks.out ?? end,
    left = HEADER + (from / t.fps) * zoom,
    right = HEADER + (to / t.fps) * zoom;
  const handle = (which: "in" | "out") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => moveMark(which, frameAt(ev.clientX));
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  };
  return (
    <div
      className="mark-range"
      style={{ left, width: Math.max(1, right - left) }}
      title={`入出点 · ${formatTime(to - from, t.fps)}`}
    >
      {marks.in !== undefined && (
        <i
          className="mark-handle in"
          onPointerDown={handle("in")}
          title="拖动入点"
        />
      )}
      {marks.out !== undefined && (
        <i
          className="mark-handle out"
          onPointerDown={handle("out")}
          title="拖动出点"
        />
      )}
    </div>
  );
}
