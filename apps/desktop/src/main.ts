import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  shell,
  Menu,
} from "electron";
import path from "node:path";
import { createStudioServer } from "../../server/src/server";
import { createDesktopPort } from "./native";
app.setName("TadaCut");
/**
 * Apps opened from Finder or the Dock start with a minimal PATH, so CLIs from
 * Homebrew, npm or version managers (and the node their scripts need) are
 * missing. Common folders are added at once; the login shell's PATH, read
 * once in the background, is put in front when it arrives.
 */
function extendPath() {
  if (process.platform === "win32") return;
  const merge = (first: string[], rest: string[]) =>
    [...new Set([...first, ...rest].filter(Boolean))].join(path.delimiter);
  const current = () => (process.env.PATH ?? "").split(path.delimiter),
    home = os.homedir();
  process.env.PATH = merge(
    current(),
    [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      ...[
        ".local/bin",
        ".npm-global/bin",
        ".bun/bin",
        ".deno/bin",
        ".cargo/bin",
        ".volta/bin",
        "Library/pnpm",
        ".claude/local",
      ].map((dir) => path.join(home, dir)),
    ].filter((dir) => fs.existsSync(dir)),
  );
  const shellPath = process.env.SHELL || "/bin/zsh";
  if (!path.isAbsolute(shellPath) || !fs.existsSync(shellPath)) return;
  const child = spawn(
    shellPath,
    ["-ilc", 'printf "\n__TADACUT_PATH__%s__TADACUT_PATH__\n" "$PATH"'],
    {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    },
  );
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.on("close", () => {
    const found = /__TADACUT_PATH__(.*)__TADACUT_PATH__/.exec(output)?.[1];
    if (found) process.env.PATH = merge(found.split(path.delimiter), current());
  });
  child.on("error", () => {});
}
type Theme = "system" | "light" | "dark";
const themeBackground = () =>
  nativeTheme.shouldUseDarkColors ? "#111214" : "#ffffff";
if (!app.requestSingleInstanceLock()) app.quit();
else {
  extendPath();
  void app
    .whenReady()
    .then(async () => {
      const dataDir = process.env.TADACUT_DATA_DIR ?? app.getPath("userData"),
        root = app.getAppPath(),
        themeFile = path.join(dataDir, "theme.json");
      try {
        const saved = JSON.parse(fs.readFileSync(themeFile, "utf8")) as Theme;
        if (["system", "light", "dark"].includes(saved))
          nativeTheme.themeSource = saved;
      } catch {
        nativeTheme.themeSource = "light";
      }
      const desktop = createDesktopPort();
      // On macOS even the availability check reads the keychain, so it waits
      // until a secret is actually sealed or opened; the vault falls back on failure.
      // Asked at most once per launch, so a declined prompt does not come back.
      let available: boolean | undefined;
      const usable = () => {
        available ??=
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" ||
            safeStorage.getSelectedStorageBackend() !== "basic_text");
        if (!available) throw new Error("系统凭据库不可用");
      };
      const cipher = {
        encrypt: (s: string) => {
          usable();
          return safeStorage.encryptString(s).toString("base64");
        },
        decrypt: (s: string) => {
          usable();
          return safeStorage.decryptString(Buffer.from(s, "base64"));
        },
      };
      const grantFile = path.join(dataDir, "directories.json");
      const directories = new Set<string>(
        fs.existsSync(grantFile)
          ? JSON.parse(fs.readFileSync(grantFile, "utf8"))
          : [],
      );
      const server = await createStudioServer({
        root,
        dataDir,
        desktop,
        cipher,
        port: Number(process.env.TADACUT_DESKTOP_PORT ?? 4319),
        allowedDirectories: () => [...directories],
      });
      const origin = await server.listen();
      let window: BrowserWindow | undefined;
      const open = () => {
        window = new BrowserWindow({
          width: 1512,
          height: 1000,
          minWidth: 1024,
          minHeight: 700,
          backgroundColor: themeBackground(),
          title: "TadaCut",
          show: false,
          webPreferences: {
            preload: path.join(root, "dist/desktop/preload.cjs"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        });
        window.webContents.setWindowOpenHandler(({ url }) => {
          if (/^https?:\/\//.test(url)) void shell.openExternal(url);
          return { action: "deny" };
        });
        window.webContents.on("will-navigate", (event, url) => {
          if (new URL(url).origin !== origin) event.preventDefault();
        });
        window.webContents.on("will-frame-navigate", (event) => {
          if (new URL(event.url).origin !== origin) event.preventDefault();
        });
        window.once("ready-to-show", () => window?.show());
        window.on("closed", () => {
          window = undefined;
        });
        void window.loadURL(origin);
        window.webContents.session.setPermissionCheckHandler(
          (contents, permission, requestingOrigin) =>
            contents === window?.webContents &&
            requestingOrigin === origin &&
            ["media", "display-capture", "fullscreen"].includes(permission),
        );
        window.webContents.session.setPermissionRequestHandler(
          (contents, permission, callback) =>
            callback(
              contents === window?.webContents &&
                ["media", "display-capture", "fullscreen"].includes(permission),
            ),
        );
      };
      for (const method of [
        "status",
        "sources",
        "selectSource",
        "windows",
        "startSession",
        "endSession",
        "action",
        "screenshot",
        "clicks",
      ] as const)
        ipcMain.handle("tadacut:" + method, (event, ...args) => {
          if (
            event.sender !== window?.webContents ||
            event.senderFrame?.url !== origin + "/"
          )
            throw new Error("非工作台窗口");
          return (desktop[method] as (...a: any[]) => unknown)(...args);
        });
      const hostAction = (name: string, run: (...args: any[]) => unknown) =>
        ipcMain.handle("tadacut:" + name, (event, ...args) => {
          if (
            event.sender !== window?.webContents ||
            event.senderFrame !== window?.webContents.mainFrame
          )
            throw new Error("非工作台窗口");
          return run(...args);
        });
      hostAction("openExternal", async (url: string) => {
        if (!/^https?:\/\//.test(url)) throw new Error("不支持的地址");
        await shell.openExternal(url);
      });
      hostAction("chooseDirectory", async () => {
        const result = await dialog.showOpenDialog(window!, {
          properties: ["openDirectory"],
        });
        if (result.canceled) return null;
        const real = fs.realpathSync(result.filePaths[0]);
        directories.add(real);
        fs.writeFileSync(grantFile, JSON.stringify([...directories]), {
          mode: 0o600,
        });
        return real;
      });
      hostAction("openDataDirectory", () => shell.openPath(dataDir));
      hostAction("setTheme", (theme: Theme) => {
        if (!["system", "light", "dark"].includes(theme))
          throw new Error("未知主题");
        nativeTheme.themeSource = theme;
        window?.setBackgroundColor(themeBackground());
        fs.writeFileSync(themeFile, JSON.stringify(theme), { mode: 0o600 });
      });
      nativeTheme.on("updated", () =>
        window?.setBackgroundColor(themeBackground()),
      );
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "TadaCut",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "quit" },
            ],
          },
          {
            // Native roles keep undo and clipboard keys working in text fields.
            // Outside text fields the studio handles these keys itself (project
            // undo, clip copy/paste) and calls preventDefault, so the menu does
            // not also run.
            label: "Edit",
            submenu: [
              { role: "undo", label: "撤销" },
              { role: "redo", label: "重做" },
              { type: "separator" },
              { role: "cut", label: "剪切" },
              { role: "copy", label: "拷贝" },
              { role: "paste", label: "粘贴" },
              { role: "selectAll", label: "全选" },
            ],
          },
          {
            label: "View",
            submenu: [
              { role: "reload" },
              { role: "toggleDevTools" },
              { role: "togglefullscreen" },
            ],
          },
        ]),
      );
      open();
      app.on("activate", () => {
        if (!window) open();
      });
      app.on("second-instance", () => {
        window?.show();
        window?.focus();
      });
      app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
      });
      let closing = false;
      app.on("before-quit", (event) => {
        if (!closing) {
          event.preventDefault();
          closing = true;
          // A job that ignores its abort signal must not keep the app open.
          // The server can finish closing before this quit call returns; a
          // nested quit would then be undone when the cancelled one unwinds.
          void Promise.race([
            server.close().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]).then(() => setImmediate(() => app.quit()));
        }
      });
    })
    .catch((error) => {
      console.error(error);
      dialog.showErrorBox(
        "TadaCut 启动失败",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}
