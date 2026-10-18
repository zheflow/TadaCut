import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Use the same real Electron flows for the production build and the packaged app.
// Every write is confined to a temporary project database and browser profile.
const root = process.cwd();
const dataDir = await fs.mkdtemp(
  path.join(os.tmpdir(), "tadacut-features-ui-"),
);
const packaged = Boolean(process.env.TADACUT_ELECTRON_PATH);
const mockKeychain = process.env.TADACUT_TEST_MOCK_KEYCHAIN === "1";
const prefix = packaged ? "packaged-features" : "desktop-features";
const evidence = path.join(root, "evidence");
await fs.mkdir(evidence, { recursive: true });
const env = {
  ...process.env,
  TADACUT_DATA_DIR: dataDir,
  TADACUT_DESKTOP_PORT: "0",
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    ...(packaged ? { executablePath: process.env.TADACUT_ELECTRON_PATH } : {}),
    args: [
      ...(!packaged ? [root] : []),
      ...(mockKeychain ? ["--use-mock-keychain"] : []),
      `--user-data-dir=${path.join(dataDir, "profile")}`,
    ],
    env,
    timeout: packaged ? 120000 : 30000,
  });
} catch (error) {
  await fs.rm(dataDir, { recursive: true, force: true });
  throw error;
}
const page = await application.firstWindow({
  timeout: packaged ? 120000 : 30000,
});
page.setDefaultTimeout(10000);
const steps = [],
  errors = [];
let currentStep = "启动";
page.on("pageerror", (error) => errors.push(error.message));
const screenshot = (name) =>
  page.screenshot({ path: path.join(evidence, `${prefix}-${name}.png`) });
const project = () =>
  page.evaluate(async () =>
    (
      await fetch(`/api/projects/${localStorage.getItem("tadacut-project")}`)
    ).json(),
  );
const revision = async () => (await project()).revision;
const waitProject = async (matches) => {
  for (let i = 0; i < 200; i++) {
    const p = await project();
    if (matches(p)) return p;
    await page.waitForTimeout(50);
  }
  throw new Error(`项目状态未满足条件：${matches}`);
};
const changed = (before) => waitProject((p) => p.revision > before);
const undo = async () => {
  const before = await revision();
  await page.getByTitle("撤销（⌘ Z）", { exact: true }).click();
  await changed(before);
};
const openTool = async (name) => {
  await page.getByRole("button", { name: "创作工具", exact: true }).click();
  await page
    .locator(".creative-tool")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
};
const closeTool = () =>
  page
    .locator(".modal-footer")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
const step = async (name, fn) => {
  currentStep = name;
  await fn();
  steps.push(name);
  console.log(`PASS ${name}`);
};
const report = (passed, extra = {}) =>
  fs.writeFile(
    path.join(evidence, `${prefix}-verification.json`),
    JSON.stringify(
      {
        passed,
        packaged,
        mockKeychain,
        steps,
        errors,
        movieRendered: false,
        remoteModelCalled: false,
        localModelDownloaded: false,
        ...extra,
      },
      null,
      2,
    ),
  );

try {
  await page.setViewportSize({ width: 1512, height: 950 });
  await step("桌面启动、隔离的宿主桥接与示例工程", async () => {
    await page.locator(".timeline-clip").first().waitFor();
    assert.equal(await page.locator(".timeline-clip").count(), 6);
    const bridge = await page.evaluate(() => ({
      desktop: Boolean(window.tadacut),
      node: typeof window.require,
    }));
    assert.deepEqual(bridge, { desktop: true, node: "undefined" });
    assert.equal(
      await application.evaluate(({ app }) => app.isPackaged),
      packaged,
    );
  });
  await step("检查器页签、画面布局与撤销", async () => {
    await page.locator(".timeline-clip.image").first().dblclick();
    const inspector = page.locator(".inspector");
    for (const tab of ["特效", "调色", "转场", "关键帧", "画面"]) {
      await inspector.getByRole("button", { name: tab, exact: true }).click();
      assert(
        (await inspector.locator(".inspector-scroll").innerText()).length > 20,
      );
    }
    const clip = (await project()).timelines[0].clips[0];
    const layout = inspector
      .locator(".inline-form")
      .filter({ has: page.locator('option[value="side-by-side"]') });
    await layout.locator("select").selectOption("side-by-side");
    const before = await revision();
    await layout.getByRole("button", { name: "应用", exact: true }).click();
    await changed(before);
    const arranged = (await project()).timelines[0].clips.find(
      (c) => c.id === clip.id,
    );
    assert(arranged.x < 0);
    assert(arranged.crop.left > 0);
    await screenshot("inspector");
    await undo();
    assert.equal(
      (await project()).timelines[0].clips.find((c) => c.id === clip.id).x,
      clip.x,
    );
    assert(
      await inspector
        .getByRole("button", { name: "移到画面空白处", exact: true })
        .isVisible(),
    );
  });
  await step("配乐面板、本机节拍分析与卡点相册", async () => {
    await page.locator(".timeline-clip.audio").dblclick();
    await page
      .locator(".inspector")
      .getByRole("button", { name: "画面", exact: true })
      .click();
    assert(
      await page
        .getByRole("button", { name: "自动闪避", exact: true })
        .isEnabled(),
    );
    const before = await project();
    await page
      .getByRole("button", { name: "生成卡点相册（放到新轨道）", exact: true })
      .click();
    // The first audio analysis also saves metadata. Wait for the actual edit.
    const after = await waitProject(
      (p) =>
        p.timelines[0].tracks.length === before.timelines[0].tracks.length + 1,
    );
    assert.equal(
      after.timelines[0].tracks.length,
      before.timelines[0].tracks.length + 1,
    );
    assert(after.timelines[0].clips.length > before.timelines[0].clips.length);
    await screenshot("music");
    await undo();
    assert.equal(
      (await project()).timelines[0].clips.length,
      before.timelines[0].clips.length,
    );
  });
  await step("素材右键菜单、重命名与撤销", async () => {
    const card = page.locator(".media-card").first();
    await card.click({ button: "right" });
    const menu = page.getByRole("menu");
    await menu.getByRole("button", { name: "重命名…", exact: true }).click();
    await page
      .getByRole("textbox", { name: "素材名称", exact: true })
      .fill("界面验证 · 晨光");
    const before = await revision();
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await changed(before);
    assert((await project()).assets.some((a) => a.name === "界面验证 · 晨光"));
    await undo();
  });
  await step("标记右键菜单、备注与颜色", async () => {
    await page
      .locator(".timeline-ruler")
      .click({ position: { x: 350, y: 10 } });
    await page.keyboard.press("m");
    await page
      .getByRole("textbox", { name: "标记名称", exact: true })
      .fill("验收标记");
    let before = await revision();
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await changed(before);
    const marker = page.locator('.timeline-marker[title^="验收标记"]');
    await marker.click({ button: "right" });
    await page.getByRole("menu").getByRole("button", { name: /备注/ }).click();
    await page
      .getByRole("textbox", { name: "标记备注", exact: true })
      .fill("独立测试数据");
    before = await revision();
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await changed(before);
    await marker.click({ button: "right" });
    before = await revision();
    await page.getByTitle("标记颜色", { exact: true }).last().click();
    await changed(before);
    const saved = (await project()).timelines[0].markers.find(
      (m) => m.label === "验收标记",
    );
    assert.equal(saved.note, "独立测试数据");
    await marker.click({ button: "right" });
    await screenshot("context-menu");
    await page.keyboard.press("Escape");
  });
  await step("场景检测的缺素材提示与按钮状态", async () => {
    await openTool("场景切换检测");
    assert.equal(await page.getByLabel("视频素材").inputValue(), "");
    assert(
      await page
        .getByRole("button", { name: "开始检测", exact: true })
        .isDisabled(),
    );
    await screenshot("scene-detect");
    await closeTool();
  });
  await step("本机高光分析、范围标记与精华版时间线", async () => {
    await openTool("查找高光");
    await page.getByLabel("每段长度（秒）").fill("5");
    await page.getByLabel("段数", { exact: true }).fill("2");
    await page
      .locator(".modal-footer")
      .getByRole("button", { name: "查找高光", exact: true })
      .click();
    await page.locator(".highlight-row").first().waitFor();
    const before = await project();
    await page.getByRole("button", { name: "添加为标记", exact: true }).click();
    await changed(before.revision);
    assert(
      (await project()).timelines[0].markers.some(
        (m) => m.label === "高光 1" && m.duration > 0,
      ),
    );
    await screenshot("highlights");
    await page
      .getByRole("button", { name: "生成精华版时间线", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await waitProject(
      (p) => p.timelines.length === before.timelines.length + 1,
    );
    await undo();
    await undo();
  });
  await step("封面、图生视频、改图和音效的服务选择界面", async () => {
    for (const name of [
      "生成封面",
      "图生视频",
      "编辑图片",
      "生成音效",
      "人声分离",
    ]) {
      await openTool(name);
      assert(await page.getByLabel("所用模型服务").isVisible());
      if (name === "生成封面") {
        await page.getByLabel("封面标题（可留空）").fill("城市漫游");
        await screenshot("cover");
      }
      if (name === "图生视频" || name === "编辑图片")
        assert(
          (await page.getByLabel("参考图片").locator("option").count()) > 1,
        );
      await closeTool();
    }
  });
  await step("故事开发编辑与持久化", async () => {
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    await page.getByRole("tab", { name: "开发", exact: true }).click();
    const before = await revision();
    await page.getByLabel("主题", { exact: true }).fill("发现身边的风景");
    await page.getByRole("heading", { name: "故事开发", exact: true }).click();
    await changed(before);
    assert.equal((await project()).story.development.theme, "发现身边的风景");
    await screenshot("development");
  });
  await step("资源库的模板、字幕、特效、转场与风格入口", async () => {
    await page
      .locator(".mode-tabs")
      .getByRole("button", { name: "剪辑", exact: true })
      .click();
    await page
      .locator(".left-switch")
      .getByRole("tab", { name: "资源库", exact: true })
      .click();
    for (const name of [
      "模板",
      "字幕",
      "特效",
      "转场",
      "风格",
      "镜头",
      "音效",
      "图库",
      "扩展",
    ]) {
      await page
        .locator(".resource-tabs")
        .getByRole("tab", { name, exact: true })
        .click();
      assert((await page.locator(".resource-body").innerText()).length > 10);
    }
    await screenshot("resources");
    await page
      .locator(".left-switch")
      .getByRole("tab", { name: "素材", exact: true })
      .click();
    await page.getByRole("button", { name: "分镜", exact: true }).click();
  });
  await step("分集、分场与剧本分镜双向转换", async () => {
    await page.getByRole("tab", { name: "分集", exact: true }).click();
    let before = await revision();
    await page.getByRole("button", { name: "添加一集", exact: true }).click();
    await changed(before);
    before = await revision();
    await page.getByRole("button", { name: "添加一场", exact: true }).click();
    await changed(before);
    assert.equal((await project()).story.episodes[0].scenes.length, 1);
    await page.getByRole("tab", { name: "剧本", exact: true }).click();
    before = await revision();
    await page.getByRole("button", { name: "从分镜生成", exact: true }).click();
    await changed(before);
    const script = (await project()).story.script;
    assert.equal(script.length, 4);
    await screenshot("script");
    before = await revision();
    await page.getByRole("button", { name: "生成分镜", exact: true }).click();
    await changed(before);
    assert.equal((await project()).story.shots.length, script.length);
    await page.getByRole("tab", { name: "生产", exact: true }).click();
    assert.equal(await page.locator(".production-card").count(), 4);
    for (const name of ["视频", "配音"])
      await page
        .locator(".production-stage")
        .getByRole("checkbox", { name, exact: true })
        .check();
    assert.equal(await page.locator(".production-stage select").count(), 3);
    await screenshot("production");
  });
  await step("设置里的发布确认与权限保存", async () => {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const publish = page
      .locator(".permission-row")
      .filter({ has: page.getByText("发布", { exact: true }) });
    assert(
      await publish
        .getByRole("button", { name: "允许", exact: true })
        .isDisabled(),
    );
    const generate = page
      .locator(".permission-row")
      .filter({ has: page.getByText("生成", { exact: true }) });
    await generate.getByRole("button", { name: "禁止", exact: true }).click();
    await generate
      .locator("button.active")
      .filter({ hasText: "禁止" })
      .waitFor();
    const settings = await page.evaluate(async () =>
      (await fetch("/api/agent/settings")).json(),
    );
    assert.equal(settings.permissions.generate, "deny");
    await generate.getByRole("button", { name: "询问", exact: true }).click();
    await screenshot("settings");
  });
  await step("扩展包文件安装、资源可见与移除", async () => {
    await page.getByRole("button", { name: "扩展", exact: true }).click();
    const pack = {
      format: "tadacut-plugin@1",
      id: "ui-fixture",
      name: "界面验证扩展",
      version: "1.0.0",
      contents: {
        captionStyles: [
          {
            id: "gold",
            name: "金色字幕",
            textStyle: { color: "#ffd400" },
            animation: "pop",
          },
        ],
      },
    };
    await page
      .getByRole("main")
      .locator('input[type="file"]')
      .setInputFiles({
        name: "ui-fixture.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(pack)),
      });
    const card = page
      .locator(".extension-card")
      .filter({ hasText: "界面验证扩展" });
    await card.waitFor();
    assert((await card.innerText()).includes("字幕样式 1"));
    await screenshot("extensions");
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    await page
      .locator(".mode-tabs")
      .getByRole("button", { name: "剪辑", exact: true })
      .click();
    await page
      .locator(".left-switch")
      .getByRole("tab", { name: "资源库", exact: true })
      .click();
    await page
      .locator(".resource-tabs")
      .getByRole("tab", { name: "扩展", exact: true })
      .click();
    await page
      .locator(".resource-body")
      .getByRole("button", { name: "金色字幕", exact: true })
      .waitFor();
    await page
      .locator(".left-switch")
      .getByRole("tab", { name: "素材", exact: true })
      .click();
    await page.getByRole("button", { name: "扩展", exact: true }).click();
    const dialog = page.waitForEvent("dialog").then((d) => d.accept());
    await card.getByRole("button", { name: "移除", exact: true }).click();
    await dialog;
    await card.waitFor({ state: "detached" });
  });
  await step("窄窗口的新页面与检查器布局", async () => {
    await page.setViewportSize({ width: 1120, height: 800 });
    for (const nav of ["设置", "扩展", "工作台"]) {
      await page.getByRole("button", { name: nav, exact: true }).click();
      assert.equal(
        await page
          .locator(".app-shell")
          .evaluate((e) => e.scrollWidth > innerWidth + 1),
        false,
      );
    }
    await page
      .locator(".mode-tabs")
      .getByRole("button", { name: "剪辑", exact: true })
      .click();
    await page.locator(".timeline-clip.image").first().dblclick();
    assert.equal(
      await page
        .locator(".inspector")
        .evaluate((e) => e.scrollWidth > e.clientWidth + 1),
      false,
    );
    await screenshot("small");
  });
  await step("重新加载后故事、标记和扩展状态保留", async () => {
    await page.reload();
    await page.locator(".timeline-clip").first().waitFor();
    const saved = await project();
    assert.equal(saved.story.development.theme, "发现身边的风景");
    assert(saved.timelines[0].markers.some((m) => m.note === "独立测试数据"));
    assert.equal(
      await page.evaluate(
        async () => (await (await fetch("/api/plugins")).json()).length,
      ),
      0,
    );
  });
  assert.deepEqual(errors, []);
  await report(true);
  for (const extension of ["png", "txt"])
    await fs.rm(path.join(evidence, `${prefix}-failure.${extension}`), {
      force: true,
    });
  console.log(`${prefix}: ${steps.length} flows passed`);
} catch (error) {
  await screenshot("failure").catch(() => {});
  await fs.writeFile(
    path.join(evidence, `${prefix}-failure.txt`),
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  await report(false, { failure: error.message, currentStep });
  throw error;
} finally {
  await application.close();
  await fs.rm(dataDir, { recursive: true, force: true });
}
