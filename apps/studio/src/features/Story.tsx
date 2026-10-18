import { localInference, readLocalPcm } from "../lib/local-models";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  Clapperboard,
  Download,
  Film,
  LoaderCircle,
  Plus,
  ScanLine,
  Search,
  Sparkles,
  Trash2,
  Type,
  Users,
  WandSparkles,
} from "lucide-react";
import {
  activeTimeline,
  buildCaptionClips,
  fillerWords,
  findInTranscript,
  replaceInTranscript,
  entitySchema,
  shotSchema,
  layoutStory,
  newTrack,
  storySyncConflicts,
  wordsOnTimeline,
  type Command,
  type Entity,
  type Project,
  type Shot,
} from "@tadacut/domain";
import {
  askText,
  commit,
  notify,
  setState,
  startJob,
  useStudio,
} from "../lib/store";
import { Modal } from "./Pages";
export function Storyboard() {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers),
    t = activeTimeline(p);
  const [editing, setEditing] = useState<Shot | null>(null),
    [sync, setSync] = useState(false),
    [entity, setEntity] = useState<Entity | true | null>(null);
  const conflicts = storySyncConflicts(p, t);
  const generate = async (s: Shot) => {
    const provider = providers.find(
      (pr) => pr.capabilities.includes("image") && pr.enabled,
    );
    if (!provider) {
      notify("先添加支持图片生成的供应商", true);
      setState({ nav: "models" });
      return;
    }
    await startJob("generate", `生成镜头 ${s.number}`, {
      capability: "image",
      prompt: s.prompt || s.description,
      providerId: provider.id,
      shotId: s.id,
    });
  };
  return (
    <div className="story-workspace">
      <div className="story-header">
        <div>
          <span className="eyebrow">STORY TO SCREEN</span>
          <h1>{p.story.title || "构建你的故事"}</h1>
          <p>{p.story.logline || "先写一个故事，再让每个镜头找到位置。"}</p>
        </div>
        <div className="button-group">
          <button
            className="text-button"
            onClick={async () => {
              const title = await askText("故事名称", p.story.title);
              if (title === null) return;
              const logline = await askText("故事梗概", p.story.logline, true);
              if (logline !== null)
                void commit(
                  [{ type: "story.logline", title, logline }],
                  "编辑故事",
                );
            }}
          >
            编辑故事
          </button>
          <button className="secondary-button" onClick={() => setSync(true)}>
            <ArrowLeftRight size={14} />
            同步到剪辑
          </button>
          <button
            className="primary-button"
            onClick={() =>
              setEditing(
                shotSchema.parse({
                  id: crypto.randomUUID(),
                  number: p.story.shots.length + 1,
                  title: `镜头 ${p.story.shots.length + 1}`,
                  description: "",
                  duration: 5,
                }),
              )
            }
          >
            <Plus size={14} />
            添加镜头
          </button>
        </div>
      </div>
      <div className="story-entities">
        <span>
          <Users size={14} />
          角色与场景
        </span>
        {p.story.entities.map((e) => (
          <button key={e.id} onClick={() => setEntity(e)}>
            <i className={`entity-dot ${e.kind}`} />
            {e.name}
            {e.confirmed && <Check size={11} />}
          </button>
        ))}
        <button className="entity-add" onClick={() => setEntity(true)}>
          <Plus size={12} />
          添加
        </button>
      </div>
      <div className="shot-grid">
        {[...p.story.shots]
          .sort((a, b) => a.number - b.number)
          .map((s) => {
            const asset = p.assets.find((a) => a.id === s.assetId);
            return (
              <article className="shot-card" key={s.id}>
                <div className="shot-image" onClick={() => setEditing(s)}>
                  {asset?.kind === "image" ? (
                    <img src={asset.url} alt="" />
                  ) : asset?.thumbnail ? (
                    <img src={asset.thumbnail} alt="" />
                  ) : (
                    <div className="shot-image-placeholder">
                      <Clapperboard size={26} />
                      <span>为这一幕寻找画面</span>
                    </div>
                  )}
                  <span className="shot-number">
                    {String(s.number).padStart(2, "0")}
                  </span>
                  <span className="shot-duration">{s.duration}s</span>
                </div>
                <div className="shot-details">
                  <button className="shot-title" onClick={() => setEditing(s)}>
                    {s.title}
                  </button>
                  <p>{s.description}</p>
                  <div className="shot-footer">
                    <span className={`shot-status ${s.status}`}>
                      <i />
                      {s.status === "ready" || s.status === "done"
                        ? "素材就绪"
                        : s.status === "generating"
                          ? "生成中"
                          : s.status === "error"
                            ? "等待重试"
                            : "待创作"}
                    </span>
                    <button
                      title="生成这一幕的素材"
                      onClick={() => void generate(s)}
                    >
                      <WandSparkles size={13} />
                      生成
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        <button
          className="add-shot-card"
          onClick={() =>
            setEditing(
              shotSchema.parse({
                id: crypto.randomUUID(),
                number: p.story.shots.length + 1,
                title: "新的镜头",
                description: "",
                duration: 5,
              }),
            )
          }
        >
          <Plus size={26} />
          <span>故事的下一幕</span>
        </button>
      </div>
      {editing && (
        <Modal
          title="编辑分镜"
          subtitle="角色、画面、台词与素材保持关联"
          close={() => setEditing(null)}
        >
          <div className="modal-body">
            <div className="form-grid">
              <label>
                镜头顺序
                <input
                  type="number"
                  min="1"
                  value={editing.number}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      number: Math.max(1, Number(e.target.value)),
                    })
                  }
                />
              </label>
              <label>
                镜头名称
                <input
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                />
              </label>
              <label>
                时长（秒）
                <input
                  type="number"
                  min=".1"
                  step=".1"
                  value={editing.duration}
                  onChange={(e) =>
                    setEditing({ ...editing, duration: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label className="form-field">
              画面描述
              <textarea
                className="field-textarea"
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              台词 / 旁白
              <textarea
                className="field-textarea"
                value={editing.dialogue}
                onChange={(e) =>
                  setEditing({ ...editing, dialogue: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              生成提示词
              <textarea
                className="field-textarea"
                value={editing.prompt}
                onChange={(e) =>
                  setEditing({ ...editing, prompt: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              绑定素材
              <select
                value={editing.assetId ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    assetId: e.target.value || undefined,
                    status: e.target.value ? "ready" : "draft",
                  })
                }
              >
                <option value="">尚未绑定</option>
                {p.assets
                  .filter((a) => ["image", "video", "motion"].includes(a.kind))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <h4>出现的角色 / 场景</h4>
            <div className="capability-checkboxes">
              {p.story.entities.map((e) => (
                <label key={e.id}>
                  <input
                    type="checkbox"
                    checked={editing.entityIds.includes(e.id)}
                    onChange={(ev) =>
                      setEditing({
                        ...editing,
                        entityIds: ev.target.checked
                          ? [...editing.entityIds, e.id]
                          : editing.entityIds.filter((x) => x !== e.id),
                      })
                    }
                  />
                  {e.name}
                </label>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="text-button danger"
              onClick={async () => {
                await commit(
                  [{ type: "story.shot.remove", shotId: editing.id }],
                  "删除分镜",
                );
                setEditing(null);
              }}
            >
              删除镜头
            </button>
            <div />
            <button
              className="secondary-button"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                await commit(
                  [{ type: "story.shot.upsert", shot: editing }],
                  "编辑分镜",
                );
                setEditing(null);
              }}
            >
              保存分镜
            </button>
          </div>
        </Modal>
      )}
      {sync && (
        <Modal
          title="剧本与剪辑同步"
          subtitle="一次同步作为一项编辑，可统一撤销"
          close={() => setSync(false)}
        >
          <div className="modal-body">
            <div className="sync-summary">
              <Film size={28} />
              <strong>
                {p.story.shots.filter((s) => s.assetId).length} 个已绑定分镜
              </strong>
              <p>同步会调整绑定分镜的片段顺序、时长与素材，保留其它片段。</p>
            </div>
            {conflicts.length > 0 && (
              <div className="conflict-notice">
                {conflicts.map((c) => (
                  <p key={c.shotId}>{c.title}：两侧都有修改</p>
                ))}
                选择一个方向，确认采用该侧内容。
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="secondary-button"
              onClick={async () => {
                await commit(
                  [
                    {
                      type: "story.sync",
                      timelineId: t.id,
                      trackId:
                        t.tracks.find((tr) => tr.kind === "video")?.id ??
                        t.tracks[0].id,
                      direction: "timeline-to-story",
                      force: true,
                    },
                  ],
                  "采用剪辑更新分镜",
                );
                setSync(false);
              }}
            >
              采用剪辑
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                await commit(storyToTimeline, "采用分镜更新剪辑");
                setSync(false);
                setState({ mode: "edit" });
              }}
            >
              采用分镜
            </button>
          </div>
        </Modal>
      )}
      {entity && (
        <EntityDialog
          initial={entity === true ? undefined : entity}
          close={() => setEntity(null)}
        />
      )}
    </div>
  );
}
/**
 * Story-to-timeline sync on the track that already holds the storyboard, else
 * the first unlocked picture track it fits on, else a new track in the same edit.
 */
function storyToTimeline(p: Project): Command[] {
  const t = activeTimeline(p),
    usable = t.tracks.filter((tr) => tr.kind === "video" && !tr.locked),
    holding = t.clips.find(
      (c) => c.shotId && usable.some((tr) => tr.id === c.trackId),
    )?.trackId,
    sync = (trackId: string): Command => ({
      type: "story.sync",
      timelineId: t.id,
      trackId,
      direction: "story-to-timeline",
      force: true,
    });
  const candidates = [
    ...new Set([holding, ...usable.map((tr) => tr.id)].filter(Boolean)),
  ] as string[];
  for (const id of candidates) {
    try {
      if (!layoutStory(p, t, id).blocked) return [sync(id)];
    } catch {
      // A missing shot asset is reported by the edit itself.
      return [sync(id)];
    }
  }
  const track = newTrack(t, "video", crypto.randomUUID());
  return [{ type: "track.add", timelineId: t.id, track }, sync(track.id)];
}
function EntityDialog({ close, initial }: { close(): void; initial?: Entity }) {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers);
  const live = initial
    ? (p.story.entities.find((e) => e.id === initial.id) ?? initial)
    : undefined;
  const [name, setName] = useState(initial?.name ?? ""),
    [kind, setKind] = useState<"character" | "scene" | "prop">(
      initial?.kind ?? "character",
    ),
    [description, setDescription] = useState(initial?.description ?? ""),
    [traits, setTraits] = useState(initial?.traits ?? ""),
    [voice, setVoice] = useState(initial?.voice ?? ""),
    [references, setReferences] = useState(initial?.referenceAssetIds ?? []),
    [confirmed, setConfirmed] = useState(initial?.confirmed ?? false);
  const image = providers.find(
    (x) => x.enabled && x.capabilities.includes("image"),
  );
  const thumb = (id?: string) => {
    const a = id ? p.assets.find((x) => x.id === id) : undefined;
    return a ? <img src={a.thumbnail || a.url} alt="" /> : <span>未选定</span>;
  };
  /** Picks a candidate as a reference or a turnaround view, straight away. */
  const choose = (
    assetId: string,
    as: "reference" | "front" | "side" | "back",
  ) => {
    if (!live) return;
    const next = structuredClone(live);
    next.candidateAssetIds = next.candidateAssetIds.filter(
      (x) => x !== assetId,
    );
    if (as === "reference")
      next.referenceAssetIds = [
        ...new Set([...next.referenceAssetIds, assetId]),
      ];
    else next.views[as] = assetId;
    setReferences(next.referenceAssetIds);
    void commit(
      [{ type: "story.entity.upsert", entity: entitySchema.parse(next) }],
      `选定「${live.name}」的图`,
    );
  };
  return (
    <Modal
      title="角色与场景"
      subtitle="为持续创作维护同一份视觉设定"
      close={close}
    >
      <div className="modal-body">
        <div className="form-grid">
          <label>
            类型
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="character">角色</option>
              <option value="scene">场景</option>
              <option value="prop">道具</option>
            </select>
          </label>
          <label>
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <label className="form-field">
          设定
          <textarea
            className="field-textarea"
            value={description}
            placeholder="身份、性格、在故事里的作用"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="form-field">
          外观特征（每个镜头都保持一致）
          <textarea
            className="field-textarea"
            value={traits}
            placeholder="年龄感、发型、脸部特征、服装、配色、材质"
            onChange={(e) => setTraits(e.target.value)}
          />
        </label>
        {kind === "character" && (
          <label className="form-field">
            声音
            <input
              value={voice}
              placeholder="配音音色 ID，或对声音的描述"
              onChange={(e) => setVoice(e.target.value)}
            />
          </label>
        )}
        {live && kind === "character" && (
          <>
            <h4>三视图</h4>
            <div className="turnaround">
              {(["front", "side", "back"] as const).map((view) => (
                <figure key={view}>
                  {thumb(live.views[view])}
                  <figcaption>
                    {{ front: "正面", side: "侧面", back: "背面" }[view]}
                  </figcaption>
                </figure>
              ))}
            </div>
            <button
              className="secondary-button"
              disabled={!image}
              title={
                image
                  ? `使用 ${image.name} 生成，会消耗额度`
                  : "需要启用图片生成的服务"
              }
              onClick={() =>
                void startJob("turnaround", `「${live.name}」三视图`, {
                  entityId: live.id,
                  providerId: image!.id,
                })
              }
            >
              <Sparkles size={13} />
              生成三视图候选
            </button>
          </>
        )}
        {live && live.candidateAssetIds.length > 0 && (
          <>
            <h4>候选图</h4>
            <div className="candidate-grid">
              {live.candidateAssetIds.map((id) => (
                <figure key={id}>
                  {thumb(id)}
                  <div className="button-group">
                    <button
                      className="text-button"
                      onClick={() => choose(id, "reference")}
                    >
                      参考
                    </button>
                    {kind === "character" &&
                      (["front", "side", "back"] as const).map((view) => (
                        <button
                          key={view}
                          className="text-button"
                          onClick={() => choose(id, view)}
                        >
                          {{ front: "正面", side: "侧面", back: "背面" }[view]}
                        </button>
                      ))}
                  </div>
                </figure>
              ))}
            </div>
          </>
        )}
        <h4>参考图片</h4>
        <div className="capability-checkboxes">
          {p.assets
            .filter((a) => a.kind === "image")
            .map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={references.includes(a.id)}
                  onChange={(e) =>
                    setReferences(
                      e.target.checked
                        ? [...references, a.id]
                        : references.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          确认此设定与参考图，分镜生成时使用
        </label>
      </div>
      <div className="modal-footer">
        {live && (
          <button
            className="text-button danger"
            onClick={async () => {
              if (!confirm(`删除「${live.name}」？`)) return;
              await commit(
                [{ type: "story.entity.remove", entityId: live.id }],
                "删除创作实体",
              );
              close();
            }}
          >
            删除
          </button>
        )}
        <div />
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button"
          disabled={!name.trim()}
          onClick={async () => {
            const latest = live
              ? (p.story.entities.find((e) => e.id === live.id) ?? live)
              : undefined;
            await commit(
              [
                {
                  type: "story.entity.upsert",
                  entity: entitySchema.parse({
                    ...latest,
                    id: latest?.id ?? crypto.randomUUID(),
                    kind,
                    name,
                    description,
                    traits,
                    ...(kind === "character" && voice.trim()
                      ? { voice: voice.trim().slice(0, 200) }
                      : { voice: undefined }),
                    referenceAssetIds: references,
                    confirmed,
                  }),
                },
              ],
              initial ? "更新创作实体" : "添加创作实体",
            );
            close();
          }}
        >
          {initial ? "保存" : "添加"}
        </button>
      </div>
    </Modal>
  );
}
export function TranscriptView() {
  const p = useStudio((s) => s.project)!;
  const [assetId, setAssetId] = useState(
      p.transcripts[0]?.assetId ??
        p.assets.find((a) => a.kind === "video" || a.kind === "audio")?.id ??
        "",
    ),
    [selected, setSelected] = useState<string[]>([]),
    [local, setLocal] = useState(true),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [regex, setRegex] = useState(false),
    [phrases, setPhrases] = useState(false),
    [maxGap, setMaxGap] = useState(0.4);
  const providers = useStudio((s) => s.providers);
  const transcript = p.transcripts.find((t) => t.assetId === assetId),
    timeline = activeTimeline(p);
  // The word under the playhead; the view re-renders when that word changes, not every frame.
  const heard = useMemo(
    () =>
      transcript
        ? wordsOnTimeline(transcript, timeline).sort(
            (a, b) => a.start - b.start,
          )
        : [],
    [transcript, timeline],
  );
  const current = useStudio((s) => {
    let lo = 0,
      hi = heard.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1,
        w = heard[mid];
      if (s.playhead < w.start) hi = mid - 1;
      else if (s.playhead >= w.end) lo = mid + 1;
      else return w.word.id;
    }
    return null;
  });
  const transcribe = async () => {
    const asset = p.assets.find((a) => a.id === assetId);
    if (!asset) return;
    if (!local) {
      const pr = providers.find((pr) =>
        pr.capabilities.includes("transcription"),
      );
      if (!pr) {
        notify("请配置转写服务", true);
        return;
      }
      await startJob("transcribe", "语音转写", { assetId, providerId: pr.id });
      return;
    }
    setBusy(true);
    let worker: Worker | undefined;
    try {
      setProgress("提取本地音频…");
      const pcm = await readLocalPcm(p.id, assetId);
      const result = await localInference(
        "transcribe",
        { pcm, model: "onnx-community/whisper-tiny" },
        setProgress,
      );
      const words = result.words.map(
        (w: { text: string; start: number; end: number }, i: number) => ({
          ...w,
          id: `word-${i}-${crypto.randomUUID()}`,
          speaker: "说话人 1",
          deleted: false,
        }),
      );
      if (!words.length) throw new Error("未识别到带时间戳的语音");
      await commit(
        [
          {
            type: "transcript.set",
            transcript: {
              id: transcript?.id ?? crypto.randomUUID(),
              assetId,
              language: "auto",
              words,
            },
          },
        ],
        "本地语音转写",
        p.id,
      );
      notify("本地转写已完成");
    } catch (e) {
      notify(String(e), true);
    } finally {
      worker?.terminate();
      setBusy(false);
      setProgress("");
    }
  };
  const cut = async (ids = selected) => {
    if (!transcript || !ids.length) return;
    await commit(
      [
        {
          type: "transcript.cut",
          transcriptId: transcript.id,
          wordIds: ids,
          timelineId: timeline.id,
        },
      ],
      "按文字剪辑",
    );
    setSelected([]);
  };
  const subtitles = async () => {
    if (!transcript) return;
    let count = 0;
    const ok = await commit((project) => {
      const result = buildCaptionClips(
        project,
        activeTimeline(project),
        transcript,
        () => crypto.randomUUID(),
        new Date().toISOString(),
        { replace: true },
      );
      count = result.count;
      return result.commands;
    }, "从文稿生成字幕");
    if (ok)
      notify(`已生成 ${count} 条字幕，可在左侧「资源库 · 字幕」换样式与翻译`);
  };
  const fillers = transcript ? fillerWords(transcript) : [];
  const matches = (() => {
    if (!transcript || !query) return [];
    try {
      return findInTranscript(transcript, query, { regex });
    } catch {
      return [];
    }
  })();
  const matched = new Set(matches.flatMap((m) => m.wordIds));
  return (
    <div className="transcript-workspace">
      <div className="story-header">
        <div>
          <span className="eyebrow">EDIT WITH WORDS</span>
          <h1>文稿剪辑</h1>
          <p>保留想说的话，删去多余的停顿。</p>
        </div>
        <button
          className="primary-button"
          disabled={!transcript}
          onClick={() => void subtitles()}
        >
          <Type size={14} />
          生成字幕
        </button>
      </div>
      <div className="transcript-toolbar">
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {p.assets
            .filter((a) => ["video", "audio"].includes(a.kind))
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={local}
            onChange={(e) => setLocal(e.target.checked)}
          />
          本地转写
        </label>
        <button
          className="secondary-button"
          disabled={busy || !assetId}
          onClick={() => void transcribe()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <ScanLine size={13} />
          )}
          开始转写
        </button>
      </div>
      {progress && <div className="model-progress">{progress}</div>}
      {local && !transcript && (
        <p className="download-note">
          <Download size={13} />
          首次使用会下载本地模型，后续可使用缓存。音频在本机处理。
        </p>
      )}
      {transcript ? (
        <>
          <div className="transcript-actions">
            <button
              disabled={!selected.length}
              className="secondary-button"
              onClick={() => void cut()}
            >
              <Trash2 size={13} />
              删除选中词并剪辑
            </button>
            <button
              className="text-button"
              disabled={!fillers.some((f) => phrases || f.reason !== "phrase")}
              title={fillers
                .slice(0, 12)
                .map((f) => f.text)
                .join("、")}
              onClick={() =>
                void cut(
                  fillers
                    .filter((f) => phrases || f.reason !== "phrase")
                    .flatMap((f) => f.wordIds),
                )
              }
            >
              去除口癖（
              {fillers.filter((f) => phrases || f.reason !== "phrase").length}）
            </button>
            <label
              className="checkbox-label"
              title="“那个”“就是说”等也可能是正常用语"
            >
              <input
                type="checkbox"
                checked={phrases}
                onChange={(e) => setPhrases(e.target.checked)}
              />
              含口头语
            </label>
            <span className="vertical-rule" />
            <select
              value={maxGap}
              onChange={(e) => setMaxGap(Number(e.target.value))}
              title="把超过这个长度的停顿缩短到这个长度"
            >
              {[0.2, 0.3, 0.4, 0.6, 0.8, 1].map((v) => (
                <option key={v} value={v}>
                  停顿 ≤ {v} 秒
                </option>
              ))}
            </select>
            <button
              className="text-button"
              onClick={() =>
                void commit(
                  [
                    {
                      type: "transcript.gaps",
                      transcriptId: transcript.id,
                      timelineId: timeline.id,
                      maxGap,
                    },
                  ],
                  "压缩停顿",
                )
              }
            >
              压缩停顿
            </button>
            <button className="text-button" onClick={() => setSelected([])}>
              取消选择
            </button>
            <span>{selected.length} 个词已选择</span>
          </div>
          <div className="transcript-find">
            <label className="search-field">
              <Search size={13} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="查找文字"
              />
            </label>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="替换为"
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={regex}
                onChange={(e) => setRegex(e.target.checked)}
              />
              正则
            </label>
            <span>{query ? `${matches.length} 处` : ""}</span>
            <button
              className="text-button"
              disabled={!matches.length}
              onClick={() => setSelected([...matched])}
            >
              选中全部
            </button>
            <button
              className="text-button"
              disabled={!matches.length}
              onClick={() => {
                const result = replaceInTranscript(
                  transcript,
                  query,
                  replacement,
                  { regex },
                );
                if (!result.count) return;
                void commit(
                  [{ type: "transcript.set", transcript: result.transcript }],
                  `替换文字 ${result.count} 处`,
                ).then((ok) => ok && notify(`已替换 ${result.count} 处`));
              }}
            >
              全部替换
            </button>
          </div>
          <div className="transcript-paper">
            <div className="transcript-speaker">
              <Users size={15} />
              {[...new Set(transcript.words.map((w) => w.speaker))].map(
                (speaker) => (
                  <button
                    key={speaker}
                    onClick={async () => {
                      const to = await askText("修改说话人名称", speaker);
                      if (to)
                        void commit(
                          [
                            {
                              type: "transcript.speaker",
                              transcriptId: transcript.id,
                              from: speaker,
                              to,
                            },
                          ],
                          "修改说话人",
                        );
                    }}
                  >
                    {speaker}
                  </button>
                ),
              )}
            </div>
            {transcript.words.map((w) => (
              <button
                key={w.id}
                className={`transcript-word ${w.deleted ? "deleted" : ""} ${selected.includes(w.id) ? "selected" : ""} ${matched.has(w.id) ? "matched" : ""} ${current === w.id ? "current" : ""}`}
                title={`${w.start.toFixed(2)}–${w.end.toFixed(2)}s · 双击修正文稿`}
                onDoubleClick={async () => {
                  const text = await askText("修正转写文字", w.text);
                  if (text !== null)
                    void commit(
                      [
                        {
                          type: "transcript.set",
                          transcript: {
                            ...transcript,
                            words: transcript.words.map((word) =>
                              word.id === w.id ? { ...word, text } : word,
                            ),
                          },
                        },
                      ],
                      "修正文稿",
                    );
                }}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey)
                    setState({
                      playhead:
                        heard.find((t) => t.word.id === w.id)?.start ?? 0,
                      mode: "edit",
                    });
                  else
                    setSelected(
                      selected.includes(w.id)
                        ? selected.filter((id) => id !== w.id)
                        : [...selected, w.id],
                    );
                }}
              >
                {w.text}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="transcript-empty">
          <BookOpen size={40} />
          <h3>用文字，找到剪辑的节奏</h3>
          <p>选择音视频并转写，即可按词删除内容、清理口癖和生成字幕。</p>
        </div>
      )}
    </div>
  );
}
export function CanvasView() {
  const p = useStudio((s) => s.project)!;
  const board = useRef<HTMLDivElement>(null),
    [draft, setDraft] = useState<Record<string, { x: number; y: number }>>({});
  const add = async () => {
    const label = await askText("写下一条创作笔记", "", true);
    if (label)
      void commit(
        [
          {
            type: "canvas.upsert",
            node: {
              id: crypto.randomUUID(),
              kind: "note",
              x: 80 + p.canvas.length * 20,
              y: 70,
              label,
            },
          },
        ],
        "添加画布笔记",
      );
  };
  return (
    <div className="canvas-workspace">
      <div className="story-header">
        <div>
          <span className="eyebrow">CONNECT YOUR IDEAS</span>
          <h1>创作画布</h1>
          <p>把分镜、设定和灵感放在同一张桌上。</p>
        </div>
        <button className="primary-button" onClick={add}>
          <Plus size={14} />
          添加笔记
        </button>
      </div>
      <div className="canvas-board" ref={board}>
        <svg className="canvas-connections" width="1800" height="1400">
          <defs>
            <marker
              id="arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path className="canvas-arrow" d="M0,0 L6,3 L0,6" />
            </marker>
          </defs>
          {p.canvas.slice(1).map((n, i) => (
            <path
              key={n.id}
              d={`M${(draft[p.canvas[i].id]?.x ?? p.canvas[i].x) + 238},${(draft[p.canvas[i].id]?.y ?? p.canvas[i].y) + 100} C${n.x - 30},${n.y + 100} ${n.x - 30},${n.y + 100} ${draft[n.id]?.x ?? n.x},${(draft[n.id]?.y ?? n.y) + 100}`}
              className="canvas-link"
              fill="none"
              strokeWidth="2"
              markerEnd="url(#arrow)"
            />
          ))}
        </svg>
        {p.canvas.map((n) => {
          const shot = p.story.shots.find((s) => s.id === n.referenceId),
            asset = p.assets.find(
              (a) => a.id === shot?.assetId || a.id === n.referenceId,
            ),
            pos = draft[n.id] ?? n;
          return (
            <article
              className={`canvas-node ${n.kind}`}
              key={n.id}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const initial = { x: e.clientX, y: e.clientY };
                let final = { x: n.x, y: n.y };
                const move = (ev: PointerEvent) => {
                  final = {
                    x: Math.max(0, n.x + ev.clientX - initial.x),
                    y: Math.max(0, n.y + ev.clientY - initial.y),
                  };
                  setDraft({ ...draft, [n.id]: final });
                };
                const end = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", end);
                  setDraft({});
                  void commit(
                    [{ type: "canvas.upsert", node: { ...n, ...final } }],
                    "移动画布节点",
                  );
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", end);
              }}
            >
              <header>
                {n.kind === "shot" ? (
                  <Film size={12} />
                ) : (
                  <BookOpen size={12} />
                )}
                <span>{n.label}</span>
                <button
                  title="移除节点"
                  onClick={() =>
                    void commit(
                      [{ type: "canvas.remove", nodeId: n.id }],
                      "删除画布节点",
                    )
                  }
                >
                  <Trash2 size={11} />
                </button>
              </header>
              {asset?.kind === "image" && <img src={asset.url} alt="" />}
              <p>{shot?.description ?? n.label}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
