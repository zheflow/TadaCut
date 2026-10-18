import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Film,
  LayoutGrid,
  MonitorPlay,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  WandSparkles,
  Workflow,
} from "lucide-react";
import {
  activeTimeline,
  isLutAsset,
  type Asset,
  type Command,
} from "@tadacut/domain";
import {
  addAssetToTimeline,
  askText,
  commit,
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  getState,
  importFiles,
  pasteClipboard,
  remember,
  selectAllClips,
  setState,
  splitSelected,
  travel,
  useStudio,
} from "../lib/store";
import {
  advance,
  clearMarks,
  goToMark,
  markClip,
  markIn,
  markOut,
  pause,
  seek,
  seekEnd,
  shuttle,
  step,
  stepEditPoint,
  togglePlay,
} from "../lib/transport";
import { ContextMenu } from "./ContextMenu";
import { Preview } from "./Preview";
import { TimelineEditor } from "./Timeline";
import { Inspector } from "./Inspector";
import { TranscriptView, CanvasView } from "./Story";
import { StoryStudio } from "./StoryStudio";
import { RecordingView } from "./Recording";
import { ResourcesPanel } from "./Resources";
import { describePage } from "../lib/studio-control";
import { ReferenceButton, useReferenceSelection } from "./References";
import type { StudioReference } from "../../../../packages/platform/src/studio";
const nonTextInputs = [
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
  "file",
];
/** Fields that use keys for their own text editing; sliders and toggles do not. */
const typing = (target: HTMLElement) =>
  target.isContentEditable ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && !nonTextInputs.includes(target.type));
const activeFps = () => {
  const p = getState().project;
  return p ? activeTimeline(p).fps : 30;
};
const modes = [
  { id: "edit", label: "剪辑", icon: Film },
  { id: "story", label: "分镜", icon: LayoutGrid },
  { id: "transcript", label: "文稿", icon: BookOpen },
  { id: "record", label: "应用录制", icon: MonitorPlay },
  { id: "canvas", label: "创作画布", icon: Workflow },
] as const;
export function Workspace() {
  const mode = useStudio((s) => s.mode),
    p = useStudio((s) => s.project),
    panel = useStudio((s) => s.panel);
  useEffect(() => {
    // Text fields keep their own editing keys; in the desktop app the Edit menu
    // roles handle them, and handled keys here stop the menu with preventDefault.
    let holdingK = false;
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement,
        state = getState();
      if (typing(target) || state.modal || state.ask) return;
      const letter = e.key.length === 1 ? e.key.toLowerCase() : e.key,
        editing = state.mode === "edit";
      if (e.metaKey || e.ctrlKey) {
        const action =
          letter === "z"
            ? () => void travel(e.shiftKey ? "redo" : "undo")
            : letter === "y"
              ? () => void travel("redo")
              : !editing
                ? undefined
                : letter === "c"
                  ? copySelected
                  : letter === "x"
                    ? () => void cutSelected()
                    : letter === "v"
                      ? () => void pasteClipboard()
                      : letter === "d"
                        ? () => void duplicateSelected()
                        : letter === "a"
                          ? selectAllClips
                          : undefined;
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }
      // Physical key codes keep J/K/L and marks working on any keyboard layout and with Option held.
      const code = e.code;
      if (code === "KeyK") holdingK = true;
      const transport: Record<string, (() => void) | undefined> = {
        Space: e.repeat ? undefined : togglePlay,
        KeyK: e.repeat ? undefined : pause,
        KeyJ: holdingK
          ? () => step(-1)
          : e.repeat
            ? undefined
            : () => shuttle(-1),
        KeyL: holdingK
          ? () => step(1)
          : e.repeat
            ? undefined
            : () => shuttle(1),
        ArrowLeft: () => step(e.shiftKey ? -activeFps() : -1),
        ArrowRight: () => step(e.shiftKey ? activeFps() : 1),
        ArrowUp: () => stepEditPoint(-1),
        ArrowDown: () => stepEditPoint(1),
        Home: () => seek(0),
        End: seekEnd,
        KeyI: e.altKey
          ? () => clearMarks("in")
          : e.shiftKey
            ? () => goToMark("in")
            : () => markIn(),
        KeyO: e.altKey
          ? () => clearMarks("out")
          : e.shiftKey
            ? () => goToMark("out")
            : () => markOut(),
        KeyX: () => clearMarks("both"),
        Slash: markClip,
      };
      const action = transport[code];
      if (action && (editing || code === "Space")) {
        e.preventDefault();
        action();
        return;
      }
      if (e.key === "Escape") {
        setState({ selectedClipIds: [], tool: "select" });
        pause();
      } else if (!editing || e.altKey) return;
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelected(e.shiftKey);
      } else if (code === "KeyS") void splitSelected();
      else if (code === "KeyV") setState({ tool: "select" });
      else if (code === "KeyB") setState({ tool: "blade" });
      else if (code === "KeyY") setState({ tool: "slip" });
      else if (code === "KeyU") setState({ tool: "slide" });
      else if (code === "KeyN") setState({ tool: "roll" });
      else if (code === "KeyM")
        window.dispatchEvent(new Event("tadacut-add-marker"));
    };
    const release = (e: KeyboardEvent) => {
      if (e.code === "KeyK") holdingK = false;
    };
    const blur = () => {
      holdingK = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    let id = 0;
    const tick = (now: number) => {
      advance(now);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  if (!p) return <div className="empty-state">请新建或打开一个项目</div>;
  return (
    <div className="workspace">
      <div className="workspace-tabs">
        <div className="mode-tabs">
          {modes.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? "selected" : ""}
              onClick={() => {
                setState({ mode: m.id });
                pause();
              }}
            >
              <m.icon size={14} />
              {m.label}
            </button>
          ))}
        </div>
        <div className="workspace-tools">
          <button
            className="subtle-button"
            onClick={() => setState({ modal: "tools" })}
          >
            <WandSparkles size={14} />
            创作工具
          </button>
          <button
            className={`icon-button ${panel === "inspector" ? "chosen" : ""}`}
            title="片段属性"
            onClick={() =>
              setState({ panel: panel === "inspector" ? "agent" : "inspector" })
            }
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>
      <div className="workspace-body">
        {mode === "edit" ? (
          <>
            <div
              className={`editing-top ${panel === "inspector" ? "with-inspector" : ""}`}
            >
              <LeftPanel />
              <Preview />
              {panel === "inspector" && (
                <aside className="right-panel">
                  <Inspector />
                </aside>
              )}
            </div>
            <TimelineEditor />
          </>
        ) : (
          <div className="other-workspace">
            <div className="workspace-view">
              {mode === "story" ? (
                <StoryStudio />
              ) : mode === "transcript" ? (
                <TranscriptView />
              ) : mode === "record" ? (
                <RecordingView />
              ) : (
                <CanvasView />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
/** Project media, or the library of effects, templates, captions and stock. */
function LeftPanel() {
  const left = useStudio((s) => s.leftPanel);
  const choose = (value: "media" | "library") => {
    setState({ leftPanel: value });
    remember("tadacut-left-panel", value);
  };
  return (
    <section className="media-panel">
      <div className="left-switch" role="tablist">
        <button
          role="tab"
          aria-selected={left === "media"}
          className={left === "media" ? "active" : ""}
          onClick={() => choose("media")}
        >
          素材
        </button>
        <button
          role="tab"
          aria-selected={left === "library"}
          className={left === "library" ? "active" : ""}
          onClick={() => choose("library")}
        >
          资源库
        </button>
      </div>
      {left === "media" ? <MediaPanel embedded /> : <ResourcesPanel />}
    </section>
  );
}
export function AssetThumbnail({
  asset,
  className = "",
}: {
  asset: Asset;
  className?: string;
}) {
  return (
    <div
      className={`asset-thumbnail ${className}`}
      style={{ backgroundColor: asset.color }}
    >
      {asset.kind === "image" ? (
        <img src={asset.thumbnail || asset.url} alt="" loading="lazy" />
      ) : asset.kind === "video" ? (
        asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" />
        ) : (
          <Film size={28} />
        )
      ) : asset.kind === "audio" ? (
        <svg viewBox="0 0 180 48" aria-hidden="true">
          {asset.waveform?.length ? (
            asset.waveform
              .filter(
                (_, i) =>
                  i % Math.max(1, Math.floor(asset.waveform!.length / 36)) ===
                  0,
              )
              .slice(0, 36)
              .map((v, i) => (
                <line
                  key={i}
                  x1={i * 5}
                  x2={i * 5}
                  y1={24 - Math.min(1, v * 3) * 20}
                  y2={24 + Math.min(1, v * 3) * 20}
                  stroke="currentColor"
                  strokeWidth="2"
                />
              ))
          ) : (
            <line x1="0" x2="180" y1="24" y2="24" stroke="currentColor" />
          )}
        </svg>
      ) : asset.kind === "text" ? (
        <span className="text-thumb">Aa</span>
      ) : (
        <WandSparkles size={26} />
      )}
      <span className="asset-kind">
        {isLutAsset(asset)
          ? "LUT"
          : {
              image: "IMG",
              video: "VIDEO",
              audio: "AUDIO",
              text: "TEXT",
              motion: "MG",
              sequence: "SEQ",
            }[asset.kind]}
      </span>
      {asset.duration && (
        <span className="asset-duration">{Math.round(asset.duration)}s</span>
      )}
    </div>
  );
}
/** Right-click menu of a project asset: name, folder, tags, description and removal. */
function AssetMenu({
  asset,
  at,
  close,
}: {
  asset: Asset;
  at: { x: number; y: number };
  close(): void;
}) {
  const update = (patch: Partial<Asset>, label: string) =>
    void commit([{ type: "asset.update", assetId: asset.id, patch }], label);
  const ask = async (
    title: string,
    value: string,
    apply: (v: string) => void,
    multiline = false,
  ) => {
    close();
    const next = await askText(title, value, multiline);
    if (next !== null && next !== value) apply(next);
  };
  return (
    <ContextMenu at={at} close={close} label={`素材「${asset.name}」`}>
      <button
        onClick={() =>
          void ask(
            "素材名称",
            asset.name,
            (name) =>
              name.trim() &&
              update({ name: name.trim().slice(0, 300) }, "重命名素材"),
          )
        }
      >
        重命名…
      </button>
      <button
        onClick={() =>
          void ask("移到文件夹", asset.folder, (folder) =>
            update({ folder: folder.trim() || "素材" }, "整理素材"),
          )
        }
      >
        移到文件夹…<small>{asset.folder}</small>
      </button>
      <button
        onClick={() =>
          void ask("标签（用逗号分隔）", asset.tags.join("，"), (text) =>
            update(
              {
                tags: [
                  ...new Set(
                    text
                      .split(/[,，、]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  ),
                ].slice(0, 30),
              },
              "素材标签",
            ),
          )
        }
      >
        标签…<small>{asset.tags.length || ""}</small>
      </button>
      <button
        onClick={() =>
          void ask(
            "素材描述",
            asset.description,
            (description) => update({ description }, "素材描述"),
            true,
          )
        }
      >
        描述…
      </button>
      <button
        className="danger"
        onClick={() => {
          close();
          const p = getState().project!,
            uses = p.timelines.flatMap((t) =>
              t.clips
                .filter((c) => c.assetId === asset.id)
                .map((c) => ({ t, c })),
            );
          if (
            !confirm(
              uses.length
                ? `「${asset.name}」在时间线上有 ${uses.length} 个片段，删除素材会一起移除它们。继续？`
                : `从项目中删除「${asset.name}」？`,
            )
          )
            return;
          void commit(
            [
              ...uses.map(
                ({ t, c }): Command => ({
                  type: "clip.remove",
                  timelineId: t.id,
                  clipId: c.id,
                  ripple: false,
                }),
              ),
              { type: "asset.remove", assetId: asset.id },
            ],
            "删除素材",
          );
        }}
      >
        <Trash2 size={14} />
        删除素材
      </button>
    </ContextMenu>
  );
}
export function MediaPanel({ embedded = false }: { embedded?: boolean }) {
  const p = useStudio((s) => s.project)!;
  const input = useRef<HTMLInputElement>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [folder, setFolder] = useState(""),
    [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
      null,
    ),
    closeMenu = useCallback(() => setMenu(null), []);
  const folders = [...new Set(p.assets.map((a) => a.folder))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  const assets = p.assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      (!folder || a.folder === folder) &&
      (a.name + " " + a.description + " " + a.tags.join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const menuAsset = menu && p.assets.find((a) => a.id === menu.id);
  const reference = (a: Asset): StudioReference => ({
    kind: "asset",
    id: a.id,
    name: a.name,
    projectId: p.id,
  });
  const selection = useReferenceSelection(assets.map(reference));
  useEffect(
    () =>
      describePage("studio", {
        assetSearch: search,
        assetKind: filter,
        assetFolder: folder,
      }),
    [search, filter, folder],
  );
  const Wrapper = embedded ? "div" : "section";
  return (
    <Wrapper className={embedded ? "media-panel-body" : "media-panel"}>
      <div className="panel-heading">
        <span>
          项目素材 <small>{p.assets.length}</small>
        </span>
        <button
          className="icon-button"
          title="导入素材"
          onClick={() => input.current?.click()}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="media-controls">
        <label className="search-field">
          <Search size={13} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索素材、标签…"
          />
        </label>
        <div className="media-filter">
          {[
            ["all", "全部"],
            ["video", "视频"],
            ["image", "图片"],
            ["audio", "音频"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {name}
            </button>
          ))}
        </div>
        {folders.length > 1 && (
          <select
            className="media-folder"
            value={folders.includes(folder) ? folder : ""}
            onChange={(e) => setFolder(e.target.value)}
            aria-label="按文件夹筛选"
          >
            <option value="">全部文件夹</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}（{p.assets.filter((a) => a.folder === f).length}）
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="media-grid">
        {assets.map((asset) => (
          <div
            key={asset.id}
            draggable
            onDragStart={(e) =>
              selection.startDrag(reference(asset), e.dataTransfer)
            }
            className={`media-card ${selection.isSelected(reference(asset)) ? "selected" : ""}`}
            tabIndex={0}
            role="option"
            aria-selected={selection.isSelected(reference(asset))}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                [" ", "Enter"].includes(e.key)
              ) {
                e.preventDefault();
                selection.select(reference(asset), e);
              }
            }}
            onClick={(e) => selection.select(reference(asset), e)}
            onDoubleClick={() => void addAssetToTimeline(asset)}
            onContextMenu={(e) => {
              e.preventDefault();
              setState({ selectedAssetId: asset.id });
              setMenu({ id: asset.id, x: e.clientX, y: e.clientY });
            }}
            title={`${asset.name}\n右键可重命名、整理或删除`}
          >
            <AssetThumbnail asset={asset} />
            <div className="media-card-name" title={asset.name}>
              {asset.name.replace(/\.\w+$/, "")}
            </div>
            <span className="media-card-meta">
              {asset.width
                ? `${asset.width} × ${asset.height}`
                : asset.kind === "audio"
                  ? "本地音频"
                  : "项目素材"}
            </span>
            <ReferenceButton reference={reference(asset)} />
            <button
              className="asset-add"
              title="添加到时间线"
              onClick={(e) => {
                e.stopPropagation();
                void addAssetToTimeline(asset);
              }}
            >
              <Plus size={12} />
            </button>
          </div>
        ))}
      </div>
      {menu && menuAsset && (
        <AssetMenu asset={menuAsset} at={menu} close={closeMenu} />
      )}
      <button
        className="import-dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void importFiles([...e.dataTransfer.files]);
        }}
      >
        <Upload size={18} />
        <span>导入你的素材</span>
        <small>拖入文件，或点击选择</small>
      </button>
      <div className="media-hint">
        <span>⌘ / Ctrl 多选 · Shift 连选</span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*,.cube"
        onChange={(e) => {
          void importFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </Wrapper>
  );
}
