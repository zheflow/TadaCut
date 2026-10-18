import { useEffect, useRef, useState } from "react";
import {
  canvasNodeSchema,
  canvasRelations,
  type Project,
  type Command,
} from "@tadacut/domain";
import { askText, commit, setState, useStudio } from "../lib/store";
import { describePage } from "../lib/studio-control";
type Node = Project["canvas"][number];
const names: Record<Node["kind"], string> = {
  note: "笔记",
  asset: "素材",
  entity: "设定",
  shot: "分镜",
  group: "分组",
  audio: "音频",
  video: "视频",
  image: "图片",
  character: "角色",
  scene: "场景",
  prop: "道具",
};
export function CanvasWorkspace() {
  const p = useStudio((s) => s.project)!;
  const [selection, setSelection] = useState<string[]>([]),
    [kind, setKind] = useState<Node["kind"]>("note"),
    [draft, setDraft] = useState<Record<string, { x: number; y: number }>>({}),
    [linkTo, setLinkTo] = useState("");
  const selected = p.canvas.find((n) => n.id === selection[0]);
  const board = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      describePage("studio", {
        canvasNodeIds: JSON.stringify(selection),
        canvasNodeType: selected?.kind ?? "",
        canvasNodeLabel: selected?.label ?? "",
      }),
    [selection.join(","), selected?.kind, selected?.label],
  );
  const add = async () => {
    const label = await askText(`添加${names[kind]}`, names[kind]);
    if (!label) return;
    const node = canvasNodeSchema.parse({
      id: crypto.randomUUID(),
      kind,
      x: 80 + (p.canvas.length % 5) * 65,
      y: 80 + Math.floor(p.canvas.length / 5) * 80,
      label,
    });
    await commit([{ type: "canvas.upsert", node }], "添加画布节点");
    setSelection([node.id]);
  };
  const patch = (node: Node) =>
    void commit([{ type: "canvas.upsert", node }], "更新画布节点");
  const descendants = (ids: string[]) => {
    const result = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of p.canvas)
        if (n.parentId && result.has(n.parentId) && !result.has(n.id)) {
          result.add(n.id);
          changed = true;
        }
    }
    return result;
  };
  const setMedia = (assetId: string) => {
    if (!selected) return;
    const history = [...(selected.history ?? [])];
    if (
      selected.referenceId &&
      p.assets.some((a) => a.id === selected.referenceId)
    )
      history.push({
        assetId: selected.referenceId,
        at: new Date().toISOString(),
        reason: "替换素材",
      });
    patch({
      ...selected,
      referenceId: assetId || undefined,
      history: history.slice(-200),
    });
  };
  const group = async () => {
    if (!selection.length) return;
    const label = await askText("分组名称", "新分组");
    if (!label) return;
    const nodes = p.canvas.filter((n) => selection.includes(n.id));
    const id = crypto.randomUUID(),
      node = canvasNodeSchema.parse({
        id,
        kind: "group",
        label,
        x: Math.max(0, Math.min(...nodes.map((n) => n.x)) - 30),
        y: Math.max(0, Math.min(...nodes.map((n) => n.y)) - 55),
      });
    await commit(
      [
        { type: "canvas.upsert", node },
        ...nodes.map((n) => ({
          type: "canvas.upsert" as const,
          node: { ...n, parentId: id },
        })),
      ],
      "画布分组",
    );
    setSelection([id]);
  };
  const assetFor = (n: Node) => {
    const shot = p.story.shots.find((s) => s.id === n.referenceId),
      entity = p.story.entities.find((e) => e.id === n.referenceId);
    return p.assets.find(
      (a) =>
        a.id ===
        (shot?.assetId ?? entity?.referenceAssetIds[0] ?? n.referenceId),
    );
  };
  return (
    <div className="canvas-workspace">
      <div className="story-header">
        <div>
          <span className="eyebrow">IDEAS WITH CONTEXT</span>
          <h1>创作画布</h1>
          <p>关联素材、设定和分镜，保留每次素材选择的历史。</p>
        </div>
        <div className="team-actions">
          <select
            aria-label="画布节点类型"
            value={kind}
            onChange={(e) => setKind(e.target.value as Node["kind"])}
          >
            {Object.entries(names).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="primary-button" onClick={() => void add()}>
            添加节点
          </button>
          <button disabled={!selection.length} onClick={() => void group()}>
            所选编组
          </button>
        </div>
      </div>
      <div className="canvas-layout">
        <div
          className="canvas-board"
          ref={board}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelection([]);
          }}
        >
          <svg className="canvas-connections" width="2400" height="1800">
            {p.canvas.flatMap((n) =>
              (n.references ?? []).flatMap((id) => {
                const other = p.canvas.find((x) => x.id === id);
                if (!other) return [];
                const a = draft[n.id] ?? n,
                  b = draft[id] ?? other;
                return [
                  <path
                    key={n.id + id}
                    d={`M${a.x + 238} ${a.y + 70} C${a.x + 300} ${a.y + 70},${b.x - 60} ${b.y + 70},${b.x} ${b.y + 70}`}
                    fill="none"
                    stroke="#d995ae"
                    strokeWidth="2"
                  />,
                ];
              }),
            )}
          </svg>
          {p.canvas.map((n) => {
            const asset = assetFor(n),
              pos = draft[n.id] ?? n,
              chosen = selection.includes(n.id);
            return (
              <article
                key={n.id}
                tabIndex={0}
                aria-label={`${names[n.kind]}：${n.label}`}
                className={`canvas-node ${n.kind} ${chosen ? "selected" : ""}`}
                style={{ left: pos.x, top: pos.y }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelection([n.id]);
                }}
                onPointerDown={(e) => {
                  if (
                    (e.target as HTMLElement).closest(
                      "button,a,input,select,video,audio",
                    )
                  )
                    return;
                  e.stopPropagation();
                  const ids =
                    e.shiftKey || e.metaKey || e.ctrlKey
                      ? chosen
                        ? selection.filter((id) => id !== n.id)
                        : [...selection, n.id]
                      : chosen
                        ? selection
                        : [n.id];
                  setSelection(ids);
                  if (!ids.includes(n.id)) return;
                  const moving = descendants(ids),
                    initial = { x: e.clientX, y: e.clientY };
                  let final: Record<string, { x: number; y: number }> = {};
                  const move = (event: PointerEvent) => {
                    final = Object.fromEntries(
                      p.canvas
                        .filter((x) => moving.has(x.id))
                        .map((x) => [
                          x.id,
                          {
                            x: Math.max(0, x.x + event.clientX - initial.x),
                            y: Math.max(0, x.y + event.clientY - initial.y),
                          },
                        ]),
                    );
                    setDraft(final);
                  };
                  const end = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", end);
                    setDraft({});
                    const commands: Command[] = p.canvas
                      .filter(
                        (x) =>
                          final[x.id] &&
                          (final[x.id].x !== x.x || final[x.id].y !== x.y),
                      )
                      .map((x) => ({
                        type: "canvas.upsert",
                        node: { ...x, ...final[x.id] },
                      }));
                    if (commands.length) void commit(commands, "移动画布节点");
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", end, { once: true });
                }}
              >
                <header>
                  <small>{names[n.kind]}</small>
                  <span>{n.label}</span>
                  <button title="选择节点" onClick={() => setSelection([n.id])}>
                    •••
                  </button>
                </header>
                {asset?.kind === "image" && (
                  <img src={asset.url} alt={asset.name} />
                )}{" "}
                {asset?.kind === "video" && (
                  <video
                    src={asset.proxy?.url ?? asset.url}
                    muted
                    controls
                    preload="metadata"
                  />
                )}
                {asset?.kind === "audio" && (
                  <audio src={asset.url} controls preload="metadata" />
                )}
                {n.kind === "group" ? (
                  <p>
                    {p.canvas.filter((x) => x.parentId === n.id).length}{" "}
                    个直属节点
                  </p>
                ) : (
                  <p>{asset?.name ?? n.label}</p>
                )}
                {n.parentId && (
                  <small>
                    属于 {p.canvas.find((x) => x.id === n.parentId)?.label}
                  </small>
                )}
              </article>
            );
          })}
        </div>
        <aside className="canvas-details">
          {selected ? (
            <>
              <h3>{names[selected.kind]}</h3>
              <label className="form-field">
                节点名称
                <input
                  value={selected.label}
                  onChange={(e) =>
                    patch({ ...selected, label: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                所属分组
                <select
                  value={selected.parentId ?? ""}
                  onChange={(e) =>
                    patch({
                      ...selected,
                      parentId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">不分组</option>
                  {p.canvas
                    .filter(
                      (n) =>
                        n.kind === "group" &&
                        !descendants([selected.id]).has(n.id),
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                </select>
              </label>
              {selected.kind !== "group" && selected.kind !== "note" && (
                <label className="form-field">
                  引用对象
                  <select
                    aria-label="节点引用对象"
                    value={selected.referenceId ?? ""}
                    onChange={(e) => setMedia(e.target.value)}
                  >
                    <option value="">无</option>
                    {(["entity", "character", "scene", "prop"].includes(
                      selected.kind,
                    )
                      ? p.story.entities
                          .filter(
                            (e) =>
                              selected.kind === "entity" ||
                              e.kind === selected.kind,
                          )
                          .map((e) => ({ id: e.id, name: e.name }))
                      : selected.kind === "shot"
                        ? p.story.shots.map((s) => ({
                            id: s.id,
                            name: s.title,
                          }))
                        : p.assets.filter(
                            (a) =>
                              !["image", "video", "audio"].includes(
                                selected.kind,
                              ) || a.kind === selected.kind,
                          )
                    ).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <h4>节点关联</h4>
              <select
                aria-label="关联其他节点"
                value={linkTo}
                onChange={(e) => setLinkTo(e.target.value)}
              >
                <option value="">选择节点</option>
                {p.canvas
                  .filter((n) => n.id !== selected.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
              </select>
              <button
                disabled={!linkTo}
                onClick={() =>
                  patch({
                    ...selected,
                    references: [
                      ...new Set([...(selected.references ?? []), linkTo]),
                    ],
                  })
                }
              >
                添加引用
              </button>
              {(selected.references ?? []).map((id) => (
                <div className="team-row" key={id}>
                  <button onClick={() => setSelection([id])}>
                    {p.canvas.find((n) => n.id === id)?.label}
                  </button>
                  <button
                    onClick={() =>
                      patch({
                        ...selected,
                        references: selected.references?.filter(
                          (x) => x !== id,
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              <h4>使用位置</h4>
              {canvasRelations(p, selected.id).clips.map((c) => (
                <button
                  key={c.clipId}
                  onClick={() => {
                    if (p.activeTimelineId !== c.timelineId)
                      void commit(
                        [
                          {
                            type: "timeline.activate",
                            timelineId: c.timelineId,
                          },
                        ],
                        "打开时间线",
                      );
                    setState({ mode: "edit", selectedClipIds: [c.clipId] });
                  }}
                >
                  前往时间线片段
                </button>
              ))}
              <h4>素材历史</h4>
              {(selected.history ?? []).map((h, i) => (
                <div className="team-row" key={i}>
                  <span>
                    {p.assets.find((a) => a.id === h.assetId)?.name ?? "素材"}
                    <small>{new Date(h.at).toLocaleString()}</small>
                  </span>
                  <button onClick={() => setMedia(h.assetId)}>恢复</button>
                </div>
              ))}
              <h4>被引用</h4>
              {canvasRelations(p, selected.id).referencedBy.map((n) => (
                <button key={n.id} onClick={() => setSelection([n.id])}>
                  {n.label}
                </button>
              ))}
              <button
                className="text-button danger"
                onClick={() =>
                  void commit(
                    selection.map((nodeId) => ({
                      type: "canvas.remove",
                      nodeId,
                    })),
                    "移除画布节点",
                  )
                }
              >
                移除所选 {selection.length} 个节点
              </button>
            </>
          ) : (
            <p>
              选择一个或多个节点。按住 Shift
              多选；分组可以整体拖动。助手会感知当前选择。
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
