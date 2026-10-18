import { useEffect, useRef, useState } from "react";
import {
  Aperture,
  ArrowUpRight,
  Bell,
  ChevronDown,
  Clapperboard,
  Command,
  Download,
  Folder,
  FolderOpen,
  Layers,
  LayoutGrid,
  LoaderCircle,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Puzzle,
  Settings2,
  Sparkles,
  Sun,
  UserRound,
  Workflow,
} from "lucide-react";
import {
  bootstrap,
  importFiles,
  remember,
  setState,
  useStudio,
} from "../lib/store";
import { AgentPanel } from "../features/AgentPanel";
import { FileRequest } from "../features/FileRequest";
import { SakuraDecor } from "./SakuraDecor";
import { Workspace } from "../features/Workspace";
import {
  ModelsView,
  ProjectsView,
  LibraryView,
  SkillsView,
  TasksView,
  SettingsView,
} from "../features/Pages";
import { AskDialog, Dialogs } from "../features/Dialogs";
import { ExtensionsView } from "../features/Manage";
import { setTheme, shownTheme, watchTheme } from "../lib/theme";
const navigation = [
  { id: "studio", name: "工作台", icon: Clapperboard },
  { id: "projects", name: "项目", icon: FolderOpen },
  { id: "library", name: "素材", icon: Layers },
  { id: "models", name: "模型", icon: Aperture },
  { id: "skills", name: "技能", icon: Workflow },
  { id: "extensions", name: "扩展", icon: Puzzle },
  { id: "tasks", name: "任务", icon: LayoutGrid },
] as const;
let booted = false;
export function App() {
  const nav = useStudio((s) => s.nav),
    project = useStudio((s) => s.project),
    loading = useStudio((s) => s.loading),
    connected = useStudio((s) => s.connected),
    busy = useStudio((s) => s.busy),
    toast = useStudio((s) => s.toast),
    jobs = useStudio((s) => s.jobs),
    theme = useStudio((s) => s.theme),
    assistantOpen = useStudio((s) => s.assistantOpen),
    sakuraEffects = useStudio((s) => s.sakuraEffects);
  const input = useRef<HTMLInputElement>(null),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!booted) {
      booted = true;
      watchTheme();
      void bootstrap();
    }
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        input.current?.click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const running = jobs.filter((j) =>
    ["running", "queued"].includes(j.status),
  ).length;
  return (
    <div className="app-shell" data-sakura-effects={sakuraEffects}>
      <SakuraDecor />
      <aside className="navigation">
        <button
          className="brand-symbol"
          title="TadaCut 工作台"
          onClick={() => setState({ nav: "studio" })}
        >
          <i />
          <i />
          <i />
        </button>
        <div className="nav-items">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${nav === item.id ? "active" : ""}`}
              onClick={() => setState({ nav: item.id })}
              title={item.name}
            >
              <item.icon size={21} />
              <span>{item.name}</span>
              {item.id === "tasks" && running > 0 && (
                <b className="nav-badge">{running}</b>
              )}
            </button>
          ))}
        </div>
        <div className="nav-bottom">
          <button
            className={`nav-item ${nav === "settings" ? "active" : ""}`}
            onClick={() => setState({ nav: "settings" })}
          >
            <Settings2 size={20} />
            <span>设置</span>
          </button>
          <button
            className="avatar"
            title="本地创作空间"
            aria-label="本地创作空间"
            onClick={() => setState({ nav: "settings" })}
          >
            <UserRound size={16} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="wordmark">
            Tada<span>Cut</span>
            <small>STUDIO</small>
          </div>
          <div className="header-divider" />
          <div className="project-selector">
            <button className="project-name" onClick={() => setMenu(!menu)}>
              <Folder size={15} />
              {project?.name ?? "创作空间"}
              <ChevronDown size={13} />
            </button>
            {project?.id === "demo-city" && (
              <span className="quiet-badge">示例项目</span>
            )}
            {menu && (
              <div className="dropdown">
                <button
                  onClick={() => {
                    setMenu(false);
                    setState({ nav: "projects" });
                  }}
                >
                  <FolderOpen size={15} />
                  打开项目
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    setState({ modal: "project" });
                  }}
                >
                  <Plus size={15} />
                  新建项目
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    input.current?.click();
                  }}
                >
                  <Download size={15} />
                  导入素材
                </button>
              </div>
            )}
          </div>
          <div className="topbar-spacer" />
          <span className="save-state">
            <i className={busy ? "saving" : ""} />
            {busy ? "正在保存" : connected ? "已保存到本机" : "连接中"}
          </span>
          <button
            className="icon-button"
            title={shownTheme(theme) === "dark" ? "切换到浅色" : "切换到深色"}
            aria-label="切换浅色或深色外观"
            onClick={() =>
              setTheme(shownTheme(theme) === "dark" ? "light" : "dark")
            }
          >
            {shownTheme(theme) === "dark" ? (
              <Sun size={17} />
            ) : (
              <Moon size={17} />
            )}
          </button>
          <button
            className="icon-button"
            title="任务与通知"
            onClick={() => setState({ nav: "tasks" })}
          >
            <Bell size={17} />
            {running > 0 && <i className="notification-dot" />}
          </button>
          <button
            className={`assistant-toggle ${assistantOpen ? "active" : ""}`}
            aria-label={assistantOpen ? "收起创作助手" : "展开创作助手"}
            aria-expanded={assistantOpen}
            aria-controls="global-assistant"
            onClick={() => {
              remember("tadacut-assistant-open", !assistantOpen);
              setState({ assistantOpen: !assistantOpen });
            }}
          >
            {assistantOpen ? (
              <PanelRightClose size={16} />
            ) : (
              <PanelRightOpen size={16} />
            )}
            <span>创作助手</span>
          </button>
          <button
            className="export-button"
            onClick={() => setState({ modal: "export" })}
            disabled={!project}
          >
            <ArrowUpRight size={16} />
            导出
          </button>
        </header>
        <div className="app-body">
          <main className="main-content">
            {loading && !project ? (
              <div className="initial-loading">
                <LoaderCircle className="spin" size={28} />
                <h2>打开你的创作空间</h2>
                <p>项目与素材保存在本机</p>
              </div>
            ) : nav === "studio" ? (
              <Workspace />
            ) : nav === "models" ? (
              <ModelsView />
            ) : nav === "projects" ? (
              <ProjectsView />
            ) : nav === "library" ? (
              <LibraryView />
            ) : nav === "skills" ? (
              <SkillsView />
            ) : nav === "extensions" ? (
              <ExtensionsView />
            ) : nav === "tasks" ? (
              <TasksView />
            ) : (
              <SettingsView />
            )}
          </main>
          <aside
            id="global-assistant"
            className="global-assistant"
            aria-label="全局创作助手"
            hidden={!assistantOpen}
          >
            {project ? (
              <AgentPanel key={project.id} />
            ) : (
              <div className="assistant-empty">
                <Sparkles size={24} />
                <h3>从一个项目开始</h3>
                <p>打开或新建项目后，就可以在任意页面与助手协作。</p>
                <button
                  className="primary-button"
                  onClick={() => setState({ modal: "project" })}
                >
                  新建项目
                </button>
              </div>
            )}
          </aside>
        </div>
        <footer className="statusbar">
          <span>
            <i className="status-dot" />
            本地创作空间
          </span>
          <span className="status-middle">
            {project
              ? `${project.assets.length} 个素材 · ${project.story.shots.length} 个分镜`
              : "TadaCut"}{" "}
          </span>
          <button onClick={() => setState({ nav: "settings" })}>
            <Command size={11} />
            快捷键
          </button>
          <span>TadaCut 0.2</span>
        </footer>
      </div>
      <Dialogs />
      <FileRequest />
      <AskDialog />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*,.cube"
        onChange={(e) => {
          void importFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          <Sparkles size={15} />
          {toast.text}
          <button onClick={() => setState({ toast: null })}>×</button>
        </div>
      )}
    </div>
  );
}
