import { LocalAudioLabels, ReframeDialog } from "./LocalTools";
import { useEffect, useState } from "react";
import {
  activeTimeline,
  assetSchema,
  clipSchema,
  durationInFrames,
  formatTime,
  energyOnTimeline,
  highlightWindows,
  markerSchema,
  rangesTimeline,
  trackSchema,
  type Command,
  type Highlight,
} from "@tadacut/domain";
import {
  ArrowRight,
  AudioLines,
  Braces,
  Film,
  Globe,
  Image,
  Layers,
  Mic,
  Monitor,
  Music2,
  ScanLine,
  Scissors,
  Sparkles,
  Star,
  Type,
  WandSparkles,
} from "lucide-react";
import {
  answerText,
  commit,
  createProject,
  getState,
  jobDone,
  notify,
  setState,
  startJob,
  useStudio,
} from "../lib/store";
import { audioAnalysis } from "../lib/studio-api";
import { markedRange, seek } from "../lib/transport";
import { post } from "../lib/api";
import { Modal, MotionEditor } from "./Pages";
export function Dialogs() {
  const modal = useStudio((s) => s.modal);
  if (!modal) return null;
  const close = () => setState({ modal: null });
  return modal === "project" ? (
    <NewProjectDialog close={close} />
  ) : modal === "export" ? (
    <ExportDialog close={close} />
  ) : modal === "title" ? (
    <TitleDialog close={close} />
  ) : (
    <ToolsDialog close={close} />
  );
}
/** Text input requested through askText. */
export function AskDialog() {
  const ask = useStudio((s) => s.ask);
  return ask ? <AskForm key={ask.id} ask={ask} /> : null;
}
function AskForm({
  ask,
}: {
  ask: { title: string; value: string; multiline: boolean };
}) {
  const [value, setValue] = useState(ask.value),
    cancel = () => answerText(null),
    keys = (e: React.KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      else if (e.key === "Enter" && !ask.multiline) answerText(value);
    };
  return (
    <Modal title={ask.title} close={cancel}>
      <div className="modal-body">
        <div className="form-field">
          {ask.multiline ? (
            <textarea
              autoFocus
              aria-label={ask.title}
              className="field-textarea"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={keys}
            />
          ) : (
            <input
              autoFocus
              aria-label={ask.title}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={keys}
            />
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={cancel}>
          取消
        </button>
        <button className="primary-button" onClick={() => answerText(value)}>
          确定
        </button>
      </div>
    </Modal>
  );
}
function NewProjectDialog({ close }: { close(): void }) {
  const [name, setName] = useState("未命名项目");
  return (
    <Modal
      title="新的创作"
      subtitle="一个想法，一个自己的工作空间"
      close={close}
    >
      <div className="modal-body">
        <label className="form-field">
          项目名称
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) void createProject(name);
            }}
          />
        </label>
        <div className="new-project-info">
          <Layers size={22} />
          <div>
            <strong>素材、分镜与剪辑放在一起</strong>
            <p>在本机自动保存，可以随时导出完整工程。</p>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button"
          disabled={!name.trim()}
          onClick={() => void createProject(name.trim())}
        >
          创建项目
          <ArrowRight size={14} />
        </button>
      </div>
    </Modal>
  );
}
function ExportDialog({ close }: { close(): void }) {
  const p = useStudio((s) => s.project);
  const [format, setFormat] = useState("video"),
    [codec, setCodec] = useState("h264"),
    [quality, setQuality] = useState(20),
    [transparent, setTransparent] = useState(false),
    [hardware, setHardware] = useState(false),
    // Half the logical cores, like Remotion's own default.
    [concurrency, setConcurrency] = useState(() =>
      Math.max(
        1,
        Math.min(6, Math.round((navigator.hardwareConcurrency || 4) / 2)),
      ),
    ),
    [scope, setScope] = useState<"all" | "range">(() => {
      const current = getState().project;
      return current && markedRange(activeTimeline(current)) ? "range" : "all";
    });
  if (!p) return null;
  const t = activeTimeline(p),
    range = markedRange(t),
    span =
      scope === "range" && range
        ? range
        : { start: 0, end: durationInFrames(t) };
  const submit = async () => {
    if (format === "still") {
      await startJob("export-still", "导出静帧", {
        timelineId: t.id,
        frame: Math.round(getState().playhead),
        format: codec === "jpeg" ? "jpeg" : "png",
      });
      close();
      setState({ nav: "tasks" });
      return;
    }
    if (format === "clip") {
      const clipId = getState().selectedClipIds[0];
      if (!clipId) return notify("请先在时间线上选择一个片段", true);
      await startJob("export-clip", "导出单个片段", {
        timelineId: t.id,
        clipId,
        codec: codec === "vp9" || codec === "h264" ? codec : "prores",
      });
      close();
      setState({ nav: "tasks" });
      return;
    }
    if (
      ["project", "fcpxml", "srt", "markdown", "capcut", "edl"].includes(format)
    ) {
      try {
        const result = await post<{ url: string }>(
          `/api/projects/${p.id}/artifact`,
          { format, timelineId: t.id },
        );
        const link = document.createElement("a");
        link.href = result.url;
        link.download = "";
        link.click();
        close();
        notify("文件已准备好");
      } catch (e) {
        notify(String(e), true);
      }
    } else {
      await startJob("export", "导出 " + p.name, {
        timelineId: t.id,
        codec: format === "audio" ? (codec === "wav" ? "wav" : "mp3") : codec,
        crf: quality,
        transparent,
        hardware,
        concurrency,
        ...(scope === "range" && range
          ? { range: [range.start, range.end] }
          : {}),
      });
      close();
      setState({ nav: "tasks" });
    }
  };
  return (
    <Modal title="让作品出发" subtitle={`${p.name} · ${t.name}`} close={close}>
      <div className="modal-body">
        <div className="export-summary">
          <Film size={24} />
          <div>
            <strong>
              {t.width} × {t.height} · {t.fps} FPS
            </strong>
            <span>
              {((span.end - span.start) / t.fps).toFixed(1)} 秒 ·{" "}
              {scope === "range" && range
                ? "入点到出点"
                : `${t.clips.length} 个片段`}
            </span>
          </div>
          <span className="quiet-badge green">本机导出</span>
        </div>
        <label className="form-field">
          导出类型
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setCodec(
                e.target.value === "audio"
                  ? "mp3"
                  : e.target.value === "still"
                    ? "png"
                    : e.target.value === "clip"
                      ? "prores"
                      : "h264",
              );
            }}
          >
            <option value="video">视频成片</option>
            <option value="audio">纯音频</option>
            <option value="still">当前帧图片（封面、缩略图）</option>
            <option value="clip">所选片段（透明背景，动画与标题）</option>
            <option value="project">完整 TadaCut 工程（.tadacut）</option>
            <option value="edl">CMX 3600 EDL</option>
            <option value="fcpxml">Final Cut Pro XML</option>
            <option value="srt">字幕 SRT</option>
            <option value="markdown">时间线 Markdown</option>
            <option value="capcut">剪映 / CapCut 草稿</option>
          </select>
        </label>
        {range && ["video", "audio"].includes(format) && (
          <label className="form-field">
            导出范围
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "all" | "range")}
            >
              <option value="all">
                整条时间线 · {formatTime(durationInFrames(t), t.fps)}
              </option>
              <option value="range">
                入点到出点 · {formatTime(range.end - range.start, t.fps)}
              </option>
            </select>
          </label>
        )}
        {format === "video" && (
          <>
            <label className="form-field">
              编码
              <select
                value={codec}
                onChange={(e) => {
                  setCodec(e.target.value);
                  if (!["prores", "vp8", "vp9"].includes(e.target.value))
                    setTransparent(false);
                }}
              >
                <option value="h264">H.264 · MP4</option>
                <option value="h265">H.265 · MP4</option>
                <option value="vp9">VP9 · WebM</option>
                <option value="vp8">VP8 · WebM</option>
                <option value="prores">ProRes · MOV</option>
              </select>
            </label>
            <label className="form-field">
              并行渲染
              <input
                type="number"
                min="1"
                max="8"
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(
                    Math.max(1, Math.min(8, Number(e.target.value))),
                  )
                }
              />
            </label>
            {["h264", "h265"].includes(codec) && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={hardware}
                  onChange={(e) => setHardware(e.target.checked)}
                />
                使用硬件编码（可用时）
              </label>
            )}
            <label className="slider-field">
              <span>
                画质<small>CRF {quality}</small>
              </span>
              <input
                type="range"
                min="12"
                max="32"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </label>
            {["prores", "vp8", "vp9"].includes(codec) && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                保留透明通道
              </label>
            )}
          </>
        )}
        {format === "audio" && (
          <label className="form-field">
            音频格式
            <select
              value={codec}
              onChange={(e) => {
                setCodec(e.target.value);
                if (!["prores", "vp8", "vp9"].includes(e.target.value))
                  setTransparent(false);
              }}
            >
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </select>
          </label>
        )}
        {format === "still" && (
          <label className="form-field">
            图片格式
            <select value={codec} onChange={(e) => setCodec(e.target.value)}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </label>
        )}
        {format === "clip" && (
          <label className="form-field">
            编码
            <select value={codec} onChange={(e) => setCodec(e.target.value)}>
              <option value="prores">ProRes 4444 · 透明 MOV</option>
              <option value="vp9">VP9 · 透明 WebM</option>
              <option value="h264">H.264 · MP4（不透明）</option>
            </select>
          </label>
        )}
        <p className="small-description">
          导出完成后可在「任务」页的导出记录里校验文件与发布。
        </p>
        {format === "project" && (
          <p className="small-description">
            工程包包括当前项目、分镜、文稿与本地素材。模型密钥不进入工程文件。
          </p>
        )}
        {format === "fcpxml" && (
          <p className="small-description">
            导出可编辑片段和素材引用；复杂 shader
            与代码动画需要先输出媒体再用于外部软件。
          </p>
        )}
        {format === "capcut" && (
          <p className="small-description">
            使用随应用安装的草稿适配器，导出含素材的 ZIP
            包；目标软件的版本差异与效果映射会写入包内报告。
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button className="primary-button" onClick={() => void submit()}>
          <ArrowRight size={14} />
          {["video", "audio", "still", "clip"].includes(format)
            ? "开始导出"
            : "导出文件"}
        </button>
      </div>
    </Modal>
  );
}
function TitleDialog({ close }: { close(): void }) {
  const p = useStudio((s) => s.project)!,
    frame = useStudio((s) => s.playhead),
    t = activeTimeline(p),
    [text, setText] = useState("你的故事，从这里开始");
  return (
    <Modal title="添加文字" close={close}>
      <div className="modal-body">
        <label className="form-field">
          文字内容
          <textarea
            className="field-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button"
          onClick={async () => {
            const track =
              t.tracks.find((tr) => tr.kind === "text") ??
              trackSchema.parse({
                id: crypto.randomUUID(),
                name: "文字",
                kind: "text",
              });
            const asset = assetSchema.parse({
              id: crypto.randomUUID(),
              name: text.slice(0, 30),
              kind: "text",
              url: "",
              text,
              createdAt: new Date().toISOString(),
            });
            const commands: any[] = [
              ...(t.tracks.some((tr) => tr.id === track.id)
                ? []
                : [{ type: "track.add", timelineId: t.id, track }]),
              { type: "asset.add", asset },
              {
                type: "clip.add",
                timelineId: t.id,
                clip: clipSchema.parse({
                  id: crypto.randomUUID(),
                  assetId: asset.id,
                  trackId: track.id,
                  start: frame,
                  duration: t.fps * 4,
                  text,
                }),
              },
            ];
            await commit(commands, "添加文字");
            close();
          }}
        >
          添加到时间线
        </button>
      </div>
    </Modal>
  );
}
const tools = [
  {
    id: "image",
    name: "生成图片",
    description: "把画面描述变成素材",
    icon: Image,
    cap: "image",
  },
  {
    id: "video",
    name: "生成视频",
    description: "为一个镜头生成动态画面",
    icon: Film,
    cap: "video",
  },
  {
    id: "speech",
    name: "生成配音",
    description: "用选择的音色讲述故事",
    icon: Mic,
    cap: "speech",
  },
  {
    id: "voice-clone",
    name: "克隆音色",
    description: "以你有权使用的录音创建音色",
    icon: AudioLines,
    cap: "voice-clone",
  },
  {
    id: "music",
    name: "生成配乐",
    description: "为故事寻找合适的声音",
    icon: Music2,
    cap: "music",
  },
  {
    id: "sfx",
    name: "生成音效",
    description: "用一句描述得到环境声或动作音效",
    icon: AudioLines,
    cap: "sfx",
  },
  {
    id: "image-edit",
    name: "编辑图片",
    description: "按描述修改一张图片，得到新素材",
    icon: Image,
    cap: "image-edit",
  },
  {
    id: "ref-video",
    name: "图生视频",
    description: "让一张图片按描述动起来",
    icon: Film,
    cap: "ref-video",
  },
  {
    id: "cover",
    name: "生成封面",
    description: "按故事、品牌色与标题生成视频封面",
    icon: Image,
    cap: "image",
  },
  {
    id: "motion-ai",
    name: "AI 代码动画",
    description: "用聊天模型生成可编辑的图形动画",
    icon: Braces,
    cap: "chat",
  },
  {
    id: "motion",
    name: "代码动画",
    description: "动态标题、图形与透明素材",
    icon: Braces,
  },
  {
    id: "title",
    name: "添加文字",
    description: "标题、字幕与说明",
    icon: Type,
  },
  {
    id: "transcript",
    name: "语音转写",
    description: "本地模型或你的云服务",
    icon: ScanLine,
  },
  {
    id: "audio-labels",
    name: "本地声音语义",
    description: "CLAP · 用描述分类声音素材",
    icon: AudioLines,
  },
  {
    id: "subject-reframe",
    name: "本地主体重构",
    description: "检测人物，让新画幅的裁切跟随主体",
    icon: Monitor,
  },
  {
    id: "analyze",
    name: "音频分析",
    description: "响度、静音、波形与节拍",
    icon: AudioLines,
  },
  {
    id: "voice-clean",
    name: "人声降噪",
    description: "本机频谱降噪，清理录音底噪",
    icon: Mic,
  },
  {
    id: "voice-isolate",
    name: "人声分离",
    description: "用你的服务把人声与背景音乐分开",
    icon: Mic,
    cap: "voice-isolation",
  },
  {
    id: "scene-detect",
    name: "场景切换检测",
    description: "找出视频里的镜头切换，分割或做标记",
    icon: Scissors,
  },
  {
    id: "highlights",
    name: "查找高光",
    description: "按语速、关键词和响度推荐高光候选",
    icon: Star,
  },
  {
    id: "normalize",
    name: "响度归一",
    description: "得到统一响度的音频素材",
    icon: Music2,
  },
  {
    id: "silence",
    name: "移除静音",
    description: "分析停顿，提出剪辑方案",
    icon: WandSparkles,
  },
  {
    id: "multicam",
    name: "多机位同步",
    description: "根据音频对齐两个机位",
    icon: Layers,
  },
  {
    id: "reframe",
    name: "多画幅重构",
    description: "复制为 9:16、1:1、4:5 或 16:9 的新时间线",
    icon: Monitor,
  },
  {
    id: "understand",
    name: "理解图片与视频",
    description: "所选视觉模型分析取样画面",
    icon: Image,
    cap: "chat",
  },
  {
    id: "semantic",
    name: "语义索引",
    description: "用本地或云 embedding 找素材",
    icon: Sparkles,
    cap: "embedding",
  },
  {
    id: "web",
    name: "网页采集",
    description: "网页描述与截图成为参考",
    icon: Globe,
  },
] as const;
/** The asset kinds a tool's material picker offers. */
const assetKinds = (toolId: string): string[] =>
  toolId === "understand"
    ? ["video", "image"]
    : ["image-edit", "ref-video"].includes(toolId)
      ? ["image"]
      : ["video", "audio"];
function ToolsDialog({ close }: { close(): void }) {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers),
    requested = useStudio((s) => s.creativeTool);
  const [selected, setSelected] = useState<string | null>(null),
    [prompt, setPrompt] = useState(""),
    [assetId, setAssetId] = useState(
      p.assets.find((a) => ["video", "audio"].includes(a.kind))?.id ?? "",
    ),
    [second, setSecond] = useState(""),
    [provider, setProvider] = useState(""),
    [duration, setDuration] = useState(5),
    [voice, setVoice] = useState("alloy"),
    [title, setTitle] = useState("");
  useEffect(() => {
    if (!requested) return;
    if (requested === "title") setState({ modal: "title", creativeTool: null });
    else if (requested === "transcript")
      setState({
        nav: "studio",
        mode: "transcript",
        modal: null,
        creativeTool: null,
      });
    else {
      setSelected(requested);
      setState({ creativeTool: null });
    }
  }, [requested]);
  if (selected === "audio-labels") return <LocalAudioLabels close={close} />;
  if (selected === "reframe" || selected === "subject-reframe")
    return (
      <ReframeDialog close={close} detect={selected === "subject-reframe"} />
    );
  if (selected === "motion") return <MotionEditor close={close} />;
  if (selected === "scene-detect")
    return <SceneDetect close={close} back={() => setSelected(null)} />;
  if (selected === "highlights")
    return <Highlights close={close} back={() => setSelected(null)} />;
  const tool = tools.find((t) => t.id === selected),
    cap = tool && "cap" in tool ? tool.cap : undefined;
  const available = providers.filter(
    (p) => !cap || p.capabilities.includes(cap as any),
  );
  const choose = (id: string) => {
    if (id === "title") {
      setState({ modal: "title" });
      return;
    }
    if (id === "transcript") {
      close();
      setState({ mode: "transcript" });
      return;
    }
    setSelected(id);
    const kinds = assetKinds(id);
    if (!p.assets.some((a) => a.id === assetId && kinds.includes(a.kind)))
      setAssetId(p.assets.find((a) => kinds.includes(a.kind))?.id ?? "");
    const selected = tools.find((t) => t.id === id);
    setProvider(
      providers.find(
        (p) =>
          selected &&
          "cap" in selected &&
          p.capabilities.includes(selected.cap as any),
      )?.id ?? "",
    );
  };
  const run = async () => {
    if (!tool) return;
    const kind = [
      "image",
      "video",
      "speech",
      "music",
      "voice-clone",
      "sfx",
      "image-edit",
      "ref-video",
    ].includes(tool.id)
      ? "generate"
      : tool.id;
    const job = await startJob(kind, tool.name, {
      capability: tool.id,
      prompt,
      assetId,
      secondAssetId: second,
      providerId: provider || available[0]?.id,
      duration,
      voice,
      targetLufs: -14,
      ...(tool.id === "cover" ? { title } : {}),
    });
    if (job) {
      close();
      setState({ nav: "tasks" });
    }
  };
  return (
    <Modal
      title={tool ? tool.name : "创作工具"}
      subtitle={tool ? tool.description : "把创意工作交给适合的工具"}
      close={close}
    >
      <div className="modal-body">
        {!tool ? (
          <div className="creative-tools-grid">
            {tools.map((t, i) => (
              <button
                key={t.id}
                className={`creative-tool tone-${i % 4}`}
                onClick={() => choose(t.id)}
              >
                <t.icon size={22} />
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <button className="text-button" onClick={() => setSelected(null)}>
              ← 所有工具
            </button>
            {cap && (
              <label className="form-field">
                所用模型服务
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="">选择供应商</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ·{" "}
                      {p.models[cap as keyof typeof p.models] ||
                        p.model ||
                        "尚未填写模型"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {[
              "analyze",
              "normalize",
              "voice-clean",
              "voice-isolate",
              "silence",
              "multicam",
              "voice-clone",
              "understand",
              "image-edit",
              "ref-video",
            ].includes(tool.id) && (
              <label className="form-field">
                {["image-edit", "ref-video"].includes(tool.id)
                  ? "参考图片"
                  : "参考音视频"}
                <select
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                >
                  <option value="">选择素材</option>
                  {p.assets
                    .filter((a) => assetKinds(tool.id).includes(a.kind))
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {tool.id === "multicam" && (
              <label className="form-field">
                另一机位
                <select
                  value={second}
                  onChange={(e) => setSecond(e.target.value)}
                >
                  <option value="">选择另一个素材</option>
                  {p.assets
                    .filter(
                      (a) =>
                        ["video", "audio"].includes(a.kind) && a.id !== assetId,
                    )
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {[
              "image",
              "video",
              "speech",
              "music",
              "web",
              "voice-clone",
              "motion-ai",
              "sfx",
              "image-edit",
              "ref-video",
              "cover",
            ].includes(tool.id) && (
              <label className="form-field">
                {tool.id === "web"
                  ? "网页 URL"
                  : tool.id === "speech"
                    ? "配音文本"
                    : tool.id === "voice-clone"
                      ? "新音色名称"
                      : "描述你的想法"}
                <textarea
                  className="field-textarea large"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    tool.id === "web"
                      ? "https://…"
                      : "写下画面、情绪、风格和需要保留的细节…"
                  }
                />
              </label>
            )}
            {["video", "music", "sfx", "ref-video"].includes(tool.id) && (
              <label className="form-field">
                时长（秒）
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </label>
            )}
            {tool.id === "cover" && (
              <label className="form-field">
                封面标题（可留空）
                <input
                  value={title}
                  maxLength={60}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：一个人的城市漫游"
                />
              </label>
            )}
            {tool.id === "speech" && (
              <label className="form-field">
                音色 ID
                <input
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                />
              </label>
            )}
            {cap && !available.length && (
              <div className="conflict-notice">
                尚未配置此类服务。
                <button
                  className="text-button"
                  onClick={() => {
                    close();
                    setState({ nav: "models" });
                  }}
                >
                  添加模型服务 →
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          关闭
        </button>
        {tool && (
          <button
            className="primary-button"
            disabled={
              Boolean(cap && !provider) ||
              (["image-edit", "ref-video", "voice-isolate"].includes(tool.id) &&
                !assetId)
            }
            onClick={() => void run()}
          >
            <Sparkles size={14} />
            开始{tool.name}
          </button>
        )}
      </div>
    </Modal>
  );
}

interface SceneCuts {
  cuts: { seconds: number; score: number }[];
  timeline: { timelineId: string; cuts: { clipId: string; frame: number }[] };
}
/** Finds the shot changes inside a video with FFmpeg, then splits its clips there or marks them. */
function SceneDetect({ close, back }: { close(): void; back(): void }) {
  const p = useStudio((s) => s.project)!,
    videos = p.assets.filter((a) => a.kind === "video");
  const [assetId, setAssetId] = useState(() => {
      const t = activeTimeline(p),
        chosen = getState().selectedClipIds,
        clip = t.clips.find(
          (c) =>
            chosen.includes(c.id) && videos.some((v) => v.id === c.assetId),
        );
      return clip?.assetId ?? videos[0]?.id ?? "";
    }),
    [threshold, setThreshold] = useState(0.3),
    [running, setRunning] = useState(false),
    [result, setResult] = useState<SceneCuts | null>(null);
  const detect = async () => {
    setRunning(true);
    setResult(null);
    const job = await startJob("scene-detect", "场景切换检测", {
      assetId,
      threshold,
    });
    const done = job && (await jobDone(job.id));
    setRunning(false);
    if (done?.status === "completed") setResult(done.result as SceneCuts);
    else if (done) notify(done.error ?? "检测没有完成", true);
  };
  const onTimeline = (project: NonNullable<typeof p>) => {
    const t = project.timelines.find(
      (x) => x.id === result!.timeline.timelineId,
    );
    if (!t) throw new Error("检测时的时间线已不存在");
    return t;
  };
  const split = () =>
    commit((project) => {
      const t = onTimeline(project);
      // From the last cut back, so every split lands inside the clip it was found in.
      return [...result!.timeline.cuts]
        .filter((cut) => {
          const c = t.clips.find((x) => x.id === cut.clipId);
          return (
            c &&
            c.start < cut.frame &&
            cut.frame < c.start + c.duration &&
            !t.tracks.find((x) => x.id === c.trackId)?.locked
          );
        })
        .sort((a, b) => b.frame - a.frame)
        .map(
          (cut): Command => ({
            type: "clip.split",
            timelineId: t.id,
            clipId: cut.clipId,
            at: cut.frame,
            newClipId: crypto.randomUUID(),
          }),
        );
    }, "在场景切换处分割");
  const mark = () =>
    commit((project) => {
      const t = onTimeline(project);
      return [...new Set(result!.timeline.cuts.map((c) => c.frame))]
        .sort((a, b) => a - b)
        .map(
          (frame, i): Command => ({
            type: "marker.add",
            timelineId: t.id,
            marker: markerSchema.parse({
              id: crypto.randomUUID(),
              frame,
              label: `切换 ${i + 1}`,
              color: "#e8c46a",
            }),
          }),
        );
    }, "标记场景切换");
  const fps = activeTimeline(p).fps;
  return (
    <Modal
      title="场景切换检测"
      subtitle="用 FFmpeg 比较相邻画面，找出镜头切换"
      close={close}
    >
      <div className="modal-body">
        <button className="text-button" onClick={back}>
          ← 所有工具
        </button>
        <label className="form-field">
          视频素材
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {!videos.length && <option value="">项目里还没有视频</option>}
            {videos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          灵敏度 {Math.round((1 - threshold) * 100)}%
          <input
            type="range"
            min={0.1}
            max={0.6}
            step={0.05}
            value={0.7 - threshold}
            onChange={(e) =>
              setThreshold(
                Math.round((0.7 - Number(e.target.value)) * 100) / 100,
              )
            }
          />
        </label>
        {result && (
          <div className="scene-result">
            <p>
              找到 {result.cuts.length} 处切换
              {result.timeline.cuts.length
                ? `，其中 ${result.timeline.cuts.length} 处在当前时间线的片段里`
                : "；这段视频还没有放到时间线上，放上去后再检测即可分割"}
              。
            </p>
            <div className="scene-cuts">
              {result.timeline.cuts.slice(0, 60).map((cut) => (
                <button
                  key={`${cut.clipId}-${cut.frame}`}
                  className="quiet-badge"
                  onClick={() => seek(cut.frame)}
                >
                  {formatTime(cut.frame, fps)}
                </button>
              ))}
              {!result.timeline.cuts.length &&
                result.cuts.slice(0, 60).map((cut) => (
                  <span key={cut.seconds} className="quiet-badge">
                    {cut.seconds.toFixed(2)}s
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          关闭
        </button>
        {result?.timeline.cuts.length ? (
          <>
            <button className="secondary-button" onClick={() => void mark()}>
              添加为标记
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                if (await split()) close();
              }}
            >
              <Scissors size={14} />
              在切换处分割
            </button>
          </>
        ) : (
          <button
            className="primary-button"
            disabled={!assetId || running}
            onClick={() => void detect()}
          >
            <Scissors size={14} />
            {running ? "检测中…" : "开始检测"}
          </button>
        )}
      </div>
    </Modal>
  );
}
/** Highlight candidates from speech density, lively words and loudness, as markers or a new reel. */
function Highlights({ close, back }: { close(): void; back(): void }) {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  const [length, setLength] = useState(15),
    [count, setCount] = useState(5),
    [running, setRunning] = useState(false),
    [found, setFound] = useState<Highlight[] | null>(null);
  const find = async () => {
    setRunning(true);
    try {
      const project = getState().project!,
        tl = activeTimeline(project),
        lead =
          tl.clips.find((c) =>
            project.transcripts.some((tr) => tr.assetId === c.assetId),
          ) ??
          tl.clips.find((c) => {
            const kind = project.assets.find((a) => a.id === c.assetId)?.kind;
            return kind === "audio" || kind === "video";
          });
      let energy: number[] | undefined;
      if (lead)
        energy = await audioAnalysis(lead.assetId)
          .then((analysis) => energyOnTimeline(tl, lead, analysis.energy))
          .catch(() => undefined);
      setFound(highlightWindows(project, tl, { length, count, energy }));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setRunning(false);
    }
  };
  const mark = () =>
    commit(
      found!.map(
        (h, i): Command => ({
          type: "marker.add",
          timelineId: t.id,
          marker: markerSchema.parse({
            id: crypto.randomUUID(),
            frame: h.start,
            duration: h.end - h.start,
            label: `高光 ${i + 1}`,
            color: "#e88f7d",
            note: h.text,
          }),
        }),
      ),
      "标记高光片段",
    );
  const reel = () =>
    commit(
      (project) => [
        {
          type: "timeline.create",
          timeline: rangesTimeline(
            activeTimeline(project),
            found!.map((h) => [h.start, h.end]),
            () => crypto.randomUUID(),
            `${activeTimeline(project).name} · 精华版`,
          ),
        },
      ],
      "生成精华版时间线",
    );
  return (
    <Modal
      title="查找高光"
      subtitle="按语速、情绪词与响度给时间线上的片段打分"
      close={close}
    >
      <div className="modal-body">
        <button className="text-button" onClick={back}>
          ← 所有工具
        </button>
        <div className="field-grid">
          <label className="form-field">
            每段长度（秒）
            <input
              type="number"
              min={3}
              max={120}
              value={length}
              onChange={(e) =>
                setLength(Math.max(3, Number(e.target.value) || 15))
              }
            />
          </label>
          <label className="form-field">
            段数
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))
              }
            />
          </label>
        </div>
        <p className="small-description">
          有文稿时会参考说话内容；首次使用会在本机分析主声音的响度。
        </p>
        {found && !found.length && (
          <p className="small-description">时间线上还没有足够长的内容。</p>
        )}
        {found?.map((h, i) => (
          <button
            key={h.start}
            className="highlight-row"
            onClick={() => seek(h.start)}
          >
            <strong>
              {i + 1}. {formatTime(h.start, t.fps)} – {formatTime(h.end, t.fps)}
            </strong>
            <span>{h.text || "（没有文稿）"}</span>
            <small>
              {h.reasons.join(" · ") || "综合得分"} · {h.score.toFixed(2)}
            </small>
          </button>
        ))}
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          关闭
        </button>
        {found?.length ? (
          <>
            <button className="secondary-button" onClick={() => void mark()}>
              添加为标记
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                if (await reel()) close();
              }}
            >
              <Star size={14} />
              生成精华版时间线
            </button>
          </>
        ) : (
          <button
            className="primary-button"
            disabled={running}
            onClick={() => void find()}
          >
            <Star size={14} />
            {running ? "分析中…" : "查找高光"}
          </button>
        )}
      </div>
    </Modal>
  );
}
