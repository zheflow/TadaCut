import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd(),
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-ui-"));
await fs.mkdir("evidence", { recursive: true });
const steps = [],
  errors = [];
const model = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "fixture-local" }] }));
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const modelPort = model.address().port;
const child = spawn(process.execPath, ["dist/server/main.mjs"], {
  cwd: root,
  env: { ...process.env, TADACUT_DATA_DIR: dataDir, TADACUT_PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const address = await new Promise((resolve, reject) => {
  let text = "";
  const timeout = setTimeout(
    () => reject(new Error("本地服务启动超时")),
    30000,
  );
  child.stdout.on("data", (bytes) => {
    text += bytes;
    const match = /TadaCut ready: (http:\/\/127\.0\.0\.1:\d+)/.exec(text);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  child.on("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error("服务退出：" + code));
  });
});
child.stderr.on("data", (data) => {
  if (!String(data).includes("ExperimentalWarning")) errors.push(String(data));
});
const browser = await chromium.launch({
  executablePath:
    process.env.TADACUT_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1040 },
  acceptDownloads: true,
});
page.on("pageerror", (e) => errors.push(e.message));
const project = () =>
  page.evaluate(async () => {
    const current = localStorage.getItem("tadacut-project");
    return (await fetch("/api/projects/" + current)).json();
  });
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  console.log("PASS " + name);
};
try {
  await step("真实生产工作台启动与原创示例素材", async () => {
    await page.goto(address);
    await page.locator(".timeline-clip").first().waitFor();
    assert.equal(await page.locator(".timeline-clip").count(), 6);
    await page.screenshot({ path: "evidence/studio.png" });
  });
  await step("分割与统一撤销", async () => {
    await page.locator(".timeline-clip.image").first().click();
    await page.keyboard.press("s");
    await page.waitForFunction(
      () => document.querySelectorAll(".timeline-clip").length === 7,
    );
    await page.getByTitle("撤销（⌘ Z）").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".timeline-clip").length === 6,
    );
  });
  await step("拖动移动与撤销", async () => {
    // The last clip has free space after it; moving onto a neighbor is blocked.
    const x = (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41;
    const clip = page.locator(".timeline-clip.image").last(),
      box = await clip.boundingBox(),
      before = await clip.evaluate(x);
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 20, { steps: 8 });
    await page.mouse.up();
    const position = () =>
      page.evaluate(
        () =>
          new DOMMatrixReadOnly(
            getComputedStyle(
              [...document.querySelectorAll(".timeline-clip.image")].at(-1),
            ).transform,
          ).m41,
      );
    await page.waitForFunction(
      (left) =>
        new DOMMatrixReadOnly(
          getComputedStyle(
            [...document.querySelectorAll(".timeline-clip.image")].at(-1),
          ).transform,
        ).m41 > left,
      before,
    );
    await page.getByTitle("撤销（⌘ Z）").click();
    await page.waitForFunction(
      (left) =>
        new DOMMatrixReadOnly(
          getComputedStyle(
            [...document.querySelectorAll(".timeline-clip.image")].at(-1),
          ).transform,
        ).m41 === left,
      before,
    );
    assert.equal(await position(), before);
  });
  await step("同轨重叠被阻止", async () => {
    const before = await project(),
      box = await page.locator(".timeline-clip.image").first().boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 20, { steps: 8 });
    assert.equal(await page.locator(".timeline-clip.invalid").count(), 1);
    await page.mouse.up();
    await page
      .locator(".toast.error")
      .filter({ hasText: "已有片段" })
      .waitFor();
    assert.equal((await project()).revision, before.revision);
  });
  await step("拖到同类轨道、Ctrl 复制粘贴与撤销", async () => {
    await page.getByTitle("添加轨道", { exact: true }).click();
    await page.locator(".track-row").nth(3).waitFor();
    // Make the timeline tall enough to show all four tracks.
    const resizer = await page.locator(".timeline-resizer").boundingBox();
    await page.mouse.move(resizer.x + 300, resizer.y + resizer.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizer.x + 300, resizer.y - 200, { steps: 4 });
    await page.mouse.up();
    const original = (await project()).timelines[0],
      overlay = original.tracks[3].id,
      clip = page.locator(".timeline-clip.image").first(),
      box = await clip.boundingBox(),
      row = await page.locator(".track-row").nth(3).boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    // Crossing the audio and text rows keeps the clip on its own track.
    await page.mouse.move(box.x + 40, row.y + row.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      async ([id, track]) =>
        (
          await (
            await fetch(
              "/api/projects/" + localStorage.getItem("tadacut-project"),
            )
          ).json()
        ).timelines[0].clips.find((c) => c.id === id).trackId === track,
      [original.clips[0].id, overlay],
    );
    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      (track) =>
        !document.querySelector(
          `.track-row[data-track-id="${track}"] .timeline-clip`,
        ),
      overlay,
    );
    const count = (await project()).timelines[0].clips.length;
    await page.locator(".timeline-clip.image").first().click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await page.waitForFunction(
      (n) => document.querySelectorAll(".timeline-clip").length === n + 1,
      count,
    );
    const pasted = (await project()).timelines[0].clips.at(-1);
    assert.equal(pasted.trackId, overlay);
    assert.equal(pasted.assetId, original.clips[0].assetId);
    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      (n) => document.querySelectorAll(".timeline-clip").length === n,
      count,
    );
    // Pasting moved the playhead past the pasted clip; later steps start at the first clip.
    await page.getByTitle("回到开头（Home）", { exact: true }).click();
  });
  await step("轨道锁定阻止鼠标编辑", async () => {
    await page.getByTitle("锁定轨道", { exact: true }).first().click();
    await page.locator(".track-row.locked").waitFor();
    const before = await project();
    const box = await page
      .locator(".timeline-clip.image")
      .first()
      .boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 20, { steps: 6 });
    await page.mouse.up();
    assert.equal((await project()).revision, before.revision);
    await page.getByTitle("解锁轨道", { exact: true }).click();
  });
  await step("片段属性与关键帧", async () => {
    await page.locator(".timeline-clip.image").first().dblclick();
    await page.getByRole("button", { name: "关键帧", exact: true }).click();
    const row = page.locator(".keyframe-row").filter({ hasText: "透明度" });
    await row.getByTitle("添加关键帧").click();
    await row.locator("small").filter({ hasText: "1 帧" }).waitFor();
    const saved = (await project()).timelines[0].clips[0];
    assert.equal(saved.keyframes.opacity.length, 1);
    await page.screenshot({ path: "evidence/inspector.png" });
    await page.getByTitle("片段属性", { exact: true }).click();
  });
  const timecode = () =>
    page
      .locator(".preview-footer .timecode")
      .evaluate((e) => e.firstChild.textContent.trim());
  await step("J/K/L 穿梭、逐帧与剪辑点", async () => {
    await page
      .locator(".timeline-ruler")
      .click({ position: { x: 600, y: 10 } });
    await page.keyboard.press("Home");
    assert.equal(await timecode(), "00:00:00");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    assert.equal(await timecode(), "00:00:03");
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await timecode(), "00:01:03");
    // Edit points in the sample: title 30–160, pictures every 180 frames.
    await page.keyboard.press("ArrowDown");
    assert.equal(await timecode(), "00:05:10");
    await page.keyboard.press("ArrowUp");
    assert.equal(await timecode(), "00:01:00");
    // Holding K, L moves one frame.
    await page.keyboard.down("k");
    await page.keyboard.press("l");
    await page.keyboard.up("k");
    assert.equal(await timecode(), "00:01:01");
    await page.keyboard.press("l");
    await page.keyboard.press("l");
    await page.locator(".shuttle-badge").filter({ hasText: "2×" }).waitFor();
    await page.waitForTimeout(400);
    await page.keyboard.press("k");
    await page.locator(".shuttle-badge").waitFor({ state: "detached" });
    const forward = await timecode();
    assert.notEqual(forward, "00:01:01");
    await page.keyboard.press("j");
    await page.waitForTimeout(400);
    await page.keyboard.press("k");
    assert(
      (await timecode()) < forward,
      "J 应该倒放：" + (await timecode()) + " < " + forward,
    );
  });
  await step("入出点、范围导出与清除", async () => {
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("i");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("o");
    await page.locator(".mark-range").waitFor();
    await page.locator(".range-info").filter({ hasText: "00:02:01" }).waitFor();
    await page.keyboard.press("Shift+i");
    assert.equal(await timecode(), "00:01:00");
    await page.keyboard.press("Shift+o");
    assert.equal(await timecode(), "00:03:00");
    await page.getByRole("button", { name: "导出", exact: true }).click();
    assert.match(await page.getByLabel("导出范围").inputValue(), /range/);
    await page
      .locator(".export-summary")
      .filter({ hasText: "入点到出点" })
      .waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.keyboard.press("x");
    await page.locator(".mark-range").waitFor({ state: "detached" });
  });
  await step("刀片工具在点击处分割", async () => {
    const before = await page.locator(".timeline-clip").count();
    await page.keyboard.press("b");
    await page.locator(".timeline-inner.blade-mode").waitFor();
    const box = await page
      .locator(".timeline-clip.image")
      .first()
      .boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    await page.waitForFunction(
      (n) => document.querySelectorAll(".timeline-clip").length === n + 1,
      before,
    );
    await page.keyboard.press("v");
    await page
      .locator(".timeline-inner.blade-mode")
      .waitFor({ state: "detached" });
    await page.getByTitle("撤销（⌘ Z）").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".timeline-clip").length === n,
      before,
    );
  });
  await step("调色效果在预览中绘制", async () => {
    const p = await project(),
      t = p.timelines[0],
      clip = t.clips.find((c) => c.start === 0 && c.trackId === t.tracks[0].id);
    await page.evaluate(
      async ([id, revision, timelineId, clipId]) => {
        const response = await fetch(`/api/projects/${id}/commands`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            expectedRevision: revision,
            label: "调色",
            commands: [
              {
                type: "clip.update",
                timelineId,
                clipId,
                patch: { effects: { gamma: 1.6, gain: [1.2, 0.9, 0.9] } },
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
      },
      [p.id, p.revision, t.id, clip.id],
    );
    await page.keyboard.press("Home");
    await page.locator(".preview-stage .effect-canvas").waitFor();
    // The canvas keeps its drawing buffer, so drawn pixels can be read back.
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".preview-stage .effect-canvas");
      if (!canvas || canvas.width < 2) return false;
      const probe = document.createElement("canvas");
      probe.width = probe.height = 8;
      const context = probe.getContext("2d");
      context.drawImage(canvas, 0, 0, 8, 8);
      return context
        .getImageData(0, 0, 8, 8)
        .data.some((v, i) => i % 4 === 3 && v > 0);
    });
    assert.equal(await page.locator(".preview-stage .motion-error").count(), 0);
    await page.getByTitle("撤销（⌘ Z）").click();
    await page
      .locator(".preview-stage .effect-canvas")
      .waitFor({ state: "detached" });
  });
  await step("浅色与深色外观切换", async () => {
    const background = () =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      );
    const first = await background();
    await page.getByLabel("切换浅色或深色外观").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme);
    await page.waitForTimeout(400);
    const second = await background();
    assert.notEqual(first, second);
    await page.screenshot({ path: "evidence/theme-toggled.png" });
    await page.getByLabel("切换浅色或深色外观").click();
    await page.waitForTimeout(400);
    assert.equal(await background(), first);
  });
  await step("多画幅重构生成新时间线", async () => {
    const before = await project();
    await page.getByRole("button", { name: "创作工具", exact: true }).click();
    await page.getByRole("button", { name: /多画幅重构/ }).click();
    await page.getByRole("radio", { name: /方形 1:1/ }).click();
    await page
      .getByRole("button", { name: "创建方形 1:1时间线", exact: true })
      .click();
    await page
      .locator(".preview-meta")
      .filter({ hasText: "1080 × 1080" })
      .waitFor();
    const after = await project(),
      created = after.timelines.find((t) => t.id === after.activeTimelineId);
    assert.equal(after.timelines.length, before.timelines.length + 1);
    assert.equal(created.width, 1080);
    assert.equal(created.clips.length, before.timelines[0].clips.length);
    await page.screenshot({ path: "evidence/reframe.png" });
    await page.getByTitle("撤销（⌘ Z）").click();
    await page
      .locator(".preview-meta")
      .filter({ hasText: "1920 × 1080" })
      .waitFor();
  });
  await step("离线 Agent 提案、确认与撤销", async () => {
    if (!(await page.locator(".agent-panel").count()))
      await page.getByTitle("片段属性", { exact: true }).click();
    await page.locator(".agent-panel textarea").fill("剪成一条 15 秒短片");
    await page.locator(".agent-panel textarea").press("Enter");
    await page.getByRole("button", { name: "应用修改", exact: true }).waitFor();
    await page.getByRole("button", { name: "应用修改", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector(".preview-footer")
        .textContent.includes("00:15:00"),
    );
    await page.getByTitle("撤销（⌘ Z）").click();
    await page.waitForFunction(() =>
      document
        .querySelector(".preview-footer")
        .textContent.includes("00:24:00"),
    );
  });
  await step("分镜编辑与双向同步", async () => {
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    await page.locator(".shot-title").first().click();
    await page.getByLabel("镜头名称", { exact: true }).fill("晨光与出发");
    await page.getByRole("button", { name: "保存分镜", exact: true }).click();
    // In-app text input (Electron has no window.prompt).
    await page.getByRole("button", { name: "编辑故事", exact: true }).click();
    await page
      .getByRole("textbox", { name: "故事名称", exact: true })
      .fill("城市漫游 · 新版");
    await page.keyboard.press("Enter");
    await page
      .getByRole("textbox", { name: "故事梗概", exact: true })
      .fill("一段关于出发的短片");
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await page
      .locator(".story-header h1")
      .filter({ hasText: "城市漫游 · 新版" })
      .waitFor();
    await page.getByRole("button", { name: "同步到剪辑", exact: true }).click();
    await page.getByRole("button", { name: "采用分镜", exact: true }).click();
    await page
      .locator(".timeline-clip")
      .filter({ hasText: "晨光与出发" })
      .waitFor();
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    await page.screenshot({ path: "evidence/storyboard.png" });
  });
  await step("自配供应商、发现本地模型与密钥隔离", async () => {
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page
      .locator(".provider-card")
      .filter({ hasText: "Ollama" })
      .getByRole("button", { name: "配置", exact: true })
      .click();
    await page.getByLabel("接口类型").selectOption("compatible");
    await page.getByLabel("服务地址").fill(`http://127.0.0.1:${modelPort}/v1`);
    await page
      .getByLabel("API Key", { exact: true })
      .fill("owned-ui-fixture-key");
    await page.getByRole("button", { name: "发现模型", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector("datalist option")?.value === "fixture-local",
    );
    await page.getByLabel("聊天模型", { exact: true }).fill("fixture-local");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await page
      .locator(".provider-card")
      .filter({ hasText: "fixture-local" })
      .waitFor();
    const providers = await page.evaluate(async () =>
      (await fetch("/api/providers")).json(),
    );
    const configured = providers.find((p) => p.id === "ollama");
    assert.equal(configured.hasKey, true);
    assert(!JSON.stringify(providers).includes("owned-ui-fixture-key"));
    await page.screenshot({ path: "evidence/models.png" });
  });
  await step("新项目与跨项目素材复用", async () => {
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称").fill("界面验证项目");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.waitForFunction(
      () => localStorage.getItem("tadacut-project") !== "demo-city",
    );
    await page.getByRole("button", { name: "素材", exact: true }).click();
    await page
      .locator(".library-card")
      .first()
      .getByRole("button", { name: "放到当前时间线" })
      .click();
    await page.waitForFunction(
      async () =>
        (
          await (
            await fetch(
              "/api/projects/" + localStorage.getItem("tadacut-project"),
            )
          ).json()
        ).timelines[0].clips.length === 1,
    );
  });
  await step("代码动画独立沙箱预览与保存", async () => {
    await page.getByRole("button", { name: "代码动画", exact: true }).click();
    await page.frameLocator("iframe").getByText("从想法，走向画面").waitFor();
    await page.screenshot({ path: "evidence/motion-editor.png" });
    await page.getByRole("button", { name: "保存为素材", exact: true }).click();
    await page
      .locator(".library-card")
      .filter({ hasText: "动态标题" })
      .getByRole("button", { name: "放到当前时间线" })
      .click();
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    await page.locator(".timeline-clip.motion").waitFor();
  });
  await step("完整工程下载与刷新后持久化", async () => {
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByLabel("导出类型").selectOption("project");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出文件", exact: true }).click();
    const file = await download;
    await file.saveAs("evidence/ui-project.tadacut");
    const count = (await project()).timelines[0].clips.length;
    await page.reload();
    await page.locator(".timeline-clip").first().waitFor();
    assert.equal(await page.locator(".timeline-clip").count(), count);
  });
  await step("页面导航与较窄窗口布局", async () => {
    for (const name of [
      "任务",
      "技能",
      "设置",
      "素材",
      "项目",
      "模型",
      "工作台",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      assert((await page.locator("main").innerText()).length > 50);
    }
    await page.setViewportSize({ width: 1120, height: 800 });
    await page.screenshot({ path: "evidence/studio-small.png" });
    assert.equal(
      await page
        .locator(".app-shell")
        .evaluate((e) => e.scrollWidth > innerWidth + 1),
      false,
    );
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "evidence/ui-verification.json",
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        steps,
        errors,
        movieRendered: false,
        remoteModelCalled: false,
      },
      null,
      2,
    ),
  );
  console.log(`UI verification: ${steps.length} flows passed`);
} catch (error) {
  await page.screenshot({ path: "evidence/ui-failure.png" });
  await fs.writeFile(
    "evidence/ui-verification.json",
    JSON.stringify(
      { passed: false, steps, errors, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => model.close(resolve));
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}
