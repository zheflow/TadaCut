import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Clapperboard,
  Factory,
  Film,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  Plus,
  ScrollText,
  Trash2,
  Tv,
} from "lucide-react";
import {
  activeTimeline,
  episodeSchema,
  productionPlan,
  productionStages,
  productionSummary,
  restoreProduction,
  sceneSchema,
  scriptFromShots,
  scriptRowSchema,
  shotsFromScript,
  stageNames,
  type Command,
  type Project,
  type ProductionStage,
  type Shot,
} from "@tadacut/domain";
import { commit, setState, startJob, useStudio } from "../lib/store";
import { Storyboard } from "./Story";

type View = "board" | "development" | "episodes" | "script" | "production";
const views: [View, string, typeof Film][] = [
  ["board", "分镜", Clapperboard],
  ["development", "开发", BookOpen],
  ["episodes", "分集", Tv],
  ["script", "剧本", ScrollText],
  ["production", "生产", Factory],
];
export function StoryStudio() {
  const view = useStudio((s) => s.storyView);
  const setView = (view: View) => setState({ storyView: view });
  return (
    <div className="story-studio">
      <div className="story-tabs" role="tablist">
        {views.map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      {view === "board" ? (
        <Storyboard />
      ) : view === "development" ? (
        <Development />
      ) : view === "episodes" ? (
        <Episodes />
      ) : view === "script" ? (
        <Script />
      ) : (
        <Production />
      )}
    </div>
  );
}
const developmentFields: [
  keyof Project["story"]["development"],
  string,
  string,
  boolean,
][] = [
  ["premise", "一句话前提", "如果……会怎样？谁想要什么，又被什么阻挡", false],
  ["genre", "类型", "悬疑、都市、奇幻、喜剧…", false],
  ["tone", "基调", "温暖、冷峻、荒诞、热血…", false],
  ["audience", "受众", "目标观众与观看场景", false],
  [
    "format",
    "格式",
    "集数、每集时长、画幅与平台，如：12 集 · 每集 90 秒 · 9:16",
    false,
  ],
  ["theme", "主题", "故事想表达的核心", false],
  ["world", "世界观", "时代、地点、规则与氛围", true],
  ["synopsis", "故事梗概", "开端、发展、高潮、结局", true],
];
function Development() {
  const p = useStudio((s) => s.project)!;
  const d = p.story.development;
  const save = (patch: Partial<typeof d>, label = "更新故事设定") =>
    void commit([{ type: "story.development", development: patch }], label);
  return (
    <div className="story-page">
      <div className="story-header">
        <div>
          <span className="eyebrow">DEVELOPMENT</span>
          <h1>故事开发</h1>
          <p>
            先把故事想清楚：这些设定会进入每一个分镜与生成提示。也可以在右侧让助手用
            /drama 或 /adapt 帮你完成。
          </p>
        </div>
      </div>
      <div className="development-form">
        {developmentFields.map(([key, label, placeholder, long]) => (
          <label className="form-field" key={key}>
            {label}
            {long ? (
              <textarea
                className="field-textarea"
                defaultValue={String(d[key] ?? "")}
                key={`${key}-${String(d[key] ?? "")}`}
                placeholder={placeholder}
                onBlur={(e) =>
                  e.target.value !== d[key] && save({ [key]: e.target.value })
                }
              />
            ) : (
              <input
                defaultValue={String(d[key] ?? "")}
                key={`${key}-${String(d[key] ?? "")}`}
                placeholder={placeholder}
                onBlur={(e) =>
                  e.target.value !== d[key] && save({ [key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        <label className="select-field">
          <span>改编原文</span>
          <select
            value={d.sourceAssetId ?? ""}
            onChange={(e) =>
              save(
                { sourceAssetId: e.target.value || undefined },
                "设置改编原文",
              )
            }
          >
            <option value="">不是改编</option>
            {p.assets
              .filter((a) => a.kind === "text" && !a.name.endsWith(".cube"))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      </div>
    </div>
  );
}
function Episodes() {
  const p = useStudio((s) => s.project)!;
  const episodes = [...p.story.episodes].sort((a, b) => a.number - b.number);
  const save = (episode: (typeof episodes)[number], label = "更新分集") =>
    void commit(
      [{ type: "story.episode.upsert", episode: episodeSchema.parse(episode) }],
      label,
    );
  return (
    <div className="story-page">
      <div className="story-header">
        <div>
          <span className="eyebrow">EPISODES</span>
          <h1>分集与分场</h1>
          <p>
            每集一个完整的戏剧单元；每场完成一个任务：揭示、对抗、选择或反转。
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() =>
            save(
              episodeSchema.parse({
                id: crypto.randomUUID(),
                number: Math.max(0, ...episodes.map((e) => e.number)) + 1,
                title: `第 ${episodes.length + 1} 集`,
              }),
              "添加分集",
            )
          }
        >
          <Plus size={14} />
          添加一集
        </button>
      </div>
      {!episodes.length && (
        <p className="small-description">
          还没有分集。短片可以不分集，直接在「剧本」或「分镜」里工作。
        </p>
      )}
      {episodes.map((e) => (
        <section className="episode-card" key={e.id}>
          <div className="episode-head">
            <strong>第 {e.number} 集</strong>
            <input
              defaultValue={e.title}
              key={e.title}
              onBlur={(ev) =>
                ev.target.value !== e.title &&
                save({ ...e, title: ev.target.value || e.title })
              }
            />
            <button
              className="icon-button"
              title="删除这一集"
              onClick={() => {
                if (confirm(`删除「${e.title}」及其分场？`))
                  void commit(
                    [{ type: "story.episode.remove", episodeId: e.id }],
                    "删除分集",
                  );
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <textarea
            className="field-textarea"
            placeholder="这一集讲什么，结尾的钩子是什么"
            defaultValue={e.summary}
            key={`summary-${e.summary}`}
            onBlur={(ev) =>
              ev.target.value !== e.summary &&
              save({ ...e, summary: ev.target.value })
            }
          />
          <div className="scene-list">
            {e.scenes.map((sc, i) => (
              <div className="scene-card" key={sc.id}>
                <div className="episode-head">
                  <small>第 {sc.number} 场</small>
                  <input
                    defaultValue={sc.title}
                    key={sc.title}
                    onBlur={(ev) =>
                      ev.target.value !== sc.title &&
                      save({
                        ...e,
                        scenes: e.scenes.map((x, j) =>
                          j === i
                            ? { ...x, title: ev.target.value || x.title }
                            : x,
                        ),
                      })
                    }
                  />
                  <input
                    className="scene-location"
                    placeholder="地点"
                    defaultValue={sc.location}
                    key={`loc-${sc.location}`}
                    onBlur={(ev) =>
                      ev.target.value !== sc.location &&
                      save({
                        ...e,
                        scenes: e.scenes.map((x, j) =>
                          j === i ? { ...x, location: ev.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    className="icon-button"
                    title="删除这一场"
                    onClick={() =>
                      save(
                        { ...e, scenes: e.scenes.filter((_, j) => j !== i) },
                        "删除分场",
                      )
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  className="field-textarea"
                  placeholder="这场发生了什么"
                  defaultValue={sc.summary}
                  key={`s-${sc.summary}`}
                  onBlur={(ev) =>
                    ev.target.value !== sc.summary &&
                    save({
                      ...e,
                      scenes: e.scenes.map((x, j) =>
                        j === i ? { ...x, summary: ev.target.value } : x,
                      ),
                    })
                  }
                />
                <textarea
                  className="field-textarea"
                  placeholder="节拍：每行一个（发现线索 / 争吵 / 和解…）"
                  defaultValue={sc.beats.join("\n")}
                  key={`b-${sc.beats.join("|")}`}
                  onBlur={(ev) => {
                    const beats = ev.target.value
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean)
                      .slice(0, 60);
                    if (beats.join("|") !== sc.beats.join("|"))
                      save({
                        ...e,
                        scenes: e.scenes.map((x, j) =>
                          j === i ? { ...x, beats } : x,
                        ),
                      });
                  }}
                />
                {p.story.entities.length > 0 && (
                  <div className="entity-chips">
                    {p.story.entities.map((en) => (
                      <button
                        key={en.id}
                        className={sc.entityIds.includes(en.id) ? "active" : ""}
                        onClick={() =>
                          save(
                            {
                              ...e,
                              scenes: e.scenes.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      entityIds: x.entityIds.includes(en.id)
                                        ? x.entityIds.filter(
                                            (id) => id !== en.id,
                                          )
                                        : [...x.entityIds, en.id],
                                    }
                                  : x,
                              ),
                            },
                            "调整出场设定",
                          )
                        }
                      >
                        <i className={`entity-dot ${en.kind}`} />
                        {en.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button
              className="secondary-button"
              onClick={() =>
                save(
                  {
                    ...e,
                    scenes: [
                      ...e.scenes,
                      sceneSchema.parse({
                        id: crypto.randomUUID(),
                        number:
                          Math.max(0, ...e.scenes.map((x) => x.number)) + 1,
                        title: `第 ${e.scenes.length + 1} 场`,
                      }),
                    ],
                  },
                  "添加分场",
                )
              }
            >
              <Plus size={12} />
              添加一场
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
const scriptColumns: [string, string, number][] = [
  ["visual", "画面", 3],
  ["narration", "旁白", 2],
  ["speaker", "说话人", 1],
  ["dialogue", "台词", 2],
  ["notes", "备注", 1],
];
function Script() {
  const p = useStudio((s) => s.project)!;
  const rows = [...p.story.script].sort((a, b) => a.number - b.number);
  const scenes = p.story.episodes.flatMap((e) =>
    e.scenes.map((sc) => ({ ...sc, episode: e.number })),
  );
  const set = (next: typeof rows, label = "更新剧本") =>
    void commit(
      [
        {
          type: "story.script.set",
          rows: next.map((r, i) =>
            scriptRowSchema.parse({ ...r, number: i + 1 }),
          ),
        },
      ],
      label,
    );
  const update = (id: string, patch: Partial<(typeof rows)[number]>) =>
    set(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const seconds = rows.reduce((sum, r) => sum + r.duration, 0);
  return (
    <div className="story-page">
      <div className="story-header">
        <div>
          <span className="eyebrow">SCRIPT</span>
          <h1>剧本</h1>
          <p>
            {rows.length} 行 · 约 {Math.round(seconds)}{" "}
            秒。一行对应一个镜头；改好后可以一键生成分镜。
          </p>
        </div>
        <div className="button-group">
          <button
            className="secondary-button"
            disabled={!p.story.shots.length}
            title="用现有分镜生成剧本表"
            onClick={() => {
              if (
                rows.length &&
                !confirm("用分镜重新生成剧本？当前剧本会被替换（可以撤销）。")
              )
                return;
              set(
                scriptFromShots(p, () => crypto.randomUUID()),
                "从分镜生成剧本",
              );
            }}
          >
            <ArrowUpFromLine size={13} />
            从分镜生成
          </button>
          <button
            className="primary-button"
            disabled={!rows.length}
            onClick={() =>
              void commit(
                shotsFromScript(p, () => crypto.randomUUID()),
                "从剧本生成分镜",
              )
            }
          >
            <ArrowDownToLine size={13} />
            生成分镜
          </button>
        </div>
      </div>
      <div className="script-table" role="table">
        <div className="script-row head" role="row">
          <span>#</span>
          <span>场</span>
          {scriptColumns.map(([, label]) => (
            <span key={label}>{label}</span>
          ))}
          <span>秒</span>
          <span />
        </div>
        {rows.map((r) => (
          <div className="script-row" role="row" key={r.id}>
            <span>
              {r.number}
              {r.shotId && <small title="已关联分镜">●</small>}
            </span>
            <select
              value={r.sceneId ?? ""}
              onChange={(e) =>
                update(r.id, { sceneId: e.target.value || undefined })
              }
            >
              <option value="">—</option>
              {scenes.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.episode}-{sc.number} {sc.title}
                </option>
              ))}
            </select>
            {scriptColumns.map(([key]) => (
              <textarea
                key={`${key}-${String(r[key as keyof typeof r] ?? "")}`}
                rows={2}
                defaultValue={String(r[key as keyof typeof r] ?? "")}
                onBlur={(e) =>
                  e.target.value !== r[key as keyof typeof r] &&
                  update(r.id, { [key]: e.target.value })
                }
              />
            ))}
            <input
              type="number"
              min={0.1}
              step={0.5}
              defaultValue={r.duration}
              key={`d-${r.duration}`}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0.1 && v !== r.duration)
                  update(r.id, { duration: v });
              }}
            />
            <button
              className="icon-button"
              title="删除这一行"
              onClick={() =>
                set(
                  rows.filter((x) => x.id !== r.id),
                  "删除剧本行",
                )
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="secondary-button"
        onClick={() =>
          set(
            [
              ...rows,
              scriptRowSchema.parse({
                id: crypto.randomUUID(),
                number: rows.length + 1,
                sceneId: rows[rows.length - 1]?.sceneId,
              }),
            ],
            "添加剧本行",
          )
        }
      >
        <Plus size={13} />
        添加一行
      </button>
    </div>
  );
}
const stageIcons: Record<ProductionStage, typeof Film> = {
  frame: ImageIcon,
  video: Film,
  voice: Mic,
};
const capabilityOf: Record<ProductionStage, string[]> = {
  frame: ["image"],
  video: ["ref-video", "video"],
  voice: ["speech"],
};
function Production() {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers).filter((x) => x.enabled),
    jobs = useStudio((s) => s.jobs);
  const [stages, setStages] = useState<ProductionStage[]>(["frame"]),
    [force, setForce] = useState(false),
    [assemble, setAssemble] = useState(false),
    [chosen, setChosen] = useState<Partial<Record<ProductionStage, string>>>(
      {},
    );
  const options = (stage: ProductionStage) =>
    providers.filter((x) =>
      capabilityOf[stage].some((c) => x.capabilities.includes(c as never)),
    );
  const providerIds = Object.fromEntries(
    stages
      .map((stage) => [stage, chosen[stage] ?? options(stage)[0]?.id])
      .filter(([, id]) => id),
  ) as Partial<Record<ProductionStage, string>>;
  const plan = useMemo(
    () => productionPlan(p, { stages, providerIds, force }),
    [p, stages, JSON.stringify(providerIds), force],
  );
  const summary = productionSummary(p),
    running = jobs.find(
      (j) =>
        j.projectId === p.id &&
        j.kind === "produce" &&
        ["queued", "running"].includes(j.status),
    ),
    shots = [...p.story.shots].sort((a, b) => a.number - b.number),
    missing = stages.filter((stage) => !providerIds[stage]);
  const asset = (id?: string) =>
    id ? p.assets.find((a) => a.id === id) : undefined;
  const restore = (shot: Shot, assetId: string) =>
    void commit(
      [{ type: "story.shot.upsert", shot: restoreProduction(shot, assetId) }],
      `恢复镜头 ${shot.number} 的版本`,
    );
  return (
    <div className="story-page">
      <div className="story-header">
        <div>
          <span className="eyebrow">PRODUCTION</span>
          <h1>批量生产</h1>
          <p>
            {summary.shots} 个镜头 · 分镜图 {summary.framed} · 视频{" "}
            {summary.filmed} · 配音 {summary.voiced}/{summary.needVoice} ·
            已确认设定 {summary.confirmedEntities}/{summary.entities}
          </p>
        </div>
        <div className="button-group">
          <button
            className="secondary-button"
            disabled={!shots.length}
            onClick={() => {
              const t = activeTimeline(p),
                trackId = t.tracks.find(
                  (x) => x.kind === "video" && !x.locked,
                )?.id;
              if (!trackId) return;
              void commit(
                [
                  {
                    type: "story.sync",
                    timelineId: t.id,
                    direction: "story-to-timeline",
                    trackId,
                    force: false,
                  },
                ] as Command[],
                "分镜同步到时间线",
              );
            }}
          >
            排到时间线
          </button>
        </div>
      </div>
      <div className="production-controls">
        {productionStages.map((stage) => {
          const Icon = stageIcons[stage];
          return (
            <div className="production-stage" key={stage}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={stages.includes(stage)}
                  onChange={(e) =>
                    setStages(
                      e.target.checked
                        ? productionStages.filter(
                            (x) => x === stage || stages.includes(x),
                          )
                        : stages.filter((x) => x !== stage),
                    )
                  }
                />
                <Icon size={13} />
                {stageNames[stage]}
              </label>
              {stages.includes(stage) && (
                <select
                  value={providerIds[stage] ?? ""}
                  onChange={(e) =>
                    setChosen({ ...chosen, [stage]: e.target.value })
                  }
                >
                  {!options(stage).length && (
                    <option value="">没有可用服务</option>
                  )}
                  {options(stage).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {stage === "video" && x.capabilities.includes("ref-video")
                        ? "（参考图生视频）"
                        : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          重做已是最新的产物
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={assemble}
            onChange={(e) => setAssemble(e.target.checked)}
          />
          完成后排到时间线（需确认）
        </label>
        <button
          className="primary-button"
          disabled={!plan.length || Boolean(running) || missing.length > 0}
          title={
            missing.length ? "请先在「模型」页添加对应能力的服务" : undefined
          }
          onClick={() =>
            void startJob("produce", `批量生产 ${plan.length} 项`, {
              stages,
              providerIds,
              force,
              assemble,
            })
          }
        >
          {running ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Factory size={13} />
          )}
          {running ? (running.stage ?? "生产中") : `生产 ${plan.length} 项`}
        </button>
        {missing.length > 0 && (
          <button
            className="text-button"
            onClick={() => setState({ nav: "models" })}
          >
            缺少{missing.map((x) => stageNames[x]).join("、")}服务，去添加
          </button>
        )}
      </div>
      <p className="small-description">
        生产会调用你选择的服务并消耗额度；输入没有变化的镜头会自动跳过。
      </p>
      <div className="production-board">
        {shots.map((s) => {
          const planned = plan.filter((x) => x.shotId === s.id);
          return (
            <div className="production-card" key={s.id}>
              <div className="production-card-head">
                <strong>
                  {s.number}. {s.title}
                </strong>
                <span
                  className={`quiet-badge ${s.production.stage !== "planned" ? "green" : ""}`}
                >
                  {stageNames[s.production.stage]}
                </span>
              </div>
              <div className="production-thumbs">
                {(["frame", "video", "voice"] as const).map((stage) => {
                  const id =
                      stage === "frame"
                        ? s.frameAssetId
                        : stage === "video"
                          ? s.videoAssetId
                          : s.voiceAssetId,
                    a = asset(id),
                    Icon = stageIcons[stage],
                    todo = planned.find((x) => x.stage === stage);
                  return (
                    <div
                      key={stage}
                      className={`production-thumb ${todo ? todo.reason : a ? "ready" : ""}`}
                      title={
                        todo
                          ? todo.reason === "missing"
                            ? "待生产"
                            : "输入已变化，需要重做"
                          : stageNames[stage]
                      }
                    >
                      {a?.kind === "image" ? (
                        <img src={a.thumbnail || a.url} alt="" />
                      ) : a?.kind === "video" && a.thumbnail ? (
                        <img src={a.thumbnail} alt="" />
                      ) : (
                        <Icon size={16} />
                      )}
                      <small>{stageNames[stage]}</small>
                    </div>
                  );
                })}
              </div>
              <p>{s.description || "（还没有画面描述）"}</p>
              {s.production.error && (
                <p className="error-text">{s.production.error}</p>
              )}
              {s.production.history.length > 1 && (
                <details className="production-history">
                  <summary>
                    <History size={11} /> {s.production.history.length}{" "}
                    个历史版本
                  </summary>
                  {[...s.production.history].reverse().map((h, i) => (
                    <button
                      key={`${h.assetId}-${i}`}
                      onClick={() => restore(s, h.assetId)}
                    >
                      {stageNames[h.stage]} · {h.provider || "未知服务"} ·{" "}
                      {new Date(h.at).toLocaleString("zh-CN")}
                    </button>
                  ))}
                </details>
              )}
            </div>
          );
        })}
        {!shots.length && (
          <p className="small-description">
            还没有镜头。先在「剧本」生成分镜，或在「分镜」里添加镜头。
          </p>
        )}
      </div>
    </div>
  );
}
