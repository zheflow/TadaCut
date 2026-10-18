import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Languages,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Square,
  Subtitles,
  Type,
} from "lucide-react";
import {
  activeTimeline,
  applyLut,
  assetSchema,
  avoidSubjects,
  buildCaptionClips,
  cameraKeyframes,
  cameraMoveNames,
  cameraMoves,
  captionAnimationNames,
  captionAnimations,
  captionPresets,
  effectCategories,
  effectPresets,
  fitSafeZone,
  generateLook,
  keyframeProperties,
  looks,
  placeAsset,
  safeZones,
  serializeCube,
  textStyleSchema,
  transitionList,
  type CaptionAnimation,
  type CaptionStyle,
  type Clip,
  type Command,
  type LookId,
  type Project,
  type SafeZone,
  type Timeline,
} from "@tadacut/domain";
import {
  instantiateTemplate,
  templateCatalog,
  templateCategories,
  type MotionTemplate,
} from "../../../../packages/motion/src/catalog";
import { MotionLayer } from "../../../../packages/render/src/components/MotionLayer";
import { post, type Job } from "../lib/api";
import {
  localFonts,
  pluginsApi,
  useRemote,
  type PluginInfo,
  type StockItem,
} from "../lib/studio-api";
import {
  acceptJob,
  commit,
  getState,
  notify,
  remember,
  setState,
  startJob,
  useIdlePlayhead,
  useStudio,
} from "../lib/store";
import { framePixels, type FramePixels } from "./Scopes";
import { subjectsUnder } from "./LocalTools";

type Section =
  | "effects"
  | "transitions"
  | "looks"
  | "camera"
  | "templates"
  | "captions"
  | "sounds"
  | "stock"
  | "fonts"
  | "extensions";
const sections: [Section, string][] = [
  ["templates", "模板"],
  ["captions", "字幕"],
  ["effects", "特效"],
  ["transitions", "转场"],
  ["looks", "风格"],
  ["camera", "镜头"],
  ["sounds", "音效"],
  ["stock", "图库"],
  ["fonts", "字体"],
  ["extensions", "扩展"],
];
const newId = () => crypto.randomUUID();
/** Selected clips in the active timeline, optionally only visual ones. */
function selection(p: Project, t: Timeline, visual = false) {
  const ids = getState().selectedClipIds;
  return t.clips.filter((c) => {
    if (!ids.includes(c.id)) return false;
    if (!visual) return true;
    const kind = p.assets.find((a) => a.id === c.assetId)?.kind;
    return kind !== "audio";
  });
}
function needSelection(clips: Clip[], what = "片段") {
  if (!clips.length) {
    notify(`请先在时间线上选择要应用的${what}`, true);
    return false;
  }
  return true;
}
export function ResourcesPanel() {
  const section = useStudio((s) => s.resourceSection);
  const setSection = (section: Section) =>
    setState({ resourceSection: section });
  return (
    <div className="resources">
      <div className="resource-tabs" role="tablist">
        {sections.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={section === id}
            className={section === id ? "active" : ""}
            onClick={() => {
              setSection(id);
              remember("tadacut-resource-section", id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="resource-body">
        {section === "effects" ? (
          <EffectsLibrary />
        ) : section === "transitions" ? (
          <TransitionsLibrary />
        ) : section === "looks" ? (
          <LooksLibrary />
        ) : section === "camera" ? (
          <CameraLibrary />
        ) : section === "templates" ? (
          <TemplatesLibrary />
        ) : section === "captions" ? (
          <CaptionsLibrary />
        ) : section === "sounds" ? (
          <SoundsLibrary />
        ) : section === "stock" ? (
          <StockLibrary />
        ) : section === "fonts" ? (
          <FontsLibrary />
        ) : (
          <ExtensionsLibrary />
        )}
      </div>
    </div>
  );
}
function EffectsLibrary() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const apply = (id: string) => {
    const preset = effectPresets.find((x) => x.id === id)!,
      clips = selection(p, t, true);
    if (!needSelection(clips, "画面片段")) return;
    void commit(
      clips.map(
        (c): Command => ({
          type: "clip.update",
          timelineId: t.id,
          clipId: c.id,
          patch: {
            effects: {
              ...c.effects,
              presets: [
                ...c.effects.presets.filter((x) => x.id !== id),
                {
                  id,
                  params: Object.fromEntries(
                    preset.params.map((x) => [x.key, x.default]),
                  ),
                },
              ].slice(-8),
            },
          },
        }),
      ),
      `添加特效「${preset.name}」`,
    );
  };
  return (
    <>
      {Object.entries(effectCategories).map(([category, name]) => (
        <section key={category}>
          <h5>{name}</h5>
          <div className="resource-grid">
            {effectPresets
              .filter((x) => x.category === category)
              .map((x) => (
                <button
                  key={x.id}
                  className="resource-card"
                  title={x.description}
                  onClick={() => apply(x.id)}
                >
                  <i className={`effect-swatch ${x.id}`} />
                  <span>{x.name}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
      <p className="resource-hint">
        选择片段后点击特效即可叠加；参数在右侧「片段属性 · 特效」里调整。
      </p>
    </>
  );
}
function TransitionsLibrary() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const [seconds, setSeconds] = useState(0.5);
  const apply = (kind: (typeof transitionList)[number]["kind"]) => {
    const clips = selection(p, t, true);
    if (!needSelection(clips)) return;
    void commit(
      clips.map(
        (c): Command => ({
          type: "clip.update",
          timelineId: t.id,
          clipId: c.id,
          patch: {
            transition: {
              kind,
              duration: Math.max(
                1,
                Math.min(c.duration, Math.round(seconds * t.fps)),
              ),
              ...(c.transition?.direction
                ? { direction: c.transition.direction }
                : {}),
            },
          },
        }),
      ),
      `转场「${transitionList.find((x) => x.kind === kind)?.name}」`,
    );
  };
  return (
    <>
      <label className="slider-field">
        <span>
          时长<small>{seconds.toFixed(1)} 秒</small>
        </span>
        <input
          type="range"
          min={0.1}
          max={2}
          step={0.1}
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
        />
      </label>
      {(["basic", "shape", "motion", "stylize"] as const).map((category) => (
        <section key={category}>
          <h5>
            {
              {
                basic: "基础",
                shape: "形状",
                motion: "运动",
                stylize: "风格化",
              }[category]
            }
          </h5>
          <div className="resource-grid">
            {transitionList
              .filter((x) => x.category === category)
              .map((x) => (
                <button
                  key={x.kind}
                  className="resource-card"
                  onClick={() => apply(x.kind)}
                >
                  <i className={`transition-swatch ${x.kind}`} />
                  <span>{x.name}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
      <p className="resource-hint">
        转场放在所选片段的结尾，过渡到同一轨道上紧接的下一个片段。
      </p>
    </>
  );
}
/** Before/after thumbnails of every look on the frame under the playhead. */
function LooksLibrary() {
  const p = useStudio((s) => s.project)!,
    frame = useIdlePlayhead(),
    t = activeTimeline(p);
  const [source, setSource] = useState<FramePixels | null>(null),
    [loading, setLoading] = useState(false),
    [intensity, setIntensity] = useState(0.8),
    [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await framePixels(p.id, t.id, frame, 0.18);
      setSource((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(
    () => () => setSource((old) => (old && URL.revokeObjectURL(old.url), null)),
    [],
  );
  const apply = (id: LookId) => {
    const clips = selection(p, t, true);
    if (!needSelection(clips, "画面片段")) return;
    const look = looks[id],
      name = `${look.name}${intensity < 1 ? ` ${Math.round(intensity * 100)}%` : ""}.cube`,
      existing = p.assets.find(
        (x) => x.name === name && x.text?.startsWith("TITLE"),
      ),
      assetId = existing?.id ?? newId();
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
                  text: serializeCube(generateLook(id, 25, intensity)),
                  folder: "LUT",
                  tags: ["LUT", "风格"],
                  description: look.description,
                  createdAt: new Date().toISOString(),
                }),
              },
            ]),
        ...clips.map(
          (c): Command => ({
            type: "clip.update",
            timelineId: t.id,
            clipId: c.id,
            patch: { effects: { ...c.effects, lutAssetId: assetId } },
          }),
        ),
      ],
      `套用风格「${look.name}」`,
    );
  };
  return (
    <>
      <div className="inline-form">
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <LoaderCircle className="spin" size={12} />
          ) : (
            <Play size={12} />
          )}
          {source ? "用当前帧重新对比" : "用当前帧对比风格"}
        </button>
      </div>
      <label className="slider-field">
        <span>
          强度<small>{Math.round(intensity * 100)}%</small>
        </span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
        />
      </label>
      {error && <p className="small-description error-text">{error}</p>}
      <div className="look-compare">
        {source && (
          <figure>
            <img src={source.url} alt="" />
            <figcaption>原画面</figcaption>
          </figure>
        )}
        {(Object.keys(looks) as LookId[]).map((id) => (
          <LookThumb
            key={id}
            id={id}
            source={source}
            intensity={intensity}
            onApply={() => apply(id)}
          />
        ))}
      </div>
      <p className="resource-hint">
        选择画面片段后点击风格套用；风格是程序生成的 LUT，会作为 .cube
        素材保存在项目里。
      </p>
    </>
  );
}
function LookThumb({
  id,
  source,
  intensity,
  onApply,
}: {
  id: LookId;
  source: FramePixels | null;
  intensity: number;
  onApply(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lut = useMemo(() => generateLook(id, 17, intensity), [id, intensity]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !source) return;
    canvas.current!.width = source.width;
    canvas.current!.height = source.height;
    const image = ctx.createImageData(source.width, source.height);
    image.data.set(applyLut(source.rgba, lut));
    ctx.putImageData(image, 0, 0);
  }, [source, lut]);
  return (
    <figure
      className="look-thumb"
      onClick={onApply}
      title={looks[id].description}
    >
      {source ? <canvas ref={canvas} /> : <i className={`look-swatch ${id}`} />}
      <figcaption>{looks[id].name}</figcaption>
    </figure>
  );
}
function CameraLibrary() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const [intensity, setIntensity] = useState(1);
  return (
    <>
      <label className="slider-field">
        <span>
          幅度<small>{intensity.toFixed(1)}×</small>
        </span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
        />
      </label>
      <div className="resource-grid">
        {cameraMoves.map((move) => (
          <button
            key={move}
            className="resource-card"
            onClick={() => {
              const clips = selection(p, t, true);
              if (!needSelection(clips, "画面片段")) return;
              void commit(
                clips.map(
                  (c): Command => ({
                    type: "clip.update",
                    timelineId: t.id,
                    clipId: c.id,
                    patch: {
                      keyframes: cameraKeyframes(t, c, move, { intensity }),
                    },
                  }),
                ),
                `镜头运动：${cameraMoveNames[move]}`,
              );
            }}
          >
            <i className={`camera-swatch ${move}`} />
            <span>{cameraMoveNames[move]}</span>
          </button>
        ))}
      </div>
      <p className="resource-hint">
        镜头运动会生成缩放、位置与旋转关键帧，可在「关键帧」里继续微调。
      </p>
    </>
  );
}
function TemplatesLibrary() {
  const p = useStudio((s) => s.project)!,
    playhead = useIdlePlayhead(),
    t = activeTimeline(p);
  const plugins = useRemote<PluginInfo[]>("/api/plugins", "plugins", []);
  const [extra, setExtra] = useState<MotionTemplate[]>([]);
  useEffect(() => {
    const wanted = (plugins.value ?? []).flatMap(
      (x) => x.items.templates?.map((i) => [x.id, i.id, x.name]) ?? [],
    );
    if (!wanted.length) return setExtra([]);
    void Promise.all(
      wanted.map(([pluginId, itemId, name]) =>
        pluginsApi
          .item<MotionTemplate>(pluginId, "templates", itemId)
          .then((x) => ({
            ...x,
            id: `${pluginId}/${x.id}`,
            tags: [...x.tags, name],
          }))
          .catch(() => null),
      ),
    ).then((list) =>
      setExtra(list.filter((x): x is MotionTemplate => Boolean(x))),
    );
  }, [plugins.value]);
  const all = [...templateCatalog, ...extra];
  const [chosen, setChosen] = useState<MotionTemplate | null>(null),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [query, setQuery] = useState(""),
    [previewFrame, setPreviewFrame] = useState(36);
  const filtered = all.filter(
    (x) => !query || `${x.name} ${x.tags.join(" ")}`.includes(query),
  );
  const code = chosen
    ? instantiateTemplate(chosen, values, p.styles.brand)
    : "";
  const add = () => {
    if (!chosen) return;
    const asset = assetSchema.parse({
      id: newId(),
      name: chosen.name,
      kind: "motion",
      code,
      duration: chosen.duration,
      folder: "动画",
      tags: ["模板", ...chosen.tags.slice(0, 3)],
      createdAt: new Date().toISOString(),
    });
    let clipId = "";
    void commit((project) => {
      const timeline = activeTimeline(project),
        track = timeline.tracks.find(
          (x) => x.kind === "motion" && !x.locked,
        )?.id,
        placed = placeAsset(project, timeline, asset, playhead, newId, track);
      clipId = placed.clip.id;
      return placed.commands;
    }, `添加模板「${chosen.name}」`).then(
      (ok) => ok && setState({ selectedClipIds: [clipId] }),
    );
  };
  return (
    <>
      <label className="search-field">
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模板：标题、数据、片尾…"
        />
      </label>
      {chosen && (
        <div className="template-editor">
          <div
            className="motion-editor-preview"
            style={{ aspectRatio: `${t.width} / ${t.height}` }}
          >
            <MotionLayer
              code={code}
              frame={previewFrame}
              fps={t.fps}
              width={t.width}
              height={t.height}
            />
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(chosen.duration * t.fps) - 1)}
            value={previewFrame}
            aria-label="模板预览帧"
            onChange={(e) => setPreviewFrame(Number(e.target.value))}
          />
          {chosen.params.map((param) => (
            <label className="form-field" key={param.key}>
              {param.name}
              {param.type === "color" ? (
                <input
                  type="color"
                  value={String(
                    values[param.key] ??
                      (param.brand === "primary"
                        ? p.styles.brand.colors[0]
                        : undefined) ??
                      param.default,
                  )}
                  onChange={(e) =>
                    setValues({ ...values, [param.key]: e.target.value })
                  }
                />
              ) : param.type === "list" ? (
                <textarea
                  rows={3}
                  value={
                    Array.isArray(values[param.key])
                      ? (values[param.key] as string[]).join("\n")
                      : String(
                          values[param.key] ??
                            (param.default as string[]).join("\n"),
                        )
                  }
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [param.key]: e.target.value.split("\n"),
                    })
                  }
                />
              ) : (
                <input
                  type={param.type === "number" ? "number" : "text"}
                  value={String(values[param.key] ?? param.default)}
                  placeholder={
                    param.brand === "font" ? "留空使用品牌字体" : undefined
                  }
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [param.key]:
                        param.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
          <div className="inline-form">
            <button
              className="secondary-button"
              onClick={() => setChosen(null)}
            >
              返回
            </button>
            <button className="primary-button" onClick={add}>
              <Plus size={13} />
              放到播放头
            </button>
          </div>
        </div>
      )}
      {!chosen &&
        Object.entries(templateCategories).map(([category, name]) => {
          const items = filtered.filter((x) => x.category === category);
          if (!items.length) return null;
          return (
            <section key={category}>
              <h5>{name}</h5>
              <div className="resource-grid">
                {items.map((x) => (
                  <button
                    key={x.id}
                    className="resource-card"
                    title={x.tags.join(" · ")}
                    onClick={() => {
                      setChosen(x);
                      setValues({});
                      setPreviewFrame(
                        Math.min(
                          Math.round(x.duration * t.fps) - 1,
                          Math.round(t.fps * 1.2),
                        ),
                      );
                    }}
                  >
                    <i className={`template-swatch ${x.category}`} />
                    <span>{x.name}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}
function CaptionsLibrary() {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers),
    t = activeTimeline(p);
  const styles: CaptionStyle[] = [
    ...captionPresets,
    ...p.styles.captions.filter(
      (s) => !captionPresets.some((x) => x.id === s.id),
    ),
  ];
  const onTimeline = p.transcripts.filter((tr) =>
    t.clips.some((c) => c.assetId === tr.assetId),
  );
  const [transcriptId, setTranscriptId] = useState(onTimeline[0]?.id ?? ""),
    [styleId, setStyleId] = useState(styles[0].id),
    [animation, setAnimation] = useState<CaptionAnimation | "">(""),
    [maxChars, setMaxChars] = useState(16),
    [language, setLanguage] = useState("English"),
    [zone, setZone] = useState<SafeZone>("douyin");
  const chat = providers.filter(
      (x) => x.enabled && x.capabilities.includes("chat"),
    ),
    [providerId, setProviderId] = useState(
      () => getState().providerId || chat[0]?.id || "",
    );
  const captions = t.clips.filter((c) => c.caption);
  const [detecting, setDetecting] = useState("");
  /** Finds people under each caption with the local detector and moves captions that cover them. */
  const avoid = async () => {
    const chosen = captions.slice(0, 40);
    try {
      const { boxes, checked } = await subjectsUnder(
        p,
        t,
        chosen.map((c) => c.start + Math.floor(c.duration / 2)),
        setDetecting,
      );
      if (!checked) return notify("字幕下面没有可以检测的画面", true);
      const ok = await commit(
        (project) =>
          avoidSubjects(
            activeTimeline(project),
            chosen.map((c) => c.id),
            boxes,
          ),
        "字幕避开人物",
      );
      if (ok)
        notify(
          boxes.length
            ? `检测到 ${boxes.length} 处人物，遮挡人物的字幕已移到上方`
            : "没有检测到人物",
        );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setDetecting("");
    }
  };
  const generate = () => {
    const transcript = p.transcripts.find((x) => x.id === transcriptId);
    if (!transcript)
      return notify("请先转写口播素材，并把它放到时间线上", true);
    let count = 0;
    void commit((project) => {
      const result = buildCaptionClips(
        project,
        activeTimeline(project),
        transcript,
        newId,
        new Date().toISOString(),
        {
          styleId,
          maxChars,
          replace: true,
          ...(animation ? { animation } : {}),
        },
      );
      count = result.count;
      return result.commands;
    }, "生成字幕").then((ok) => ok && notify(`已生成 ${count} 条字幕`));
  };
  return (
    <>
      <h5>
        <Subtitles size={12} /> 从文稿生成
      </h5>
      {onTimeline.length ? (
        <>
          <label className="select-field">
            <span>文稿</span>
            <select
              value={transcriptId}
              onChange={(e) => setTranscriptId(e.target.value)}
            >
              {onTimeline.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {p.assets.find((a) => a.id === tr.assetId)?.name ?? tr.id} ·{" "}
                  {tr.words.length} 词
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>动画</span>
            <select
              value={animation}
              onChange={(e) =>
                setAnimation(e.target.value as CaptionAnimation | "")
              }
            >
              <option value="">跟随样式</option>
              {captionAnimations.map((a) => (
                <option key={a} value={a}>
                  {captionAnimationNames[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="slider-field">
            <span>
              每行字数<small>{maxChars}</small>
            </span>
            <input
              type="range"
              min={6}
              max={40}
              value={maxChars}
              onChange={(e) => setMaxChars(Number(e.target.value))}
            />
          </label>
          <button className="primary-button" onClick={generate}>
            <Sparkles size={13} />
            生成字幕（替换已有字幕）
          </button>
        </>
      ) : (
        <p className="resource-hint">
          时间线上还没有转写过的口播素材。在「文稿」视图转写后再来生成字幕。
        </p>
      )}
      <h5>样式</h5>
      <div className="caption-styles">
        {styles.map((s) => (
          <button
            key={s.id}
            className={`caption-style-card ${styleId === s.id ? "active" : ""}`}
            onClick={() => setStyleId(s.id)}
            onDoubleClick={() => {
              const targets = selection(p, t).filter(
                (c) =>
                  c.caption ||
                  p.assets.find((a) => a.id === c.assetId)?.kind === "text",
              );
              const list = targets.length ? targets : captions;
              if (!list.length) return notify("时间线上还没有字幕", true);
              void commit(
                list.map(
                  (c): Command => ({
                    type: "clip.update",
                    timelineId: t.id,
                    clipId: c.id,
                    patch: {
                      textStyle: s.textStyle,
                      caption: {
                        ...c.caption,
                        styleId: s.id,
                        animation: s.animation,
                        highlight: s.highlight,
                      },
                    },
                  }),
                ),
                `字幕样式：${s.name}`,
              );
            }}
            title="单击选择，双击应用到所选字幕（未选择时应用到全部字幕）"
          >
            <span
              style={{
                color: s.textStyle.color,
                background: s.textStyle.background,
                WebkitTextStroke: s.textStyle.strokeColor
                  ? `${Math.min(2, s.textStyle.strokeWidth / 4)}px ${s.textStyle.strokeColor}`
                  : undefined,
                fontWeight: s.textStyle.fontWeight ?? 700,
                textShadow: s.textStyle.shadow,
              }}
            >
              字幕 Aa
            </span>
            <small>{s.name}</small>
          </button>
        ))}
      </div>
      {captions.length > 0 && (
        <>
          <h5>安全区</h5>
          <div className="inline-form">
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value as SafeZone)}
            >
              {(Object.keys(safeZones) as SafeZone[]).map((z) => (
                <option key={z} value={z}>
                  {safeZones[z].name}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              onClick={() =>
                void commit(
                  captions.map(
                    (c): Command => ({
                      type: "clip.update",
                      timelineId: t.id,
                      clipId: c.id,
                      patch: {
                        textStyle: fitSafeZone(
                          c.textStyle ?? textStyleSchema.parse({}),
                          zone,
                        ),
                      },
                    }),
                  ),
                  `字幕避开${safeZones[zone].name}界面`,
                )
              }
            >
              避开界面
            </button>
          </div>
          <button
            className="secondary-button"
            disabled={Boolean(detecting)}
            onClick={() => void avoid()}
          >
            {detecting ? <LoaderCircle className="spin" size={12} /> : null}
            {detecting || "避开人物（本机检测）"}
          </button>
          <p className="resource-hint">
            人物检测在本机运行，首次使用会下载检测模型；画面不会离开电脑。
          </p>
          <h5>
            <Languages size={12} /> 翻译
          </h5>
          <div className="inline-form">
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="目标语言"
            />
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {!chat.length && <option value="">没有对话模型</option>}
              {chat.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="secondary-button"
            disabled={!providerId || !language.trim()}
            onClick={() =>
              void startJob("translate-captions", `翻译字幕为${language}`, {
                language: language.trim(),
                providerId,
                timelineId: t.id,
              })
            }
          >
            翻译 {captions.length} 条字幕（原文可还原）
          </button>
        </>
      )}
    </>
  );
}
interface PluginSoundRef {
  pluginId: string;
  pluginName: string;
  id: string;
  name: string;
}
function SoundsLibrary() {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers);
  const plugins = useRemote<PluginInfo[]>("/api/plugins", "plugins", []);
  const sounds: PluginSoundRef[] = (plugins.value ?? []).flatMap((x) =>
    (x.items.sounds ?? []).map((s) => ({
      pluginId: x.id,
      pluginName: x.name,
      id: s.id,
      name: s.name,
    })),
  );
  const [playing, setPlaying] = useState(""),
    audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const sfx = providers.filter(
      (x) => x.enabled && x.capabilities.includes("sfx"),
    ),
    [providerId, setProviderId] = useState(sfx[0]?.id ?? ""),
    [prompt, setPrompt] = useState(""),
    [duration, setDuration] = useState(2);
  const preview = (s: PluginSoundRef) => {
    audio.current?.pause();
    if (playing === s.id) return setPlaying("");
    audio.current = new Audio(
      `/api/plugins/${s.pluginId}/sounds/${encodeURIComponent(s.id)}`,
    );
    audio.current.onended = () => setPlaying("");
    void audio.current.play().catch(() => notify("无法播放这个音效", true));
    setPlaying(s.id);
  };
  return (
    <>
      <h5>扩展音效</h5>
      {sounds.length ? (
        <div className="sound-list">
          {sounds.map((s) => (
            <div key={`${s.pluginId}/${s.id}`} className="sound-row">
              <button
                className="icon-button"
                title="试听"
                onClick={() => preview(s)}
              >
                {playing === s.id ? <Square size={12} /> : <Play size={12} />}
              </button>
              <span>
                {s.name}
                <small>{s.pluginName}</small>
              </span>
              <button
                className="icon-button"
                title="加入素材库"
                onClick={() =>
                  void post<{ asset: { id: string } }>(
                    `/api/projects/${p.id}/plugin-sound`,
                    { pluginId: s.pluginId, soundId: s.id },
                  )
                    .then(() => notify(`「${s.name}」已加入素材库`))
                    .catch((e) => notify(String(e), true))
                }
              >
                <Plus size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="resource-hint">
          安装带音效的扩展包后会出现在这里；也可以在「图库」搜索 Freesound。
        </p>
      )}
      <h5>
        <Music2 size={12} /> 生成音效
      </h5>
      {sfx.length ? (
        <>
          <textarea
            rows={2}
            value={prompt}
            placeholder="描述声音，例如：清脆的玻璃杯碰撞声"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="inline-form">
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {sfx.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0.5}
              max={22}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              title="秒"
            />
          </div>
          <button
            className="secondary-button"
            disabled={!prompt.trim()}
            onClick={() =>
              void startJob("generate", "生成音效", {
                capability: "sfx",
                prompt: prompt.trim(),
                providerId,
                duration,
              })
            }
          >
            生成（使用 {sfx.find((x) => x.id === providerId)?.name} 的额度）
          </button>
        </>
      ) : (
        <p className="resource-hint">
          在「模型」页添加启用了「音效」能力的服务（如
          ElevenLabs、fal.ai）后可以生成音效。
        </p>
      )}
    </>
  );
}
function StockLibrary() {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers),
    t = activeTimeline(p);
  const stock = providers.filter(
    (x) => x.enabled && x.capabilities.includes("stock"),
  );
  const [providerId, setProviderId] = useState(stock[0]?.id ?? ""),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<"image" | "video" | "audio">("video"),
    [items, setItems] = useState<StockItem[]>([]),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState(1);
  const provider = stock.find((x) => x.id === providerId);
  const search = async (nextPage = 1) => {
    if (!query.trim() || !providerId) return;
    setLoading(true);
    try {
      const found = await post<StockItem[]>("/api/stock/search", {
        providerId,
        query: query.trim(),
        kind,
        page: nextPage,
        ...(t.height > t.width
          ? { orientation: "portrait" }
          : t.width > t.height
            ? { orientation: "landscape" }
            : {}),
      });
      setItems(nextPage === 1 ? found : [...items, ...found]);
      setPage(nextPage);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setLoading(false);
    }
  };
  if (!stock.length)
    return (
      <p className="resource-hint">
        在「模型」页添加 Pexels、Pixabay 或 Freesound（填写各自的 API
        Key）后，就能在这里检索可商用的图片、视频与音效。
      </p>
    );
  return (
    <>
      <div className="inline-form">
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          {stock.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          {provider?.kind !== "freesound" && (
            <option value="video">视频</option>
          )}
          {provider?.kind !== "freesound" && (
            <option value="image">图片</option>
          )}
          {provider?.kind === "freesound" && (
            <option value="audio">音效</option>
          )}
        </select>
      </div>
      <form
        className="search-field"
        onSubmit={(e) => {
          e.preventDefault();
          void search(1);
        }}
      >
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="关键词（英文结果更多）"
        />
      </form>
      {loading && <LoaderCircle className="spin" size={14} />}
      <div className="stock-grid">
        {items.map((item) => (
          <figure key={item.id} className="stock-item">
            {item.kind === "audio" ? (
              <audio src={item.previewUrl} controls preload="none" />
            ) : item.kind === "video" ? (
              <video
                src={item.previewUrl}
                muted
                loop
                preload="none"
                onMouseEnter={(e) =>
                  void e.currentTarget.play().catch(() => {})
                }
                onMouseLeave={(e) => e.currentTarget.pause()}
              />
            ) : (
              <img src={item.previewUrl} alt="" loading="lazy" />
            )}
            <figcaption
              title={`${item.title} · ${item.author ?? ""} · ${item.license}`}
            >
              <span>{item.title}</span>
              <button
                className="icon-button"
                title="导入到项目"
                onClick={async () => {
                  try {
                    const job = await post<Job>(
                      `/api/projects/${p.id}/import-url`,
                      {
                        url: item.downloadUrl,
                        name: item.title.slice(0, 120),
                        license: item.license,
                        author: item.author,
                        sourceUrl: item.sourceUrl,
                        sourceName: item.provider,
                      },
                    );
                    acceptJob(job);
                    notify("正在下载到素材库");
                  } catch (e) {
                    notify(String(e), true);
                  }
                }}
              >
                <Download size={12} />
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
      {items.length > 0 && (
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void search(page + 1)}
        >
          加载更多
        </button>
      )}
      <p className="resource-hint">
        导入时会记录作者与许可；需要署名的素材请在描述或片尾注明。
      </p>
    </>
  );
}
function FontsLibrary() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const [fonts, setFonts] = useState<{ family: string; file: string }[] | null>(
      null,
    ),
    [query, setQuery] = useState(""),
    [sample, setSample] = useState("剪出你的故事 Story 2026");
  useEffect(() => {
    void localFonts().then(setFonts);
  }, []);
  const shown = (fonts ?? [])
    .filter(
      (f) => !query || f.family.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 200);
  return (
    <>
      <label className="search-field">
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索本机字体"
        />
      </label>
      <input
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        aria-label="预览文字"
      />
      {!fonts && <LoaderCircle className="spin" size={14} />}
      <div className="font-list">
        {shown.map((f) => (
          <button
            key={f.family}
            className="font-row"
            title="应用到所选文字片段"
            onClick={() => {
              const clips = selection(p, t).filter(
                (c) =>
                  c.caption ||
                  p.assets.find((a) => a.id === c.assetId)?.kind === "text",
              );
              if (!needSelection(clips, "文字或字幕片段")) return;
              void commit(
                clips.map(
                  (c): Command => ({
                    type: "clip.update",
                    timelineId: t.id,
                    clipId: c.id,
                    patch: {
                      textStyle: textStyleSchema.parse({
                        ...c.textStyle,
                        fontFamily: f.family,
                      }),
                    },
                  }),
                ),
                `字体：${f.family}`,
              );
            }}
          >
            <span style={{ fontFamily: `"${f.family}"` }}>
              {sample || f.family}
            </span>
            <small>
              <Type size={10} /> {f.family}
            </small>
          </button>
        ))}
      </div>
      <p className="resource-hint">
        字体来自这台电脑；导出在同一台电脑渲染，所以画面一致。换电脑打开时请确认字体已安装。
      </p>
    </>
  );
}
function ExtensionsLibrary() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const plugins = useRemote<PluginInfo[]>("/api/plugins", "plugins", []);
  const apply = async (
    plugin: PluginInfo,
    kind: string,
    itemId: string,
    name: string,
  ) => {
    try {
      if (kind === "captionStyles") {
        const style = await pluginsApi.item<CaptionStyle>(
          plugin.id,
          kind,
          itemId,
        );
        await commit(
          [
            {
              type: "styles.update",
              patch: {
                captions: [
                  ...p.styles.captions.filter((x) => x.id !== style.id),
                  style,
                ].slice(-60),
              },
            },
          ],
          `保存扩展字幕样式「${name}」`,
        );
        return;
      }
      const clips = selection(p, t, true);
      if (!needSelection(clips, "画面片段")) return;
      if (kind === "luts") {
        const lut = await pluginsApi.item<{ name: string; cube: string }>(
          plugin.id,
          kind,
          itemId,
        );
        const assetId = newId();
        await commit(
          [
            {
              type: "asset.add",
              asset: assetSchema.parse({
                id: assetId,
                name: `${lut.name}.cube`,
                kind: "text",
                text: lut.cube,
                tags: ["LUT", "扩展"],
                folder: "LUT",
                createdAt: new Date().toISOString(),
                source: { kind: "plugin", name: plugin.id },
              }),
            },
            ...clips.map(
              (c): Command => ({
                type: "clip.update",
                timelineId: t.id,
                clipId: c.id,
                patch: { effects: { ...c.effects, lutAssetId: assetId } },
              }),
            ),
          ],
          `套用扩展 LUT「${name}」`,
        );
      } else if (kind === "effects") {
        const effect = await pluginsApi.item<{ shader: string }>(
          plugin.id,
          kind,
          itemId,
        );
        await commit(
          clips.map(
            (c): Command => ({
              type: "clip.update",
              timelineId: t.id,
              clipId: c.id,
              patch: { effects: { ...c.effects, shader: effect.shader } },
            }),
          ),
          `扩展特效「${name}」`,
        );
      } else if (kind === "transitions") {
        const transition = await pluginsApi.item<{ shader: string }>(
          plugin.id,
          kind,
          itemId,
        );
        await commit(
          clips.map(
            (c): Command => ({
              type: "clip.update",
              timelineId: t.id,
              clipId: c.id,
              patch: {
                transition: {
                  kind: "dissolve",
                  duration: Math.max(
                    1,
                    Math.min(c.duration, Math.round(t.fps * 0.6)),
                  ),
                  shader: transition.shader,
                },
              },
            }),
          ),
          `扩展转场「${name}」`,
        );
      } else if (kind === "cameraMoves") {
        const move = await pluginsApi.item<{
          keyframes: Partial<
            Record<
              (typeof keyframeProperties)[number],
              { frame: number; value: number; easing: string }[]
            >
          >;
        }>(plugin.id, kind, itemId);
        await commit(
          clips.map(
            (c): Command => ({
              type: "clip.update",
              timelineId: t.id,
              clipId: c.id,
              patch: {
                keyframes: {
                  ...c.keyframes,
                  ...Object.fromEntries(
                    Object.entries(move.keyframes).map(([k, keys]) => [
                      k,
                      [
                        ...new Map(
                          keys!.map((key) => {
                            const frame = Math.min(
                              c.duration - 1,
                              Math.round(key.frame * (c.duration - 1)),
                            );
                            return [frame, { ...key, frame }];
                          }),
                        ).values(),
                      ],
                    ]),
                  ),
                } as Clip["keyframes"],
              },
            }),
          ),
          `扩展镜头运动「${name}」`,
        );
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };
  const kinds: [string, string][] = [
    ["luts", "LUT"],
    ["effects", "特效"],
    ["transitions", "转场"],
    ["cameraMoves", "镜头运动"],
    ["captionStyles", "字幕样式"],
  ];
  return (
    <>
      <button
        className="secondary-button"
        onClick={() => setState({ nav: "extensions" })}
      >
        <Puzzle size={13} />
        管理扩展
      </button>
      {!(plugins.value ?? []).length && (
        <p className="resource-hint">
          还没有安装扩展。扩展包（tadacut-plugin@1）可以提供模板、LUT、音效、转场、特效、镜头运动和字幕样式。
        </p>
      )}
      {(plugins.value ?? []).map((plugin) => (
        <section key={plugin.id}>
          <h5>{plugin.name}</h5>
          {kinds.map(([kind, label]) =>
            plugin.items[kind]?.length ? (
              <div key={kind}>
                <small className="muted">{label}</small>
                <div className="resource-grid">
                  {plugin.items[kind].map((item) => (
                    <button
                      key={item.id}
                      className="resource-card"
                      onClick={() =>
                        void apply(plugin, kind, item.id, item.name)
                      }
                    >
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </section>
      ))}
    </>
  );
}
