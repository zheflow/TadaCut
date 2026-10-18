import { useRef, useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import type { Project } from "@tadacut/domain";
import { post, request } from "../lib/api";
import {
  importFiles,
  notify,
  openProject,
  setState,
  useStudio,
} from "../lib/store";
import { Modal } from "./Pages";

/** Async agent requests prepare an entry point; the user gesture opens the OS picker. */
export function FileRequest() {
  const target = useStudio((s) => s.fileRequest),
    project = useStudio((s) => s.project);
  const input = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false);
  if (!target || !project) return null;
  const close = () => setState({ fileRequest: null });
  const names: Record<string, string> = {
    media: "导入素材",
    project: "导入工程",
    skill: "导入技能",
    extension: "安装扩展包",
    directory: "关联素材文件夹",
    relink: "重连素材",
  };
  const accept: Record<string, string> = {
    media: "image/*,video/*,audio/*,.cube",
    project: ".tadacut,.json,.edl,.fcpxml,.xml",
    skill: ".md",
    extension: ".json",
    relink: "image/*,video/*,audio/*",
  };
  return (
    <Modal
      title={names[target.kind]}
      subtitle="选择本机文件后继续"
      close={close}
    >
      <div className="modal-body file-request">
        <FolderOpen size={28} />
        <p>
          {target.kind === "directory"
            ? "选择要自动导入素材的文件夹。"
            : "选择你要交给当前项目使用的文件。"}
        </p>
        <button
          className="primary-button"
          disabled={busy || (target.kind === "directory" && !window.tadacut)}
          onClick={async () => {
            if (target.kind !== "directory") {
              input.current?.click();
              return;
            }
            const directory = await window.tadacut?.chooseDirectory();
            if (!directory) return;
            setBusy(true);
            try {
              await post(`/api/projects/${project.id}/watches`, { directory });
              notify("文件夹已关联");
              close();
            } catch (e) {
              notify(String(e), true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload size={14} />
          {target.kind === "directory" ? "选择文件夹" : "选择文件"}
        </button>
        {target.kind === "directory" && !window.tadacut && (
          <p>关联文件夹需要桌面版。</p>
        )}
        <input
          ref={input}
          type="file"
          hidden
          multiple={target.kind === "media"}
          accept={accept[target.kind]}
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (!files.length) return;
            setBusy(true);
            try {
              if (target.kind === "media") {
                if (!(await importFiles(files, project.id))) return;
              } else if (target.kind === "skill")
                await post("/api/skills/import", {
                  markdown: await files[0].text(),
                });
              else {
                const form = new FormData();
                form.append("file", files[0]);
                if (target.kind === "project") {
                  const p = await request<Project>("/api/projects/import", {
                    method: "POST",
                    body: form,
                  });
                  await openProject(p.id);
                } else if (target.kind === "extension")
                  await request("/api/plugins/install", {
                    method: "POST",
                    body: form,
                  });
                else if (target.kind === "relink") {
                  if (!project.assets.some((a) => a.id === target.assetId))
                    throw new Error("请先选择要重连的素材");
                  await request(
                    `/api/projects/${project.id}/assets/${target.assetId}/relink`,
                    { method: "POST", body: form },
                  );
                }
              }
              notify(`${names[target.kind]}已完成`);
              close();
            } catch (e) {
              notify(String(e), true);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Modal>
  );
}
