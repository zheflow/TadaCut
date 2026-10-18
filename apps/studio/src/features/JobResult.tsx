import { activeTimeline } from "@tadacut/domain";
import { commit, notify, setState, useStudio } from "../lib/store";
import type { Job } from "../lib/api";
export function JobResult({ job }: { job: Job }) {
  const p = useStudio((s) => s.project),
    result = job.result;
  if (!result) return null;
  return (
    <div className="job-result">
      {Array.isArray(result.warnings) &&
        result.warnings.map((warning: string, i: number) => (
          <p className="hint" key={i}>
            {warning}
          </p>
        ))}
      {job.kind === "process-media" &&
        result.url &&
        (/\.(wav|mp3|m4a|ogg)$/i.test(result.url) ? (
          <audio
            className="processing-preview"
            controls
            src={result.previewUrl ?? result.url}
            preload="metadata"
          />
        ) : (
          <video
            className="processing-preview"
            controls
            muted
            src={result.previewUrl ?? result.url}
            preload="metadata"
          />
        ))}
      {job.kind === "process-media" && (
        <p>
          {result.cached ? "已复用有效缓存。" : ""}候选结果就绪，应用后可撤销。
        </p>
      )}

      {typeof result.rmsDb === "number" && (
        <div className="analysis-metrics">
          <span>
            RMS <strong>{result.rmsDb.toFixed(1)} dBFS</strong>
          </span>
          <span>
            峰值{" "}
            <strong>
              {(20 * Math.log10(Math.max(result.peak, 1e-9))).toFixed(1)} dBFS
            </strong>
          </span>
          <span>
            静音 <strong>{result.silence?.length ?? 0} 段</strong>
          </span>
          <span>
            节拍{" "}
            <strong>
              {result.beats?.bpm
                ? `${result.beats.bpm} BPM · ${(result.beats.confidence * 100).toFixed(0)}%`
                : "未检测到可靠周期"}
            </strong>
          </span>
        </div>
      )}
      {result.beats?.beats?.length > 0 && (
        <button
          className="text-button"
          onClick={async () => {
            if (!p || p.id !== job.projectId) {
              notify("先打开对应项目");
              return;
            }
            const t = activeTimeline(p),
              source = t.clips.find((c) => c.assetId === job.input.assetId);
            if (!source) {
              notify("先把此音频放到时间线");
              return;
            }
            const frames = result.beats.beats
              .map((seconds: number) =>
                Math.round(
                  source.start +
                    ((seconds - source.sourceOffset) / source.speed) * t.fps,
                ),
              )
              .filter(
                (f: number) =>
                  f >= source.start && f < source.start + source.duration,
              )
              .slice(0, 400);
            if (frames.length)
              await commit(
                frames.map((frame: number, i: number) => ({
                  type: "marker.add",
                  timelineId: t.id,
                  marker: {
                    id: crypto.randomUUID(),
                    frame,
                    label: `节拍 ${i + 1}`,
                    color: "#c9bc80",
                  },
                })),
                "添加节拍标记",
              );
          }}
        >
          把节拍标到时间线
        </button>
      )}
      {result.alignment && (
        <p>
          机位偏移 {result.alignment.offsetSeconds.toFixed(3)} 秒 · 相关性{" "}
          {(result.alignment.confidence * 100).toFixed(1)}%
        </p>
      )}
      {result.indexed !== undefined && <p>已索引 {result.indexed} 个素材</p>}
      {result.words !== undefined && <p>已识别 {result.words} 个词</p>}
      {result.voice_id && (
        <p>
          新音色 ID：<code>{result.voice_id}</code>
        </p>
      )}
      {result.summary && <p>{result.summary}</p>}
      {result.message && <p>{result.message}</p>}
      {result.usage && (
        <p>
          {result.usage.reported
            ? `输入 ${result.usage.input} · 输出 ${result.usage.output} tokens`
            : "该运行时未报告 token 用量"}
        </p>
      )}
      {result.proposalId && (
        <button
          className="secondary-button"
          onClick={() => setState({ nav: "studio", panel: "agent" })}
        >
          查看剪辑提案
        </button>
      )}
    </div>
  );
}
