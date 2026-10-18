import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type {
  RuntimeId,
  RuntimeStatus,
} from "../../../server/src/runtime-status";
import { post, request } from "../lib/api";
import { getState, setState, useStudio } from "../lib/store";

let loading: Promise<void> | null = null;
export function RuntimeConnection({
  id,
  details = false,
}: {
  id: RuntimeId;
  details?: boolean;
}) {
  const status = useStudio((s) =>
    s.runtimes.find((runtime) => runtime.id === id),
  );
  const [checking, setChecking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!loading && !getState().runtimes.length)
      loading = request<RuntimeStatus[]>("/api/agent/runtimes")
        .then((runtimes) => {
          setState({ runtimes });
        })
        .finally(() => {
          loading = null;
        });
    void loading?.catch(() => setError("无法读取运行时状态"));
  }, []);
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      const checked = await post<RuntimeStatus>(
        `/api/agent/runtimes/${id}/check`,
        {},
      );
      setState({
        runtimes: [
          ...getState().runtimes.filter((runtime) => runtime.id !== id),
          checked,
        ],
      });
    } catch {
      setError("检测未完成，请确认本机服务正在运行");
    } finally {
      setChecking(false);
    }
  };
  return (
    <div
      className={`runtime-connection ${status?.state ?? "unverified"}`}
      data-runtime={id}
    >
      <div>
        {details && (
          <strong>
            {id === "codex"
              ? "Codex"
              : id === "claude"
                ? "Claude Code"
                : "GitHub Copilot"}
          </strong>
        )}
        <span>{error || status?.message || "正在读取运行时状态…"}</span>
        {details && status?.path && <code>{status.path}</code>}
        {status?.version && <small>版本 {status.version}</small>}
      </div>
      <button
        className="text-button"
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? (
          <LoaderCircle className="spin" size={11} />
        ) : (
          <RefreshCw size={11} />
        )}
        {checking ? "检测中" : id === "codex" ? "检测连接" : "检测安装"}
      </button>
    </div>
  );
}
