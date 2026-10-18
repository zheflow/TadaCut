import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  CloudUpload,
  Download,
  ExternalLink,
  History,
  LoaderCircle,
  Plus,
  Pencil,
  Puzzle,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  presetGroups,
  providerPresets,
  type ProviderPreset,
} from "../../../../packages/providers/src/presets";
import {
  providerSchema,
  type Provider,
} from "../../../../packages/providers/src/types";
import { post } from "../lib/api";
import {
  agentApi,
  del,
  exportsApi,
  pluginsApi,
  useRemote,
  versionsApi,
  type AgentSettings,
  type ExportRecord,
  type GlobalMemory,
  type MemoryCandidate,
  type PluginInfo,
  type ProjectVersion,
} from "../lib/studio-api";
import {
  askText,
  commit,
  jobDone,
  notify,
  startJob,
  useStudio,
} from "../lib/store";
import { Modal, PageHeading } from "./Pages";
import { ReferenceButton } from "./References";

const effects: [keyof AgentSettings["permissions"], string, string][] = [
  ["read", "读取", "读取项目、素材、文稿与画面"],
  ["edit", "编辑", "修改时间线、字幕、分镜等（手动模式下先进入草稿）"],
  ["job", "后台任务", "转写、分析、导出、本机音频处理"],
  ["manage", "应用管理", "设置、模型、技能、扩展与项目管理，确认后直接生效"],
  ["generate", "生成", "调用你配置的生成服务，会消耗额度"],
  ["external", "外部服务", "联网搜索、读取网页、在线素材库、上传存储"],
  ["publish", "发布", "公开发布到社交平台，每次都需要确认"],
];
export function AgentSettingsSection() {
  const tick = useStudio((s) => s.ticks["agent-settings"]);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  useEffect(() => {
    void agentApi
      .settings()
      .then(setSettings)
      .catch(() => {});
  }, [tick]);
  if (!settings) return null;
  const save = async (patch: Partial<AgentSettings>) => {
    const next = await agentApi.saveSettings(patch);
    if (next) setSettings(next);
  };
  return (
    <section className="settings-section">
      <h2>创作助手</h2>
      <p>
        决定助手可以直接做什么、什么需要先问你。技能与扩展不会提升这些权限。
      </p>
      <div className="permission-table">
        {effects.map(([effect, name, description]) => (
          <div key={effect} className="permission-row">
            <div>
              <strong>{name}</strong>
              <small>{description}</small>
            </div>
            <div className="segmented">
              {(["allow", "ask", "deny"] as const).map((value) => (
                <button
                  key={value}
                  className={
                    settings.permissions[effect] === value ? "active" : ""
                  }
                  disabled={effect === "publish" && value === "allow"}
                  title={
                    effect === "publish" && value === "allow"
                      ? "发布总是需要你确认"
                      : undefined
                  }
                  onClick={() =>
                    void save({
                      permissions: { ...settings.permissions, [effect]: value },
                    })
                  }
                >
                  {{ allow: "允许", ask: "询问", deny: "禁止" }[value]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <label className="select-field">
        <span>默认模式</span>
        <select
          value={settings.defaultMode}
          onChange={(e) =>
            void save({
              defaultMode: e.target.value as AgentSettings["defaultMode"],
            })
          }
        >
          <option value="manual">手动：修改先进草稿，完成后确认</option>
          <option value="auto">自动：每一步直接应用，可逐步撤销</option>
          <option value="ask">问答：只读取和回答</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.verify}
          onChange={(e) => void save({ verify: e.target.checked })}
        />
        完成修改后让助手对照需求自查一遍
      </label>
      <label className="field-label">
        应用上下文预算（估算 tokens）
        <input
          key={settings.inputBudget}
          type="number"
          aria-label="上下文预算"
          min={8000}
          max={64000}
          step={1000}
          defaultValue={settings.inputBudget}
          onBlur={(e) => {
            const value = Number(e.currentTarget.value);
            if (value !== settings.inputBudget)
              void save({ inputBudget: value });
          }}
        />
      </label>
      <p>
        默认 24,000，包含系统提示、技能、工具定义和消息；CLI
        内部的压缩由运行时管理。
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.learnPreferences}
          onChange={(e) => void save({ learnPreferences: e.target.checked })}
        />
        从对话中发现长期偏好，作为候选记忆交给你确认（会额外调用一次对话模型）
      </label>
    </section>
  );
}
export function MemoriesSection() {
  const p = useStudio((s) => s.project);
  const [query, setQuery] = useState("");
  const matches = (m: { text: string; tags: string[] }) =>
    `${m.text} ${m.tags.join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const memories = useRemote<GlobalMemory[]>("/api/memories", "memories", []),
    candidates = useRemote<MemoryCandidate[]>(
      "/api/memory-candidates",
      "memory-candidates",
      [],
    );
  return (
    <section className="settings-section" id="agent-memories">
      <h2>记忆</h2>
      <p>
        长期偏好用于所有项目；项目约定只对当前项目有效。随时可以编辑和删除。
      </p>
      <input
        className="search-input"
        aria-label="搜索记忆"
        placeholder="搜索长期偏好与项目约定"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(candidates.value ?? []).length > 0 && (
        <div className="memory-candidates">
          <h3>助手发现的偏好</h3>
          {candidates.value!.map((c) => (
            <div className="memory-card candidate" key={c.id}>
              <div>
                {c.text}
                <small>{c.reason}</small>
              </div>
              <div className="button-group">
                <button
                  className="icon-button"
                  title="不需要"
                  onClick={() =>
                    void post(`/api/memory-candidates/${c.id}`, {
                      keep: false,
                    }).then(candidates.refresh)
                  }
                >
                  <X size={13} />
                </button>
                <button
                  className="icon-button"
                  title="记住"
                  onClick={() =>
                    void post(`/api/memory-candidates/${c.id}`, {
                      keep: true,
                    }).then(() => {
                      candidates.refresh();
                      memories.refresh();
                    })
                  }
                >
                  <Check size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <h3>长期偏好</h3>
      {(memories.value ?? []).filter(matches).map((m) => (
        <div className="memory-card" key={m.id}>
          <div>
            {m.text}
            <small>
              {m.source === "learned"
                ? "从对话中确认"
                : m.source === "agent"
                  ? "助手记录"
                  : "手动添加"}
              {m.tags.length ? ` · ${m.tags.join(" · ")}` : ""}
            </small>
          </div>
          <button
            className="icon-button"
            title="编辑长期偏好"
            onClick={async () => {
              const text = await askText("编辑长期偏好", m.text, true);
              if (text?.trim())
                await post("/api/memories", {
                  id: m.id,
                  text: text.trim(),
                  tags: m.tags,
                })
                  .then(memories.refresh)
                  .catch((e) => notify(String(e), true));
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="icon-button"
            title="删除"
            onClick={() =>
              void del(`/api/memories/${m.id}`).then(memories.refresh)
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        className="secondary-button"
        onClick={async () => {
          const text = await askText(
            "记录一条长期偏好（例如：字幕用黄色描边、竖屏 9:16）",
            "",
            true,
          );
          if (text?.trim())
            await post("/api/memories", {
              text: text.trim(),
              tags: ["用户偏好"],
            })
              .then(memories.refresh)
              .catch((e) => notify(String(e), true));
        }}
      >
        <Plus size={13} />
        添加长期偏好
      </button>
      {p && (
        <>
          <h3>本项目的约定</h3>
          {p.memories.filter(matches).map((m) => (
            <div className="memory-card" key={m.id}>
              <div>
                {m.text}
                <small>{m.tags.join(" · ")}</small>
              </div>
              <button
                className="icon-button"
                title="编辑项目约定"
                onClick={async () => {
                  const text = await askText("编辑项目约定", m.text, true);
                  if (text?.trim())
                    void commit(
                      [
                        {
                          type: "memory.upsert",
                          memory: {
                            ...m,
                            text: text.trim(),
                            updatedAt: new Date().toISOString(),
                          },
                        },
                      ],
                      "编辑项目约定",
                    );
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                className="icon-button"
                title="删除"
                onClick={() =>
                  void commit(
                    [{ type: "memory.remove", memoryId: m.id }],
                    "删除项目约定",
                  )
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            className="secondary-button"
            onClick={async () => {
              const text = await askText("记录本项目的约定", "", true);
              if (text?.trim())
                void commit(
                  [
                    {
                      type: "memory.upsert",
                      memory: {
                        id: crypto.randomUUID(),
                        text: text.trim(),
                        tags: ["项目约定"],
                        updatedAt: new Date().toISOString(),
                      },
                    },
                  ],
                  "保存项目约定",
                );
            }}
          >
            <Plus size={13} />
            添加项目约定
          </button>
        </>
      )}
    </section>
  );
}
export function ExtensionsView() {
  const plugins = useRemote<PluginInfo[]>("/api/plugins", "plugins", []);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const install = async (input: File | string) => {
    setBusy(true);
    await pluginsApi.install(input);
    setBusy(false);
    plugins.refresh();
  };
  const kinds: [string, string][] = [
    ["templates", "动态模板"],
    ["luts", "LUT"],
    ["sounds", "音效"],
    ["transitions", "转场"],
    ["effects", "特效"],
    ["cameraMoves", "镜头运动"],
    ["captionStyles", "字幕样式"],
  ];
  return (
    <div className="page">
      <PageHeading
        eyebrow="EXTENSIONS"
        title="扩展中心"
        description="安装模板、LUT、音效、转场、特效、镜头运动与字幕样式包。扩展只提供资源，不能运行动画框与着色器之外的代码。"
        action={
          <div className="button-group">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                const url = await askText(
                  "扩展包地址（tadacut-plugin@1 JSON）",
                );
                if (url?.trim()) await install(url.trim());
              }}
            >
              <ExternalLink size={14} />
              从网址安装
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Upload size={14} />
              )}
              安装扩展包
            </button>
          </div>
        }
      />
      <div className="extension-grid">
        {(plugins.value ?? []).map((x) => (
          <div className="extension-card" key={x.id}>
            <div className="extension-head">
              <Puzzle size={20} />
              <div>
                <h3>{x.name}</h3>
                <small>
                  {x.version}
                  {x.author ? ` · ${x.author}` : ""}
                  {x.license ? ` · ${x.license}` : ""}
                </small>
              </div>
            </div>
            {x.description && <p>{x.description}</p>}
            <div className="cap-tags">
              {kinds
                .filter(([k]) => x.counts[k])
                .map(([k, label]) => (
                  <span key={k}>
                    {label} {x.counts[k]}
                  </span>
                ))}
            </div>
            <div className="provider-actions">
              <ReferenceButton
                reference={{ kind: "extension", id: x.id, name: x.name }}
              />
              {x.homepage && (
                <a
                  className="text-button"
                  href={x.homepage}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={12} />
                  主页
                </a>
              )}
              <button
                className="text-button danger"
                onClick={() => {
                  if (
                    confirm(
                      `移除扩展「${x.name}」？已经用到项目里的素材会保留。`,
                    )
                  )
                    void pluginsApi.remove(x.id).then(plugins.refresh);
                }}
              >
                <Trash2 size={12} />
                移除
              </button>
            </div>
          </div>
        ))}
        {!(plugins.value ?? []).length && (
          <div className="empty-state">
            <Puzzle size={34} />
            <h3>还没有安装扩展</h3>
            <p>
              扩展包是一个 JSON 文件，格式为
              tadacut-plugin@1。安装后在工作台左侧「资源库」中使用。
            </p>
          </div>
        )}
      </div>
      <input
        ref={file}
        type="file"
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void install(chosen);
          e.target.value = "";
        }}
      />
    </div>
  );
}
const platforms = [
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["x", "X"],
  ["linkedin", "LinkedIn"],
  ["threads", "Threads"],
  ["pinterest", "Pinterest"],
] as const;
function PublishDialog({
  record,
  close,
}: {
  record: ExportRecord;
  close(): void;
}) {
  const providers = useStudio((s) => s.providers).filter(
    (x) => x.enabled && x.capabilities.includes("publish"),
  );
  const [providerId, setProviderId] = useState(providers[0]?.id ?? ""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  return (
    <Modal title="发布视频" subtitle={record.filename} close={close}>
      <div className="modal-body">
        {!providers.length ? (
          <p className="small-description">
            需要先在「模型」页添加 Upload-Post 发布服务，填写 API Key
            和账号档案名称（user），并在 Upload-Post 里绑定要发布的平台。
          </p>
        ) : (
          <>
            {record.verification && !record.verification.ok && (
              <div className="warning-note">
                <CircleAlert size={13} />
                校验发现问题：{record.verification.issues.join("；")}
              </div>
            )}
            <label className="select-field">
              <span>发布服务</span>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
              >
                {providers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              标题
              <input
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="form-field">
              描述
              <textarea
                rows={4}
                value={description}
                maxLength={5000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <h4>平台</h4>
            <div className="capability-checkboxes">
              {platforms.map(([id, name]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(id)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, id]
                          : chosen.filter((x) => x !== id),
                      )
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认把这个视频公开发布到所选平台（发布后无法在这里撤回）
            </label>
          </>
        )}
      </div>
      <div className="modal-footer">
        <div />
        <button className="secondary-button" onClick={close}>
          取消
        </button>
        <button
          className="primary-button"
          disabled={
            !providerId || !title.trim() || !chosen.length || !confirmed
          }
          onClick={async () => {
            const job = await exportsApi.publish(record.id, {
              providerId,
              title: title.trim(),
              description: description.trim() || undefined,
              platforms: chosen,
            });
            if (job) close();
          }}
        >
          <Send size={13} />
          发布
        </button>
      </div>
    </Modal>
  );
}
const exportKinds: Record<ExportRecord["kind"], string> = {
  video: "视频",
  audio: "音频",
  clip: "单个片段",
  still: "静帧",
};
/** Uploads an export to the user's S3-compatible storage and copies a link that expires. */
async function uploadExport(record: ExportRecord, providerId: string) {
  const job = await startJob("storage-upload", `上传「${record.filename}」`, {
    exportId: record.id,
    providerId,
    expiresHours: 24,
  });
  const done = job && (await jobDone(job.id));
  if (done?.status !== "completed") {
    if (done) notify(done.error ?? "上传没有完成", true);
    return;
  }
  const url = String(done.result?.url ?? "");
  try {
    await navigator.clipboard.writeText(url);
    notify("已上传，24 小时内有效的链接已复制");
  } catch {
    notify("已上传；链接在任务中心的结果里");
  }
}
export function ExportHistory({ projectId }: { projectId: string }) {
  const records = useRemote<ExportRecord[]>(
    `/api/projects/${projectId}/exports`,
    "exports",
    [],
  );
  const [publishing, setPublishing] = useState<ExportRecord | null>(null),
    [uploading, setUploading] = useState(""),
    storage = useStudio((s) => s.providers).find(
      (x) => x.enabled && x.capabilities.includes("storage"),
    );
  const list = [...(records.value ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  if (!list.length) return null;
  return (
    <section className="export-history">
      <h2>导出记录</h2>
      {list.slice(0, 30).map((r) => (
        <div className="export-row" key={r.id}>
          <div>
            <strong>{r.filename}</strong>
            <small>
              {exportKinds[r.kind]} · {r.codec} ·{" "}
              {(r.size / 1024 / 1024).toFixed(1)} MB ·{" "}
              {new Date(r.createdAt).toLocaleString("zh-CN")}
            </small>
            {r.verification && (
              <small className={r.verification.ok ? "ok-text" : "error-text"}>
                {r.verification.ok ? (
                  <>
                    <BadgeCheck size={11} /> 校验通过
                    {r.verification.duration !== undefined
                      ? ` · ${r.verification.duration.toFixed(2)} 秒`
                      : ""}
                    {r.verification.width
                      ? ` · ${r.verification.width}×${r.verification.height}`
                      : ""}
                  </>
                ) : (
                  <>
                    <CircleAlert size={11} /> {r.verification.issues.join("；")}
                  </>
                )}
              </small>
            )}
            {r.published?.length ? (
              <small className="ok-text">
                已发布到{" "}
                {[...new Set(r.published.flatMap((x) => x.platforms))].join(
                  "、",
                )}
              </small>
            ) : null}
          </div>
          <div className="button-group">
            <a className="icon-button" href={r.url} download title="下载">
              <Download size={14} />
            </a>
            <button
              className="icon-button"
              title="用 ffprobe 校验"
              onClick={() => void exportsApi.verify(r.id)}
            >
              <ShieldCheck size={14} />
            </button>
            {storage && (
              <button
                className="icon-button"
                title={`上传到「${storage.name}」并复制链接`}
                disabled={uploading === r.id}
                onClick={async () => {
                  setUploading(r.id);
                  await uploadExport(r, storage.id);
                  setUploading("");
                }}
              >
                {uploading === r.id ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <CloudUpload size={14} />
                )}
              </button>
            )}
            {(r.kind === "video" || r.kind === "clip") && (
              <button
                className="icon-button"
                title="发布"
                onClick={() => setPublishing(r)}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
      {publishing && (
        <PublishDialog record={publishing} close={() => setPublishing(null)} />
      )}
    </section>
  );
}
export function VersionsDialog({
  projectId,
  close,
}: {
  projectId: string;
  close(): void;
}) {
  const versions = useRemote<ProjectVersion[]>(
    `/api/projects/${projectId}/versions`,
    "versions",
    [],
  );
  return (
    <Modal
      title="版本"
      subtitle="保存的版本可以随时恢复；恢复本身也能撤销"
      close={close}
    >
      <div className="modal-body">
        <button
          className="secondary-button"
          onClick={async () => {
            const name = await askText(
              "版本名称",
              new Date().toLocaleString("zh-CN"),
            );
            if (name?.trim()) {
              await versionsApi.save(name.trim(), projectId);
              versions.refresh();
            }
          }}
        >
          <Plus size={13} />
          保存当前版本
        </button>
        <div className="version-list">
          {(versions.value ?? []).map((v) => (
            <div className="export-row" key={v.id}>
              <div>
                <strong>{v.name}</strong>
                <small>
                  {new Date(v.createdAt).toLocaleString("zh-CN")} · 第{" "}
                  {v.revision} 次修改 · {(v.size / 1024).toFixed(0)} KB
                </small>
              </div>
              <div className="button-group">
                <button
                  className="secondary-button"
                  onClick={async () => {
                    if (
                      !confirm(
                        `恢复到「${v.name}」？当前内容会被替换，可以撤销。`,
                      )
                    )
                      return;
                    await versionsApi.restore(v.id, projectId);
                    close();
                  }}
                >
                  <History size={12} />
                  恢复
                </button>
                <button
                  className="icon-button"
                  title="删除版本"
                  onClick={async () => {
                    if (!confirm(`删除版本「${v.name}」？`)) return;
                    await versionsApi.remove(v.id, projectId);
                    versions.refresh();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          {!(versions.value ?? []).length && (
            <p className="small-description">
              还没有保存的版本。自动模式开始前也会自动保存一个版本。
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
/** Starting points for common services; the user adds the key and picks models. */
export function ProviderPresets({
  onPick,
}: {
  onPick(provider: Provider): void;
}) {
  const [group, setGroup] = useState<ProviderPreset["group"]>("llm");
  return (
    <section className="preset-section">
      <div className="section-heading">
        <h2>从常用服务开始</h2>
        <p>地址和能力已经填好，你只需要填写自己的密钥并选择模型。</p>
      </div>
      <div className="page-tabs">
        {(Object.keys(presetGroups) as ProviderPreset["group"][]).map((g) => (
          <button
            key={g}
            className={group === g ? "active" : ""}
            onClick={() => setGroup(g)}
          >
            {presetGroups[g]}
          </button>
        ))}
      </div>
      <div className="preset-grid">
        {providerPresets
          .filter((x) => x.group === group)
          .map((x) => (
            <button
              key={x.id}
              className="preset-card"
              onClick={() =>
                onPick(
                  providerSchema.parse({
                    id: `${x.id}-${Math.random().toString(36).slice(2, 7)}`,
                    name: x.name,
                    kind: x.kind,
                    baseUrl: x.baseUrl,
                    capabilities: x.capabilities,
                    model: x.model ?? "",
                    options: x.options ?? {},
                  }),
                )
              }
            >
              <strong>{x.name}</strong>
              <small>{x.note}</small>
              {x.keyUrl && (
                <a
                  className="text-button"
                  href={x.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  获取密钥 <ExternalLink size={10} />
                </a>
              )}
            </button>
          ))}
      </div>
    </section>
  );
}
