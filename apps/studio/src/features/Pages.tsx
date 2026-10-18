import { ApplyMediaResult } from "./AdvancedEditing";
import { MotionLayer } from "../../../../packages/render/src/components/MotionLayer";
import { motionTemplates } from "../../../../packages/motion/src/templates";
import { JobResult } from "./JobResult";
import { FolderWatches, SemanticSearch, RelinkButton } from "./MediaServices";
import { useEffect, useRef, useState } from "react";
import {
  Aperture,
  ArrowRight,
  Braces,
  CheckCircle2,
  CircleStop,
  Code2,
  Download,
  Ellipsis,
  Globe,
  HardDrive,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import {
  activeTimeline,
  assetSchema,
  durationInFrames,
  formatTime,
  type Asset,
  type Project,
} from "@tadacut/domain";
import {
  providerSchema,
  type Capability,
  type Provider,
} from "../../../../packages/providers/src/types";
import {
  post,
  request,
  type Job,
  type PublicProvider,
  type Skill,
} from "../lib/api";
import {
  acceptJob,
  addAssetToTimeline,
  askText,
  commit,
  importFiles,
  notify,
  openProject,
  remember,
  setState,
  startJob,
  useStudio,
} from "../lib/store";
import { setTheme } from "../lib/theme";
import { describePage } from "../lib/studio-control";
import { ReferenceButton, useReferenceSelection } from "./References";
import type { StudioReference } from "../../../../packages/platform/src/studio";
import { AssetThumbnail } from "./Workspace";
import { RuntimeConnection } from "./RuntimeConnection";
import {
  AgentSettingsSection,
  ExportHistory,
  MemoriesSection,
  ProviderPresets,
  VersionsDialog,
} from "./Manage";
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  close(): void;
}) {
  const assistantOpen = useStudio((s) => s.assistantOpen);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal={!assistantOpen}
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" title="关闭" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
const capNames: Record<Capability, string> = {
  chat: "对话",
  embedding: "语义搜索",
  image: "图片",
  video: "视频",
  speech: "配音",
  transcription: "转写",
  music: "音乐",
  "voice-clone": "音色克隆",
  sfx: "音效",
  "video-matte": "视频抠像",
  "video-inpaint": "视频消除",
  "video-upscale": "视频超分",
  avatar: "数字人",
  "lip-sync": "口型同步",
  "voice-isolation": "人声分离",
  "ref-video": "参考图生视频",
  "image-edit": "图片编辑",
  stock: "在线素材",
  web: "网页检索",
  publish: "发布",
  storage: "云存储",
};
export function ModelsView() {
  const providers = useStudio((s) => s.providers),
    editingId = useStudio((s) => s.editingProviderId);
  const [editing, setEditing] = useState<Provider | null>(null),
    [testing, setTesting] = useState(""),
    [status, setStatus] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!editingId) return;
    const provider = providers.find((p) => p.id === editingId);
    if (provider) setEditing(provider);
    setState({ editingProviderId: null });
  }, [editingId, providers]);
  const test = async (p: PublicProvider) => {
    setTesting(p.id);
    try {
      const models = await post<string[]>(`/api/providers/${p.id}/models`, {});
      setStatus({ ...status, [p.id]: true });
      notify(`模型目录读取成功，发现 ${models.length} 个模型；尚未验证推理`);
    } catch (e) {
      setStatus({ ...status, [p.id]: false });
      notify(String(e), true);
    } finally {
      setTesting("");
    }
  };
  return (
    <div className="page">
      <PageHeading
        eyebrow="YOUR MODELS, YOUR CHOICE"
        title="模型与连接"
        description="选择你信任的服务，或把模型留在自己的电脑上。"
        action={
          <button
            className="primary-button"
            onClick={() =>
              setEditing(
                providerSchema.parse({
                  id: crypto.randomUUID(),
                  name: "自定义供应商",
                  kind: "compatible",
                  baseUrl: "http://127.0.0.1:1234/v1",
                }),
              )
            }
          >
            <Plus size={15} />
            添加供应商
          </button>
        }
      />
      <div className="connection-callout">
        <div className="callout-icon">
          <Laptop size={23} />
        </div>
        <div>
          <strong>本地模型，完整的创作自由</strong>
          <p>
            通过 Ollama 或 LM Studio
            连接本机模型。模型地址、能力与路由都由你选择。
          </p>
        </div>
        <span className="quiet-badge green">LOCAL FIRST</span>
      </div>
      <ProviderPresets onPick={setEditing} />
      <div className="section-heading">
        <h2>已添加的服务</h2>
      </div>
      <div className="provider-grid">
        {providers.map((p) => {
          const local = /localhost|127\.0\.0\.1/.test(p.baseUrl);
          return (
            <div className="provider-card" key={p.id}>
              <div className="provider-card-head">
                <div className={`provider-logo ${local ? "local" : ""}`}>
                  {p.kind === "ollama" ? (
                    "O"
                  ) : p.kind === "anthropic" ? (
                    "A"
                  ) : p.name === "LM Studio" ? (
                    "LM"
                  ) : (
                    <Aperture size={22} />
                  )}
                </div>
                <span
                  className={`connection-badge ${status[p.id] ? "ready" : ""}`}
                >
                  <i />
                  {status[p.id] === true
                    ? "模型目录可读"
                    : status[p.id] === false
                      ? "连接未成功"
                      : local
                        ? "本机服务"
                        : p.keyUnreadable
                          ? "凭据无法读取"
                          : p.hasKey
                            ? "已保存凭据"
                            : "等待配置"}
                </span>
              </div>
              <h3>{p.name}</h3>
              <span className="provider-address">{p.baseUrl}</span>
              <div className="cap-tags">
                {p.capabilities.map((c) => (
                  <span key={c}>{capNames[c]}</span>
                ))}
              </div>
              <div className="provider-model">
                <span>聊天模型</span>
                <strong>{p.model || "尚未选择"}</strong>
              </div>
              <div className="provider-actions">
                <ReferenceButton
                  reference={{ kind: "provider", id: p.id, name: p.name }}
                />
                <button
                  className="secondary-button"
                  onClick={() => setEditing(p)}
                >
                  <Settings2 size={13} />
                  配置
                </button>
                <button
                  className="text-button"
                  onClick={() => void test(p)}
                  disabled={testing === p.id}
                >
                  {testing === p.id ? (
                    <LoaderCircle className="spin" size={12} />
                  ) : (
                    <Globe size={12} />
                  )}
                  检测连接
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="section-heading">
        <h2>外部 Agent</h2>
        <p>沿用本机运行时与账号，所有编辑仍通过项目事务和修改预览。</p>
      </div>
      <div className="external-agent-grid">
        {[
          ["codex", "Codex", "App Server · 动态工具"],
          ["claude", "Claude Code", "CLI · MCP 工具"],
          ["copilot", "GitHub Copilot", "SDK · 自定义工具"],
        ].map(([id, name, desc]) => (
          <button
            key={id}
            className="external-agent-card"
            onClick={() => {
              setState({
                agentBackend: id as "codex" | "claude" | "copilot",
                assistantOpen: true,
              });
              notify(`已选择 ${name}，发起对话时连接本机运行时`);
            }}
          >
            <Code2 size={20} />
            <div>
              <strong>{name}</strong>
              <span>{desc}</span>
            </div>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      <div className="runtime-details">
        <RuntimeConnection id="codex" details />
        <RuntimeConnection id="claude" details />
        <RuntimeConnection id="copilot" details />
      </div>
      <div className="privacy-note">
        <LockKeyhole size={13} />
        API Key 保存在本机凭据库，项目与界面不包含明文密钥。
      </div>
      {editing && (
        <ProviderEditor provider={editing} close={() => setEditing(null)} />
      )}
    </div>
  );
}
function ProviderEditor({
  provider,
  close,
}: {
  provider: Provider;
  close(): void;
}) {
  const [p, setP] = useState<Provider>(() =>
      providerSchema.parse(
        Object.fromEntries(
          Object.entries(provider).filter(
            ([name]) => name !== "hasKey" && name !== "keyUnreadable",
          ),
        ),
      ),
    ),
    [key, setKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [models, setModels] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [routes, setRoutes] = useState(JSON.stringify(provider.routes, null, 2));
  const save = async () => {
    try {
      setBusy(true);
      const value = providerSchema.parse({ ...p, routes: JSON.parse(routes) });
      const result = await post<PublicProvider>("/api/providers", {
        provider: value,
        ...(key ? { apiKey: key } : clearKey ? { apiKey: "" } : {}),
      });
      setState({ providers: await request("/api/providers") });
      notify(`${result.name} 已保存`);
      close();
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  };
  const discover = async () => {
    setBusy(true);
    try {
      const found = await post<string[]>("/api/providers/test", {
        provider: p,
        ...(key ? { apiKey: key } : {}),
      });
      setModels(found);
      notify(`发现 ${found.length} 个模型`);
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="配置模型服务"
      subtitle="供应商、模型和能力可以自由组合"
      close={close}
    >
      <div className="modal-body">
        <div className="form-grid">
          <label>
            名称
            <input
              value={p.name}
              onChange={(e) => setP({ ...p, name: e.target.value })}
            />
          </label>
          <label>
            接口类型
            <select
              value={p.kind}
              onChange={(e) =>
                setP({ ...p, kind: e.target.value as Provider["kind"] })
              }
            >
              <option value="compatible">OpenAI 兼容接口</option>
              <option value="openai">OpenAI Responses</option>
              <option value="ollama">Ollama 原生接口</option>
              <option value="anthropic">Anthropic</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="fal">fal.ai 队列</option>
              <option value="pexels">Pexels 图库</option>
              <option value="pixabay">Pixabay 图库</option>
              <option value="freesound">Freesound 音效库</option>
              <option value="firecrawl">Firecrawl 网页</option>
              <option value="jina">Jina 搜索与阅读</option>
              <option value="searxng">SearXNG 搜索</option>
              <option value="upload-post">Upload-Post 发布</option>
              <option value="s3">S3 兼容存储</option>
              <option value="custom">自定义 HTTP 服务</option>
            </select>
          </label>
        </div>
        <label className="form-field">
          服务地址
          <input
            placeholder="http://127.0.0.1:11434"
            value={p.baseUrl}
            onChange={(e) => setP({ ...p, baseUrl: e.target.value })}
          />
        </label>
        <label className="form-field">
          API Key
          <input
            type="password"
            value={key}
            autoComplete="new-password"
            placeholder={
              "keyUnreadable" in provider && provider.keyUnreadable
                ? "已保存的密钥在本次启动无法读取，请重新输入"
                : "hasKey" in provider && provider.hasKey
                  ? "已保存；输入新的密钥可替换"
                  : "本地服务可留空"
            }
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        {Boolean(
          ("hasKey" in provider && provider.hasKey) ||
            ("keyUnreadable" in provider && provider.keyUnreadable),
        ) && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(e) => setClearKey(e.target.checked)}
            />
            删除已保存的密钥
          </label>
        )}
        <ProviderOptions
          provider={p}
          onChange={(options) => setP({ ...p, options })}
        />
        <div className="model-discovery">
          <label>
            聊天模型
            <input
              value={p.model}
              onChange={(e) => setP({ ...p, model: e.target.value })}
              placeholder="填写模型名称，或检测服务"
              list="discovered-models"
            />
            <datalist id="discovered-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void discover()}
          >
            <Search size={14} />
            发现模型
          </button>
        </div>
        <h4>启用能力</h4>
        <div className="capability-checkboxes">
          {Object.entries(capNames).map(([id, label]) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={p.capabilities.includes(id as Capability)}
                onChange={(e) =>
                  setP({
                    ...p,
                    capabilities: e.target.checked
                      ? [...p.capabilities, id as Capability]
                      : p.capabilities.filter((c) => c !== id),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
        {p.capabilities
          .filter((c) => c !== "chat")
          .map((c) => (
            <label className="form-field" key={c}>
              {capNames[c]}模型
              <input
                value={p.models[c] ?? ""}
                placeholder="填写对应模型名称"
                onChange={(e) =>
                  setP({ ...p, models: { ...p.models, [c]: e.target.value } })
                }
              />
            </label>
          ))}
        <details className="advanced-settings">
          <summary>高级接口路由</summary>
          <p>
            为音乐或自定义服务设置 path、pollPath、resultPath 和请求
            body。密钥使用上方凭据字段。
          </p>
          <textarea
            className="code-field"
            value={routes}
            onChange={(e) => setRoutes(e.target.value)}
            spellCheck={false}
          />
        </details>
      </div>
      <div className="modal-footer">
        <button
          className="text-button danger"
          onClick={async () => {
            if (!confirm("删除此供应商配置？")) return;
            await request(`/api/providers/${p.id}`, { method: "DELETE" });
            setState({ providers: await request("/api/providers") });
            close();
          }}
        >
          删除配置
        </button>
        <div />
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy && <LoaderCircle className="spin" size={13} />}保存配置
        </button>
      </div>
    </Modal>
  );
}
const optionFields: Partial<
  Record<Provider["kind"], [keyof Provider["options"], string, string][]>
> = {
  s3: [
    ["bucket", "存储桶", "my-bucket"],
    ["region", "区域", "us-east-1"],
    ["accessKeyId", "Access Key ID", "AKIA…（Secret 填在上方 API Key）"],
    ["pathStyle", "路径风格地址", "true（MinIO、R2 等）或 false"],
    ["prefix", "对象前缀", "tadacut/"],
    ["publicBaseUrl", "公开访问地址（可选）", "https://cdn.example.com"],
  ],
  "upload-post": [
    ["user", "账号档案名称（user）", "在 Upload-Post 创建的用户档案"],
  ],
  jina: [["readerUrl", "阅读服务地址", "https://r.jina.ai"]],
  searxng: [["language", "搜索语言", "zh-CN"]],
};
/** Settings some services need beyond the address and key. */
function ProviderOptions({
  provider,
  onChange,
}: {
  provider: Provider;
  onChange(options: Provider["options"]): void;
}) {
  const fields = optionFields[provider.kind];
  if (!fields) return null;
  return (
    <div className="form-grid">
      {fields.map(([key, label, placeholder]) => (
        <label key={key}>
          {label}
          <input
            value={provider.options[key] ?? ""}
            placeholder={placeholder}
            onChange={(e) =>
              onChange({ ...provider.options, [key]: e.target.value })
            }
          />
        </label>
      ))}
    </div>
  );
}
export function ProjectsView() {
  const projects = useStudio((s) => s.projects),
    input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"recent" | "archived" | "trash">("recent"),
    [versionsOf, setVersionsOf] = useState<string | null>(null);
  const archived = tab === "archived";
  useEffect(
    () =>
      describePage("projects", {
        tab: { recent: "最近项目", archived: "已归档", trash: "回收站" }[tab],
      }),
    [tab],
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="CREATIVE SPACE"
        title="你的项目"
        description="从一个想法开始，也随时回到未完成的故事。"
        action={
          <div className="button-group">
            <button
              className="secondary-button"
              onClick={() => setState({ modal: "team" })}
            >
              团队与共享素材
            </button>
            <button
              className="secondary-button"
              onClick={() => input.current?.click()}
            >
              <Upload size={14} />
              导入工程
            </button>
            <button
              className="primary-button"
              onClick={() => setState({ modal: "project" })}
            >
              <Plus size={15} />
              新建项目
            </button>
          </div>
        }
      />
      <div className="page-tabs">
        <button
          className={tab === "recent" ? "active" : ""}
          onClick={() => setTab("recent")}
        >
          最近项目
        </button>
        <button
          className={tab === "archived" ? "active" : ""}
          onClick={() => setTab("archived")}
        >
          已归档
        </button>
        <button
          className={tab === "trash" ? "active" : ""}
          onClick={() => setTab("trash")}
        >
          回收站
          {projects.some((p) => p.trashedAt) && (
            <small> {projects.filter((p) => p.trashedAt).length}</small>
          )}
        </button>
      </div>
      {tab === "trash" && <TrashList />}
      {versionsOf && (
        <VersionsDialog
          projectId={versionsOf}
          close={() => setVersionsOf(null)}
        />
      )}
      <div className="project-grid" hidden={tab === "trash"}>
        {projects
          .filter((p) => !p.trashedAt && p.archived === archived)
          .map((p) => {
            const image = p.assets.find((a) => a.kind === "image"),
              t = activeTimeline(p);
            return (
              <div className="project-card" key={p.id}>
                <button
                  className="project-cover"
                  onClick={() => void openProject(p.id)}
                >
                  {image ? (
                    <img src={image.url} alt="" />
                  ) : (
                    <div className="project-cover-placeholder">
                      <Sparkles size={34} />
                    </div>
                  )}
                  <span>{formatTime(durationInFrames(t), t.fps)}</span>
                </button>
                <div className="project-card-info">
                  <button onClick={() => void openProject(p.id)}>
                    <strong>{p.name}</strong>
                    <span>
                      {p.timelines.length} 条时间线 · {p.assets.length} 个素材
                    </span>
                  </button>
                  <ReferenceButton
                    reference={{ kind: "project", id: p.id, name: p.name }}
                  />
                  <ProjectMenu
                    project={p}
                    archived={archived}
                    onVersions={() => setVersionsOf(p.id)}
                  />
                </div>
              </div>
            );
          })}
        <button
          className="new-project-card"
          onClick={() => setState({ modal: "project" })}
        >
          <Plus size={28} />
          <strong>新的想法</strong>
          <span>创建一个空白项目</span>
        </button>
      </div>
      <input
        type="file"
        ref={input}
        hidden
        accept=".json,.tadacut,.edl,.fcpxml,.xml"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const form = new FormData();
          form.append("file", file);
          try {
            const p = await request<Project>("/api/projects/import", {
              method: "POST",
              body: form,
            });
            await openProject(p.id);
            setState({ projects: await request("/api/projects") });
          } catch (e) {
            notify(String(e), true);
          }
        }}
      />
    </div>
  );
}
function ProjectMenu({
  project,
  archived,
  onVersions,
}: {
  project: Project;
  archived: boolean;
  onVersions(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-anchor">
      <button
        className="icon-button"
        title="项目操作"
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={15} />
      </button>
      {open && (
        <div
          className="dropdown project-menu"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            onClick={() => {
              setOpen(false);
              onVersions();
            }}
          >
            版本…
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              const name = await askText("副本名称", `${project.name} 副本`);
              if (name === null) return;
              try {
                const copy = await post<Project>(
                  `/api/projects/${project.id}/duplicate`,
                  { name: name.trim() || undefined },
                );
                setState({ projects: await request("/api/projects") });
                notify(`已创建「${copy.name}」`);
              } catch (e) {
                notify(String(e), true);
              }
            }}
          >
            创建副本
          </button>
          <button
            onClick={() => {
              setOpen(false);
              void commit(
                [{ type: "project.archive", archived: !archived }],
                archived ? "恢复项目" : "归档项目",
                project.id,
              );
            }}
          >
            {archived ? "取消归档" : "归档"}
          </button>
          <button
            className="danger"
            onClick={async () => {
              setOpen(false);
              try {
                await post(`/api/projects/${project.id}/trash`, {
                  trashed: true,
                  expectedRevision: project.revision,
                });
                setState({ projects: await request("/api/projects") });
                notify("已移到回收站");
              } catch (e) {
                notify(String(e), true);
              }
            }}
          >
            移到回收站
          </button>
        </div>
      )}
    </div>
  );
}
function TrashList() {
  const projects = useStudio((s) => s.projects).filter((p) => p.trashedAt);
  const reload = async () =>
    setState({ projects: await request("/api/projects") });
  if (!projects.length)
    return (
      <div className="empty-state">
        <Trash2 size={30} />
        <h3>回收站是空的</h3>
        <p>移到回收站的项目可以恢复，也可以永久删除。</p>
      </div>
    );
  return (
    <div className="version-list">
      {projects.map((p) => (
        <div className="export-row" key={p.id}>
          <div>
            <strong>{p.name}</strong>
            <small>
              移入时间 {new Date(p.trashedAt!).toLocaleString("zh-CN")} ·{" "}
              {p.assets.length} 个素材
            </small>
          </div>
          <div className="button-group">
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await post(`/api/projects/${p.id}/trash`, {
                    trashed: false,
                    expectedRevision: p.revision,
                  });
                  await reload();
                  notify("项目已恢复");
                } catch (e) {
                  notify(String(e), true);
                }
              }}
            >
              恢复
            </button>
            <button
              className="text-button danger"
              onClick={async () => {
                if (
                  !confirm(
                    `永久删除「${p.name}」？项目记录、版本与对话会一起删除，无法恢复。`,
                  )
                )
                  return;
                try {
                  await request(`/api/projects/${p.id}`, { method: "DELETE" });
                  await reload();
                  notify("项目已永久删除");
                } catch (e) {
                  notify(String(e), true);
                }
              }}
            >
              永久删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
export function LibraryView() {
  const p = useStudio((s) => s.project)!,
    projects = useStudio((s) => s.projects);
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState("all"),
    [motion, setMotion] = useState<Asset | true | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const assets = [
    ...new Map(
      projects.flatMap((p) => p.assets).map((a) => [a.id, a]),
    ).values(),
  ].filter(
    (a) =>
      (kind === "all" || a.kind === kind) &&
      (a.name + a.description + a.tags.join(" ")).includes(search),
  );
  const reference = (a: Asset): StudioReference => ({
    kind: "asset",
    id: a.id,
    name: a.name,
    projectId:
      projects.find((x) => x.assets.some((x) => x.id === a.id))?.id ?? p.id,
  });
  const selection = useReferenceSelection(assets.map(reference));
  useEffect(() => describePage("library", { search, kind }), [search, kind]);
  return (
    <div className="page">
      <button
        className="secondary-button"
        onClick={() => setState({ modal: "team" })}
      >
        团队素材目录
      </button>
      <PageHeading
        eyebrow="YOUR MATERIALS"
        title="素材库"
        description="图片、视频、配乐与代码动画，一处管理，在不同项目里复用。"
        action={
          <div className="button-group">
            <button
              className="secondary-button"
              onClick={() => setMotion(true)}
            >
              <Braces size={14} />
              代码动画
            </button>
            <button
              className="primary-button"
              onClick={() => file.current?.click()}
            >
              <Upload size={15} />
              导入素材
            </button>
          </div>
        }
      />
      <div className="library-filters">
        <label className="search-field">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索素材、标签与描述"
          />
        </label>
        <div className="page-tabs">
          {[
            ["all", "全部"],
            ["video", "视频"],
            ["image", "图片"],
            ["audio", "音频"],
            ["motion", "动效"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={kind === id ? "active" : ""}
              onClick={() => setKind(id)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <SemanticSearch />
      <FolderWatches />
      <div className="library-grid">
        {assets.map((a) => (
          <div
            className={`library-card ${selection.isSelected(reference(a)) ? "referenced" : ""}`}
            key={a.id}
            tabIndex={0}
            role="option"
            aria-selected={selection.isSelected(reference(a))}
            draggable
            onDragStart={(e) =>
              selection.startDrag(reference(a), e.dataTransfer)
            }
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("button,input,a"))
                selection.select(reference(a), e);
            }}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === " " || e.key === "Enter")
              ) {
                e.preventDefault();
                selection.select(reference(a), e);
              }
            }}
          >
            <AssetThumbnail asset={a} />
            <div>
              <strong>{a.name}</strong>
              <ReferenceButton reference={reference(a)} />
              <p>{a.description || a.tags.join(" · ")}</p>
              {p.assets.some((x) => x.id === a.id) &&
                ["video", "audio", "image"].includes(a.kind) && (
                  <RelinkButton assetId={a.id} />
                )}{" "}
              {a.kind === "motion" && (
                <button className="text-button" onClick={() => setMotion(a)}>
                  编辑动画
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => void addAssetToTimeline(a)}
              >
                <Plus size={12} />
                放到当前时间线
              </button>
            </div>
          </div>
        ))}
      </div>
      <input
        ref={file}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*,.cube"
        onChange={(e) => void importFiles([...(e.target.files ?? [])])}
      />
      {motion && (
        <MotionEditor
          asset={motion === true ? undefined : motion}
          close={() => setMotion(null)}
        />
      )}
    </div>
  );
}
export const defaultMotion = `export default function Title({ frame, fps, width, height }) {\n  const progress = Math.min(1, frame / (fps * 0.8));\n  const y = (1 - progress) * 36;\n  return <div style={{width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', fontFamily:'sans-serif'}}>\n    <div style={{transform: 'translateY(' + y + 'px)', opacity:progress, color:'#ffffff', textAlign:'center'}}>\n      <div style={{fontSize:24, letterSpacing:12, color:'#c7e8ad'}}>A NEW PERSPECTIVE</div>\n      <h1 style={{fontSize:96, margin:24}}>从想法，走向画面</h1>\n    </div>\n  </div>;\n}`;
export function MotionEditor({
  close,
  asset,
}: {
  close(): void;
  asset?: Asset;
}) {
  const [name, setName] = useState(asset?.name ?? "动态标题"),
    [code, setCode] = useState(asset?.code ?? defaultMotion),
    [frame, setFrame] = useState(60),
    p = useStudio((s) => s.project)!;
  return (
    <Modal
      title="代码动画"
      subtitle="使用 React 与 frame / fps 创作逐帧动画"
      close={close}
    >
      <div className="modal-body">
        <label className="form-field">
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="form-field">
          从模板开始
          <select
            defaultValue=""
            onChange={(e) => {
              const template =
                motionTemplates[e.target.value as keyof typeof motionTemplates];
              if (template) {
                setCode(template.code);
                setName(template.name);
              }
            }}
          >
            <option value="">动态标题</option>
            {Object.entries(motionTemplates).map(([id, t]) => (
              <option key={id} value={id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="motion-editor-preview">
          <MotionLayer
            code={code}
            frame={frame}
            fps={30}
            width={1920}
            height={1080}
          />
        </div>
        <input
          type="range"
          min="0"
          max="149"
          value={frame}
          aria-label="动画预览帧"
          onChange={(e) => setFrame(Number(e.target.value))}
        />
        <textarea
          className="code-field motion-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
        />
        <p className="small-description">
          动画在独立预览中运行，可作为素材使用并导出透明视频。
        </p>
      </div>
      <div className="modal-footer">
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button"
          onClick={async () => {
            const saved = assetSchema.parse({
              id: asset?.id ?? crypto.randomUUID(),
              name,
              kind: "motion",
              url: "",
              code,
              duration: 5,
              createdAt: new Date().toISOString(),
              color: "#849d75",
              tags: ["代码动画"],
            });
            const { id, ...patch } = saved;
            await commit(
              asset && p.assets.some((a) => a.id === id)
                ? [{ type: "asset.update", assetId: id, patch }]
                : [{ type: "asset.add", asset: saved }],
              "保存代码动画",
            );
            notify("动画已加入素材库");
            close();
          }}
        >
          保存为素材
        </button>
      </div>
    </Modal>
  );
}
export function SkillsView() {
  const skills = useStudio((s) => s.skills),
    editingId = useStudio((s) => s.editingSkillId);
  const [editing, setEditing] = useState<Skill | null>(null),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("全部");
  const markdown = useRef<HTMLInputElement>(null);
  const categories = ["全部", ...new Set(skills.map((s) => s.category))];
  useEffect(
    () => describePage("skills", { search, category }),
    [search, category],
  );
  useEffect(() => {
    if (!editingId) return;
    const skill = skills.find((s) => s.id === editingId);
    if (skill) setEditing(skill);
    setState({ editingSkillId: null });
  }, [editingId, skills]);
  const save = async () => {
    if (!editing) return;
    try {
      await post("/api/skills", editing);
      setState({ skills: await request("/api/skills") });
      setEditing(null);
      notify("技能已保存");
    } catch (e) {
      notify(String(e), true);
    }
  };
  return (
    <div className="page">
      <PageHeading
        eyebrow="CREATIVE PLAYBOOKS"
        title="技能与工作流"
        description="把好用的创作方法留下来，让每一次协作更顺手。"
        action={
          <div className="button-group">
            <button
              className="secondary-button"
              onClick={() => markdown.current?.click()}
            >
              <Upload size={14} />
              导入 SKILL.md
            </button>
            <button
              className="secondary-button"
              onClick={async () => {
                const url = await askText(
                  "输入 GitHub 上的 SKILL.md 或技能目录链接",
                );
                if (!url) return;
                try {
                  await post("/api/skills/install", { url });
                  setState({ skills: await request("/api/skills") });
                  notify("技能已导入");
                } catch (e) {
                  notify(String(e), true);
                }
              }}
            >
              <Download size={14} />从 GitHub 导入
            </button>
            <button
              className="primary-button"
              onClick={() =>
                setEditing({
                  id: crypto.randomUUID(),
                  name: "我的新技能",
                  description: "",
                  prompt: "",
                  category: "自定义",
                  tools: [],
                  enabled: true,
                })
              }
            >
              <Plus size={15} />
              创建技能
            </button>
          </div>
        }
      />
      <input
        ref={markdown}
        type="file"
        hidden
        accept=".md,text/markdown"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            await post("/api/skills/import", { markdown: await file.text() });
            setState({ skills: await request("/api/skills") });
            notify("技能已导入");
          } catch (error) {
            notify(String(error), true);
          }
        }}
      />
      <label className="search-field page-search">
        <Search size={14} />
        <input
          placeholder="搜索技能或 /命令"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="page-tabs">
        {categories.map((c) => (
          <button
            key={c}
            className={category === c ? "active" : ""}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="skill-grid">
        {skills
          .filter(
            (s) =>
              (category === "全部" || s.category === category) &&
              (
                s.name +
                s.description +
                (s.command ? "/" + s.command : "")
              ).includes(search),
          )
          .map((s, i) => (
            <div className="skill-card" key={s.id}>
              <div className={`skill-icon tone-${i % 4}`}>
                <Workflow size={22} />
              </div>
              <span className="skill-category">
                {s.category}
                {s.builtin && " · 内置"}
                {s.context === "fork" && " · 子代理"}
              </span>
              <h3>
                {s.name}
                {s.command && (
                  <code className="skill-command">/{s.command}</code>
                )}
              </h3>
              <p>{s.description}</p>
              {(s.files?.length ?? 0) > 0 && (
                <small className="skill-files">
                  {s.files!.length} 个参考文件
                </small>
              )}
              <div className="skill-card-footer">
                <ReferenceButton
                  reference={{ kind: "skill", id: s.id, name: s.name }}
                />
                <button className="text-button" onClick={() => setEditing(s)}>
                  查看与编辑
                </button>
                <button
                  className="skill-use"
                  disabled={!s.enabled}
                  onClick={() => {
                    setState({ skillId: s.id, assistantOpen: true });
                    notify(`已引用“${s.name}”，在创作助手中发送你的需求`);
                  }}
                >
                  使用
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))}
      </div>
      {editing && (
        <Modal
          title={editing.name}
          subtitle="技能只使用你选择的工具与模型"
          close={() => setEditing(null)}
        >
          <div className="modal-body">
            <div className="form-grid">
              <label>
                名称
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </label>
              <label>
                分类
                <input
                  value={editing.category}
                  onChange={(e) =>
                    setEditing({ ...editing, category: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                斜杠命令
                <input
                  value={editing.command ?? ""}
                  placeholder="例如 clean，在对话框输入 /clean 使用"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      command:
                        e.target.value
                          .replace(/[^\p{L}\p{N}_-]/gu, "")
                          .slice(0, 40) || undefined,
                    })
                  }
                />
              </label>
              <label>
                运行方式
                <select
                  value={editing.context ?? "inline"}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      context: e.target.value as "inline" | "fork",
                    })
                  }
                >
                  <option value="inline">在当前对话中执行</option>
                  <option value="fork">作为子代理独立完成并汇报</option>
                </select>
              </label>
            </div>
            <label className="form-field">
              允许的工具（逗号分隔，留空使用全部）
              <input
                value={editing.tools.join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    tools: e.target.value
                      .split(/[,，\s]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="form-field">
              一句话说明
              <input
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              工作流说明
              <textarea
                className="field-textarea large"
                value={editing.prompt}
                onChange={(e) =>
                  setEditing({ ...editing, prompt: e.target.value })
                }
              />
            </label>
            <details className="advanced-settings">
              <summary>TypeScript 脚本（可选）</summary>
              <p>
                默认导出函数，接收 project、input、output，返回 summary 或
                commands。运行需要本机
                Deno；仅能读取本项目素材并写入临时输出目录，编辑仍生成提案。
              </p>
              <textarea
                className="code-field large"
                value={editing.script ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, script: e.target.value })
                }
                placeholder="export default async ({ project, input }) => ({ summary: project.name });"
              />
            </details>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />
              启用此技能
            </label>
          </div>
          {(editing.files?.length ?? 0) > 0 && (
            <div className="modal-body skill-file-list">
              <h4>参考文件</h4>
              {editing.files!.map((f) => (
                <details key={f.path}>
                  <summary>{f.path}</summary>
                  <pre>{f.content.slice(0, 4000)}</pre>
                </details>
              ))}
            </div>
          )}
          <div className="modal-footer">
            <a
              className="text-button"
              href={`/api/skills/${editing.id}/export`}
              download
            >
              导出 Markdown
            </a>
            {!editing.builtin && skills.some((x) => x.id === editing.id) && (
              <button
                className="text-button danger"
                onClick={async () => {
                  if (!confirm(`删除技能「${editing.name}」？`)) return;
                  try {
                    await request(`/api/skills/${editing.id}`, {
                      method: "DELETE",
                    });
                    setState({ skills: await request("/api/skills") });
                    setEditing(null);
                  } catch (e) {
                    notify(String(e), true);
                  }
                }}
              >
                删除
              </button>
            )}
            {editing.script && (
              <button
                className="secondary-button"
                onClick={async () => {
                  await post("/api/skills", editing);
                  await startJob("skill-script", "技能脚本 · " + editing.name, {
                    skillId: editing.id,
                  });
                  setEditing(null);
                  setState({ nav: "tasks" });
                }}
              >
                运行脚本
              </button>
            )}
            <button
              className="secondary-button"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button className="primary-button" onClick={() => void save()}>
              保存技能
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
const jobStatuses = {
  queued: "等待处理",
  running: "处理中",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已取消",
  interrupted: "已中断",
};
/** Finished jobs that can make another take with the same settings. */
const regenerable = new Set([
  "generate",
  "motion-ai",
  "turnaround",
  "cover",
  "translate-captions",
]);
export function TasksView() {
  const jobs = useStudio((s) => s.jobs),
    project = useStudio((s) => s.project);
  return (
    <div className="page">
      <PageHeading
        eyebrow="KEEP CREATING"
        title="任务中心"
        description="生成、分析和导出在后台进行，进度与结果始终可见。"
      />
      {project && <ExportHistory projectId={project.id} />}
      <div className="task-list">
        {jobs.length ? (
          jobs.map((j) => (
            <div className={`task-card ${j.status}`} key={j.id}>
              <div className="task-status-icon">
                {j.status === "completed" ? (
                  <CheckCircle2 size={20} />
                ) : j.status === "running" ? (
                  <LoaderCircle className="spin" size={20} />
                ) : (
                  <Workflow size={20} />
                )}
              </div>
              <div className="task-info">
                <strong>{j.label}</strong>
                <ReferenceButton
                  reference={{
                    kind: "job",
                    id: j.id,
                    name: j.label,
                    projectId: j.projectId,
                  }}
                />
                <span>
                  {j.status === "running" && j.stage
                    ? `${j.stage} · ${Math.round(j.progress)}%`
                    : jobStatuses[j.status]}{" "}
                  · {new Date(j.createdAt).toLocaleString("zh-CN")}
                </span>
                {j.error && <p className="error-text">{j.error}</p>}
                <JobResult job={j} />
                {j.status === "running" && (
                  <div className="progress-bar">
                    <i style={{ width: `${Math.max(4, j.progress)}%` }} />
                  </div>
                )}
              </div>
              <div className="task-actions">
                {j.kind === "process-media" && j.status === "completed" && (
                  <ApplyMediaResult jobId={j.id} projectId={j.projectId} />
                )}
                {j.status === "completed" && j.result?.url && (
                  <a className="secondary-button" href={j.result.url} download>
                    <Download size={13} />
                    下载
                  </a>
                )}
                {["queued", "running"].includes(j.status) ? (
                  <button
                    className="icon-button"
                    title="取消任务"
                    onClick={() => void post(`/api/jobs/${j.id}/cancel`, {})}
                  >
                    <CircleStop size={18} />
                  </button>
                ) : (
                  (["failed", "interrupted", "cancelled"].includes(j.status) ||
                    (j.status === "completed" && regenerable.has(j.kind))) && (
                    <button
                      className="secondary-button"
                      title={
                        j.status === "completed"
                          ? "用同样的设置再生成一个版本（会再次使用服务额度）"
                          : undefined
                      }
                      onClick={async () => {
                        const next = await post<Job>("/api/jobs", {
                          projectId: j.projectId,
                          kind: j.kind,
                          label:
                            j.status === "completed"
                              ? `${j.label.replace(/（再生成）$/, "")}（再生成）`
                              : j.label,
                          input: j.input,
                        });
                        acceptJob(next);
                      }}
                    >
                      {j.status === "completed" ? "再生成一次" : "重新提交"}
                    </button>
                  )
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Workflow size={34} />
            <h3>这里会记录创作的每一步</h3>
            <p>从生成图片、转写音频或导出项目开始。</p>
          </div>
        )}
      </div>
    </div>
  );
}
export function SettingsView() {
  const tick = useStudio((s) => s.ticks.settings);
  const [info, setInfo] = useState<any>(null),
    [name, setName] = useState("我的创作空间");
  useEffect(() => {
    void request("/api/capabilities").then(setInfo);
    void request<any>("/api/settings").then((s) =>
      setName(s.name ?? "我的创作空间"),
    );
  }, [tick]);
  return (
    <div className="page settings-page">
      <PageHeading
        eyebrow="MADE FOR YOUR WORKFLOW"
        title="创作空间设置"
        description="数据、连接和习惯，都由你自己掌握。"
      />
      <section className="settings-section">
        <h2>创作空间</h2>
        <label className="form-field">
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          className="secondary-button"
          onClick={() =>
            void post("/api/settings", { name }).then(() =>
              notify("设置已保存"),
            )
          }
        >
          保存
        </button>
      </section>
      <AppearanceSettings />
      <section className="settings-section">
        <h2>本机环境</h2>
        <div className="environment-grid">
          {[
            ["系统", info?.platform ?? "读取中"],
            ["桌面桥接", info?.desktop ? "可用" : "浏览器模式"],
            ["FFmpeg", info?.ffmpeg ? "可用" : "需要安装或配置"],
            ["本地转写", "浏览器内运行 · 首次使用下载模型"],
            [
              "应用操作",
              info?.desktop ? "在录制工作区开始授权会话" : "请打开桌面版",
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <p className="storage-location">
          <HardDrive size={13} />
          数据位置：{info?.dataDir ?? "读取中"}
        </p>
      </section>
      <McpSettings />
      <AgentSettingsSection />
      <MemoriesSection />
      <section className="settings-section">
        <h2>常用快捷键</h2>
        <div className="shortcut-grid">
          {[
            ["播放 / 暂停", "Space"],
            ["倒放 · 加速倒放", "J · 再按 J"],
            ["暂停", "K"],
            ["正放 · 加速正放", "L · 再按 L"],
            ["逐帧后退 / 前进", "← / → · 按住 K 再按 J / L"],
            ["后退 / 前进 1 秒", "Shift + ← / →"],
            ["上一个 / 下一个剪辑点", "↑ / ↓"],
            ["跳到开头 / 结尾", "Home / End"],
            ["设入点 / 出点", "I / O"],
            ["跳到入点 / 出点", "Shift + I / O"],
            ["清除入点 / 出点", "Option + I / O"],
            ["清除入出点", "X"],
            ["按片段设入出点", "/"],
            ["选择工具 / 刀片工具", "V / B"],
            ["滑移 / 滑动 / 卷动工具", "Y / U / N"],
            ["在播放头添加标记", "M"],
            ["在播放头分割", "S"],
            ["删除片段", "Delete"],
            ["波纹删除", "Shift + Delete"],
            ["撤销", "⌘ / Ctrl + Z"],
            ["重做", "⌘ / Ctrl + Shift + Z · Ctrl + Y"],
            ["复制片段", "⌘ / Ctrl + C"],
            ["剪切片段", "⌘ / Ctrl + X"],
            ["粘贴到播放头", "⌘ / Ctrl + V"],
            ["创建片段副本", "⌘ / Ctrl + D"],
            ["选择全部片段", "⌘ / Ctrl + A"],
            ["导入素材", "⌘ / Ctrl + I"],
            ["移到同类轨道", "上下拖动片段"],
          ].map(([name, key]) => (
            <div key={name}>
              <span>{name}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
function AppearanceSettings() {
  const theme = useStudio((s) => s.theme),
    effects = useStudio((s) => s.sakuraEffects);
  return (
    <section className="settings-section">
      <h2>外观</h2>
      <div className="segmented" role="radiogroup" aria-label="外观">
        {(
          [
            ["system", "跟随系统"],
            ["light", "白色 · 浅色"],
            ["dark", "墨绿 · 深色"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            role="radio"
            aria-checked={theme === id}
            className={theme === id ? "active" : ""}
            onClick={() => setTheme(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="skin-preview">
        <span className="skin-swatches">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div>
          <strong>白色 · 清晰</strong>
          <p>白色底面与中性灰层次；蓝色标出可操作的重点，红色只用于错误。</p>
        </div>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={effects}
          onChange={(e) => {
            remember("tadacut-sakura-effects", e.target.checked);
            setState({ sakuraEffects: e.target.checked });
          }}
        />
        樱花线条与轻动效
      </label>
      <p>预览画面与导出内容不受外观影响。</p>
    </section>
  );
}
function McpSettings() {
  const [config, setConfig] = useState<any>(null);
  const requested = useStudio((s) => s.showMcpConfig);
  useEffect(() => {
    if (!requested) return;
    void request("/api/mcp-config")
      .then(setConfig)
      .catch((e) => notify(String(e), true));
    setState({ showMcpConfig: false });
  }, [requested]);
  return (
    <section className="settings-section">
      <h2>连接外部 Agent · MCP</h2>
      <p>外部 Agent 可以读取项目、提交编辑提案。修改在工作台中确认后生效。</p>
      <button
        className="secondary-button"
        onClick={() => void request("/api/mcp-config").then(setConfig)}
      >
        <Braces size={14} />
        查看连接配置
      </button>
      {config && (
        <>
          <pre className="connection-code">
            {JSON.stringify(config, null, 2)}
          </pre>
          <button
            className="text-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(JSON.stringify(config, null, 2))
                .then(() => notify("MCP 配置已复制"))
            }
          >
            复制连接配置
          </button>
        </>
      )}
    </section>
  );
}
