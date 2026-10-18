import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Uses the user's real CLI only for initialize/account/read. No model turn,
// login change, personal project or credential is submitted or exported.
const root = process.cwd();
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-real-codex-"));
const packaged = Boolean(process.env.TADACUT_ELECTRON_PATH);
const prefix = packaged ? "packaged-real-codex" : "desktop-real-codex";
const env = {
  ...process.env,
  TADACUT_DATA_DIR: dataDir,
  TADACUT_DESKTOP_PORT: "0",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  // Prevent login-shell PATH enrichment, so version-manager discovery is tested.
  SHELL: "/usr/bin/false",
};
delete env.TADACUT_CODEX_PATH;
delete env.ELECTRON_RUN_AS_NODE;
let application;
const errors = [],
  agentRequests = [];
try {
  application = await electron.launch({
    ...(packaged ? { executablePath: process.env.TADACUT_ELECTRON_PATH } : {}),
    args: [
      ...(!packaged ? [root] : []),
      "--use-mock-keychain",
      `--user-data-dir=${path.join(dataDir, "profile")}`,
    ],
    env,
    timeout: 30000,
  });
  assert.equal(
    await application.evaluate(() => process.env.TADACUT_CODEX_PATH),
    undefined,
  );
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/agent(?:\/|$)/.test(new URL(request.url()).pathname) &&
      !/\/runtimes\//.test(request.url())
    )
      agentRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator(".navigation")
    .getByRole("button", { name: "模型", exact: true })
    .click();
  const runtime = page.locator('.runtime-connection[data-runtime="codex"]');
  await runtime
    .getByText("已找到 CLI；登录与连接尚未验证", { exact: true })
    .waitFor();
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/agent/runtimes/codex/check" &&
      response.request().method() === "POST",
  );
  await runtime.getByRole("button", { name: "检测连接", exact: true }).click();
  const checkedResponse = await response;
  assert.equal(checkedResponse.status(), 200);
  const checked = await checkedResponse.json();
  if (checked.state !== "ready") console.log(JSON.stringify(checked));
  assert.equal(checked.state, "ready");
  assert.equal(checked.protocol, true);
  assert.equal(checked.kind, "cli");
  assert(checked.version);
  assert(checked.path && !checked.path.startsWith(dataDir));
  assert(
    !["account", "email", "accessToken", "refreshToken", "apiKey"].some((key) =>
      Object.hasOwn(checked, key),
    ),
  );
  await runtime
    .getByText("真实 CLI 握手与登录检查通过；未发起模型推理", { exact: true })
    .waitFor();
  const jobs = await page.evaluate(async () =>
    (await fetch("/api/jobs")).json(),
  );
  assert.equal(jobs.length, 0);
  assert.deepEqual(agentRequests, []);
  assert.deepEqual(errors, []);
  await fs.mkdir(path.join(root, "evidence"), { recursive: true });
  // Evidence is published with the repository: show the home folder as ~.
  await page.evaluate((home) => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node; (node = walker.nextNode()); )
      if (node.nodeValue.includes(home))
        node.nodeValue = node.nodeValue.split(home).join("~");
  }, os.homedir());
  await page.screenshot({ path: path.join(root, "evidence", `${prefix}.png`) });
  const report = {
    at: new Date().toISOString(),
    packaged,
    realCli: true,
    mockKeychain: true,
    minimalPath: env.PATH,
    loginShellPathEnabled: false,
    inferenceStarted: false,
    jobsCreated: jobs.length,
    protocolMethods: ["initialize", "initialized", "account/read"],
    status: checked,
    errors,
  };
  await fs.writeFile(
    path.join(root, "evidence", `${prefix}.json`),
    JSON.stringify(report, null, 2).split(os.homedir()).join("~") + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close();
  await fs.rm(dataDir, { recursive: true, force: true });
}
