import { _electron as electron } from "playwright-core";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// A scripted local model drives the real agent, permission gate, SSE bridge and UI.
// All media, credentials and changes belong to an isolated disposable profile.
const root = process.cwd(),
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "icut-assistant-ui-"));
const runtimeBin = path.join(dataDir, "runtime-bin");
await fs.mkdir(runtimeBin);
await fs.writeFile(
  path.join(runtimeBin, "codex"),
  `#!/usr/bin/env node
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const event = JSON.parse(line);
  if (event.id !== undefined && event.method) {
    send({ id: event.id, result: event.method === 'thread/start' ? { thread: { id: 'fixture-thread' } } : event.method === 'account/read' ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } : {} });
    if (event.method === 'turn/start') {
      const prompt = event.params.input[0].text;
      send({ id: 777, method: 'item/tool/call', params: { tool: 'update_app_settings', arguments: { name: prompt.includes('拒绝') ? '不应保存' : '外部确认工作室' } } });
    }
  } else if (event.id === 777) {
    send({ method: 'item/agentMessage/delta', params: { delta: event.result.success ? '外部验证已执行' : '外部验证已拒绝' } });
    send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  }
});
`,
  { mode: 0o700 },
);
const packaged = Boolean(process.env.TADACUT_ELECTRON_PATH),
  prefix = packaged ? "packaged-assistant" : "desktop-assistant";
const requests = [],
  steps = [],
  errors = [];
const fixture = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const messages = input.messages;
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const line = system
      .split("\n")
      .find((line) => line.startsWith("当前界面上下文："));
    const context = line
      ? JSON.parse(line.slice("当前界面上下文：".length))
      : null;
    let userIndex = messages.findLastIndex((m) => m.role === "user");
    const message = messages[userIndex]?.content ?? "";
    const history = messages.slice(userIndex + 1);
    const completed = new Set(
      history.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
    );
    const references = context?.references ?? [];
    const operations = message.includes("验证素材")
      ? [
          [
            "organize_assets",
            {
              assetIds: references
                .filter((r) => r.kind === "asset")
                .map((r) => r.id),
              tags: ["春日精选"],
              description: "多选素材的对话整理",
            },
          ],
        ]
      : message.includes("验证设置")
        ? [
            [
              "update_app_settings",
              { name: "樱花工作室", agent: { verify: false } },
            ],
            ["set_app_appearance", { theme: "light", sakuraEffects: false }],
          ]
        : message.includes("验证技能")
          ? [
              [
                "configure_skill",
                {
                  skillId: references.find((r) => r.kind === "skill")?.id,
                  patch: { enabled: false },
                },
              ],
            ]
          : message.includes("验证模型")
            ? [
                [
                  "configure_provider",
                  {
                    providerId: "fixture-chat",
                    patch: { model: "fixture-changed" },
                  },
                ],
              ]
            : message.includes("验证故事")
              ? [
                  [
                    "navigate_app",
                    {
                      page: "studio",
                      workspace: "story",
                      storyView: "development",
                    },
                  ],
                ]
              : message.includes("验证文件")
                ? [["choose_local_files", { kind: "media" }]]
                : message.includes("验证目录")
                  ? [
                      [
                        "set_workspace_view",
                        { leftPanel: "library", resourceSection: "captions" },
                      ],
                    ]
                  : [];
    const sequence = [
      ["tool_search", { query: "media application" }],
      ["read_project", {}],
      ["read_app_context", {}],
      ...operations,
    ];
    const index = sequence.findIndex(
      (_entry, i) => !completed.has(`fixture-${i}`),
    );
    const delta =
      index >= 0
        ? {
            tool_calls: [
              {
                index: 0,
                id: `fixture-${index}`,
                function: {
                  name: sequence[index][0],
                  arguments: JSON.stringify(sequence[index][1]),
                },
              },
            ],
          }
        : { content: `验证完成：${message}` };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
    );
  } catch (error) {
    errors.push(`fixture: ${error.message}`);
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
let application,
  currentStep = "启动";
const env = {
  ...process.env,
  TADACUT_DATA_DIR: dataDir,
  TADACUT_DESKTOP_PORT: "0",
  TADACUT_CODEX_PATH: path.join(runtimeBin, "codex"),
  PATH: `${runtimeBin}:${process.env.PATH}`,
};
delete env.ELECTRON_RUN_AS_NODE;
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
  const page = await application.firstWindow();
  assert.equal(
    await application.evaluate(() => process.env.TADACUT_CODEX_PATH),
    path.join(runtimeBin, "codex"),
  );
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1512, height: 950 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  const screenshot = (name) =>
    page.screenshot({
      path: path.join(root, "evidence", `${prefix}-${name}.png`),
    });
  const api = (method, url, body) =>
    page.evaluate(
      async ({ method, url, body }) => {
        const r = await fetch(url, {
          method,
          ...(body === undefined
            ? {}
            : {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
        });
        const value = await r.json();
        if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(value)}`);
        return value;
      },
      { method, url, body },
    );
  const project = () => api("GET", "/api/projects/demo-city");
  const wait = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (await predicate()) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`未满足条件：${predicate}`);
  };
  const changed = (before) =>
    wait(async () => (await project()).revision > before);
  const nav = (name) =>
    page
      .locator(".navigation")
      .getByRole("button", { name, exact: true })
      .click();
  const step = async (name, action) => {
    currentStep = name;
    await action();
    steps.push(name);
    console.log(`PASS ${name}`);
  };
  const clearReferences = async () => {
    const clear = page.locator(".reference-summary button");
    if (await clear.isVisible()) await clear.click();
  };
  const send = async (text) => {
    const before = requests.length;
    await page.locator(".chat-input textarea").fill(text);
    await page.getByTitle("发送", { exact: true }).click();
    for (let i = 0; i < 400; i++) {
      const approve = page
        .locator(".approval-card.pending")
        .getByRole("button", { name: "允许这一次", exact: true });
      if ((await approve.isVisible()) && (await approve.isEnabled())) {
        await approve.click();
        await page.waitForTimeout(150);
      }
      if (
        (
          await page.locator(".chat-message.assistant").last().innerText()
        ).includes(`验证完成：${text}`)
      ) {
        assert(requests.length > before);
        const failed = await page.locator(".agent-step.error").count();
        assert.equal(failed, 0);
        return requests[before];
      }
      await page.waitForTimeout(50);
    }
    throw new Error(`对话没有完成：${text}`);
  };

  try {
    await step("默认白色浅色，系统深色下保持浅色，单一全局助手", async () => {
      await page.locator(".timeline-clip").first().waitFor();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
      assert.equal(await page.locator(".agent-panel").count(), 1);
      assert.equal(
        await application.evaluate(({ app }) => app.isPackaged),
        packaged,
      );
      await screenshot("sakura");
    });
    await step("全部页面保留同一对话与输入草稿，自动显示所在页面", async () => {
      await page.locator(".chat-input textarea").fill("尚未发送的创作想法");
      for (const [name, label] of [
        ["项目", "项目"],
        ["素材", "素材库"],
        ["模型", "模型"],
        ["技能", "技能"],
        ["扩展", "扩展"],
        ["任务", "任务"],
        ["设置", "设置"],
        ["工作台", "工作台"],
      ]) {
        await nav(name);
        assert.equal(await page.locator(".agent-panel").count(), 1);
        assert.equal(
          await page.locator(".chat-input textarea").inputValue(),
          "尚未发送的创作想法",
        );
        assert(
          (await page.locator(".assistant-context").innerText()).includes(
            label,
          ),
        );
      }
      await page.locator(".chat-input textarea").fill("");
    });
    await step(
      "工作台素材支持 Cmd 多选、Shift 连选与逐项取消引用",
      async () => {
        const cards = page.locator(".media-card");
        await cards.nth(0).click();
        await cards.nth(1).click({ modifiers: ["Meta"] });
        assert.equal(
          await page.locator('.media-card[aria-selected="true"]').count(),
          2,
        );
        await cards.nth(3).click({ modifiers: ["Shift"] });
        assert.equal(
          await page.locator('.media-card[aria-selected="true"]').count(),
          3,
        );
        await cards.nth(2).click({ modifiers: ["Meta"] });
        assert.equal(
          await page.locator('.media-card[aria-selected="true"]').count(),
          2,
        );
        assert(
          (await page.locator(".reference-summary").innerText()).includes(
            "2 项",
          ),
        );
        await page
          .locator(".assistant-references .context-chip button")
          .first()
          .click();
        assert.equal(
          await page.locator('.media-card[aria-selected="true"]').count(),
          1,
        );
        await clearReferences();
      },
    );
    await step(
      "两个片段一起左键拖到同类轨道，显示落点，一次撤销恢复",
      async () => {
        let p = await project();
        await api("POST", "/api/projects/demo-city/commands", {
          requestId: "add-track",
          expectedRevision: p.revision,
          label: "测试第二画面轨道",
          commands: [
            {
              type: "track.add",
              timelineId: p.activeTimelineId,
              track: { id: "second-video", name: "画面 02", kind: "video" },
            },
          ],
        });
        await page.locator('[data-track-id="second-video"]').waitFor();
        const resizer = await page.locator(".timeline-resizer").boundingBox();
        await page.mouse.move(resizer.x + 350, resizer.y + 2);
        await page.mouse.down();
        await page.mouse.move(resizer.x + 350, resizer.y - 160, { steps: 5 });
        await page.mouse.up();
        const clips = page.locator(".timeline-clip.image");
        await clips.nth(0).click({ position: { x: 60, y: 20 } });
        await clips
          .nth(1)
          .click({ modifiers: ["Meta"], position: { x: 60, y: 20 } });
        assert.equal(await page.locator(".timeline-clip.selected").count(), 2);
        p = await project();
        const original = p.timelines[0].clips.filter((c) =>
          ["demo-clip-0", "demo-clip-1"].includes(c.id),
        );
        const from = await clips.nth(0).boundingBox(),
          to = await page
            .locator('[data-track-id="second-video"]')
            .boundingBox();
        await page.mouse.move(from.x + 60, from.y + 20);
        await page.mouse.down();
        await page.mouse.move(from.x + 60, to.y + to.height / 2, { steps: 12 });
        assert.equal(await page.locator(".track-row.drop-valid").count(), 1);
        assert(
          (await page.locator(".drop-guide").innerText()).includes("2 个片段"),
        );
        await screenshot("multi-drag");
        await page.mouse.up();
        await changed(p.revision);
        let after = await project();
        assert.equal(after.revision, p.revision + 1);
        assert(
          after.timelines[0].clips
            .filter((c) => original.some((x) => x.id === c.id))
            .every((c) => c.trackId === "second-video"),
        );
        await page.getByTitle("撤销（⌘ Z）", { exact: true }).click();
        await changed(after.revision);
        after = await project();
        for (const c of original)
          assert.deepEqual(
            after.timelines[0].clips.find((x) => x.id === c.id),
            c,
          );
      },
    );
    await step("不兼容轨道显示拒绝落点，Esc 取消拖动均不提交修改", async () => {
      let p = await project();
      const before = p.revision;
      let from = await page
          .locator(".timeline-clip.image")
          .first()
          .boundingBox(),
        to = await page.locator(".track-row").nth(1).boundingBox();
      await page.mouse.move(from.x + 60, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, to.y + to.height / 2, { steps: 8 });
      assert.equal(await page.locator(".track-row.drop-invalid").count(), 1);
      await page.mouse.up();
      await page.waitForTimeout(150);
      assert.equal((await project()).revision, before);
      from = await page.locator(".timeline-clip.image").first().boundingBox();
      to = await page.locator('[data-track-id="second-video"]').boundingBox();
      await page.mouse.move(from.x + 60, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, to.y + to.height / 2, { steps: 8 });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal((await project()).revision, before);
      await clearReferences();
    });
    await step("多选素材一起拖入时间线，作为一个可撤销操作", async () => {
      const cards = page.locator(".media-card");
      await cards.nth(0).click();
      await cards.nth(1).click({ modifiers: ["Meta"] });
      const before = await project();
      await cards
        .nth(0)
        .dragTo(page.locator('[data-track-id="second-video"] .track-clips'), {
          targetPosition: { x: 50, y: 25 },
        });
      await changed(before.revision);
      const after = await project();
      assert.equal(after.revision, before.revision + 1);
      assert.equal(
        after.timelines[0].clips.length,
        before.timelines[0].clips.length + 2,
      );
      const added = after.timelines[0].clips.filter(
        (c) => !before.timelines[0].clips.some((x) => x.id === c.id),
      );
      assert(added.every((c) => c.trackId === "second-video"));
      assert.equal(added[1].start, added[0].start + added[0].duration);
      await page.getByTitle("撤销（⌘ Z）", { exact: true }).click();
      await changed(after.revision);
      await clearReferences();
    });
    await step(
      "素材页多选和筛选自动进入实际模型上下文，对话批量整理生效",
      async () => {
        await api("POST", "/api/providers", {
          provider: {
            id: "fixture-chat",
            name: "本地验证模型",
            kind: "compatible",
            baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`,
            model: "fixture",
          },
        });
        await api("POST", "/api/agent/settings", {
          verify: false,
          learnPreferences: false,
        });
        await wait(async () =>
          (await page.locator(".model-picker").innerText()).includes(
            "离线指令",
          ),
        );
        await page.locator(".model-picker > button").first().click();
        await page
          .locator(".model-menu")
          .getByRole("button", { name: "本地验证模型" })
          .click();
        await page
          .locator(".agent-modes")
          .getByRole("radio", { name: "自动", exact: true })
          .click();
        await nav("素材");
        await page.locator(".library-filters input").fill(".svg");
        const cards = page.locator(".library-card");
        await cards.nth(0).click();
        await cards.nth(2).click({ modifiers: ["Shift"] });
        const input = await send("验证素材：整理这些素材");
        const line = input.messages[0].content
          .split("\n")
          .find((l) => l.startsWith("当前界面上下文："));
        const context = JSON.parse(line.slice("当前界面上下文：".length));
        assert.equal(context.page, "library");
        assert.equal(context.details.search, ".svg");
        assert.equal(
          context.references.filter((r) => r.kind === "asset").length,
          3,
        );
        assert(context.clientId);
        const p = await project();
        for (const r of context.references.filter((r) => r.kind === "asset"))
          assert(p.assets.find((a) => a.id === r.id).tags.includes("春日精选"));
        await screenshot("library-context");
        await clearReferences();
      },
    );
    await step("设置页通过对话更名和切换皮肤，真实数据与表单同步", async () => {
      await nav("设置");
      await send("验证设置：改名并关闭樱花动效");
      assert.equal((await api("GET", "/api/settings")).name, "樱花工作室");
      assert.equal(
        await page
          .locator(".settings-section")
          .first()
          .locator("input")
          .inputValue(),
        "樱花工作室",
      );
      assert.equal(
        await page.getByLabel("樱花线条与轻动效").isChecked(),
        false,
      );
      await screenshot("settings-control");
    });
    await step("技能引用无需切回工作台，对话停用技能并同步编辑器", async () => {
      await nav("技能");
      await page.locator(".page-search input").fill("文稿精剪");
      await page.getByLabel("引用「文稿精剪」", { exact: true }).click();
      await send("验证技能：停用这个技能");
      assert.equal(
        (await api("GET", "/api/skills")).find((s) => s.id === "cleanup")
          .enabled,
        false,
      );
      assert.equal(await page.locator(".skill-use").isDisabled(), true);
      await screenshot("skill-context");
      await clearReferences();
    });
    await step("模型页对话修改公开配置，模型选择器同步更新", async () => {
      await nav("模型");
      await page.getByLabel("引用「本地验证模型」", { exact: true }).click();
      await send("验证模型：修改这个模型的默认模型名");
      assert.equal(
        (await api("GET", "/api/providers")).find(
          (p) => p.id === "fixture-chat",
        ).model,
        "fixture-changed",
      );
      assert(
        (await page.locator(".model-picker").innerText()).includes(
          "fixture-changed",
        ),
      );
      await clearReferences();
    });
    await step("对话导航到故事开发子页和资源库字幕子页", async () => {
      await send("验证故事：打开故事开发");
      assert.equal(
        await page.locator('.story-tabs [aria-selected="true"]').innerText(),
        "开发",
      );
      await nav("工作台");
      await page
        .getByRole("button", { name: "剪辑", exact: true })
        .first()
        .click();
      await send("验证目录：打开字幕资源");
      assert.equal(
        await page.locator('.resource-tabs [aria-selected="true"]').innerText(),
        "字幕",
      );
    });
    await step("文件选择返回待用户操作，表单打开时助手仍可用", async () => {
      await send("验证文件：准备导入素材");
      assert.equal(await page.locator(".file-request").isVisible(), true);
      assert.equal(
        await page.locator(".chat-input textarea").isVisible(),
        true,
      );
      const input = await page.locator(".chat-input textarea").boundingBox();
      const hit = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        { x: input.x + 20, y: input.y + 20 },
      );
      assert.equal(hit, "TEXTAREA");
      await page.locator(".modal").getByTitle("关闭", { exact: true }).click();
    });
    await step(
      "外部运行时也能管理应用，实际确认与拒绝均生效（模拟 Codex 协议）",
      async () => {
        await page.locator(".model-picker > button").first().click();
        await page
          .locator(".model-menu")
          .getByRole("button", { name: "Codex", exact: false })
          .click();
        await page
          .locator(".chat-input textarea")
          .fill("外部验证：修改工作室名称");
        await page.getByTitle("发送", { exact: true }).click();
        await page.locator(".external-approval").waitFor();
        assert.equal((await api("GET", "/api/settings")).name, "樱花工作室");
        await screenshot("external-approval");
        await page
          .locator(".external-approval")
          .getByRole("button", { name: "允许这一次", exact: true })
          .click();
        await wait(
          async () =>
            (await api("GET", "/api/settings")).name === "外部确认工作室",
        );
        await wait(async () =>
          (
            await page.locator(".chat-message.assistant").last().innerText()
          ).includes("外部验证已执行"),
        );
        await page.locator(".chat-input textarea").fill("外部验证：拒绝修改");
        await page.getByTitle("发送", { exact: true }).click();
        await page.locator(".external-approval").waitFor();
        await page
          .locator(".external-approval")
          .getByRole("button", { name: "不要执行", exact: true })
          .click();
        await wait(async () =>
          (
            await page.locator(".chat-message.assistant").last().innerText()
          ).includes("外部验证已拒绝"),
        );
        assert.equal(
          (await api("GET", "/api/settings")).name,
          "外部确认工作室",
        );
      },
    );
    await step("深色主题保留，主题和动效偏好在重载后生效", async () => {
      await nav("设置");
      await page
        .getByRole("radio", { name: "墨绿 · 深色", exact: true })
        .click();
      await wait(
        async () =>
          (await page.locator("html").getAttribute("data-theme")) === "dark",
      );
      await screenshot("dark");
      await page
        .getByRole("radio", { name: "白色 · 浅色", exact: true })
        .click();
      await page.reload();
      await page.locator(".chat-input textarea").waitFor();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
      await nav("设置");
      assert.equal(
        await page.getByLabel("樱花线条与轻动效").isChecked(),
        false,
      );
      await page.getByLabel("樱花线条与轻动效").check();
    });
    await step("窄窗口助手可折叠，恢复后保留当前对话", async () => {
      const text = await page.locator(".agent-messages").innerText();
      await page.setViewportSize({ width: 1120, height: 800 });
      await page.getByLabel("收起创作助手", { exact: true }).click();
      assert.equal(await page.locator(".agent-panel").isVisible(), false);
      await page.getByLabel("展开创作助手", { exact: true }).click();
      assert.equal(await page.locator(".agent-messages").innerText(), text);
      await screenshot("small");
    });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(root, "evidence", `${prefix}-verification.json`),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          packaged,
          mockKeychain: true,
          externalRuntime: "scripted Codex protocol fixture; no account calls",
          steps,
          modelRequests: requests.length,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    await fs.rm(path.join(root, "evidence", `${prefix}-failure.png`), {
      force: true,
    });
    await fs.rm(path.join(root, "evidence", `${prefix}-failure.txt`), {
      force: true,
    });
    console.log(`${prefix}: ${steps.length} flows passed`);
  } catch (error) {
    await screenshot("failure").catch(() => {});
    await fs.writeFile(
      path.join(root, "evidence", `${prefix}-failure.txt`),
      `${currentStep}\n${error.stack}\n${await page.locator("body").innerText()}\n${JSON.stringify(errors)}`,
    );
    throw error;
  }
} finally {
  await application?.close();
  await new Promise((resolve) => fixture.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}
