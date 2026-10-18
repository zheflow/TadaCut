import { useEffect, useRef, useState } from "react";
import { activeTimeline, type Project } from "@tadacut/domain";
import { Modal } from "./Pages";
import { post, request } from "../lib/api";
import {
  getState,
  notify,
  openProject,
  setState,
  useStudio,
} from "../lib/store";
import { describePage } from "../lib/studio-control";
type Remote = {
  id: string;
  name: string;
  version: number;
  owner: string;
  members: Record<string, string>;
};
type Member = { id: string; name: string; role: string; hasInvite?: boolean };
type Catalog = {
  id: string;
  title: string;
  kind: string;
  description: string;
  license: string;
  author: string;
};
export function TeamWorkspace({ close }: { close: () => void }) {
  const project = useStudio((s) => s.project),
    nav = useStudio((s) => s.nav),
    frame = useStudio((s) => s.playhead);
  const [tab, setTab] = useState("connection"),
    [working, setBusy] = useState(false),
    [loadedView, setLoadedView] = useState(""),
    [error, setError] = useState(""),
    [url, setUrl] = useState(""),
    [name, setName] = useState("团队空间"),
    [token, setToken] = useState(""),
    [configured, setConfigured] = useState(false),
    [hosting, setHosting] = useState(false),
    [lan, setLan] = useState(false),
    [port, setPort] = useState(4399);
  const [projects, setProjects] = useState<Remote[]>([]),
    [remoteId, setRemoteId] = useState(""),
    [members, setMembers] = useState<Member[]>([]),
    [memberName, setMemberName] = useState(""),
    [memberId, setMemberId] = useState(""),
    [role, setRole] = useState("viewer"),
    [versions, setVersions] = useState<
      { version: number; updatedAt: string }[]
    >([]);
  const [comments, setComments] = useState<
      {
        id: string;
        author: string;
        text: string;
        frame?: number;
        resolved: boolean;
        version: number;
      }[]
    >([]),
    [comment, setComment] = useState(""),
    [reviews, setReviews] = useState<
      { id: string; remoteId: string; url: string; expiresAt: number }[]
    >([]),
    [exports, setExports] = useState<
      { id: string; filename: string; name?: string }[]
    >([]),
    [exportId, setExportId] = useState(""),
    [days, setDays] = useState(7);
  const [catalog, setCatalog] = useState<Catalog[]>([]),
    [kind, setKind] = useState("template"),
    [query, setQuery] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [license, setLicense] = useState(""),
    [assetId, setAssetId] = useState("");
  const pending = useRef(0),
    sequences = useRef({ projects: 0, catalog: 0, review: 0 });
  const viewKey = `${tab}:${remoteId}`,
    viewRef = useRef(viewKey);
  viewRef.current = viewKey;
  const busy =
    working || (configured && tab !== "connection" && loadedView !== viewKey);
  const run = async (fn: () => Promise<void>) => {
    pending.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current--;
      setBusy(pending.current > 0);
    }
  };
  const loadConfig = async () => {
    const c = await request<{
      baseUrl?: string;
      name?: string;
      hasKey: boolean;
      hosting: boolean;
    }>("/api/team/config");
    setUrl(c.baseUrl ?? "");
    setName(c.name ?? "团队空间");
    setConfigured(c.hasKey && Boolean(c.baseUrl));
    setHosting(c.hosting);
  };
  const loadProjects = async () => {
    const ticket = ++sequences.current.projects;
    const [nextProjects, nextMembers] = await Promise.all([
      request<Remote[]>("/api/team/projects"),
      request<Member[]>("/api/team/members"),
    ]);
    if (ticket !== sequences.current.projects) return;
    setProjects(nextProjects);
    setMembers(nextMembers);
  };
  const loadCatalog = async () => {
    const ticket = ++sequences.current.catalog;
    const result = await request<Catalog[]>(
      `/api/team/catalog?q=${encodeURIComponent(query)}&kind=${kind}`,
    );
    if (ticket === sequences.current.catalog) setCatalog(result);
  };
  const loadReview = async () => {
    if (!remoteId) return;
    const ticket = ++sequences.current.review;
    const [nextComments, nextVersions, nextReviews, nextExports] =
      await Promise.all([
        request<typeof comments>(`/api/team/projects/${remoteId}/comments`),
        request<typeof versions>(`/api/team/projects/${remoteId}/versions`),
        request<typeof reviews>("/api/team/reviews"),
        project
          ? request<typeof exports>(`/api/projects/${project.id}/exports`)
          : Promise.resolve([]),
      ]);
    if (ticket !== sequences.current.review) return;
    setComments(nextComments);
    setVersions(nextVersions);
    setReviews(nextReviews);
    setExports(nextExports);
  };
  useEffect(() => {
    void run(loadConfig);
  }, []);
  useEffect(
    () => describePage(nav, { teamTab: tab, teamRemoteProject: remoteId }),
    [nav, tab, remoteId],
  );
  useEffect(() => {
    if (!configured || tab === "connection") return;
    void run(async () => {
      if (tab === "catalog") await loadCatalog();
      else {
        await loadProjects();
        if (tab === "review") await loadReview();
      }
    }).finally(() => {
      if (viewRef.current === viewKey) setLoadedView(viewKey);
    });
  }, [tab, configured, remoteId]);
  const selected = projects.find((p) => p.id === remoteId);
  const chooseProject = (
    <label className="form-field">
      远程项目
      <select
        aria-label="远程项目"
        value={remoteId}
        onChange={(e) => setRemoteId(e.target.value)}
      >
        <option value="">请选择远程项目</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · v{p.version}
          </option>
        ))}
      </select>
    </label>
  );
  const pull = async (id: string, version?: number) => {
    const result = await post<{ project: Project }>(
      `/api/team/projects/${id}/pull`,
      { version },
    );
    setState({ projects: await request("/api/projects") });
    await openProject(result.project.id);
    notify("远程版本已下载为新的本地项目");
  };
  return (
    <Modal
      title="团队与共享素材"
      subtitle="连接自己的团队服务，管理项目版本、评审和素材。"
      close={close}
    >
      <div className="modal-body team-workspace">
        <div className="team-tabs">
          {[
            ["connection", "连接"],
            ["projects", "项目"],
            ["catalog", "素材目录"],
            ["review", "版本与评审"],
            ["members", "成员"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {busy && <p className="hint">正在与团队服务同步…</p>}
        {tab === "connection" ? (
          <div className="team-connect">
            <section>
              <h3>连接团队</h3>
              <label className="form-field">
                空间名称
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="form-field">
                服务地址
                <input
                  aria-label="团队服务地址"
                  placeholder="https://team.example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <label className="form-field">
                访问凭据
                <input
                  aria-label="团队访问凭据"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    configured
                      ? "已保存在本机，留空保留"
                      : "填写管理员发给你的凭据"
                  }
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <button
                className="primary-button"
                disabled={busy || !url}
                onClick={() =>
                  void run(async () => {
                    await post("/api/team/config", {
                      name,
                      baseUrl: url,
                      ...(token ? { token } : {}),
                    });
                    setToken("");
                    await loadConfig();
                    await request("/api/team/me");
                    notify("团队连接成功");
                  })
                }
              >
                保存并测试
              </button>
            </section>
            <section>
              <h3>在这台电脑上托管</h3>
              <p>
                适合自己的设备和小团队。服务随应用退出而停止；远程服务器也可运行随项目提供的团队服务。
              </p>
              <label className="form-field">
                端口
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={lan}
                  onChange={(e) => setLan(e.target.checked)}
                />
                允许局域网连接
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await post("/api/team/host", {
                      enabled: !hosting,
                      port,
                      allowLan: lan,
                    });
                    await loadConfig();
                  })
                }
              >
                {hosting ? "停止本机服务" : "启动并连接"}
              </button>
              {lan && (
                <p className="hint">
                  其他设备使用本机局域网 IP 和此端口。邀请凭据在“成员”中创建。
                </p>
              )}
            </section>
          </div>
        ) : !configured ? (
          <p className="empty-state">先在“连接”中配置团队服务。</p>
        ) : (
          <>
            {tab === "projects" && (
              <>
                <div className="team-actions">
                  <button
                    className="primary-button"
                    disabled={busy || !project}
                    onClick={() =>
                      void run(async () => {
                        const p = getState().project!;
                        const r = await post<Remote>(
                          "/api/team/projects/push",
                          {
                            projectId: p.id,
                            expectedRevision: p.revision,
                            expectedVersion: 0,
                          },
                        );
                        setRemoteId(r.id);
                        await loadProjects();
                        notify("项目及媒体已上传");
                      })
                    }
                  >
                    共享当前项目
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void run(loadProjects)}
                  >
                    刷新项目
                  </button>
                </div>
                {projects.length === 0 && <p>还没有共享项目。</p>}
                {projects.map((p) => (
                  <article className="team-row" key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      <small>版本 {p.version}</small>
                    </div>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() => void run(() => pull(p.id))}
                      >
                        下载为新项目
                      </button>
                      <button
                        onClick={() => {
                          setRemoteId(p.id);
                          setTab("review");
                        }}
                      >
                        版本与评审
                      </button>
                    </div>
                  </article>
                ))}
              </>
            )}
            {tab === "review" && (
              <>
                {chooseProject}
                {selected && (
                  <>
                    <div className="team-actions">
                      <button
                        disabled={busy || !project}
                        onClick={() =>
                          void run(async () => {
                            const p = getState().project!;
                            await post("/api/team/projects/push", {
                              projectId: p.id,
                              expectedRevision: p.revision,
                              remoteId,
                              expectedVersion: selected.version,
                            });
                            await loadProjects();
                            await loadReview();
                            notify("新版本已上传");
                          })
                        }
                      >
                        以当前工程提交新版本
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void run(loadReview)}
                      >
                        刷新
                      </button>
                    </div>
                    <details>
                      <summary>版本历史</summary>
                      {versions.map((v) => (
                        <div className="team-row" key={v.version}>
                          <span>
                            v{v.version} ·{" "}
                            {new Date(v.updatedAt).toLocaleString()}
                          </span>
                          <button
                            onClick={() =>
                              void run(() => pull(remoteId, v.version))
                            }
                          >
                            下载此版本
                          </button>
                        </div>
                      ))}
                    </details>
                    <section className="team-share">
                      <h3>分享评审</h3>
                      <label className="form-field">
                        附带视频
                        <select
                          value={exportId}
                          onChange={(e) => setExportId(e.target.value)}
                        >
                          <option value="">仅工程版本与评论</option>
                          {exports
                            .filter((e) => e.filename.endsWith(".mp4"))
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name || e.filename}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="form-field">
                        有效天数
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={days}
                          onChange={(e) => setDays(Number(e.target.value))}
                        />
                      </label>
                      <button
                        disabled={busy || !project}
                        onClick={() =>
                          void run(async () => {
                            await post(
                              `/api/team/projects/${remoteId}/reviews`,
                              {
                                days,
                                localProjectId: project!.id,
                                ...(exportId ? { exportId } : {}),
                              },
                            );
                            await loadReview();
                          })
                        }
                      >
                        创建评审链接
                      </button>
                      {reviews
                        .filter((r) => r.remoteId === remoteId)
                        .map((r) => (
                          <div className="team-row" key={r.id}>
                            <a href={r.url} target="_blank" rel="noreferrer">
                              打开评审 ·{" "}
                              {new Date(r.expiresAt).toLocaleDateString()} 到期
                            </a>
                            <button
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(r.url)
                                  .then(() => notify("链接已复制"))
                              }
                            >
                              复制
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await request(
                                    `/api/team/projects/${remoteId}/reviews/${r.id}`,
                                    { method: "DELETE" },
                                  );
                                  await loadReview();
                                })
                              }
                            >
                              撤销
                            </button>
                          </div>
                        ))}
                    </section>
                    <h3>评审意见</h3>
                    <textarea
                      aria-label="评审意见"
                      placeholder={`在播放头 ${frame} 帧留下意见`}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <button
                      disabled={busy || !comment.trim()}
                      onClick={() =>
                        void run(async () => {
                          await post(
                            `/api/team/projects/${remoteId}/comments`,
                            {
                              text: comment,
                              frame: Math.floor(frame),
                              timelineId: project
                                ? activeTimeline(project).id
                                : undefined,
                              version: selected.version,
                            },
                          );
                          setComment("");
                          await loadReview();
                        })
                      }
                    >
                      添加意见
                    </button>
                    {comments.map((c) => (
                      <article className="team-comment" key={c.id}>
                        <strong>
                          {c.author} · v{c.version} · {c.frame ?? 0} 帧
                        </strong>
                        <p>{c.text}</p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await post(
                                `/api/team/projects/${remoteId}/comments/${c.id}/resolve`,
                                { resolved: !c.resolved },
                              );
                              await loadReview();
                            })
                          }
                        >
                          {c.resolved ? "重新打开" : "标记解决"}
                        </button>
                      </article>
                    ))}
                  </>
                )}
              </>
            )}
            {tab === "members" && (
              <>
                <h3>成员</h3>
                <div className="team-actions">
                  <input
                    aria-label="新成员名称"
                    placeholder="成员姓名"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                  />
                  <button
                    disabled={busy || !memberName.trim()}
                    onClick={() =>
                      void run(async () => {
                        await post("/api/team/members", {
                          name: memberName,
                          role: "member",
                        });
                        setMemberName("");
                        await loadProjects();
                      })
                    }
                  >
                    创建成员
                  </button>
                </div>
                {members.map((m) => (
                  <div className="team-row" key={m.id}>
                    <span>
                      {m.name} · {m.role}
                    </span>
                    {m.id !== "admin" && (
                      <>
                        <button
                          onClick={() =>
                            void run(async () => {
                              const value = await request<{ token: string }>(
                                `/api/team/invites/${m.id}`,
                              );
                              await navigator.clipboard.writeText(value.token);
                              notify("邀请凭据已复制，交给该成员即可");
                            })
                          }
                        >
                          复制本机创建的邀请
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await request(`/api/team/members/${m.id}`, {
                                method: "DELETE",
                              });
                              await loadProjects();
                            })
                          }
                        >
                          移除
                        </button>
                      </>
                    )}
                  </div>
                ))}
                <h3>项目权限</h3>
                {chooseProject}
                <select
                  aria-label="项目成员"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                >
                  <option value="">选择成员</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="项目权限"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="viewer">只读</option>
                  <option value="editor">可编辑</option>
                  <option value="remove">移除权限</option>
                </select>
                <button
                  disabled={busy || !remoteId || !memberId}
                  onClick={() =>
                    void run(async () => {
                      await post(`/api/team/projects/${remoteId}/members`, {
                        memberId,
                        role,
                      });
                      await loadProjects();
                      notify("权限已更新");
                    })
                  }
                >
                  保存权限
                </button>
              </>
            )}
            {tab === "catalog" && (
              <>
                <div className="team-actions">
                  <select
                    aria-label="共享素材类型"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="template">模板</option>
                    <option value="sticker">贴纸</option>
                    <option value="audio">音频</option>
                  </select>
                  <input
                    placeholder="搜索团队素材"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button disabled={busy} onClick={() => void run(loadCatalog)}>
                    搜索
                  </button>
                </div>
                <details>
                  <summary>发布到共享素材库</summary>
                  <label className="form-field">
                    名称
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  {kind !== "template" && (
                    <label className="form-field">
                      素材
                      <select
                        value={assetId}
                        onChange={(e) => setAssetId(e.target.value)}
                      >
                        <option value="">请选择</option>
                        {project?.assets
                          .filter((a) =>
                            kind === "audio"
                              ? a.kind === "audio"
                              : ["image", "motion"].includes(a.kind),
                          )
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className="form-field">
                    描述
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    授权说明
                    <input
                      placeholder="填写素材实际许可证或使用范围"
                      value={license}
                      onChange={(e) => setLicense(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !project || !title || !license}
                    onClick={() =>
                      void run(async () => {
                        const p = getState().project!;
                        await post("/api/team/catalog", {
                          projectId: p.id,
                          expectedRevision: p.revision,
                          title,
                          kind,
                          description,
                          license,
                          ...(kind !== "template" ? { assetId } : {}),
                        });
                        await loadCatalog();
                        notify("条目已发布");
                      })
                    }
                  >
                    {kind === "template" ? "发布当前工程为模板" : "发布素材"}
                  </button>
                </details>
                {!catalog.length && (
                  <p className="empty-state">
                    目录还没有匹配的条目。发布后团队成员即可搜索和导入。
                  </p>
                )}
                {catalog.map((c) => (
                  <article className="team-row" key={c.id}>
                    <div>
                      <strong>{c.title}</strong>
                      <p>{c.description}</p>
                      <small>{c.license}</small>
                    </div>
                    <button
                      disabled={busy || !project}
                      onClick={() =>
                        void run(async () => {
                          const p = getState().project!;
                          const result = await post<{
                            project: Project;
                            created?: boolean;
                          }>(`/api/team/catalog/${c.id}/import`, {
                            projectId: p.id,
                            expectedRevision: p.revision,
                          });
                          if (result.created) {
                            setState({
                              projects: await request("/api/projects"),
                            });
                            await openProject(result.project.id);
                          } else setState({ project: result.project });
                          notify("已导入共享条目");
                        })
                      }
                    >
                      导入
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await request(`/api/team/catalog/${c.id}`, {
                            method: "DELETE",
                          });
                          await loadCatalog();
                        })
                      }
                    >
                      移除
                    </button>
                  </article>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
