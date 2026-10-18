import { useEffect, useRef, useState } from "react";
import {
  activeTimeline,
  portraitPresets,
  beautySchema,
  blendModeNames,
  blendModes,
  colorSpaces,
  formatFrameTimecode,
  importSubtitleCommands,
  maskSchema,
  maskSvg,
  mediaOperationSchema,
  processingFeatures,
  processingSourceKinds,
  standardFrameRates,
  timelineProfileSchema,
  type Clip,
  type ClipAdvanced,
  type ClipMask,
  type MediaOperation,
  type Project,
  type SubtitleFormat,
  type Timeline,
} from "@tadacut/domain";
import {
  commit,
  getState,
  notify,
  setState,
  startJob,
  useStudio,
} from "../lib/store";
import { post, request } from "../lib/api";
import { Modal } from "./Pages";

const Field = ({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) => (
  <label className="advanced-number">
    <span>{label}</span>
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number(value.toFixed(4))}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
    />
  </label>
);
export function CurveEditor({
  value,
  onChange,
  max = 1,
  label = "曲线",
}: {
  value: [number, number][];
  onChange: (v: [number, number][]) => void;
  max?: number;
  label?: string;
}) {
  const [draft, setDraft] = useState(value),
    [selected, setSelected] = useState(0);
  const drag = useRef<number | null>(null),
    latest = useRef(draft);
  useEffect(() => {
    setDraft(value);
    latest.current = value;
  }, [JSON.stringify(value)]);
  const update = (v: [number, number][]) => {
    latest.current = v;
    setDraft(v);
  };
  return (
    <div className="curve-editor">
      <svg
        viewBox="0 0 220 136"
        role="img"
        aria-label={label}
        onPointerDown={(e) => {
          if (drag.current !== null) return;
          const r = e.currentTarget.getBoundingClientRect(),
            x = Math.max(
              0.001,
              Math.min(0.999, (e.clientX - r.left) / r.width),
            ),
            y = Math.max(
              max === 1 ? 0 : 0.05,
              Math.min(max, (1 - (e.clientY - r.top) / r.height) * max),
            );
          if (draft.length < 32) {
            const next = [...draft, [x, y] as [number, number]].sort(
              (a, b) => a[0] - b[0],
            );
            update(next);
            onChange(next);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const index = drag.current,
            r = e.currentTarget.getBoundingClientRect();
          const next = latest.current.map((p) => [...p] as [number, number]);
          const x =
            index === 0
              ? 0
              : index === next.length - 1
                ? 1
                : Math.max(
                    next[index - 1][0] + 0.001,
                    Math.min(
                      next[index + 1][0] - 0.001,
                      (e.clientX - r.left) / r.width,
                    ),
                  );
          const y = Math.max(
            max === 1 ? 0 : 0.05,
            Math.min(max, (1 - (e.clientY - r.top) / r.height) * max),
          );
          next[index] = [x, y];
          update(next);
        }}
        onPointerUp={() => {
          if (drag.current !== null) {
            drag.current = null;
            onChange(latest.current);
          }
        }}
      >
        <path
          className="curve-grid"
          d="M0 34H220M0 68H220M0 102H220M55 0V136M110 0V136M165 0V136"
        />
        <polyline
          className="curve-line"
          points={draft
            .map((p) => `${p[0] * 220},${136 - (p[1] / max) * 136}`)
            .join(" ")}
        />
        {draft.map((p, i) => (
          <circle
            key={i}
            cx={p[0] * 220}
            cy={136 - (p[1] / max) * 136}
            r="5"
            className={selected === i ? "selected" : ""}
            onPointerDown={(e) => {
              e.stopPropagation();
              drag.current = i;
              setSelected(i);
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
      <div className="advanced-inline">
        <small>点击加点 · 拖动调整</small>
        <button
          disabled={selected === 0 || selected === draft.length - 1}
          onClick={() => {
            const next = draft.filter((_, i) => i !== selected);
            update(next);
            setSelected(0);
            onChange(next);
          }}
        >
          删除点
        </button>
      </div>
    </div>
  );
}
export function AdvancedVisualPanel({
  p,
  t,
  clipIds,
}: {
  p: Project;
  t: Timeline;
  clipIds: string[];
}) {
  const clips = t.clips.filter((c) => clipIds.includes(c.id)),
    c = clips[0],
    a = c?.advanced ?? {};
  const [channel, setChannel] = useState<"master" | "red" | "green" | "blue">(
      "master",
    ),
    [band, setBand] = useState(0),
    [maskId, setMaskId] = useState("");
  const frame = useStudio((s) => s.playhead);
  if (!c) return null;
  const patch = (value: Partial<ClipAdvanced>, label: string) =>
    void commit(
      clips.map((clip) => ({
        type: "clip.update",
        timelineId: t.id,
        clipId: clip.id,
        patch: { advanced: { ...clip.advanced, ...value } },
      })),
      label,
    );
  const mask = a.masks?.find((m) => m.id === maskId) ?? a.masks?.[0];
  const updateMask = (m: ClipMask) =>
    patch(
      { masks: (a.masks ?? []).map((x) => (x.id === m.id ? m : x)) },
      "调整蒙版",
    );
  const beauty = beautySchema.parse(a.beauty ?? {}),
    hsl = a.hsl?.find((h) => h.center === band) ?? {
      center: band,
      width: 45,
      hue: 0,
      saturation: 0,
      lightness: 0,
    };
  return (
    <div className="advanced-visual">
      {clips.length > 1 && (
        <p className="hint">这页设置将应用到所选 {clips.length} 个片段。</p>
      )}
      <label className="form-field">
        图层混合
        <select
          aria-label="图层混合"
          value={a.blend ?? "normal"}
          onChange={(e) =>
            patch(
              { blend: e.target.value as ClipAdvanced["blend"] },
              "图层混合",
            )
          }
        >
          {blendModes.map((m) => (
            <option key={m} value={m}>
              {blendModeNames[m]}
            </option>
          ))}
        </select>
      </label>
      <details open>
        <summary>蒙版与手动修边</summary>
        <div className="advanced-inline">
          <select
            aria-label="选择蒙版"
            value={mask?.id ?? ""}
            onChange={(e) => setMaskId(e.target.value)}
          >
            <option value="">选择蒙版</option>
            {(a.masks ?? []).map((m, i) => (
              <option key={m.id} value={m.id}>
                蒙版 {i + 1} · {m.shape}
              </option>
            ))}
          </select>
          <button
            disabled={(a.masks?.length ?? 0) >= 8}
            onClick={() => {
              const m = maskSchema.parse({
                id: crypto.randomUUID(),
                shape: "ellipse",
              });
              patch({ masks: [...(a.masks ?? []), m] }, "添加蒙版");
              setMaskId(m.id);
            }}
          >
            添加
          </button>
        </div>
        {mask && (
          <>
            <label className="form-field">
              形状
              <select
                aria-label="蒙版形状"
                value={mask.shape}
                onChange={(e) =>
                  updateMask(
                    maskSchema.parse({
                      ...mask,
                      shape: e.target.value,
                      points: [
                        [0.1, 0.1],
                        [0.9, 0.1],
                        [0.9, 0.9],
                        [0.1, 0.9],
                      ],
                      anchors: [
                        { point: [0.1, 0.1], outgoing: [0.5, 0] },
                        { point: [0.9, 0.1], outgoing: [1, 0.5] },
                        { point: [0.9, 0.9], outgoing: [0.5, 1] },
                        { point: [0.1, 0.9], outgoing: [0, 0.5] },
                      ],
                    }),
                  )
                }
              >
                {[
                  ["ellipse", "椭圆"],
                  ["rectangle", "矩形"],
                  ["polygon", "自由多边形"],
                  ["bezier", "贝塞尔路径"],
                  ["brush", "笔刷修边"],
                ].map(([v, n]) => (
                  <option value={v} key={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <MaskEditor mask={mask} onChange={updateMask} />
            <div className="advanced-fields">
              {(
                [
                  "x",
                  "y",
                  "width",
                  "height",
                  "rotation",
                  "feather",
                  "opacity",
                ] as const
              ).map((k) => (
                <Field
                  key={k}
                  label={
                    {
                      x: "蒙版 X",
                      y: "蒙版 Y",
                      width: "蒙版宽",
                      height: "蒙版高",
                      rotation: "蒙版角度",
                      feather: "羽化",
                      opacity: "蒙版透明度",
                    }[k]
                  }
                  value={mask[k]}
                  min={
                    k === "rotation"
                      ? -360
                      : k === "width" || k === "height"
                        ? 0.01
                        : 0
                  }
                  max={
                    k === "rotation"
                      ? 360
                      : k === "width" || k === "height"
                        ? 4
                        : 1
                  }
                  onChange={(v) => updateMask({ ...mask, [k]: v })}
                />
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={mask.inverted}
                onChange={(e) =>
                  updateMask({ ...mask, inverted: e.target.checked })
                }
              />
              反向蒙版
            </label>
            <select
              aria-label="蒙版组合"
              value={mask.operation}
              onChange={(e) =>
                updateMask({
                  ...mask,
                  operation: e.target.value as ClipMask["operation"],
                })
              }
            >
              <option value="add">相加</option>
              <option value="subtract">减去</option>
              <option value="intersect">交集</option>
            </select>
            <div className="advanced-inline">
              <button
                onClick={() => {
                  const at = Math.max(
                    0,
                    Math.min(c.duration - 1, Math.round(frame - c.start)),
                  );
                  updateMask({
                    ...mask,
                    keys: [
                      ...mask.keys.filter((k) => k.frame !== at),
                      {
                        frame: at,
                        x: mask.x,
                        y: mask.y,
                        width: mask.width,
                        height: mask.height,
                        rotation: mask.rotation,
                        feather: mask.feather,
                      },
                    ].sort((a, b) => a.frame - b.frame),
                  });
                }}
              >
                在播放头添加关键帧
              </button>
              <button
                onClick={() =>
                  patch(
                    { masks: a.masks?.filter((m) => m.id !== mask.id) },
                    "删除蒙版",
                  )
                }
              >
                删除蒙版
              </button>
            </div>
            {mask.keys.length > 0 && (
              <div className="mask-keys">
                {mask.keys.map((k) => (
                  <button
                    title="点击移到关键帧；右键删除"
                    key={k.frame}
                    onClick={() => {
                      setState({ playhead: c.start + k.frame });
                      const { frame: _, ...values } = k;
                      updateMask({ ...mask, ...values });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      updateMask({
                        ...mask,
                        keys: mask.keys.filter((x) => x.frame !== k.frame),
                      });
                    }}
                  >
                    ◆ {k.frame}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </details>
      <details open>
        <summary>RGB 曲线</summary>
        <select
          aria-label="曲线通道"
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        >
          {[
            ["master", "主曲线"],
            ["red", "红色"],
            ["green", "绿色"],
            ["blue", "蓝色"],
          ].map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <CurveEditor
          value={
            a.curves?.[channel] ?? [
              [0, 0],
              [1, 1],
            ]
          }
          onChange={(points) =>
            patch(
              { curves: { ...a.curves, [channel]: points } },
              "调整色彩曲线",
            )
          }
        />
      </details>
      <details>
        <summary>选择性 HSL</summary>
        <select
          aria-label="HSL 色带"
          value={band}
          onChange={(e) => setBand(Number(e.target.value))}
        >
          {[0, 30, 60, 120, 180, 240, 270, 300].map((v, i) => (
            <option key={v} value={v}>
              {["红", "橙", "黄", "绿", "青", "蓝", "紫", "洋红"][i]}
            </option>
          ))}
        </select>
        {(["hue", "saturation", "lightness", "width"] as const).map((k) => (
          <Field
            key={k}
            label={
              {
                hue: "色相偏移",
                saturation: "饱和度偏移",
                lightness: "明度偏移",
                width: "色带宽度",
              }[k]
            }
            value={hsl[k]}
            min={k === "hue" ? -180 : k === "width" ? 1 : -1}
            max={k === "hue" || k === "width" ? 180 : 1}
            onChange={(v) =>
              patch(
                {
                  hsl: [
                    ...(a.hsl ?? []).filter((b) => b.center !== band),
                    { ...hsl, [k]: v },
                  ],
                },
                "选择性调色",
              )
            }
          />
        ))}
      </details>
      <details>
        <summary>人像与身形</summary>
        <div className="advanced-inline">
          {portraitPresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() =>
                patch(
                  { beauty: { ...beauty, ...preset.values } },
                  "应用人像预设",
                )
              }
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="hint">
          调整作用在指定区域；请按画面设置脸部和身体的位置。
        </p>
        {(
          ["smooth", "brighten", "faceSlim", "eyeSize", "bodySlim"] as const
        ).map((k) => (
          <Field
            key={k}
            label={
              {
                smooth: "磨皮",
                brighten: "提亮",
                faceSlim: "瘦脸",
                eyeSize: "大眼",
                bodySlim: "身形",
              }[k]
            }
            value={beauty[k]}
            min={
              k === "smooth" || k === "brighten"
                ? 0
                : k === "eyeSize"
                  ? -0.5
                  : -1
            }
            max={k === "eyeSize" ? 0.5 : 1}
            onChange={(v) =>
              patch({ beauty: { ...beauty, [k]: v } }, "调整人像")
            }
          />
        ))}
        {(["face", "body"] as const).map((region) => (
          <details key={region}>
            <summary>{region === "face" ? "脸部区域" : "身体区域"}</summary>
            {(["x", "y", "width", "height"] as const).map((k) => (
              <Field
                key={k}
                label={`${region === "face" ? "脸部" : "身体"} ${k}`}
                value={beauty[region][k]}
                onChange={(v) =>
                  patch(
                    {
                      beauty: {
                        ...beauty,
                        [region]: { ...beauty[region], [k]: v },
                      },
                    },
                    "调整人像区域",
                  )
                }
              />
            ))}
          </details>
        ))}
        {(["leftEye", "rightEye"] as const).map((eye) => (
          <div key={eye} className="advanced-fields">
            {[0, 1].map((i) => (
              <Field
                key={i}
                label={`${eye === "leftEye" ? "左眼" : "右眼"} ${i === 0 ? "X" : "Y"}`}
                value={beauty[eye][i]}
                onChange={(v) => {
                  const point = [...beauty[eye]] as [number, number];
                  point[i] = v;
                  patch(
                    { beauty: { ...beauty, [eye]: point } },
                    "调整眼睛位置",
                  );
                }}
              />
            ))}
          </div>
        ))}
      </details>
      {a.tracking && (
        <details open>
          <summary>跟踪轨迹</summary>
          <p>
            {a.tracking.mode === "plane" ? "平面" : "位置"} ·{" "}
            {a.tracking.samples.length} 帧
          </p>
          <button
            onClick={() => {
              const next = { ...a };
              delete next.tracking;
              void commit(
                clips.map((c) => ({
                  type: "clip.update",
                  timelineId: t.id,
                  clipId: c.id,
                  patch: { advanced: next },
                })),
                "移除跟踪",
              );
            }}
          >
            移除跟踪
          </button>
        </details>
      )}
      {p.assets.find((a) => a.id === c.assetId)?.proxy && (
        <button
          onClick={() =>
            void commit(
              [{ type: "asset.proxy.clear", assetId: c.assetId }],
              "恢复原始素材预览",
            )
          }
        >
          移除代理关联
        </button>
      )}
      <button
        className="secondary-button"
        onClick={() => setState({ modal: "tools", creativeTool: "advanced" })}
      >
        打开高级媒体工具
      </button>
    </div>
  );
}
function MaskEditor({
  mask,
  onChange,
}: {
  mask: ClipMask;
  onChange: (m: ClipMask) => void;
}) {
  const [draft, setDraft] = useState(mask),
    [erase, setErase] = useState(false),
    [radius, setRadius] = useState(0.04);
  const drawing = useRef(false),
    current = useRef(mask);
  useEffect(() => {
    setDraft(mask);
    current.current = mask;
  }, [mask]);
  const point = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  };
  const update = (m: ClipMask) => {
    current.current = m;
    setDraft(m);
  };
  return (
    <div className="mask-editor">
      <svg
        viewBox="0 0 100 100"
        aria-label="绘制蒙版"
        onPointerDown={(e) => {
          const p = point(e);
          if (mask.shape === "brush") {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            update({
              ...mask,
              strokes: [
                ...(mask.strokes ?? []),
                { points: [p], radius, erase },
              ],
            });
          } else if (mask.shape === "polygon") {
            onChange({
              ...mask,
              points: [...(mask.points ?? []), p].slice(-128),
            });
          } else if (mask.shape === "bezier") {
            onChange({
              ...mask,
              anchors: [
                ...(mask.anchors ?? []),
                {
                  point: p,
                  incoming: [Math.max(0, p[0] - 0.1), p[1]] as [number, number],
                  outgoing: [Math.min(1, p[0] + 0.1), p[1]] as [number, number],
                },
              ].slice(-64),
            });
          }
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const m = current.current,
            strokes = [...(m.strokes ?? [])],
            last = strokes.at(-1)!;
          if (last.points.length < 2000)
            strokes[strokes.length - 1] = {
              ...last,
              points: [...last.points, point(e)],
            };
          update({ ...m, strokes });
        }}
        onPointerUp={() => {
          if (drawing.current) {
            drawing.current = false;
            onChange(current.current);
          }
        }}
      >
        <image
          href={`data:image/svg+xml,${encodeURIComponent(maskSvg([{ ...draft, x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0, keys: [] }], 100, 100))}`}
          width="100"
          height="100"
        />
        {draft.shape === "bezier" &&
          draft.anchors?.map((a, i) => (
            <g key={i}>
              <path
                d={`M${(a.incoming ?? a.point)[0] * 100} ${(a.incoming ?? a.point)[1] * 100}L${a.point[0] * 100} ${a.point[1] * 100}L${(a.outgoing ?? a.point)[0] * 100} ${(a.outgoing ?? a.point)[1] * 100}`}
                stroke="#e592ae"
                strokeWidth=".5"
              />
              {(["point", "incoming", "outgoing"] as const).map(
                (key) =>
                  a[key] && (
                    <circle
                      key={key}
                      cx={a[key]![0] * 100}
                      cy={a[key]![1] * 100}
                      r="2"
                      fill={key === "point" ? "#eb7c9f" : "#8aa9d6"}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const svg = e.currentTarget.ownerSVGElement!,
                          rect = svg.getBoundingClientRect();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const circle = e.currentTarget;
                        circle.onpointermove = (event) => {
                          const anchors = structuredClone(
                            current.current.anchors!,
                          );
                          anchors[i][key] = [
                            Math.max(
                              0,
                              Math.min(
                                1,
                                (event.clientX - rect.left) / rect.width,
                              ),
                            ),
                            Math.max(
                              0,
                              Math.min(
                                1,
                                (event.clientY - rect.top) / rect.height,
                              ),
                            ),
                          ];
                          update({ ...current.current, anchors });
                        };
                        circle.onpointerup = () => {
                          circle.onpointermove = null;
                          circle.onpointerup = null;
                          onChange(current.current);
                        };
                      }}
                    />
                  ),
              )}
            </g>
          ))}
      </svg>
      {mask.shape === "brush" ? (
        <>
          <Field
            label="笔刷大小"
            value={radius}
            min={0.005}
            max={0.3}
            onChange={setRadius}
          />
          <label>
            <input
              type="checkbox"
              checked={erase}
              onChange={(e) => setErase(e.target.checked)}
            />
            擦除笔刷
          </label>
          <button onClick={() => onChange({ ...mask, strokes: [] })}>
            清空笔迹
          </button>
        </>
      ) : (
        <small>
          {mask.shape === "bezier"
            ? "点击加锚点，拖动蓝点调整曲线"
            : "自由路径点击添加顶点"}
        </small>
      )}
    </div>
  );
}
export function TimelineProfilePanel({ timeline }: { timeline: Timeline }) {
  const p =
    timeline.profile ??
    timelineProfileSchema.parse({
      rate: { numerator: Math.round(timeline.fps * 1000), denominator: 1000 },
    });
  const patch = (value: Partial<typeof p>) => {
    try {
      const profile = timelineProfileSchema.parse({ ...p, ...value });
      void commit(
        [
          {
            type: "timeline.profile",
            timelineId: timeline.id,
            profile,
            preserveTime: true,
          },
        ],
        "设置时间线格式",
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  return (
    <details className="advanced-profile" open>
      <summary>帧率与色彩管理</summary>
      <select
        aria-label="标准帧率"
        value={`${p.rate.numerator}/${p.rate.denominator}`}
        onChange={(e) => {
          const [numerator, denominator] = e.target.value
            .split("/")
            .map(Number);
          patch({ rate: { numerator, denominator }, dropFrame: false });
        }}
      >
        <option value={`${p.rate.numerator}/${p.rate.denominator}`}>
          {(p.rate.numerator / p.rate.denominator).toFixed(3)} fps
        </option>
        {standardFrameRates.map((r) => (
          <option key={r.name} value={`${r.numerator}/${r.denominator}`}>
            {r.name}
          </option>
        ))}
      </select>
      <label className="check-label">
        <input
          type="checkbox"
          checked={p.dropFrame}
          disabled={
            p.rate.denominator !== 1001 ||
            ![30000, 60000].includes(p.rate.numerator)
          }
          onChange={(e) => patch({ dropFrame: e.target.checked })}
        />
        丢帧时间码
      </label>
      <small>{formatFrameTimecode(Math.round(timeline.fps * 60), p)}</small>
      {(["workingSpace", "outputSpace"] as const).map((k) => (
        <label className="form-field" key={k}>
          {k === "workingSpace" ? "工作色彩空间" : "输出色彩空间"}
          <select value={p[k]} onChange={(e) => patch({ [k]: e.target.value })}>
            {colorSpaces.map((s) => (
              <option value={s} key={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      ))}
      <Field
        label="峰值亮度 (nit)"
        value={p.peakNits}
        min={100}
        max={10000}
        step={100}
        onChange={(peakNits) => patch({ peakNits })}
      />
      <label className="check-label">
        <input
          type="checkbox"
          checked={p.proxyPreview}
          onChange={(e) => patch({ proxyPreview: e.target.checked })}
        />
        预览优先使用代理
      </label>
    </details>
  );
}
export function AdvancedToolsDialog({
  close,
  initial,
}: {
  close: () => void;
  initial?: string;
}) {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers),
    selected = useStudio((s) => s.selectedClipIds),
    t = activeTimeline(p);
  const [type, setType] = useState(initial ?? "speed-curve"),
    [clipId, setClipId] = useState(selected[0] ?? ""),
    [assetId, setAssetId] = useState(
      p.assets.find((a) => ["video", "audio", "image"].includes(a.kind))?.id ??
        "",
    ),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [caps, setCaps] = useState<
      { type: string; available: boolean; reason: string }[]
    >([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void request<typeof caps>("/api/advanced/capabilities")
      .then(setCaps)
      .catch((e) => notify(e.message, true));
  }, []);
  useEffect(() => {
    if (type === "subtitles") return;
    const kinds = processingSourceKinds(type),
      validClips = t.clips.filter((c) =>
        p.assets.some((a) => a.id === c.assetId && kinds.includes(a.kind)),
      );
    if (
      (clipId && !validClips.some((c) => c.id === clipId)) ||
      (type === "prerender" && !clipId)
    )
      setClipId(validClips[0]?.id ?? "");
    if (!p.assets.some((a) => a.id === assetId && kinds.includes(a.kind)))
      setAssetId(p.assets.find((a) => kinds.includes(a.kind))?.id ?? "");
  }, [type, p.revision]);
  const defaults: Record<string, Record<string, unknown>> = {
    "speed-curve": {
      points: [
        { position: 0, speed: 1 },
        { position: 0.5, speed: 0.3 },
        { position: 1, speed: 1 },
      ],
    },
    freeze: { at: 0, seconds: 3 },
    interpolate: { fps: 60, method: "optical-flow" },
    stabilize: { strength: 16, crop: true },
    voice: { semitones: 0, pan: 0, preset: "clean" },
    proxy: { width: 960 },
    track: {
      region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      mode: "position",
      sampleFps: 12,
    },
    "color-convert": { input: "rec709", output: "rec2020-pq", peakNits: 1000 },
    inpaint: {
      prompt: "Reconstruct a natural background in the masked region.",
    },
    upscale: { scale: "2" },
  };
  const v = { ...defaults[type], ...values },
    feature = processingFeatures.find((f) => f.type === type),
    cap = feature && "capability" in feature ? feature.capability : undefined;
  const available = providers.filter(
    (p) => p.enabled && (!cap || p.capabilities.includes(cap as never)),
  );
  const change = (key: string, value: unknown) =>
    setValues({ ...values, [key]: value });
  const number = (
    key: string,
    label: string,
    min: number,
    max: number,
    step = 0.01,
  ) => (
    <Field
      label={label}
      value={Number(v[key] ?? 0)}
      min={min}
      max={max}
      step={step}
      onChange={(n) => change(key, n)}
    />
  );
  const chooseAsset = (key: string, label: string, kinds: string[]) => (
    <label className="form-field">
      {label}
      <select
        aria-label={label}
        value={String(v[key] ?? "")}
        onChange={(e) => change(key, e.target.value || undefined)}
      >
        <option value="">请选择</option>
        {p.assets
          .filter((a) => kinds.includes(a.kind))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
    </label>
  );
  const run = async () => {
    setBusy(true);
    try {
      const operation = mediaOperationSchema.parse({
        ...v,
        type,
        ...(cap ? { providerId: v.providerId ?? available[0]?.id } : {}),
      });
      const current = getState().project!;
      const job = await startJob("process-media", feature!.name, {
        ...(clipId ? { clipId } : { assetId }),
        timelineId: t.id,
        expectedRevision: current.revision,
        operation,
      });
      if (job) {
        close();
        setState({ nav: "tasks" });
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="高级媒体工具"
      subtitle="选择功能与素材，处理完成后在任务中心预览并应用。也可直接让创作助手操作。"
      close={close}
    >
      <div className="modal-body advanced-tools">
        <nav aria-label="高级功能">
          {processingFeatures.map((f) => (
            <button
              key={f.type}
              className={type === f.type ? "active" : ""}
              onClick={() => {
                setType(f.type);
                setValues({});
              }}
            >
              {f.name}
              {!f.local && <small>模型</small>}
            </button>
          ))}
          <button
            className={type === "subtitles" ? "active" : ""}
            onClick={() => setType("subtitles")}
          >
            字幕 / 歌词导入
          </button>
        </nav>
        <section>
          {type === "subtitles" ? (
            <SubtitleImportPanel />
          ) : (
            <>
              <h3>{feature?.name}</h3>
              <label className="form-field">
                处理片段
                <select
                  aria-label="处理片段"
                  value={clipId}
                  onChange={(e) => setClipId(e.target.value)}
                >
                  <option value="" disabled={type === "prerender"}>
                    使用完整素材
                  </option>
                  {t.clips
                    .filter((c) =>
                      p.assets.some(
                        (a) =>
                          a.id === c.assetId &&
                          processingSourceKinds(type).includes(a.kind),
                      ),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ||
                          p.assets.find((a) => a.id === c.assetId)?.name}
                      </option>
                    ))}
                </select>
              </label>
              {!clipId && (
                <label className="form-field">
                  素材
                  <select
                    aria-label="处理素材"
                    value={assetId}
                    onChange={(e) => setAssetId(e.target.value)}
                  >
                    {p.assets
                      .filter((a) =>
                        processingSourceKinds(type).includes(a.kind),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {cap && (
                <label className="form-field">
                  模型服务
                  <select
                    aria-label="模型服务"
                    value={String(v.providerId ?? available[0]?.id ?? "")}
                    onChange={(e) => change("providerId", e.target.value)}
                  >
                    <option value="">选择已配置的服务</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {type === "speed-curve" && (
                <>
                  <div className="advanced-inline">
                    {[
                      ["匀速", 1, 1, 1],
                      ["慢进快出", 0.5, 1, 3],
                      ["子弹时间", 1, 0.2, 1],
                      ["加速", 1, 2, 4],
                    ].map(([name, a, b, c]) => (
                      <button
                        key={name}
                        onClick={() =>
                          change("points", [
                            { position: 0, speed: a },
                            { position: 0.5, speed: b },
                            { position: 1, speed: c },
                          ])
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <CurveEditor
                    label="速度曲线"
                    max={4}
                    value={(
                      v.points as { position: number; speed: number }[]
                    ).map((p) => [p.position, p.speed])}
                    onChange={(points) =>
                      change(
                        "points",
                        points.map(([position, speed]) => ({
                          position,
                          speed,
                        })),
                      )
                    }
                  />
                  <p className="hint">
                    横轴为源片段位置，纵轴为速度（0.05–4 倍）。对话工具支持最高
                    16 倍。
                  </p>
                </>
              )}
              {type === "freeze" && (
                <>
                  {number("at", "定格位置（秒）", 0, 1800)}
                  {number("seconds", "定格时长（秒）", 0.1, 600)}
                </>
              )}
              {type === "interpolate" && (
                <>
                  {number("fps", "目标帧率", 1, 120, 1)}
                  <select
                    aria-label="补帧方法"
                    value={String(v.method)}
                    onChange={(e) => change("method", e.target.value)}
                  >
                    <option value="optical-flow">运动估计补帧</option>
                    <option value="blend">帧混合</option>
                  </select>
                </>
              )}
              {type === "stabilize" && (
                <>
                  {number("strength", "防抖强度", 1, 64, 1)}
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(v.crop)}
                      onChange={(e) => change("crop", e.target.checked)}
                    />
                    裁切边缘
                  </label>
                </>
              )}
              {type === "voice" && (
                <>
                  {number("semitones", "音高（半音）", -12, 12, 0.5)}
                  {number("pan", "声像（左 -1 / 右 +1）", -1, 1, 0.05)}
                  <select
                    aria-label="音色效果"
                    value={String(v.preset)}
                    onChange={(e) => change("preset", e.target.value)}
                  >
                    {[
                      ["clean", "自然"],
                      ["deep", "低沉"],
                      ["bright", "明亮"],
                      ["radio", "收音机"],
                      ["echo", "回声"],
                      ["robot", "机械颤音"],
                    ].map(([v, n]) => (
                      <option value={v} key={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {type === "proxy" && number("width", "代理宽度", 160, 1920, 2)}
              {type === "track" && (
                <>
                  <select
                    aria-label="跟踪模式"
                    value={String(v.mode)}
                    onChange={(e) => change("mode", e.target.value)}
                  >
                    <option value="position">位置跟踪</option>
                    <option value="plane">四点平面跟踪</option>
                  </select>
                  <div className="advanced-fields">
                    {["x", "y", "width", "height"].map((k) => (
                      <Field
                        key={k}
                        label={`跟踪区域 ${k}`}
                        value={(v.region as Record<string, number>)[k]}
                        onChange={(n) =>
                          change("region", { ...(v.region as object), [k]: n })
                        }
                      />
                    ))}
                  </div>
                  {number("sampleFps", "每秒跟踪采样", 1, 30, 1)}
                  <label className="form-field">
                    跟随片段
                    <select
                      value={String(v.targetClipId ?? "")}
                      onChange={(e) =>
                        change("targetClipId", e.target.value || undefined)
                      }
                    >
                      <option value="">原片段</option>
                      {t.clips.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    跟随蒙版
                    <select
                      value={String(v.maskId ?? "")}
                      onChange={(e) =>
                        change("maskId", e.target.value || undefined)
                      }
                    >
                      <option value="">移动整个片段</option>
                      {t.clips
                        .find((c) => c.id === (v.targetClipId ?? clipId))
                        ?.advanced?.masks?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.shape} · {m.id.slice(0, 5)}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              {type === "color-convert" && (
                <>
                  {["input", "output"].map((k) => (
                    <label className="form-field" key={k}>
                      {k === "input" ? "输入空间" : "输出空间"}
                      <select
                        value={String(v[k])}
                        onChange={(e) => change(k, e.target.value)}
                      >
                        {colorSpaces.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {number("peakNits", "峰值亮度", 100, 10000, 100)}
                  <p className="hint">
                    转换传递函数与色域，输出 10 位 ProRes；高动态范围转 SDR
                    时做亮度映射。
                  </p>
                </>
              )}
              {type === "remove-background" &&
                chooseAsset("backgroundAssetId", "替换背景（可选）", [
                  "image",
                  "video",
                ])}
              {type === "inpaint" && (
                <>
                  <label className="form-field">
                    使用片段蒙版
                    <select
                      value={String(v.maskId ?? "")}
                      onChange={(e) =>
                        change("maskId", e.target.value || undefined)
                      }
                    >
                      <option value="">使用下面的蒙版文件</option>
                      {t.clips
                        .find((c) => c.id === clipId)
                        ?.advanced?.masks?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.shape} · {m.id.slice(0, 5)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {chooseAsset(
                    "maskAssetId",
                    "消除蒙版（黑色移除、白色保留）",
                    ["image", "video"],
                  )}
                  <label className="form-field">
                    重建背景描述
                    <textarea
                      value={String(v.prompt)}
                      onChange={(e) => change("prompt", e.target.value)}
                    />
                  </label>
                </>
              )}
              {type === "upscale" && (
                <select
                  aria-label="超分倍率"
                  value={String(v.scale)}
                  onChange={(e) => change("scale", e.target.value)}
                >
                  <option value="2">2 倍</option>
                  <option value="4">4 倍</option>
                </select>
              )}
              {type === "lyrics" && (
                <>
                  <label className="form-field">
                    人声分离（可选）
                    <select
                      value={String(v.isolationProviderId ?? "")}
                      onChange={(e) =>
                        change(
                          "isolationProviderId",
                          e.target.value || undefined,
                        )
                      }
                    >
                      <option value="">直接识别</option>
                      {providers
                        .filter(
                          (p) =>
                            p.enabled &&
                            p.capabilities.includes("voice-isolation"),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="form-field">
                    歌词模板
                    <select
                      value={String(v.styleId ?? "karaoke")}
                      onChange={(e) => change("styleId", e.target.value)}
                    >
                      <option value="karaoke">卡拉 OK</option>
                      <option value="highlight">逐词高亮</option>
                      <option value="neon">霓虹歌词</option>
                      <option value="clean">简洁歌词</option>
                    </select>
                  </label>
                </>
              )}
              {["avatar", "lip-sync"].includes(type) &&
                chooseAsset("audioAssetId", "配音素材", ["audio", "video"])}
              {caps.find((c) => c.type === type && !c.available) && (
                <p className="hint">
                  {caps.find((c) => c.type === type)?.reason}
                  <button
                    className="text-button"
                    onClick={() => {
                      close();
                      setState({ nav: "models" });
                    }}
                  >
                    模型设置
                  </button>
                </p>
              )}
              <button
                className="primary-button"
                disabled={
                  busy ||
                  (!clipId && !assetId) ||
                  (Boolean(cap) && !available.length)
                }
                onClick={() => void run()}
              >
                {busy ? "提交中…" : "开始处理"}
              </button>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
export function SubtitleImportPanel() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const [format, setFormat] = useState<SubtitleFormat>("srt"),
    [text, setText] = useState(""),
    [lyrics, setLyrics] = useState(false),
    [offset, setOffset] = useState(0),
    [name, setName] = useState("字幕");
  const apply = async () => {
    try {
      const result = importSubtitleCommands(
        p,
        t,
        { text, format, lyrics, offset, name },
        () => crypto.randomUUID(),
        new Date().toISOString(),
      );
      await commit(result.commands, lyrics ? "导入歌词" : "导入字幕");
      notify(result.warnings.join("；") || `已导入 ${result.count} 条字幕`);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  return (
    <div className="subtitle-import">
      <h3>字幕与歌词</h3>
      <label className="form-field">
        导入文件
        <input
          type="file"
          accept=".srt,.vtt,.ass,.ssa,.lrc"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setName(file.name);
            const ext = file.name.split(".").at(-1)?.toLowerCase();
            setFormat(
              ext === "ssa"
                ? "ass"
                : ["srt", "vtt", "lrc", "ass"].includes(ext ?? "")
                  ? (ext as SubtitleFormat)
                  : "srt",
            );
            setLyrics(ext === "lrc");
            setText(await file.text());
          }}
        />
      </label>
      <select
        aria-label="字幕格式"
        value={format}
        onChange={(e) => setFormat(e.target.value as SubtitleFormat)}
      >
        {["srt", "vtt", "lrc", "ass"].map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      <textarea
        aria-label="字幕内容"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="粘贴字幕或歌词文件内容"
      />
      <Field
        label="时间偏移（秒）"
        value={offset}
        min={-3600}
        max={3600}
        onChange={setOffset}
      />
      <label>
        <input
          type="checkbox"
          checked={lyrics}
          onChange={(e) => setLyrics(e.target.checked)}
        />
        歌词高亮模板
      </label>
      <button
        className="primary-button"
        disabled={!text.trim()}
        onClick={() => void apply()}
      >
        导入到新轨道
      </button>
    </div>
  );
}
export function ApplyMediaResult({
  jobId,
  projectId,
}: {
  jobId: string;
  projectId: string;
}) {
  const [busy, setBusy] = useState(false),
    [applied, setApplied] = useState(false);
  return (
    <button
      className="primary-button"
      disabled={busy || applied}
      onClick={async () => {
        const p = getState().project;
        if (!p || p.id !== projectId) {
          notify("请先打开任务所属项目", true);
          return;
        }
        setBusy(true);
        try {
          const result = await post<{ project: Project; warnings: string[] }>(
            `/api/projects/${projectId}/process/${jobId}/apply`,
            { expectedRevision: p.revision },
          );
          setState({ project: result.project });
          setApplied(true);
          notify(result.warnings.join("；") || "处理结果已应用，可撤销");
        } catch (e) {
          notify((e as Error).message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {applied ? "已应用" : busy ? "应用中…" : "应用处理结果"}
    </button>
  );
}
