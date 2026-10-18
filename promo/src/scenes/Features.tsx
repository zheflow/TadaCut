import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import {
  ArrowLeftRight,
  AudioWaveform,
  Captions,
  CodeXml,
  FileText,
  Languages,
  LayoutGrid,
  Rows3,
  ScanFace,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { Card, CheckDot, Chip, Landscape, Words, trail } from "../kit";
import { accel, mix, pop, span } from "../motion";
import { BEAT, cues } from "../timeline";
import { clip, ink, mono } from "../theme";

const CARD = { left: 900, top: 170, width: 880, height: 740 };

const features: {
  icon: LucideIcon;
  label: string;
  title: [string, string];
  sub: string;
  Card: (props: { f: number }) => React.ReactNode;
}[] = [
  {
    icon: FileText,
    label: "文稿剪辑",
    title: ["删掉文字，", "就剪掉画面。"],
    sub: "本地 Whisper 词级转写 · 一键清理口癖",
    Card: TranscriptCard,
  },
  {
    icon: LayoutGrid,
    label: "分镜",
    title: ["从剧本到分镜，", "双向同步。"],
    sub: "角色、场景、镜头一处维护，联合修改一步撤销",
    Card: StoryCard,
  },
  {
    icon: CodeXml,
    label: "代码动画",
    title: ["动画，", "直接用代码写。"],
    sub: "React 代码动画 · 让 AI 生成，也能自己改",
    Card: CodeCard,
  },
  {
    icon: Smartphone,
    label: "竖屏重构",
    title: ["一键竖屏，", "主体自动跟随。"],
    sub: "本地 DETR 主体检测 · 原时间线保持不变",
    Card: ReframeCard,
  },
  {
    icon: Captions,
    label: "字幕",
    title: ["逐词高亮，", "一键双语。"],
    sub: "字幕样式 · 翻译保留原文 · 平台安全区",
    Card: CaptionCard,
  },
  {
    icon: AudioWaveform,
    label: "节拍卡点",
    title: ["剪辑点，", "自动卡上节拍。"],
    sub: "本机节拍分析 · 说话时自动压低配乐",
    Card: BeatCard,
  },
];

/** Six capabilities, one bar each. */
export function Features() {
  const frame = useCurrentFrame();
  const length = cues.features.length * BEAT;
  const current = Math.min(features.length - 1, Math.floor(frame / length));
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 150,
          display: "flex",
          gap: 10,
        }}
      >
        {features.map((f, i) => (
          <span
            key={f.label}
            style={{
              width: i === current ? 64 : 34,
              height: 7,
              borderRadius: 4,
              background: i <= current ? ink.accent : ink.line,
              opacity: i < current ? 0.35 : 1,
            }}
          />
        ))}
      </div>
      {features.map((feature, i) => (
        <Sequence
          key={feature.label}
          from={i * length}
          durationInFrames={length}
        >
          <Feature feature={feature} index={i} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function Feature({
  feature,
  index,
}: {
  feature: (typeof features)[number];
  index: number;
}) {
  const f = useCurrentFrame();
  const enter = pop(f, 0.05, { damping: 17, stiffness: 150 });
  const leave = span(f, 3.65, 4, accel);
  const C = feature.Card;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 300,
          width: 720,
          opacity: 1 - leave,
          transform: `translateY(${-leave * 70}px)`,
          filter: leave > 0 ? `blur(${leave * 8}px)` : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            opacity: enter,
          }}
        >
          <Chip
            icon={feature.icon}
            label={feature.label}
            tone="accent"
            size={26}
          />
          <span style={{ fontSize: 24, color: ink.faint, fontWeight: 500 }}>
            0{index + 1} / 0{features.length}
          </span>
        </div>
        <Words
          parts={[feature.title[0]]}
          at={0.1}
          size={92}
          style={{ marginTop: 34 }}
        />
        <Words parts={[feature.title[1]]} at={0.35} size={92} />
        <div
          style={{
            fontSize: 30,
            color: ink.muted,
            marginTop: 30,
            opacity: span(f, 0.6, 1.1),
            transform: `translateY(${(1 - span(f, 0.6, 1.1)) * 16}px)`,
          }}
        >
          {feature.sub}
        </div>
      </div>
      <Card
        style={{
          ...CARD,
          opacity: Math.min(1, enter * 1.4) * (1 - leave),
          transform: `perspective(2400px) translateY(${(1 - enter) * 160 - leave * 110}px) rotateX(${(1 - enter) * 14}deg) scale(${mix(0.94, 1, enter)})`,
          filter: leave > 0 ? `blur(${leave * 10}px)` : undefined,
        }}
      >
        <C f={f} />
      </Card>
    </AbsoluteFill>
  );
}

const header = (Icon: LucideIcon, title: string, right?: React.ReactNode) => (
  <div
    style={{
      height: 84,
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "0 36px",
      borderBottom: `1.5px solid ${ink.border}`,
      fontSize: 25,
      fontWeight: 600,
    }}
  >
    <Icon size={28} color={ink.muted} />
    {title}
    <span style={{ flex: 1 }} />
    {right}
  </div>
);

function TranscriptCard({ f }: { f: number }) {
  const words = [
    { t: "嗯，", cut: true },
    { t: "这座城市" },
    { t: "那个，", cut: true },
    { t: "每天早上" },
    { t: "都会" },
    { t: "就是", cut: true },
    { t: "慢慢醒过来。" },
    { t: "我喜欢" },
    { t: "呃，", cut: true },
    { t: "从桥上" },
    { t: "一路走到河边。" },
  ];
  let k = 0;
  const marks = words.map((w) => (w.cut ? k++ : -1));
  return (
    <>
      {header(
        FileText,
        "文稿 · 城市采访.m4a",
        <Chip
          label="本地 Whisper"
          tone="success"
          size={20}
          dot={ink.success}
        />,
      )}
      <div
        style={{
          padding: "40px 44px 0",
          fontSize: 50,
          lineHeight: 1.75,
          fontWeight: 500,
        }}
      >
        {words.map((w, i) => {
          if (!w.cut) return <span key={i}>{w.t}</span>;
          const marked = span(f, 0.7 + marks[i] * 0.22, 0.9 + marks[i] * 0.22);
          const gone = span(f, 2.0 + marks[i] * 0.1, 2.6 + marks[i] * 0.1);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                verticalAlign: "bottom",
                maxWidth: `${(1 - gone) * w.t.length * 1.05}em`,
                overflow: "hidden",
                whiteSpace: "nowrap",
                opacity: 1 - gone,
                color: marked > 0.5 ? ink.danger : ink.text,
                background: `rgba(254,205,202,${marked * 0.9})`,
                borderRadius: 10,
                textDecoration: marked > 0.5 ? "line-through" : undefined,
                textDecorationThickness: 4,
              }}
            >
              {w.t}
            </span>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 44,
          bottom: 182,
          fontSize: 19,
          color: ink.muted,
        }}
      >
        时间线上对应的画面
      </div>
      <div
        style={{
          position: "absolute",
          left: 44,
          right: 44,
          bottom: 120,
          display: "flex",
          gap: 5,
          height: 44,
        }}
      >
        {words.map((w, i) => {
          const marked = w.cut
            ? span(f, 0.7 + marks[i] * 0.22, 0.9 + marks[i] * 0.22)
            : 0;
          const gone = w.cut
            ? span(f, 2.0 + marks[i] * 0.1, 2.6 + marks[i] * 0.1)
            : 0;
          return (
            <span
              key={i}
              style={{
                flex: `0 0 ${(1 - gone) * w.t.length * 19}px`,
                marginRight: gone > 0.99 ? -5 : 0,
                borderRadius: 6,
                background: marked > 0.5 ? "#f6b8b2" : clip.video.fill,
                border: `1.5px solid ${marked > 0.5 ? "#ee8a80" : clip.video.line}`,
                opacity: 1 - gone,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 44,
          bottom: 40,
          opacity: span(f, 2.8, 3.2),
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 24,
          color: ink.success,
          fontWeight: 600,
        }}
      >
        <CheckDot t={span(f, 2.8, 3.3)} size={30} />
        删掉 4 处口癖，画面同步剪好
      </div>
    </>
  );
}

function StoryCard({ f }: { f: number }) {
  const rows = [
    "清晨，城市在湖面上醒来。",
    "走上山脊，风把云推远。",
    "夕阳落进河里，灯亮起来。",
    "夜路向前，星星陪着。",
  ];
  const titles = ["城市醒来", "沿着山脊出发", "暮色落在河面", "下一站，自由"];
  const spin = span(f, 2.5, 3.1);
  return (
    <>
      {header(Rows3, "剧本 → 分镜")}
      {rows.map((row, i) => {
        const t = pop(f, 0.2 + i * 0.15, { damping: 18 });
        return (
          <div
            key={row}
            style={{
              position: "absolute",
              left: 36,
              top: 128 + i * 112,
              width: 340,
              display: "flex",
              gap: 14,
              alignItems: "center",
              fontSize: 22,
              lineHeight: 1.4,
              opacity: t,
              transform: `translateX(${(1 - t) * -24}px)`,
            }}
          >
            <span
              style={{
                flex: "0 0 40px",
                height: 32,
                borderRadius: 8,
                background: ink.raised,
                color: ink.muted,
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: mono,
              }}
            >
              0{i + 1}
            </span>
            {row}
          </div>
        );
      })}
      <svg
        style={{ position: "absolute", inset: 0 }}
        width={CARD.width}
        height={CARD.height}
      >
        {rows.map((row, i) => {
          const tx = 440 + (i % 2) * 210,
            ty = 150 + Math.floor(i / 2) * 230 + 60;
          return (
            <path
              key={row}
              d={`M380 ${144 + i * 112}C410 ${144 + i * 112} ${tx - 40} ${ty} ${tx} ${ty}`}
              fill="none"
              stroke={ink.accent}
              strokeWidth="2"
              strokeOpacity=".45"
              pathLength={1}
              strokeDasharray="1"
              strokeDashoffset={1 - span(f, 0.7 + i * 0.2, 1.2 + i * 0.2)}
            />
          );
        })}
      </svg>
      {titles.map((title, i) => {
        const t = pop(f, 0.9 + i * 0.2, { damping: 14 });
        return (
          <div
            key={title}
            style={{
              position: "absolute",
              left: 440 + (i % 2) * 210,
              top: 150 + Math.floor(i / 2) * 230,
              width: 196,
              borderRadius: 14,
              overflow: "hidden",
              border: `1.5px solid ${ink.line}`,
              background: ink.surface,
              opacity: t,
              transform: `scale(${mix(0.8, 1, t)})`,
            }}
          >
            <div style={{ height: 118, position: "relative" }}>
              <Landscape variant={i} drift={-f * 0.4} />
              <span
                style={{
                  position: "absolute",
                  left: 8,
                  top: 8,
                  fontSize: 13,
                  fontFamily: mono,
                  padding: "2px 7px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,.85)",
                  color: ink.muted,
                }}
              >
                0{i + 1}
              </span>
            </div>
            <div
              style={{
                padding: "10px 12px",
                fontSize: 18,
                fontWeight: 600,
                color: ink.accentDeep,
              }}
            >
              {title}
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 36,
          display: "flex",
          justifyContent: "center",
          opacity: pop(f, 2.2),
          transform: `scale(${mix(0.8, 1, pop(f, 2.2))})`,
        }}
      >
        <Chip
          label={
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <ArrowLeftRight
                size={24}
                style={{ transform: `rotate(${spin * 180}deg)` }}
              />
              分镜与剪辑双向同步
            </span>
          }
          tone="accent"
          size={24}
        />
      </div>
    </>
  );
}

const kw = "#7c3aed",
  fn = "#2459c7",
  str = "#067647",
  num = "#b54708",
  tag = "#2f6fed",
  pun = "#5f6672";
const code: [string, string][][] = [
  [
    ["export default ", kw],
    ["({ frame, fps }) => {", pun],
  ],
  [
    ["  const ", kw],
    ["t", ink.text],
    [" = Math.", pun],
    ["min", fn],
    ["(", pun],
    ["1", num],
    [", frame / fps);", pun],
  ],
  [
    ["  return ", kw],
    ["(", pun],
  ],
  [
    ["    <h1 ", tag],
    ["style", fn],
    ["={{ opacity: t, letterSpacing: ", pun],
    ["40", num],
    [" * (", pun],
    ["1", num],
    [" - t) }}>", pun],
  ],
  [["      城市漫游", str]],
  [["    </h1>", tag]],
  [["  );", pun]],
  [["};", pun]],
];
const codeLength = code.reduce(
  (sum, line) => sum + line.reduce((s, [t]) => s + t.length, 0),
  0,
);

function CodeCard({ f }: { f: number }) {
  let budget = Math.floor(codeLength * span(f, 0.15, 2.0, (t) => t));
  const play = span(f, 2.2, 3.4);
  return (
    <>
      {header(
        CodeXml,
        "Title.tsx",
        <Chip
          label="运行中"
          tone="success"
          size={20}
          dot={ink.success}
          style={{ opacity: span(f, 2.0, 2.3) }}
        />,
      )}
      <div
        style={{
          padding: "26px 30px",
          fontFamily: mono,
          fontSize: 21,
          lineHeight: 1.62,
          background: "#fbfcfd",
          height: 380,
          borderBottom: `1.5px solid ${ink.border}`,
        }}
      >
        {code.map((line, i) => (
          <div key={i} style={{ display: "flex", whiteSpace: "pre" }}>
            <span style={{ width: 40, color: ink.faint }}>{i + 1}</span>
            {line.map(([text, color], j) => {
              const shown = text.slice(0, Math.max(0, budget));
              budget -= text.length;
              return (
                <span key={j} style={{ color }}>
                  {shown}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 200,
          top: 480,
          width: 480,
          height: 230,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(16,24,40,.2)",
        }}
      >
        <Landscape variant={3} drift={-f * 0.5} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 54,
            fontWeight: 700,
            textShadow: "0 3px 18px rgba(0,0,0,.35)",
            opacity: play,
            letterSpacing: 40 * (1 - play),
          }}
        >
          城市漫游
        </div>
      </div>
    </>
  );
}

function ReframeCard({ f }: { f: number }) {
  const k = 820 / 1920;
  const walker = mix(
    330,
    1480,
    span(f, 0, 4, (t) => t),
  );
  const cropW = 1080 * (9 / 16);
  const cropX = Math.max(0, Math.min(1920 - cropW, walker - cropW / 2));
  const y = trail(walker);
  const found = span(f, 0.5, 0.9);
  return (
    <>
      {header(
        Smartphone,
        "复制为竖版时间线",
        <Chip icon={ScanFace} label="本地 DETR" tone="success" size={20} />,
      )}
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 112,
          width: 820,
          height: 461,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <Landscape variant={1} walker={walker} />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: cropX * k,
            background: "rgba(10,16,24,.55)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: (cropX + cropW) * k,
            right: 0,
            top: 0,
            bottom: 0,
            background: "rgba(10,16,24,.55)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: cropX * k,
            top: 0,
            width: cropW * k,
            bottom: 0,
            border: "3px solid #fff",
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: (walker - 50) * k,
            top: (y - 172) * k,
            width: 100 * k,
            height: 180 * k,
            border: `2.5px dashed ${ink.accent}`,
            borderRadius: 6,
            opacity: found,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: -2,
              top: -30,
              fontSize: 15,
              padding: "2px 8px",
              borderRadius: 6,
              background: ink.accent,
              color: "#fff",
              whiteSpace: "nowrap",
            }}
          >
            人物 0.93
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 610,
          display: "flex",
          gap: 14,
          alignItems: "center",
        }}
      >
        {["9:16", "1:1", "4:5", "16:9"].map((r, i) => (
          <Chip
            key={r}
            label={r}
            tone={i === 0 ? "accent" : "quiet"}
            size={22}
            style={{ fontFamily: mono }}
          />
        ))}
        <span style={{ fontSize: 22, color: ink.muted, marginLeft: 12 }}>
          主体按裁切窗口居中，平滑跟随
        </span>
      </div>
    </>
  );
}

function CaptionCard({ f }: { f: number }) {
  const words = ["从", "晨光", "走到", "暮色"];
  const rows = [
    ["样式", "逐词高亮"],
    ["翻译", "English · 保留原文"],
    ["安全区", "抖音 · 小红书 · B 站"],
  ];
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 60,
          width: 330,
          height: 587,
          borderRadius: 46,
          border: "10px solid #15181d",
          overflow: "hidden",
          boxShadow: "0 18px 40px rgba(16,24,40,.25)",
        }}
      >
        <Landscape variant={0} aspect={9 / 16} focus={0.45} drift={-f * 0.4} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "9%",
            borderTop: "2px dashed rgba(255,255,255,.35)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "16%",
            borderTop: "2px dashed rgba(255,255,255,.35)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "20%",
            textAlign: "center",
            fontSize: 36,
            fontWeight: 700,
            color: "#fff",
            textShadow: "0 2px 10px rgba(0,0,0,.6)",
          }}
        >
          {words.map((w, i) => {
            const on = f >= (0.5 + i * 0.5) * BEAT;
            return (
              <span
                key={w}
                style={{
                  color: on ? "#ffd84d" : "#fff",
                  display: "inline-block",
                  transform: `scale(${on && f < (1 + i * 0.5) * BEAT ? 1.1 : 1})`,
                }}
              >
                {w}
              </span>
            );
          })}
          <div
            style={{
              fontSize: 20,
              fontWeight: 500,
              marginTop: 6,
              opacity: span(f, 2.4, 2.8),
              color: "rgba(255,255,255,.92)",
            }}
          >
            From dawn to dusk
          </div>
        </div>
      </div>
      {rows.map(([name, value], i) => {
        const t = pop(f, 0.3 + i * 0.25, { damping: 17 });
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: 460,
              top: 150 + i * 130,
              width: 380,
              height: 104,
              borderRadius: 18,
              border: `1.5px solid ${i === 1 ? "#cfdffd" : ink.line}`,
              background: i === 1 ? ink.accentSoft : ink.surface,
              padding: "18px 22px",
              opacity: t,
              transform: `translateX(${(1 - t) * 40}px)`,
            }}
          >
            <div
              style={{
                fontSize: 18,
                color: ink.muted,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {i === 1 && <Languages size={18} />}
              {name}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 600,
                marginTop: 8,
                color: i === 1 ? ink.accentDeep : ink.text,
              }}
            >
              {value}
            </div>
          </div>
        );
      })}
    </>
  );
}

function BeatCard({ f }: { f: number }) {
  const marker = (k: number) => 50 + k * 97;
  const start = [8, 2.3, 4.6, 6.1],
    target = [0, 2, 4, 6];
  const bars = Array.from({ length: 160 }, (_, i) => {
    const x = 50 + i * 4.9;
    const phase = ((x - 50) / 97) % 1;
    const a =
      10 +
      64 * Math.exp(-phase * 5) +
      14 * Math.abs(Math.sin(i * 1.3) * Math.sin(i * 0.21));
    return { x, a };
  });
  return (
    <>
      {header(
        AudioWaveform,
        "配乐 · 120 BPM",
        <Chip label="节拍分析" tone="success" size={20} dot={ink.success} />,
      )}
      {Array.from({ length: 9 }, (_, k) => {
        const t = span(f, 0.2 + k * 0.08, 0.45 + k * 0.08);
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: marker(k),
              top: 126,
              width: 2,
              height: 400 * t,
              background: ink.accent,
              opacity: 0.5,
            }}
          >
            <span
              style={{
                position: "absolute",
                left: -7,
                top: -9,
                width: 16,
                height: 16,
                background: ink.accent,
                transform: `rotate(45deg) scale(${t})`,
              }}
            />
          </div>
        );
      })}
      {target.map((to, i) => {
        const t = pop(f, 1.3 + i * 0.18, { damping: 9, stiffness: 180 });
        const from = start[i] - (i === 0 ? 7.6 : 0);
        const x = marker(mix(from, to, t));
        const flash =
          span(f, 1.3 + i * 0.18, 1.5 + i * 0.18) *
          (1 - span(f, 1.55 + i * 0.18, 1.9 + i * 0.18));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + 3,
              top: 150,
              width: 2 * 97 - 8,
              height: 70,
              borderRadius: 8,
              overflow: "hidden",
              border: `2px solid ${flash > 0.3 ? ink.accent : clip.video.line}`,
              boxShadow:
                flash > 0
                  ? `0 0 0 ${flash * 6}px rgba(47,111,237,.25)`
                  : undefined,
            }}
          >
            <Landscape variant={i} lite />
          </div>
        );
      })}
      <svg
        style={{ position: "absolute", left: 0, top: 260 }}
        width={CARD.width}
        height={150}
      >
        <rect
          x="46"
          y="4"
          width="784"
          height="142"
          rx="10"
          fill={clip.audio.fill}
          stroke={clip.audio.line}
          strokeWidth="2"
        />
        {bars.map((b) => (
          <line
            key={b.x}
            x1={b.x + 2}
            x2={b.x + 2}
            y1={75 - b.a / 2}
            y2={75 + b.a / 2}
            stroke="#b88d4f"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 340,
          top: 448,
          width: 260,
          height: 46,
          borderRadius: 8,
          background: clip.motion.fill,
          border: `2px solid ${clip.motion.line}`,
          color: clip.motion.text,
          fontSize: 18,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          fontWeight: 600,
        }}
      >
        对白
      </div>
      <svg
        style={{ position: "absolute", left: 0, top: 510 }}
        width={CARD.width}
        height={120}
      >
        <path
          d="M50 30H310L350 90H590L630 30H830"
          fill="none"
          stroke={ink.warning}
          strokeWidth="4"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset={1 - span(f, 2.2, 2.9)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 50,
          bottom: 40,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 24,
          fontWeight: 600,
          color: ink.warning,
          opacity: span(f, 2.8, 3.2),
        }}
      >
        说话时，配乐自动让路
      </div>
    </>
  );
}
