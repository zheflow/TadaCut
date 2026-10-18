import { useEffect, useRef, useState } from "react";
import { FolderSync, Link, Plus, Search, Trash2 } from "lucide-react";
import { activeTimeline } from "@tadacut/domain";
import { post, request } from "../lib/api";
import { commit, getState, notify, setState, useStudio } from "../lib/store";
export function FolderWatches() {
  const p = useStudio((s) => s.project)!,
    [watches, setWatches] = useState<any[]>([]);
  const refresh = () =>
    request<any[]>(`/api/projects/${p.id}/watches`)
      .then(setWatches)
      .catch((e) => notify(String(e), true));
  useEffect(() => {
    void refresh();
  }, [p.id]);
  return (
    <section className="folder-watches">
      <div className="section-title">
        <FolderSync size={16} />
        <h3>素材文件夹</h3>
        <button
          className="text-button"
          disabled={!window.tadacut}
          onClick={async () => {
            const directory = await window.tadacut?.chooseDirectory();
            if (!directory) return;
            try {
              await post(`/api/projects/${p.id}/watches`, { directory });
              await refresh();
              notify("文件夹已关联，新素材会自动导入");
            } catch (e) {
              notify(String(e), true);
            }
          }}
        >
          <Plus size={13} />
          关联文件夹
        </button>
      </div>
      {watches.map((w) => (
        <div className="memory-card" key={w.id}>
          <span>
            {w.directory}
            <small>{w.error ?? `已处理 ${w.imported} 个文件`}</small>
          </span>
          <button
            className="icon-button"
            title="停止监听"
            onClick={async () => {
              await request(`/api/watches/${w.id}`, { method: "DELETE" });
              await refresh();
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {!watches.length && (
        <p className="small-description">
          桌面版可以关联素材目录；文件内容按哈希去重，新增文件自动进入项目。
        </p>
      )}
    </section>
  );
}
export function SemanticSearch() {
  const p = useStudio((s) => s.project)!,
    providers = useStudio((s) => s.providers),
    [query, setQuery] = useState(""),
    [providerId, setProviderId] = useState(""),
    [results, setResults] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <section className="semantic-search">
      <h3>按意思找素材</h3>
      <div className="button-group">
        <input
          placeholder="例如：安静、城市日落、人物特写"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="搜索模型"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          <option value="">名称与标签</option>
          {providers
            .filter((p) => p.capabilities.includes("embedding"))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          className="secondary-button"
          disabled={!query || busy}
          onClick={async () => {
            setBusy(true);
            try {
              setResults(
                await post(`/api/projects/${p.id}/search`, {
                  query,
                  providerId: providerId || undefined,
                }),
              );
            } catch (e) {
              notify(String(e), true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Search size={13} />
          查找
        </button>
      </div>
      {results && (
        <div className="search-results">
          {results.length ? (
            results.map((r) => (
              <button
                className="memory-card"
                key={r.asset.id}
                onClick={() => {
                  setState({
                    selectedAssetId: r.asset.id,
                    nav: "studio",
                    mode: "edit",
                  });
                }}
              >
                <strong>{r.asset.name}</strong>
                <small>相似度 {r.score.toFixed(3)}</small>
              </button>
            ))
          ) : (
            <p className="small-description">
              没有匹配结果。语义查找前，请在创作工具中建立语义索引。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
export function RelinkButton({ assetId }: { assetId: string }) {
  const p = useStudio((s) => s.project)!,
    input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className="text-button"
        title="重连本地源文件"
        onClick={() => input.current?.click()}
      >
        <Link size={12} />
        重连
      </button>
      <input
        hidden
        type="file"
        ref={input}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const form = new FormData();
          form.append("file", file);
          try {
            await request(`/api/projects/${p.id}/assets/${assetId}/relink`, {
              method: "POST",
              body: form,
            });
            notify("素材已重连，时间线引用已保留");
          } catch (e) {
            notify(String(e), true);
          }
        }}
      />
    </>
  );
}
export function MulticamControls() {
  const p = useStudio((s) => s.project)!,
    t = activeTimeline(p);
  return (
    <>
      {t.multicam.map((g) => (
        <div className="multicam-bar" key={g.id}>
          <span>{g.name}</span>
          {g.cameraClipIds.map((id, i) => (
            <button
              className="secondary-button"
              key={id}
              onClick={() =>
                void commit(
                  [
                    {
                      type: "multicam.switch",
                      timelineId: t.id,
                      groupId: g.id,
                      // Read at click time so live switching during playback does not re-render every frame.
                      frame: Math.round(getState().playhead),
                      clipId: id,
                    },
                  ],
                  "切换机位",
                )
              }
            >
              机位 {i + 1}
            </button>
          ))}
          <button
            className="text-button"
            onClick={() =>
              void commit(
                [{ type: "multicam.remove", timelineId: t.id, groupId: g.id }],
                "解除机位组",
              )
            }
          >
            解除
          </button>
        </div>
      ))}
    </>
  );
}
