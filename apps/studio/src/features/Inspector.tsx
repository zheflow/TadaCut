import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Diamond,
  Film,
  Layers,
  Link2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  activeTimeline,
  applyLayout,
  assetSchema,
  autoGrade,
  beatSlideshow,
  beatsOnTimeline,
  bezierPresets,
  cameraKeyframes,
  cameraMoveNames,
  cameraMoves,
  captionAnimationNames,
  captionAnimations,
  captionPresets,
  captionStyleSchema,
  cubicBezier,
  diffClips,
  duckMusic,
  effectCategories,
  effectPresets,
  fitMusicClip,
  focusFromClicks,
  freeAreaPatch,
  formatTime,
  generateLook,
  isLutAsset,
  keyframeProperties,
  layoutNames,
  layouts,
  looks,
  newTrack,
  serializeCube,
  snapCutsToBeats,
  textStyleSchema,
  transitionList,
  watermarkSchema,
  type CameraMove,
  type Clip,
  type Command,
  type KeyframeProperty,
  type Layout,
  type LookId,
  type Project,
  type TextStyle,
  type Timeline,
  type TransitionKind,
} from "@tadacut/domain";
import {
  audioAnalysis,
  localFonts,
  type AudioAnalysis,
} from "../lib/studio-api";
import {
  askText,
  commit,
  notify,
  setState,
  startJob,
  useIdlePlayhead,
  useStudio,
} from "../lib/store";
import { ScopesPanel } from "./Scopes";
import { subjectsUnder } from "./LocalTools";

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          defaultValue={Number(value.toFixed(3))}
          key={value}
          min={min}
          max={max}
          step={step}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v === value) return;
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}
/** A slider that previews locally and commits once when released, so dragging is one undo step. */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (v) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?(v: number): string;
  onChange(value: number): void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const done = () => {
    if (local !== value) onChange(local);
  };
  return (
    <label className="slider-field">
      <span>
        {label}
        <small>{format(local)}</small>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={done}
        onKeyUp={done}
        onBlur={done}
      />
    </label>
  );
}
function ColorField({
  label,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  value: string | undefined;
  onChange(value: string | undefined): void;
  allowNone?: boolean;
}) {
  const shown = value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <label className="color-field">
      <span>{label}</span>
      <div>
        <input
          type="color"
          value={shown}
          onChange={(e) => onChange(e.target.value)}
        />
        {allowNone && (
          <button
            className={`text-button ${!value || value === "transparent" ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              onChange(undefined);
            }}
          >
            无
          </button>
        )}
      </div>
    </label>
  );
}
const propertyNames: Record<KeyframeProperty, string> = {
  x: "位置 X",
  y: "位置 Y",
  scale: "缩放",
  scaleX: "横向缩放",
  scaleY: "纵向缩放",
  rotation: "旋转",
  opacity: "透明度",
  volume: "音量",
  focusX: "聚焦 X",
  focusY: "聚焦 Y",
  radius: "圆角",
};
type Patch = (value: Partial<Clip>, label?: string) => void;
export function Inspector() {
  const p = useStudio((s) => s.project)!,
    selected = useStudio((s) => s.selectedClipIds),
    t = activeTimeline(p);
  const c = t.clips.find((c) => c.id === selected[0]);
  const asset = c && p.assets.find((a) => a.id === c.assetId);
  const textual = Boolean(c && (asset?.kind === "text" || c.caption));
  const tabs = useMemo(
    () =>
      [
        ["basic", "画面"],
        ...(textual ? [["text", "文字"]] : []),
        ["effects", "特效"],
        ["color", "调色"],
        ["transition", "转场"],
        ["keyframes", "关键帧"],
      ] as [string, string][],
    [textual],
  );
  const [tab, setTab] = useState("basic");
  useEffect(() => {
    if (!tabs.some(([id]) => id === tab)) setTab("basic");
  }, [tabs, tab]);
  if (!c || !asset)
    return <TimelineSettings p={p} t={t} count={selected.length} />;
  const patch: Patch = (value, label = "调整片段属性") =>
    void commit(
      [{ type: "clip.update", timelineId: t.id, clipId: c.id, patch: value }],
      label,
    );
  return (
    <div className="inspector">
      <div className="panel-heading">
        <span>片段属性</span>
        <small>
          {asset.kind === "sequence" ? "嵌套序列" : asset.kind.toUpperCase()}
          {selected.length > 1 ? ` · 已选 ${selected.length}` : ""}
        </small>
      </div>
      <div className="inspector-name">
        <strong>{c.name || asset.name}</strong>
        <span>{formatTime(c.duration, t.fps)}</span>
      </div>
      {(c.linkId || c.groupId) && (
        <div className="inspector-badges">
          {c.linkId && (
            <span className="quiet-badge">
              <Link2 size={10} /> 已链接
            </span>
          )}
          {c.groupId && <span className="quiet-badge">已编组</span>}
        </div>
      )}
      <div className="inspector-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="inspector-scroll">
        {tab === "basic" ? (
          <BasicTab p={p} t={t} c={c} patch={patch} />
        ) : tab === "text" ? (
          <TextTab p={p} t={t} c={c} patch={patch} />
        ) : tab === "effects" ? (
          <EffectsTab c={c} patch={patch} />
        ) : tab === "color" ? (
          <ColorTab p={p} t={t} c={c} patch={patch} />
        ) : tab === "transition" ? (
          <TransitionTab t={t} c={c} patch={patch} />
        ) : (
          <KeyframesTab t={t} c={c} patch={patch} />
        )}
      </div>
    </div>
  );
}
function BasicTab({
  p,
  t,
  c,
  patch,
}: {
  p: Project;
  t: Timeline;
  c: Clip;
  patch: Patch;
}) {
  const asset = p.assets.find((a) => a.id === c.assetId)!;
  const crop = c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const [move, setMove] = useState<CameraMove>("slow-push");
  return (
    <>
      <h4>画面变换</h4>
      <div className="field-grid">
        <NumberField label="X" value={c.x} onChange={(x) => patch({ x })} />
        <NumberField label="Y" value={c.y} onChange={(y) => patch({ y })} />
        <NumberField
          label="缩放"
          value={c.scale * 100}
          min={1}
          max={2000}
          suffix="%"
          onChange={(v) => patch({ scale: v / 100 })}
        />
        <NumberField
          label="旋转"
          value={c.rotation}
          suffix="°"
          onChange={(rotation) => patch({ rotation })}
        />
        <NumberField
          label="横向"
          value={c.scaleX * 100}
          min={1}
          max={2000}
          suffix="%"
          onChange={(v) => patch({ scaleX: v / 100 })}
        />
        <NumberField
          label="纵向"
          value={c.scaleY * 100}
          min={1}
          max={2000}
          suffix="%"
          onChange={(v) => patch({ scaleY: v / 100 })}
        />
      </div>
      <RangeField
        label="透明度"
        value={c.opacity}
        min={0}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => patch({ opacity })}
      />
      <label className="select-field">
        <span>素材适配</span>
        <select
          value={c.fit}
          onChange={(e) => patch({ fit: e.target.value as Clip["fit"] })}
        >
          <option value="cover">填满画幅</option>
          <option value="contain">完整显示</option>
        </select>
      </label>
      <h4>裁切与圆角</h4>
      <div className="field-grid">
        {(["left", "top", "right", "bottom"] as const).map((edge) => (
          <NumberField
            key={edge}
            label={{ left: "左", top: "上", right: "右", bottom: "下" }[edge]}
            value={crop[edge] * 100}
            min={0}
            max={95}
            suffix="%"
            onChange={(v) =>
              patch({ crop: { ...crop, [edge]: v / 100 } }, "裁切画面")
            }
          />
        ))}
      </div>
      <NumberField
        label="圆角"
        value={c.radius}
        min={0}
        max={2000}
        suffix="px"
        onChange={(radius) => patch({ radius }, "设置圆角")}
      />
      {(c.crop || c.radius > 0) && (
        <button
          className="text-button"
          onClick={() => {
            const { crop: _crop, ...rest } = c;
            // Removing an optional field replaces the clip; the domain diff plans that.
            void commit(
              diffClips(t.id, [c], [{ ...rest, radius: 0 } as Clip]),
              "清除裁切与圆角",
            );
          }}
        >
          <RotateCcw size={11} />
          清除裁切与圆角
        </button>
      )}
      <h4>时间与声音</h4>
      <div className="field-grid">
        <NumberField
          label="变速"
          value={c.speed}
          min={0.05}
          max={16}
          step={0.1}
          suffix="×"
          onChange={(speed) => patch({ speed })}
        />
        <NumberField
          label="音量"
          value={c.volume * 100}
          min={0}
          max={400}
          suffix="%"
          onChange={(v) => patch({ volume: v / 100 })}
        />
        <NumberField
          label="淡入"
          value={c.fadeIn / t.fps}
          min={0}
          step={0.1}
          suffix="s"
          onChange={(v) => patch({ fadeIn: Math.round(v * t.fps) })}
        />
        <NumberField
          label="淡出"
          value={c.fadeOut / t.fps}
          min={0}
          step={0.1}
          suffix="s"
          onChange={(v) => patch({ fadeOut: Math.round(v * t.fps) })}
        />
      </div>
      {asset.kind !== "audio" && (
        <>
          <h4>镜头运动</h4>
          <div className="inline-form">
            <select
              value={move}
              onChange={(e) => setMove(e.target.value as CameraMove)}
            >
              {cameraMoves.map((m) => (
                <option key={m} value={m}>
                  {cameraMoveNames[m]}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              onClick={() =>
                patch(
                  { keyframes: cameraKeyframes(t, c, move) },
                  `镜头运动：${cameraMoveNames[move]}`,
                )
              }
            >
              应用
            </button>
          </div>
          <LayoutSection t={t} />
          {asset.kind !== "sequence" && <FreeAreaButton p={p} t={t} c={c} />}
        </>
      )}
      {asset.kind === "audio" && <MusicSection p={p} t={t} c={c} />}
      {asset.kind === "sequence" && asset.sequenceTimelineId && (
        <button
          className="secondary-button"
          onClick={() => {
            void commit(
              [
                {
                  type: "timeline.activate",
                  timelineId: asset.sequenceTimelineId!,
                },
              ],
              "打开嵌套序列",
            );
            setState({ playhead: 0, selectedClipIds: [] });
          }}
        >
          <Layers size={13} />
          打开嵌套序列
        </button>
      )}
      {asset.kind === "motion" && (
        <button
          className="secondary-button"
          title="渲染成带透明背景的 ProRes 视频，放进素材库，原动画保留"
          onClick={() =>
            void startJob("bake-motion", `「${asset.name}」转视频`, {
              clipId: c.id,
              codec: "prores",
              timelineId: t.id,
            })
          }
        >
          <Film size={13} />
          渲染为透明视频素材
        </button>
      )}
      {asset.clicks?.length ? (
        <button
          className="secondary-button"
          onClick={() =>
            patch(
              {
                keyframes: {
                  ...c.keyframes,
                  ...focusFromClicks(
                    asset
                      .clicks!.filter(
                        (k) =>
                          k.time >= c.sourceOffset &&
                          k.time <
                            c.sourceOffset + (c.duration / t.fps) * c.speed,
                      )
                      .map((k) => ({
                        ...k,
                        time: (k.time - c.sourceOffset) / c.speed,
                      })),
                    t.fps,
                    c.duration,
                  ),
                },
              },
              "根据录制点击添加聚焦",
            )
          }
        >
          根据会话点击聚焦
        </button>
      ) : null}
    </>
  );
}
/** Moves a graphic, text or picture-in-picture layer to where it covers the fewest people below it. */
function FreeAreaButton({ p, t, c }: { p: Project; t: Timeline; c: Clip }) {
  const [status, setStatus] = useState("");
  const place = async () => {
    setStatus("读取画面…");
    try {
      // A few moments of the clip, so a subject that moves is still avoided.
      const frames = [0.2, 0.5, 0.8].map(
          (at) => c.start + Math.floor(c.duration * at),
        ),
        { boxes, checked } = await subjectsUnder(
          p,
          t,
          frames,
          setStatus,
          (id) => id === c.id,
        );
      if (!checked) return notify("这个图层下面没有可以检测的画面", true);
      let covered = 0;
      const ok = await commit((project) => {
        const tl = activeTimeline(project),
          clip = tl.clips.find((x) => x.id === c.id),
          asset = clip && project.assets.find((a) => a.id === clip.assetId);
        if (!clip || !asset) throw new Error("片段已不在当前时间线上");
        const result = freeAreaPatch(tl, clip, asset, boxes);
        covered = result.covered;
        return [
          {
            type: "clip.update",
            timelineId: tl.id,
            clipId: clip.id,
            patch: result.patch,
          },
        ];
      }, "放到画面空白处");
      if (ok)
        notify(
          !boxes.length
            ? "没有检测到人物，图层放在了画面的三分线附近"
            : covered > 0.001
              ? "画面里没有完全空出的位置，已移到遮挡最少的地方"
              : "已移到不遮挡人物的位置",
        );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setStatus("");
    }
  };
  return (
    <button
      className="secondary-button"
      disabled={Boolean(status)}
      title="用本机人物检测找出画面里的空白区域"
      onClick={() => void place()}
    >
      {status || "移到画面空白处"}
    </button>
  );
}
/** Arranges the selected picture clips into a split screen, grid or picture-in-picture. */
function LayoutSection({ t }: { t: Timeline }) {
  const selected = useStudio((s) => s.selectedClipIds);
  const [layout, setLayout] = useState<Layout>("side-by-side"),
    [gap, setGap] = useState(0.02);
  const visual = selected.filter((id) => {
    const clip = t.clips.find((x) => x.id === id),
      kind = clip && t.tracks.find((x) => x.id === clip.trackId)?.kind;
    return kind === "video" || kind === "motion";
  });
  return (
    <>
      <h4>画面布局</h4>
      <div className="inline-form">
        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value as Layout)}
        >
          {layouts.map((l) => (
            <option key={l} value={l}>
              {layoutNames[l]}
            </option>
          ))}
        </select>
        <button
          className="secondary-button"
          disabled={!visual.length}
          onClick={() =>
            void commit(
              (project) =>
                applyLayout(activeTimeline(project), visual, layout, { gap }),
              `画面布局：${layoutNames[layout]}`,
            )
          }
        >
          应用
        </button>
      </div>
      <RangeField
        label="间距"
        value={gap}
        min={0}
        max={0.1}
        step={0.005}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={setGap}
      />
      <p className="small-description">
        按选择顺序排入所选的 {visual.length} 个画面片段（按住 Shift
        多选）；画中画由第一个片段铺满画面。
      </p>
    </>
  );
}
/** Music tools for an audio clip: ducking under speech, cutting to the beat and shortening by bars. */
function MusicSection({ p, t, c }: { p: Project; t: Timeline; c: Clip }) {
  const visualTracks = t.tracks.filter(
      (x) => (x.kind === "video" || x.kind === "motion") && !x.locked,
    ),
    folders = [
      ...new Set(
        p.assets
          .filter((a) => a.kind === "image" || a.kind === "video")
          .map((a) => a.folder),
      ),
    ];
  const [busy, setBusy] = useState(""),
    [depth, setDepth] = useState(0.25),
    [trackId, setTrackId] = useState(visualTracks[0]?.id ?? ""),
    [tolerance, setTolerance] = useState(8),
    [folder, setFolder] = useState(""),
    [perShot, setPerShot] = useState(2),
    [target, setTarget] = useState(
      Math.max(1, Math.round(c.duration / t.fps / 2)),
    );
  /** Runs with the beats of this clip's sound, analysed on this computer the first time. */
  const analysed = async (
    label: string,
    work: (analysis: AudioAnalysis) => Promise<unknown>,
  ) => {
    setBusy(label);
    try {
      await work(await audioAnalysis(c.assetId));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy("");
    }
  };
  const music = (project: Project) => {
    const tl = activeTimeline(project),
      clip = tl.clips.find((x) => x.id === c.id);
    if (!clip) throw new Error("配乐片段已不在当前时间线上");
    return { tl, clip };
  };
  return (
    <>
      <h4>节奏与配乐</h4>
      <div className="inline-form">
        <select
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          title="有人说话时配乐的音量"
        >
          <option value={0.15}>说话时 15%</option>
          <option value={0.25}>说话时 25%</option>
          <option value={0.4}>说话时 40%</option>
        </select>
        <button
          className="secondary-button"
          disabled={Boolean(busy)}
          onClick={() =>
            void commit(
              (project) =>
                duckMusic(project, music(project).tl, {
                  clipIds: [c.id],
                  depth,
                }),
              "配乐自动闪避",
            )
          }
        >
          自动闪避
        </button>
      </div>
      <p className="small-description">
        按文稿或对白、旁白轨道找出说话的时段，在这些时段压低这段配乐。
      </p>
      <label className="select-field">
        <span>卡点画面轨道</span>
        <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
          {visualTracks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-form">
        <NumberField
          label="最多移动"
          value={tolerance}
          min={1}
          max={30}
          suffix="帧"
          onChange={setTolerance}
        />
        <button
          className="secondary-button"
          disabled={Boolean(busy) || !trackId}
          onClick={() =>
            void analysed("对齐节拍", async (analysis) => {
              let moved = 0;
              const ok = await commit((project) => {
                const { tl, clip } = music(project),
                  result = snapCutsToBeats(
                    project,
                    tl,
                    trackId,
                    beatsOnTimeline(tl, clip, analysis.beats),
                    tolerance,
                  );
                moved = result.moved;
                return result.commands;
              }, "剪辑点对齐节拍");
              if (ok)
                notify(
                  moved
                    ? `已把 ${moved} 个剪辑点对齐到节拍（约 ${Math.round(analysis.bpm)} BPM）`
                    : "在容差内没有可以对齐的剪辑点",
                );
            })
          }
        >
          剪辑点对齐节拍
        </button>
      </div>
      <div className="inline-form">
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          title="相册用哪些素材"
        >
          <option value="">所有图片</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={perShot}
          onChange={(e) => setPerShot(Number(e.target.value))}
        >
          {[1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>
              每 {n} 拍换一张
            </option>
          ))}
        </select>
      </div>
      <button
        className="secondary-button"
        disabled={Boolean(busy)}
        onClick={() =>
          void analysed("生成卡点相册", (analysis) =>
            commit((project) => {
              const { tl, clip } = music(project),
                assetIds = project.assets
                  .filter((a) =>
                    folder
                      ? a.folder === folder &&
                        (a.kind === "image" || a.kind === "video")
                      : a.kind === "image",
                  )
                  .map((a) => a.id),
                // A new track keeps the slideshow clear of existing material.
                track = newTrack(tl, "video", crypto.randomUUID());
              return [
                { type: "track.add", timelineId: tl.id, track },
                ...beatSlideshow(
                  project,
                  { ...tl, tracks: [...tl.tracks, track] },
                  assetIds,
                  beatsOnTimeline(tl, clip, analysis.beats),
                  track.id,
                  () => crypto.randomUUID(),
                  { start: clip.start, beatsPerShot: perShot },
                ),
              ];
            }, "音乐卡点相册"),
          )
        }
      >
        生成卡点相册（放到新轨道）
      </button>
      <div className="inline-form">
        <NumberField
          label="剪短到"
          value={target}
          min={1}
          suffix="秒"
          onChange={setTarget}
        />
        <button
          className="secondary-button"
          disabled={Boolean(busy)}
          onClick={() =>
            void analysed("剪短配乐", async (analysis) => {
              let kept = 0;
              const ok = await commit((project) => {
                const result = fitMusicClip(
                  music(project).tl,
                  c.id,
                  analysis,
                  target,
                  () => crypto.randomUUID(),
                );
                kept = result.keptSeconds;
                return result.commands;
              }, "按小节剪短配乐");
              if (ok)
                notify(`配乐已剪为约 ${kept.toFixed(1)} 秒，保留了前奏和结尾`);
            })
          }
        >
          按小节剪短
        </button>
      </div>
      {busy && (
        <p className="small-description">
          正在{busy}…首次使用会在本机分析这段声音的节拍。
        </p>
      )}
    </>
  );
}
const shadows: Record<string, string> = {
  "": "无",
  "0 2px 6px rgba(0,0,0,.6)": "柔和阴影",
  "0 4px 0 rgba(0,0,0,.85)": "硬投影",
  "0 0 18px rgba(127,209,174,.9)": "霓虹光晕",
};
function TextTab({
  p,
  t,
  c,
  patch,
}: {
  p: Project;
  t: Timeline;
  c: Clip;
  patch: Patch;
}) {
  const asset = p.assets.find((a) => a.id === c.assetId)!;
  const style: TextStyle = c.textStyle ?? textStyleSchema.parse({});
  const [text, setText] = useState(c.text ?? asset.text ?? "");
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(
    () => setText(c.text ?? asset.text ?? ""),
    [c.id, c.text, asset.text],
  );
  useEffect(() => {
    void localFonts().then((list) => setFonts(list.map((f) => f.family)));
  }, []);
  const setStyle = (value: Partial<TextStyle>, label = "调整文字样式") =>
    patch({ textStyle: textStyleSchema.parse({ ...style, ...value }) }, label);
  const styles = [
    ...captionPresets,
    ...p.styles.captions.filter(
      (s) => !captionPresets.some((x) => x.id === s.id),
    ),
  ];
  const fontChoices = [...new Set([...p.styles.brand.fonts, ...fonts])];
  return (
    <>
      <h4>文字内容</h4>
      <textarea
        className="field-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== (c.text ?? asset.text ?? ""))
            patch({ text }, "修改文字");
        }}
      />
      {c.caption?.original !== undefined && (
        <button
          className="text-button"
          onClick={() => {
            const { original, language: _l, ...caption } = c.caption!;
            patch(
              {
                text: original,
                caption: { ...caption, original: undefined } as Clip["caption"],
              },
              "还原原文",
            );
          }}
        >
          <RotateCcw size={11} />
          还原原文（{c.caption.language ?? "译文"}）
        </button>
      )}
      <h4>字幕样式</h4>
      <label className="select-field">
        <span>预设</span>
        <select
          value={c.caption?.styleId ?? ""}
          onChange={(e) => {
            const chosen = styles.find((s) => s.id === e.target.value);
            if (!chosen) return;
            patch(
              {
                textStyle: chosen.textStyle,
                caption: {
                  ...c.caption,
                  styleId: chosen.id,
                  animation: chosen.animation,
                  highlight: chosen.highlight,
                },
              },
              `字幕样式：${chosen.name}`,
            );
          }}
        >
          <option value="" disabled>
            选择样式
          </option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="select-field">
        <span>动画</span>
        <select
          value={c.caption?.animation ?? "none"}
          onChange={(e) =>
            patch(
              {
                caption: {
                  ...c.caption,
                  animation: e.target
                    .value as (typeof captionAnimations)[number],
                },
              },
              "字幕动画",
            )
          }
        >
          {captionAnimations.map((a) => (
            <option
              key={a}
              value={a}
              disabled={
                ["word-pop", "karaoke", "highlight"].includes(a) &&
                !c.caption?.words?.length
              }
            >
              {captionAnimationNames[a]}
            </option>
          ))}
        </select>
      </label>
      {["karaoke", "highlight", "word-pop"].includes(
        c.caption?.animation ?? "",
      ) && (
        <ColorField
          label="当前词颜色"
          value={c.caption?.highlight}
          onChange={(highlight) =>
            patch({ caption: { ...c.caption!, highlight } }, "高亮颜色")
          }
        />
      )}
      <h4>字体</h4>
      <label className="select-field">
        <span>字体</span>
        <select
          value={style.fontFamily ?? ""}
          onChange={(e) =>
            setStyle({ fontFamily: e.target.value || undefined }, "更换字体")
          }
        >
          <option value="">系统默认</option>
          {fontChoices.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <div className="field-grid">
        <NumberField
          label="字号"
          value={style.fontSize}
          min={8}
          max={300}
          onChange={(fontSize) => setStyle({ fontSize })}
        />
        <NumberField
          label="字重"
          value={style.fontWeight ?? 600}
          min={100}
          max={900}
          step={100}
          onChange={(fontWeight) =>
            setStyle({ fontWeight: Math.round(fontWeight / 100) * 100 })
          }
        />
        <NumberField
          label="字距"
          value={style.letterSpacing}
          min={-0.2}
          max={1}
          step={0.01}
          suffix="em"
          onChange={(letterSpacing) => setStyle({ letterSpacing })}
        />
        <NumberField
          label="行高"
          value={style.lineHeight}
          min={0.8}
          max={3}
          step={0.05}
          onChange={(lineHeight) => setStyle({ lineHeight })}
        />
      </div>
      <div className="segmented">
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            className={style.align === align ? "active" : ""}
            onClick={() => setStyle({ align })}
          >
            {{ left: "左对齐", center: "居中", right: "右对齐" }[align]}
          </button>
        ))}
      </div>
      <label className="switch-row">
        <span>英文大写</span>
        <input
          type="checkbox"
          checked={style.uppercase}
          onChange={(e) => setStyle({ uppercase: e.target.checked })}
        />
      </label>
      <h4>颜色与描边</h4>
      <div className="field-grid">
        <ColorField
          label="文字"
          value={style.color}
          onChange={(color) => setStyle({ color: color ?? "#ffffff" })}
        />
        <ColorField
          label="描边"
          value={style.strokeColor}
          allowNone
          onChange={(strokeColor) =>
            setStyle({
              strokeColor,
              strokeWidth: strokeColor ? Math.max(style.strokeWidth, 4) : 0,
            })
          }
        />
      </div>
      {style.strokeColor && (
        <NumberField
          label="描边粗细"
          value={style.strokeWidth}
          min={0}
          max={40}
          onChange={(strokeWidth) => setStyle({ strokeWidth })}
        />
      )}
      <label className="select-field">
        <span>阴影</span>
        <select
          value={style.shadow ?? ""}
          onChange={(e) => setStyle({ shadow: e.target.value || undefined })}
        >
          {Object.entries(shadows).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
          {style.shadow && !(style.shadow in shadows) && (
            <option value={style.shadow}>自定义</option>
          )}
        </select>
      </label>
      <h4>底框</h4>
      <div className="field-grid">
        <ColorField
          label="底色"
          value={
            style.background === "transparent" ? undefined : style.background
          }
          allowNone
          onChange={(background) =>
            setStyle({ background: background ?? "transparent" })
          }
        />
        <NumberField
          label="内边距"
          value={style.padding}
          min={0}
          max={80}
          onChange={(padding) => setStyle({ padding })}
        />
        <NumberField
          label="圆角"
          value={style.boxRadius}
          min={0}
          max={80}
          onChange={(boxRadius) => setStyle({ boxRadius })}
        />
        <NumberField
          label="最大宽度"
          value={style.maxWidth * 100}
          min={10}
          max={100}
          suffix="%"
          onChange={(v) => setStyle({ maxWidth: v / 100 })}
        />
      </div>
      <h4>位置</h4>
      <div className="segmented">
        <button
          className={style.top === undefined ? "active" : ""}
          onClick={() => {
            const { top: _top, ...rest } = style;
            patch({ textStyle: textStyleSchema.parse(rest) }, "字幕放到下方");
          }}
        >
          靠下
        </button>
        <button
          className={style.top !== undefined ? "active" : ""}
          onClick={() => setStyle({ top: style.top ?? 0.1 }, "字幕放到上方")}
        >
          靠上
        </button>
      </div>
      {style.top === undefined ? (
        <RangeField
          label="距底部"
          value={style.bottom}
          min={0}
          max={0.9}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(bottom) => setStyle({ bottom })}
        />
      ) : (
        <RangeField
          label="距顶部"
          value={style.top}
          min={0}
          max={0.9}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(top) => setStyle({ top })}
        />
      )}
      <button
        className="secondary-button"
        onClick={async () => {
          const name = await askText(
            "样式名称",
            c.caption ? "我的字幕样式" : "我的文字样式",
          );
          if (!name?.trim()) return;
          const saved = captionStyleSchema.parse({
            id: crypto.randomUUID(),
            name: name.slice(0, 60),
            textStyle: style,
            animation: c.caption?.animation ?? "none",
            ...(c.caption?.highlight ? { highlight: c.caption.highlight } : {}),
          });
          void commit(
            [
              {
                type: "styles.update",
                patch: { captions: [...p.styles.captions, saved].slice(-60) },
              },
            ],
            `保存字幕样式「${saved.name}」`,
          );
        }}
      >
        <Save size={13} />
        保存为样式
      </button>
      {c.caption && (
        <button
          className="text-button"
          onClick={() => {
            const ids = t.clips
              .filter((x) => x.caption && x.id !== c.id)
              .map((x) => x.id);
            if (!ids.length) return;
            void commit(
              ids.map((clipId): Command => {
                const other = t.clips.find((x) => x.id === clipId)!;
                return {
                  type: "clip.update",
                  timelineId: t.id,
                  clipId,
                  patch: {
                    textStyle: style,
                    caption: {
                      ...other.caption,
                      styleId: c.caption!.styleId,
                      animation: c.caption!.animation,
                      highlight: c.caption!.highlight,
                    },
                  },
                };
              }),
              "统一全部字幕样式",
            );
          }}
        >
          把这个样式用到全部字幕
        </button>
      )}
    </>
  );
}
function EffectsTab({ c, patch }: { c: Clip; patch: Patch }) {
  const [shader, setShader] = useState(c.effects.shader ?? "");
  useEffect(() => setShader(c.effects.shader ?? ""), [c.id, c.effects.shader]);
  const stack = c.effects.presets;
  const set = (presets: Clip["effects"]["presets"], label: string) =>
    patch({ effects: { ...c.effects, presets } }, label);
  return (
    <>
      <h4>特效</h4>
      {!stack.length && (
        <p className="small-description">
          从下方添加特效，最多叠加 8 个，按顺序生效。
        </p>
      )}
      {stack.map((item, index) => {
        const preset = effectPresets.find((e) => e.id === item.id);
        if (!preset)
          return (
            <div className="effect-card" key={index}>
              <strong>{item.id}</strong>
              <small>此特效不可用</small>
            </div>
          );
        return (
          <div className="effect-card" key={`${item.id}-${index}`}>
            <div className="effect-card-head">
              <strong>{preset.name}</strong>
              <div>
                <button
                  className="icon-button"
                  title="上移"
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...stack];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    set(next, "调整特效顺序");
                  }}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  className="icon-button"
                  title="下移"
                  disabled={index === stack.length - 1}
                  onClick={() => {
                    const next = [...stack];
                    [next[index + 1], next[index]] = [
                      next[index],
                      next[index + 1],
                    ];
                    set(next, "调整特效顺序");
                  }}
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  className="icon-button"
                  title="移除特效"
                  onClick={() =>
                    set(
                      stack.filter((_, i) => i !== index),
                      `移除特效「${preset.name}」`,
                    )
                  }
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            {preset.params.map((param) => (
              <RangeField
                key={param.key}
                label={param.name}
                value={item.params[param.key] ?? param.default}
                min={param.min}
                max={param.max}
                step={param.step ?? (param.max - param.min) / 100}
                format={(v) =>
                  Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)
                }
                onChange={(value) =>
                  set(
                    stack.map((x, i) =>
                      i === index
                        ? { ...x, params: { ...x.params, [param.key]: value } }
                        : x,
                    ),
                    `调整「${preset.name}」`,
                  )
                }
              />
            ))}
          </div>
        );
      })}
      <label className="select-field">
        <span>添加</span>
        <select
          value=""
          disabled={stack.length >= 8}
          onChange={(e) => {
            const preset = effectPresets.find((x) => x.id === e.target.value);
            if (!preset) return;
            set(
              [
                ...stack,
                {
                  id: preset.id,
                  params: Object.fromEntries(
                    preset.params.map((x) => [x.key, x.default]),
                  ),
                },
              ],
              `添加特效「${preset.name}」`,
            );
          }}
        >
          <option value="">选择特效…</option>
          {Object.entries(effectCategories).map(([category, name]) => (
            <optgroup key={category} label={name}>
              {effectPresets
                .filter((x) => x.category === category)
                .map((x) => (
                  <option key={x.id} value={x.id} title={x.description}>
                    {x.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <h4>自定义 Shader</h4>
      <textarea
        className="code-field"
        placeholder="GLSL ES 300 · u_texture / v_uv / fragColor"
        value={shader}
        onChange={(e) => setShader(e.target.value)}
      />
      <button
        className="secondary-button"
        onClick={() =>
          patch(
            { effects: { ...c.effects, shader: shader || undefined } },
            "应用自定义 Shader",
          )
        }
      >
        应用 Shader
      </button>
    </>
  );
}
function ColorTab({
  p,
  t,
  c,
  patch,
}: {
  p: Project;
  t: Timeline;
  c: Clip;
  patch: Patch;
}) {
  const [look, setLook] = useState<LookId>("teal-orange"),
    [intensity, setIntensity] = useState(0.7),
    [scopes, setScopes] = useState(false);
  const applyLook = () => {
    const chosen = looks[look],
      name = `${chosen.name}${intensity < 1 ? ` ${Math.round(intensity * 100)}%` : ""}.cube`,
      existing = p.assets.find(
        (x) => x.name === name && x.text?.startsWith("TITLE"),
      ),
      assetId = existing?.id ?? crypto.randomUUID();
    void commit(
      [
        ...(existing
          ? []
          : [
              {
                type: "asset.add" as const,
                asset: assetSchema.parse({
                  id: assetId,
                  name,
                  kind: "text",
                  text: serializeCube(generateLook(look, 25, intensity)),
                  folder: "LUT",
                  tags: ["LUT", "风格"],
                  description: chosen.description,
                  createdAt: new Date().toISOString(),
                }),
              },
            ]),
        {
          type: "clip.update",
          timelineId: t.id,
          clipId: c.id,
          patch: { effects: { ...c.effects, lutAssetId: assetId } },
        },
      ],
      `套用风格「${chosen.name}」`,
    );
  };
  return (
    <>
      <div className="inline-form">
        <button
          className="secondary-button"
          onClick={() => {
            try {
              const element = document.querySelector(
                ".preview-stage .stage-layer img, .preview-stage .stage-layer video",
              ) as HTMLImageElement | HTMLVideoElement | null;
              if (!element) throw new Error("请先在预览中显示此画面");
              const canvas = document.createElement("canvas");
              canvas.width = 96;
              canvas.height = 54;
              const ctx = canvas.getContext("2d")!;
              ctx.drawImage(element, 0, 0, 96, 54);
              patch(
                {
                  effects: {
                    ...c.effects,
                    ...autoGrade(ctx.getImageData(0, 0, 96, 54).data),
                  },
                },
                "按取样像素自动调色",
              );
            } catch (e) {
              notify(e instanceof Error ? e.message : String(e), true);
            }
          }}
        >
          自动平衡
        </button>
        <button
          className={`secondary-button ${scopes ? "chosen" : ""}`}
          onClick={() => setScopes(!scopes)}
        >
          示波器
        </button>
      </div>
      {scopes && <ScopesPanel />}
      <h4>基础调色</h4>
      {(["brightness", "contrast", "saturation"] as const).map((property) => (
        <RangeField
          key={property}
          label={
            { brightness: "亮度", contrast: "对比度", saturation: "饱和度" }[
              property
            ]
          }
          value={c.effects[property]}
          min={0}
          max={3}
          step={0.05}
          onChange={(value) =>
            patch({ effects: { ...c.effects, [property]: value } })
          }
        />
      ))}
      <RangeField
        label="模糊"
        value={c.effects.blur}
        min={0}
        max={60}
        step={0.5}
        format={(v) => v.toFixed(1)}
        onChange={(blur) => patch({ effects: { ...c.effects, blur } })}
      />
      <h4>风格（LUT）</h4>
      <div className="look-grid">
        {(Object.keys(looks) as LookId[]).map((id) => (
          <button
            key={id}
            className={look === id ? "active" : ""}
            title={looks[id].description}
            onClick={() => setLook(id)}
          >
            {looks[id].name}
          </button>
        ))}
      </div>
      <RangeField
        label="强度"
        value={intensity}
        min={0.1}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={setIntensity}
      />
      <button className="secondary-button" onClick={applyLook}>
        套用风格
      </button>
      <label className="select-field">
        <span>当前 LUT</span>
        <select
          value={c.effects.lutAssetId ?? ""}
          onChange={(e) =>
            patch({
              effects: {
                ...c.effects,
                lutAssetId: e.target.value || undefined,
              },
            })
          }
        >
          <option value="">不使用 LUT</option>
          {p.assets.filter(isLutAsset).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <h4>色度抠像</h4>
      <label className="switch-row">
        <span>移除背景色</span>
        <input
          type="checkbox"
          checked={Boolean(c.effects.chromaKey)}
          onChange={(e) =>
            patch({
              effects: {
                ...c.effects,
                chromaKey: e.target.checked ? "#00ff00" : undefined,
              },
            })
          }
        />
      </label>
      {c.effects.chromaKey && (
        <>
          <ColorField
            label="背景色"
            value={c.effects.chromaKey}
            onChange={(chromaKey) =>
              patch({ effects: { ...c.effects, chromaKey } })
            }
          />
          <RangeField
            label="容差"
            value={c.effects.chromaSimilarity}
            min={0}
            max={1}
            onChange={(chromaSimilarity) =>
              patch({ effects: { ...c.effects, chromaSimilarity } })
            }
          />
        </>
      )}
      <h4>色阶与 RGB 平衡</h4>
      <div className="field-grid">
        <NumberField
          label="黑场"
          value={c.effects.black}
          min={0}
          max={0.99}
          step={0.01}
          onChange={(black) => patch({ effects: { ...c.effects, black } })}
        />
        <NumberField
          label="白场"
          value={c.effects.white}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(white) => patch({ effects: { ...c.effects, white } })}
        />
        <NumberField
          label="Gamma"
          value={c.effects.gamma}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(gamma) => patch({ effects: { ...c.effects, gamma } })}
        />
      </div>
      {(["lift", "gain"] as const).map((property) => (
        <div key={property}>
          <p className="small-description">
            {property === "lift" ? "阴影 Lift" : "高光 Gain"}
          </p>
          <div className="field-grid">
            {["R", "G", "B"].map((name, i) => (
              <NumberField
                key={name}
                label={name}
                value={c.effects[property][i]}
                min={property === "lift" ? -1 : 0}
                max={property === "lift" ? 1 : 4}
                step={0.02}
                onChange={(value) => {
                  const channels = [...c.effects[property]] as [
                    number,
                    number,
                    number,
                  ];
                  channels[i] = value;
                  patch({ effects: { ...c.effects, [property]: channels } });
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <label className="switch-row">
        <span>亮度抠像</span>
        <input
          type="checkbox"
          checked={c.effects.lumaKey !== undefined}
          onChange={(e) =>
            patch({
              effects: {
                ...c.effects,
                lumaKey: e.target.checked ? 0.2 : undefined,
              },
            })
          }
        />
      </label>
      {c.effects.lumaKey !== undefined && (
        <RangeField
          label="亮度阈值"
          value={c.effects.lumaKey}
          min={0}
          max={1}
          onChange={(lumaKey) => patch({ effects: { ...c.effects, lumaKey } })}
        />
      )}
    </>
  );
}
const transitionCategories: Record<string, string> = {
  basic: "基础",
  shape: "形状",
  motion: "运动",
  stylize: "风格化",
};
function TransitionTab({
  t,
  c,
  patch,
}: {
  t: Timeline;
  c: Clip;
  patch: Patch;
}) {
  const next = t.clips
    .filter((x) => x.trackId === c.trackId && x.start === c.start + c.duration)
    .sort((a, b) => a.start - b.start)[0];
  const current = c.transition;
  const choose = (kind: TransitionKind) =>
    patch(
      {
        transition: {
          kind,
          duration:
            current?.duration ??
            Math.max(1, Math.min(c.duration, Math.round(t.fps * 0.5))),
          ...(current?.direction &&
          transitionList.find((x) => x.kind === kind)?.directional
            ? { direction: current.direction }
            : {}),
        },
      },
      "设置转场",
    );
  return (
    <>
      <p className="small-description">
        转场从本片段结尾过渡到紧接着的下一个片段
        {next ? "" : "（同一轨道上目前没有紧接的片段，转场暂时不会显示）"}。
      </p>
      {current?.shader && (
        <div className="quiet-badge green">
          使用扩展转场 · 不支持的图层以「
          {transitionList.find((x) => x.kind === current.kind)?.name}」显示
        </div>
      )}
      {Object.entries(transitionCategories).map(([category, name]) => (
        <div key={category}>
          <h4>{name}</h4>
          <div className="transition-grid">
            {transitionList
              .filter((x) => x.category === category)
              .map((x) => (
                <button
                  key={x.kind}
                  className={
                    current?.kind === x.kind && !current.shader ? "active" : ""
                  }
                  onClick={() => choose(x.kind)}
                  title={
                    x.gl ? "需要 WebGL；文字与动画图层以交叉溶解显示" : x.name
                  }
                >
                  <i className={`transition-swatch ${x.kind}`} />
                  {x.name}
                </button>
              ))}
          </div>
        </div>
      ))}
      {current && (
        <>
          <NumberField
            label="时长"
            value={current.duration / t.fps}
            min={1 / t.fps}
            max={c.duration / t.fps}
            step={0.1}
            suffix="s"
            onChange={(v) =>
              patch(
                {
                  transition: {
                    ...current,
                    duration: Math.max(
                      1,
                      Math.min(c.duration, Math.round(v * t.fps)),
                    ),
                  },
                },
                "转场时长",
              )
            }
          />
          {transitionList.find((x) => x.kind === current.kind)?.directional && (
            <div className="segmented">
              {(["left", "right", "up", "down"] as const).map((d) => (
                <button
                  key={d}
                  className={
                    (current.direction ?? "left") === d ? "active" : ""
                  }
                  onClick={() =>
                    patch(
                      { transition: { ...current, direction: d } },
                      "转场方向",
                    )
                  }
                >
                  {{ left: "向左", right: "向右", up: "向上", down: "向下" }[d]}
                </button>
              ))}
            </div>
          )}
          <button
            className="text-button danger"
            onClick={() => {
              const { transition: _drop, ...rest } = c;
              void commit(diffClips(t.id, [c], [rest as Clip]), "移除转场");
            }}
          >
            <Trash2 size={11} />
            移除转场
          </button>
        </>
      )}
    </>
  );
}
function BezierCurve({ curve }: { curve: [number, number, number, number] }) {
  const points = Array.from({ length: 33 }, (_, i) => {
    const x = i / 32;
    return `${(x * 100).toFixed(1)},${(100 - cubicBezier(curve, x) * 100).toFixed(1)}`;
  }).join(" ");
  return (
    <svg
      className="bezier-preview"
      viewBox="-10 -30 120 160"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height="100" />
      <line x1="0" y1="100" x2={curve[0] * 100} y2={100 - curve[1] * 100} />
      <line x1="100" y1="0" x2={curve[2] * 100} y2={100 - curve[3] * 100} />
      <polyline points={points} />
      <circle cx={curve[0] * 100} cy={100 - curve[1] * 100} r="4" />
      <circle cx={curve[2] * 100} cy={100 - curve[3] * 100} r="4" />
    </svg>
  );
}
function KeyframesTab({ t, c, patch }: { t: Timeline; c: Clip; patch: Patch }) {
  const frame = useIdlePlayhead();
  const [chosen, setChosen] = useState<{
    property: KeyframeProperty;
    frame: number;
  } | null>(null);
  const inside = frame >= c.start && frame < c.start + c.duration;
  const key =
    chosen &&
    c.keyframes[chosen.property]?.find((k) => k.frame === chosen.frame);
  const updateKey = (
    value: Partial<NonNullable<typeof key>>,
    label = "调整关键帧",
  ) => {
    if (!chosen || !key) return;
    patch(
      {
        keyframes: {
          ...c.keyframes,
          [chosen.property]: c.keyframes[chosen.property]!.map((k) =>
            k.frame === chosen.frame ? { ...k, ...value } : k,
          ),
        },
      },
      label,
    );
  };
  const valueOf = (property: KeyframeProperty) =>
    property === "focusX" || property === "focusY"
      ? 0.5
      : (c[property as keyof Clip] as number);
  return (
    <>
      <h4>属性动画</h4>
      <p className="small-description">
        在播放头位置记录当前属性值；点已记录的关键帧可以调整缓动曲线。
      </p>
      {keyframeProperties
        .filter((k) => k !== "focusX" && k !== "focusY")
        .map((property) => (
          <div className="keyframe-row" key={property}>
            <span>{propertyNames[property]}</span>
            <small>{c.keyframes[property]?.length ?? 0} 帧</small>
            <button
              title="添加关键帧"
              disabled={!inside}
              onClick={() =>
                void commit(
                  [
                    {
                      type: "clip.keyframe",
                      timelineId: t.id,
                      clipId: c.id,
                      property,
                      keyframe: {
                        frame: Math.round(frame - c.start),
                        value: valueOf(property),
                        easing: "ease-in-out",
                      },
                    },
                  ],
                  "添加关键帧",
                )
              }
            >
              <Diamond size={13} />
            </button>
          </div>
        ))}
      <h4>已记录的关键帧</h4>
      {Object.entries(c.keyframes).flatMap(([property, keys]) =>
        keys!.map((k) => (
          <div
            className={`keyframe-row ${chosen?.property === property && chosen.frame === k.frame ? "chosen" : ""}`}
            key={property + k.frame}
          >
            <button
              onClick={() => {
                setChosen({
                  property: property as KeyframeProperty,
                  frame: k.frame,
                });
                setState({ playhead: c.start + k.frame });
              }}
            >
              {propertyNames[property as KeyframeProperty] ?? property} ·{" "}
              {formatTime(k.frame, t.fps)}
            </button>
            <small>{Number(k.value.toFixed(3))}</small>
            <button
              title="删除关键帧"
              onClick={() =>
                void commit(
                  [
                    {
                      type: "clip.keyframe.remove",
                      timelineId: t.id,
                      clipId: c.id,
                      property: property as KeyframeProperty,
                      frame: k.frame,
                    },
                  ],
                  "删除关键帧",
                )
              }
            >
              <X size={12} />
            </button>
          </div>
        )),
      )}
      {key && chosen && (
        <div className="easing-editor">
          <h4>到下一个关键帧的缓动</h4>
          <NumberField
            label="数值"
            value={key.value}
            step={0.01}
            onChange={(value) => updateKey({ value })}
          />
          <select
            value={key.easing}
            onChange={(e) => {
              const easing = e.target.value as typeof key.easing;
              updateKey(
                easing === "bezier"
                  ? { easing, bezier: key.bezier ?? [0.25, 0.1, 0.25, 1] }
                  : { easing, bezier: undefined },
                "更改缓动",
              );
            }}
          >
            <option value="linear">线性</option>
            <option value="ease-in">缓入</option>
            <option value="ease-out">缓出</option>
            <option value="ease-in-out">缓入缓出</option>
            <option value="hold">保持（跳变）</option>
            <option value="bezier">贝塞尔曲线</option>
          </select>
          {key.easing === "bezier" && key.bezier && (
            <>
              <BezierCurve curve={key.bezier} />
              <div className="look-grid">
                {Object.entries(bezierPresets).map(([id, preset]) => (
                  <button
                    key={id}
                    onClick={() =>
                      updateKey(
                        { bezier: preset.curve },
                        `缓动：${preset.name}`,
                      )
                    }
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <div className="field-grid">
                {(["x1", "y1", "x2", "y2"] as const).map((name, i) => (
                  <NumberField
                    key={name}
                    label={name}
                    value={key.bezier![i]}
                    min={i % 2 === 0 ? 0 : -2}
                    max={i % 2 === 0 ? 1 : 3}
                    step={0.01}
                    onChange={(v) => {
                      const curve = [...key.bezier!] as [
                        number,
                        number,
                        number,
                        number,
                      ];
                      curve[i] = v;
                      updateKey({ bezier: curve }, "调整贝塞尔曲线");
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
/** With no clip selected: the timeline's canvas, watermark and the project's brand. */
function TimelineSettings({
  p,
  t,
  count,
}: {
  p: Project;
  t: Timeline;
  count: number;
}) {
  const watermark = t.watermark,
    brand = p.styles.brand,
    images = p.assets.filter((a) => a.kind === "image");
  const setWatermark = (
    value: Partial<NonNullable<typeof watermark>> | null,
    label = "设置水印",
  ) =>
    void commit(
      [
        {
          type: "timeline.update",
          timelineId: t.id,
          patch: {
            watermark:
              value === null
                ? null
                : watermarkSchema.parse({ ...watermark, ...value }),
          },
        },
      ],
      label,
    );
  const setBrand = (value: Partial<typeof brand>, label = "更新品牌设定") =>
    void commit(
      [{ type: "styles.update", patch: { brand: { ...brand, ...value } } }],
      label,
    );
  return (
    <div className="inspector">
      <div className="panel-heading">
        <span>
          <Layers size={15} />
          {count > 1 ? `已选 ${count} 个片段` : "时间线设置"}
        </span>
        <small>
          {t.width}×{t.height} · {t.fps}fps
        </small>
      </div>
      <div className="inspector-scroll">
        <p className="small-description">
          选择一个片段可以调整画面、文字、特效与转场。
        </p>
        <h4>画布</h4>
        <ColorField
          label="背景色"
          value={t.background}
          onChange={(background) =>
            void commit(
              [
                {
                  type: "timeline.update",
                  timelineId: t.id,
                  patch: { background: background ?? "#101114" },
                },
              ],
              "画布背景色",
            )
          }
        />
        <h4>水印</h4>
        {!watermark ? (
          <div className="inline-form">
            <button
              className="secondary-button"
              onClick={() =>
                setWatermark({ text: brand.name || p.name }, "添加文字水印")
              }
            >
              <Plus size={12} />
              文字水印
            </button>
            <button
              className="secondary-button"
              disabled={!images.length}
              onClick={() =>
                setWatermark(
                  { assetId: brand.logoAssetId ?? images[0]?.id },
                  "添加图片水印",
                )
              }
            >
              <Plus size={12} />
              图片水印
            </button>
          </div>
        ) : (
          <>
            {watermark.assetId !== undefined ? (
              <label className="select-field">
                <span>图片</span>
                <select
                  value={watermark.assetId}
                  onChange={(e) => setWatermark({ assetId: e.target.value })}
                >
                  {images.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="form-field">
                文字
                <input
                  defaultValue={watermark.text ?? ""}
                  key={watermark.text}
                  onBlur={(e) =>
                    e.target.value !== watermark.text &&
                    setWatermark({ text: e.target.value.slice(0, 200) })
                  }
                />
              </label>
            )}
            <label className="select-field">
              <span>位置</span>
              <select
                value={watermark.position}
                onChange={(e) =>
                  setWatermark({
                    position: e.target.value as NonNullable<
                      typeof watermark
                    >["position"],
                  })
                }
              >
                <option value="top-left">左上</option>
                <option value="top-right">右上</option>
                <option value="bottom-left">左下</option>
                <option value="bottom-right">右下</option>
                <option value="center">居中</option>
              </select>
            </label>
            <RangeField
              label="透明度"
              value={watermark.opacity}
              min={0}
              max={1}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => setWatermark({ opacity })}
            />
            <RangeField
              label="大小"
              value={watermark.scale}
              min={0.02}
              max={0.6}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(scale) => setWatermark({ scale })}
            />
            <RangeField
              label="边距"
              value={watermark.margin}
              min={0}
              max={0.3}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(margin) => setWatermark({ margin })}
            />
            <button
              className="text-button danger"
              onClick={() => setWatermark(null, "移除水印")}
            >
              <Trash2 size={11} />
              移除水印
            </button>
          </>
        )}
        <h4>品牌</h4>
        <label className="form-field">
          品牌名称
          <input
            defaultValue={brand.name}
            key={brand.name}
            onBlur={(e) =>
              e.target.value !== brand.name &&
              setBrand({ name: e.target.value })
            }
          />
        </label>
        <div className="brand-colors">
          {brand.colors.map((color, i) => (
            <span key={i} className="brand-color">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#000000"}
                onChange={(e) =>
                  setBrand(
                    {
                      colors: brand.colors.map((x, j) =>
                        j === i ? e.target.value : x,
                      ),
                    },
                    "品牌颜色",
                  )
                }
              />
              <button
                title="移除颜色"
                onClick={() =>
                  setBrand(
                    { colors: brand.colors.filter((_, j) => j !== i) },
                    "品牌颜色",
                  )
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {brand.colors.length < 12 && (
            <button
              className="icon-button"
              title="添加品牌色"
              onClick={() =>
                setBrand({ colors: [...brand.colors, "#7fd1ae"] }, "品牌颜色")
              }
            >
              <Plus size={13} />
            </button>
          )}
        </div>
        <label className="form-field">
          品牌字体（用逗号分隔）
          <input
            defaultValue={brand.fonts.join("，")}
            key={brand.fonts.join(",")}
            onBlur={(e) => {
              const fonts = e.target.value
                .split(/[,，]/)
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 6);
              if (fonts.join(",") !== brand.fonts.join(","))
                setBrand({ fonts }, "品牌字体");
            }}
          />
        </label>
        <label className="select-field">
          <span>Logo</span>
          <select
            value={brand.logoAssetId ?? ""}
            onChange={(e) =>
              setBrand(
                { logoAssetId: e.target.value || undefined },
                "品牌 Logo",
              )
            }
          >
            <option value="">未设置</option>
            {images.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          语气
          <input
            placeholder="例如：亲切、专业、简洁"
            defaultValue={brand.tone}
            key={brand.tone}
            onBlur={(e) =>
              e.target.value !== brand.tone &&
              setBrand({ tone: e.target.value }, "品牌语气")
            }
          />
        </label>
      </div>
    </div>
  );
}
