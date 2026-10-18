import { builtinSkillRecords } from "./builtin-skills";
import fs from "node:fs";
import path from "node:path";
import {
  analyzePcm,
  activeTimeline,
  clipSchema,
  entitySchema,
  makeProject,
  markerSchema,
  shotSchema,
  type Asset,
} from "@tadacut/domain";
import { sampleArt } from "./sample-art";
import type { Repository, Skill } from "./storage";
function ambientWav(seconds: number) {
  const rate = 16000,
    count = rate * seconds;
  const out = Buffer.alloc(44 + count * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t / 2, (seconds - t) / 2);
    const value =
      (Math.sin(t * 2 * Math.PI * 130.81) +
        0.5 * Math.sin(t * 2 * Math.PI * 196) +
        0.25 * Math.sin(t * 2 * Math.PI * 261.63)) *
      0.065 *
      envelope *
      (0.85 + 0.15 * Math.sin(t * 0.5));
    out.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return out;
}
const sampleFile = (i: number) => `demo-landscape-${i}.svg`;

export function seed(repo: Repository, mediaDir: string) {
  fs.mkdirSync(mediaDir, { recursive: true });
  // Sample artwork written by an earlier version is redrawn in place; the
  // project only references these files by name.
  sampleArt.forEach((svg, i) => {
    const file = path.join(mediaDir, sampleFile(i));
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== svg)
      fs.writeFileSync(file, svg);
  });
  if (!repo.projects().length) {
    const now = new Date().toISOString(),
      p = makeProject("demo-city", "城市漫游", now),
      t = activeTimeline(p);
    const names = [
      "晨光里的城市",
      "沿着山脊出发",
      "暮色落在河面",
      "下一站，自由",
    ];
    for (let i = 0; i < 4; i++) {
      const aid = `demo-landscape-${i}`,
        file = sampleFile(i);
      fs.writeFileSync(path.join(mediaDir, file), sampleArt[i]);
      const asset: Asset = {
        id: aid,
        name: names[i] + ".svg",
        kind: "image",
        url: "/media/" + file,
        width: 1920,
        height: 1080,
        tags: ["示例素材", ["城市", "山野", "城市", "夜景"][i]],
        description: "TadaCut 原创示例画面",
        folder: "城市漫游",
        color: ["#9a86c2", "#5f9fd6", "#c46c7f", "#2b3170"][i],
        createdAt: now,
      };
      p.assets.push(asset);
      t.clips.push(
        clipSchema.parse({
          id: `demo-clip-${i}`,
          assetId: aid,
          trackId: t.tracks[0].id,
          start: i * 180,
          duration: 180,
          name: names[i],
          shotId: `shot-${i}`,
          transition: { kind: "dissolve", duration: 15 },
          keyframes: {
            scale: [
              { frame: 0, value: 1, easing: "ease-in-out" },
              { frame: 179, value: 1.08, easing: "linear" },
            ],
          },
        }),
      );
      p.story.shots.push(
        shotSchema.parse({
          id: `shot-${i}`,
          number: i + 1,
          title: names[i],
          description: [
            "清晨，城市在湖面上醒来。远景缓缓推进，让阳光先落到水面。",
            "走上山脊，风把云推远。切换到更开阔的视角。",
            "夕阳落进河里，桥上的灯亮起来，保留一点安静。",
            "夜路向前，星星陪着。最后一个镜头留给前方，轻轻淡出。",
          ][i],
          dialogue: "",
          duration: 6,
          assetId: aid,
          entityIds: ["scene-city"],
          status: "ready",
          prompt: "",
        }),
      );
    }
    p.story.title = "城市漫游 · 一段关于出发的短片";
    p.story.logline = "从晨光走到暮色，重新发现熟悉的城市。";
    p.story.entities.push(
      entitySchema.parse({
        id: "scene-city",
        kind: "scene",
        name: "城市与远山",
        description: "晨光与暮色里的城市、远山和水面，保持整体视觉一致。",
        referenceAssetIds: ["demo-landscape-0", "demo-landscape-2"],
        confirmed: true,
      }),
    );
    const ambient = ambientWav(24);
    fs.writeFileSync(path.join(mediaDir, "demo-ambient.wav"), ambient);
    const samples = new Float32Array((ambient.length - 44) / 2);
    for (let i = 0; i < samples.length; i++)
      samples[i] = ambient.readInt16LE(44 + i * 2) / 32768;
    p.assets.push({
      id: "demo-ambient",
      name: "Ambient · 原创示例配乐.wav",
      kind: "audio",
      url: "/media/demo-ambient.wav",
      duration: 24,
      waveform: analyzePcm(samples, 16000).waveform,
      tags: ["示例素材", "氛围"],
      description: "示例合成音色",
      folder: "城市漫游",
      color: "#b69c71",
      createdAt: now,
    });
    t.clips.push(
      clipSchema.parse({
        id: "demo-audio",
        assetId: "demo-ambient",
        trackId: t.tracks[1].id,
        start: 0,
        duration: 720,
        volume: 0.7,
        fadeIn: 45,
        fadeOut: 60,
        name: "Ambient / 原创配乐",
      }),
    );
    p.assets.push({
      id: "demo-title",
      name: "城市漫游 · 标题",
      kind: "text",
      url: "",
      text: "城市漫游",
      description: "",
      tags: ["标题"],
      folder: "文字",
      color: "#b09dcc",
      createdAt: now,
    });
    t.clips.push(
      clipSchema.parse({
        id: "demo-title-clip",
        assetId: "demo-title",
        trackId: t.tracks[2].id,
        start: 30,
        duration: 130,
        text: "城市漫游",
        textStyle: {
          fontSize: 98,
          color: "#ffffff",
          align: "center",
          bottom: 0.4,
          background: "transparent",
        },
        fadeIn: 20,
        fadeOut: 25,
      }),
    );
    t.markers = [
      markerSchema.parse({
        id: "demo-marker",
        frame: 180,
        label: "出发",
        color: "#d3ba85",
      }),
    ];
    p.canvas = p.story.shots.map((s, i) => ({
      id: `canvas-${s.id}`,
      kind: "shot",
      x: 80 + i * 290,
      y: 150,
      label: s.title,
      referenceId: s.id,
    }));
    repo.put(p);
  }
  if (!repo.providers().length)
    for (const p of [
      {
        id: "openai",
        name: "OpenAI",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        capabilities: [
          "chat",
          "image",
          "video",
          "speech",
          "transcription",
          "embedding",
        ],
      },
      {
        id: "ollama",
        name: "Ollama",
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        capabilities: ["chat", "embedding"],
      },
      {
        id: "lmstudio",
        name: "LM Studio",
        kind: "compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
        capabilities: ["chat", "embedding"],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        capabilities: ["chat"],
      },
    ])
      repo.saveProvider({
        ...p,
        model: "",
        models: {},
        routes: {},
        enabled: true,
      } as any);
  // Built-in skills follow the app version; the user's enabled choice is kept.
  for (const skill of builtinSkillRecords((id) =>
    repo.record<Skill>("skill", id),
  ))
    repo.save<Skill>("skill", skill);
}
