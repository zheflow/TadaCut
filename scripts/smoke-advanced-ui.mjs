import { _electron as electron, chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile),
  root = process.cwd(),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-advanced-ui-"));
const evidence = path.join(root, "output/playwright/advanced"),
  packaged = Boolean(process.env.TADACUT_ELECTRON_PATH),
  prefix = packaged ? "packaged" : "desktop";
await fs.mkdir(evidence, { recursive: true });
const port = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const port = s.address().port;
    s.close(() => resolve(port));
  });
});
const raw = path.join(dir, "signal.rgb"),
  fixture = path.join(dir, "UI-signal.mp4"),
  rgb = Buffer.alloc(64 * 64 * 3 * 12);
for (let f = 0; f < 12; f++)
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const i = (f * 4096 + y * 64 + x) * 3;
      rgb[i] = f * 20;
      rgb[i + 1] = x * 4;
      rgb[i + 2] = y * 4;
    }
await fs.writeFile(raw, rgb);
await run(path.join(root, "build/ffmpeg/ffmpeg"), [
  "-v",
  "error",
  "-y",
  "-f",
  "rawvideo",
  "-pixel_format",
  "rgb24",
  "-video_size",
  "64x64",
  "-framerate",
  "12",
  "-i",
  raw,
  "-c:v",
  "h264_videotoolbox",
  "-allow_sw",
  "1",
  "-b:v",
  "1M",
  fixture,
]);
const env = {
  ...process.env,
  TADACUT_DATA_DIR: dir,
  TADACUT_DESKTOP_PORT: "0",
};
delete env.ELECTRON_RUN_AS_NODE;
let app, page, reviewBrowser;
const steps = [],
  errors = [];
let stepName = "startup";
const screenshot = async (name) =>
  page.screenshot({ path: path.join(evidence, `${prefix}-${name}.png`) });
const step = async (name, fn) => {
  stepName = name;
  await fn();
  steps.push(name);
  console.log("PASS " + name);
};
const getProject = () =>
  page.evaluate(async () =>
    (
      await fetch(`/api/projects/${localStorage.getItem("tadacut-project")}`)
    ).json(),
  );
const waitFor = async (test) => {
  for (let i = 0; i < 200; i++) {
    const p = await getProject();
    if (test(p)) return p;
    await page.waitForTimeout(50);
  }
  throw Error("Project condition timed out: " + test);
};
const closeModal = () =>
  page.getByRole("dialog").getByTitle("关闭", { exact: true }).click();
try {
  app = await electron.launch({
    ...(packaged ? { executablePath: process.env.TADACUT_ELECTRON_PATH } : {}),
    args: [
      ...(!packaged ? [root] : []),
      "--use-mock-keychain",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--user-data-dir=${path.join(dir, "profile")}`,
    ],
    env,
    timeout: packaged ? 120000 : 30000,
  });
  page = await app.firstWindow({ timeout: packaged ? 120000 : 30000 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1512, height: 950 });
  await page.locator(".timeline-clip.image").first().waitFor();
  await fs.writeFile(
    path.join(evidence, `${prefix}-initial-ui.txt`),
    await page.locator("body").innerText(),
  );
  await step("TadaCut 品牌、常驻助手与高级检查器", async () => {
    assert((await page.locator(".app-shell").innerText()).includes("TadaCut"));
    assert(await page.getByLabel("全局创作助手").isVisible());
    await page.locator(".timeline-clip.image").first().dblclick();
    await page
      .locator(".inspector")
      .getByRole("button", { name: "高级", exact: true })
      .click();
    assert(await page.getByLabel("图层混合").isVisible());
    await screenshot("advanced-inspector");
  });
  const clipId = (await getProject()).timelines[0].clips[0].id;
  await step("混合模式、蒙版实际像素与调色曲线", async () => {
    await page.getByLabel("图层混合").selectOption("screen");
    await waitFor(
      (p) =>
        p.timelines[0].clips.find((c) => c.id === clipId)?.advanced?.blend ===
        "screen",
    );
    await page
      .locator(".advanced-visual")
      .getByRole("button", { name: "添加", exact: true })
      .click();
    await waitFor(
      (p) =>
        p.timelines[0].clips.find((c) => c.id === clipId)?.advanced?.masks
          ?.length === 1,
    );
    assert(
      (
        await page
          .locator(".stage-clip")
          .first()
          .evaluate((e) => getComputedStyle(e).maskImage)
      ).includes("data:image/svg"),
    );
    const curve = page.locator(".curve-editor svg").first();
    await curve.scrollIntoViewIfNeeded();
    const box = await curve.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await waitFor(
      (p) =>
        p.timelines[0].clips.find((c) => c.id === clipId)?.advanced?.curves
          ?.master?.length === 3,
    );
    await page.locator(".effect-canvas").first().waitFor();
    assert.equal(await page.locator(".effect-canvas[data-error]").count(), 0);
    assert.equal(await page.locator(".motion-error").count(), 0);
    await page.getByLabel("蒙版形状").selectOption("bezier");
    await page.locator(".mask-editor circle").first().waitFor();
    assert.equal(await page.locator(".mask-editor circle").count(), 8);
    await page.getByLabel("蒙版形状").selectOption("brush");
    await page.locator(".mask-editor svg").scrollIntoViewIfNeeded();
    const b = await page.locator(".mask-editor svg").boundingBox();
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.65, {
      steps: 8,
    });
    await page.mouse.up();
    await waitFor(
      (p) =>
        p.timelines[0].clips.find((c) => c.id === clipId)?.advanced?.masks?.[0]
          ?.strokes?.[0]?.points.length > 2,
    );
    await screenshot("mask-and-curves");
  });
  await step("高级工具完整入口与字幕导入", async () => {
    await page
      .getByRole("button", { name: "打开高级媒体工具", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "高级媒体工具", exact: true })
      .waitFor();
    const nav = page.getByRole("navigation", { name: "高级功能" });
    assert.equal(await nav.locator("button").count(), 17);
    for (const title of [
      "曲线变速",
      "倒放",
      "定格",
      "补帧",
      "画面防抖",
      "变调与声像",
      "代理媒体",
      "预渲染缓存",
      "运动与平面跟踪",
      "色彩空间转换",
      "智能抠像",
      "视频消除",
      "AI 超分",
      "数字人",
      "口型同步",
      "歌词识别",
    ]) {
      await nav.getByRole("button", { name: title, exact: false }).click();
      assert(
        await page
          .locator(".advanced-tools section")
          .getByRole("heading", { name: title, exact: true })
          .isVisible(),
      );
    }
    await nav.getByRole("button", { name: "字幕 / 歌词导入" }).click();
    await page
      .getByLabel("字幕内容")
      .fill("1\n00:00:00,000 --> 00:00:01,000\n界面导入验证\n");
    await page
      .getByRole("button", { name: "导入到新轨道", exact: true })
      .click();
    await waitFor((p) =>
      p.timelines[0].clips.some((c) => c.text === "界面导入验证"),
    );
    await screenshot("subtitle-import");
    await closeModal();
  });
  await step("真实素材上传、代理任务与应用候选结果", async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByTitle("导入素材", { exact: true }).click();
    await (await chooser).setFiles(fixture);
    const p = await waitFor((p) =>
        p.assets.some((a) => a.name === "UI-signal.mp4"),
      ),
      asset = p.assets.find((a) => a.name === "UI-signal.mp4");
    await page
      .getByRole("button", { name: "打开高级媒体工具", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "高级功能" })
      .getByRole("button", { name: "代理媒体", exact: true })
      .click();
    await page.getByLabel("处理片段").selectOption("");
    await page.getByLabel("处理素材").selectOption(asset.id);
    await page.getByRole("button", { name: "开始处理", exact: true }).click();
    await page
      .getByRole("heading", { name: "任务中心", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "应用处理结果", exact: true })
      .click();
    await waitFor((p) => p.assets.find((a) => a.id === asset.id)?.proxy?.url);
    await screenshot("processed-proxy");
  });
  await step("画布节点类型、分组与界面上下文", async () => {
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    await page.getByRole("button", { name: "创作画布", exact: true }).click();
    await page.getByLabel("画布节点类型").selectOption("video");
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    const ask = page.getByRole("dialog");
    await ask.locator("input").fill("UI 视频节点");
    await ask.getByRole("button", { name: "确定", exact: true }).click();
    await page.getByLabel("节点引用对象").waitFor();
    const p = await getProject();
    await page
      .getByLabel("节点引用对象")
      .selectOption(p.assets.find((a) => a.name === "UI-signal.mp4").id);
    await page.getByRole("button", { name: "所选编组", exact: true }).click();
    await ask.locator("input").fill("UI 分组");
    await ask.getByRole("button", { name: "确定", exact: true }).click();
    await waitFor((p) =>
      p.canvas.some((n) => n.label === "UI 视频节点" && n.parentId),
    );
    await screenshot("canvas-groups");
  });
  await step("本机团队服务、项目与目录", async () => {
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page
      .getByRole("button", { name: "团队与共享素材", exact: true })
      .click();
    await page.getByLabel("端口", { exact: true }).fill(String(port));
    await page.getByRole("button", { name: "启动并连接", exact: true }).click();
    await page
      .getByRole("button", { name: "停止本机服务", exact: true })
      .waitFor();
    await page
      .locator(".team-tabs")
      .getByRole("button", { name: "项目", exact: true })
      .click();
    await page
      .getByRole("button", { name: "共享当前项目", exact: true })
      .click();
    await page
      .getByRole("button", { name: "下载为新项目", exact: true })
      .waitFor();
    await screenshot("team-projects");
    await page
      .locator(".team-tabs")
      .getByRole("button", { name: "素材目录", exact: true })
      .click();
    await page.getByText("发布到共享素材库", { exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("本机验证模板");
    await page.getByLabel("授权说明", { exact: true }).fill("仅本机自动化验证");
    await page
      .getByRole("button", { name: "发布当前工程为模板", exact: true })
      .click();
    await page
      .locator(".team-row")
      .filter({ hasText: "本机验证模板" })
      .waitFor();
    await screenshot("shared-catalog");
  });
  await step("固定版本评审和时间点评论", async () => {
    // Delay a real read to exercise navigation readiness and stale list protection.
    await page.route("**/api/team/reviews", async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ response });
    });
    await page
      .locator(".team-tabs")
      .getByRole("button", { name: "版本与评审", exact: true })
      .click();
    const published = page.waitForResponse(
      (r) =>
        r.url().includes("/api/team/projects/") &&
        r.url().endsWith("/reviews") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "创建评审链接", exact: true })
      .click();
    assert.equal((await published).status(), 200);
    const link = page.getByRole("link", { name: /打开评审/ }).first();
    await link.waitFor();
    const url = await link.getAttribute("href");
    const browserMeta = JSON.parse(
      await fs.readFile(
        path.join(root, "build/render-browser/tadacut-browser.json"),
        "utf8",
      ),
    );
    reviewBrowser = await chromium.launch({
      executablePath: path.join(
        root,
        "build/render-browser",
        browserMeta.executable,
      ),
      headless: true,
    });
    const review = await reviewBrowser.newPage();
    await review.goto(url);
    await review.getByPlaceholder("你的名字").fill("本机 UI 验证");
    await review.getByPlaceholder("留下画面意见").fill("这是本机验证评论");
    await review
      .getByRole("button", { name: "在当前时间添加评论", exact: true })
      .click();
    await review.getByText(/这是本机验证评论/).waitFor();
    await review.screenshot({
      path: path.join(evidence, `${prefix}-review-page.png`),
    });
    await review.close();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByRole("button", { name: "标记解决", exact: true }).click();
    await page.getByRole("button", { name: "重新打开", exact: true }).waitFor();
    await screenshot("review-comments");
    await closeModal();
  });
  await step("摄像头录制管线（Chromium 虚拟摄像头）", async () => {
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    await page.getByRole("button", { name: "应用录制", exact: true }).click();
    await page.getByLabel("录制模式").selectOption("camera");
    const before = (await getProject()).assets.length;
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    await page
      .getByRole("button", { name: "停止并保存", exact: true })
      .waitFor();
    await page.waitForTimeout(1250);
    await screenshot("camera-recording");
    await page.getByRole("button", { name: "停止并保存", exact: true }).click();
    await waitFor((p) => p.assets.length > before);
  });
  await step("窄窗口和全局助手", async () => {
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.getByRole("button", { name: "项目", exact: true }).click();
    assert(await page.getByLabel("全局创作助手").isVisible());
    await screenshot("small");
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, `${prefix}-verification.json`),
    JSON.stringify(
      {
        passed: true,
        steps,
        errors,
        packaged,
        remoteModelsCalled: false,
        externalServiceUsed: false,
        camera: "Chromium virtual test camera",
        userProjectMovieRendered: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page) {
    await screenshot("failure").catch(() => {});
    await fs.writeFile(
      path.join(evidence, `${prefix}-failure-ui.txt`),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  await fs.writeFile(
    path.join(evidence, `${prefix}-verification.json`),
    JSON.stringify(
      { passed: false, step: stepName, error: String(error), steps, errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await reviewBrowser?.close();
  await app?.close();
  await fs.rm(dir, { recursive: true, force: true });
}
