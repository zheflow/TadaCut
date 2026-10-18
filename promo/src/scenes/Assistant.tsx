import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import {
  Aperture,
  ArrowUp,
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
  Clapperboard,
  Film,
  FolderOpen,
  Layers,
  LayoutGrid,
  Magnet,
  MonitorPlay,
  Moon,
  MousePointer2,
  Music,
  PanelRight,
  Play,
  Puzzle,
  Redo2,
  RotateCcw,
  Scissors,
  Search,
  Settings2,
  Shapes,
  SkipBack,
  SkipForward,
  Sparkles,
  Type,
  Undo2,
  WandSparkles,
} from "lucide-react";
import {
  BrandBars,
  CheckDot,
  Cursor,
  Landscape,
  Ripple,
  Spinner,
  Wordmark,
  Words,
} from "../kit";
import { accel, inOut, keys, mix, pop, span } from "../motion";
import { BEAT, cues, prompt } from "../timeline";
import { clip, ink, mono, shadow } from "../theme";

/** Window placement on the canvas. */
const X0 = 160,
  Y0 = 90,
  W = 1600,
  H = 900;
const PPS = 40; // timeline pixels per second
const steps = [
  { title: "读取时间线", detail: "4 个片段 · 24 秒" },
  { title: "调整为 15 秒", detail: "按比例缩短，保留转场" },
  { title: "复制为 9:16 竖版", detail: "新时间线 · 主体居中" },
  { title: "生成字幕", detail: "逐词高亮 · 避开人物" },
];
const shots = ["晨光里的城市", "沿着山脊出发", "暮色落在河面", "下一站，自由"];
const captions = ["清晨，城市醒来", "穿过山脊", "暮色落在河面", "下一站，自由"];
const nav = [
  [Clapperboard, "工作台"],
  [FolderOpen, "项目"],
  [Layers, "素材"],
  [Aperture, "模型"],
  [Shapes, "技能"],
  [Puzzle, "扩展"],
  [LayoutGrid, "任务"],
] as const;

// Camera: zoom into the assistant to type, back out to watch the edit land,
// then park the window on the right for the headline.
const camera = {
  s: [
    [0, 1],
    [2.25, 1],
    [3, 1.65],
    [12, 1.65],
    [13, 1],
    [14.2, 1],
    [15.2, 1.22],
    [17.7, 1.22],
    [18.7, 0.6],
  ] as [number, number][],
  x: [
    [0, 960],
    [2.25, 960],
    [3, 1188],
    [12, 1188],
    [13, 960],
    [14.2, 960],
    [15.2, 800],
    [17.7, 800],
    [18.7, 410],
  ] as [number, number][],
  y: [
    [0, 540],
    [2.25, 540],
    [3, 688],
    [5.6, 688],
    [6.4, 545],
    [12, 545],
    [13, 540],
    [14.2, 540],
    [15.2, 600],
    [17.7, 600],
    [18.7, 540],
  ] as [number, number][],
};

const box = (
  left: number,
  top: number,
  width: number,
  height: number,
  style: React.CSSProperties = {},
): React.CSSProperties => ({
  position: "absolute",
  left,
  top,
  width,
  height,
  ...style,
});

export function Assistant() {
  const frame = useCurrentFrame();
  const c = cues.assistant;
  const s = keys(frame, camera.s),
    fx = keys(frame, camera.x),
    fy = keys(frame, camera.y);
  const toScreen = (x: number, y: number) => [
    (x - fx) * s + 960,
    (y - fy) * s + 540,
  ];
  const [bx, by] = toScreen(X0 + 1282, Y0 + 574);
  const cursorX = keys(frame, [
    [12.6, 1720],
    [13.4, bx],
    [14.1, bx],
    [15, 980],
  ]);
  const cursorY = keys(frame, [
    [12.6, 1100],
    [13.4, by],
    [14.1, by],
    [15, 800],
  ]);
  const press =
    span(frame, c.click - 0.08, c.click, inOut) *
    (1 - span(frame, c.click + 0.1, c.click + 0.3));
  const exit = span(frame, 23.4, 24, accel);
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <AbsoluteFill
        style={{
          transformOrigin: "0 0",
          transform: `translate(${960 - fx * s}px, ${540 - fy * s}px) scale(${s})`,
        }}
      >
        <StudioWindow frame={frame} />
      </AbsoluteFill>
      {frame > 12.5 * BEAT && frame < 15.6 * BEAT && (
        <>
          <Ripple x={bx} y={by} t={span(frame, c.click, c.click + 0.8)} />
          <Cursor
            x={cursorX}
            y={cursorY}
            press={press}
            opacity={span(frame, 12.6, 12.9) * (1 - span(frame, 14.9, 15.5))}
          />
        </>
      )}
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 330,
          transform: `translateX(${-exit * 60}px)`,
        }}
      >
        <Words parts={["你说想法，"]} at={c.outro + 0.6} size={100} />
        <Words
          parts={["它来", { text: "动手", color: ink.accent }, "。"]}
          at={c.outro + 1.4}
          size={100}
        />
        <div style={{ marginTop: 44, display: "grid", gap: 20 }}>
          {["先出方案，你确认才写入", "每次修改，都能一步撤销"].map(
            (text, i) => {
              const t = pop(frame, c.outro + 2.6 + i * 0.6, { damping: 20 });
              return (
                <div
                  key={text}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    fontSize: 34,
                    fontWeight: 500,
                    color: ink.muted,
                    opacity: t,
                    transform: `translateY(${(1 - t) * 24}px)`,
                  }}
                >
                  <CheckDot
                    t={span(
                      frame,
                      c.outro + 2.8 + i * 0.6,
                      c.outro + 3.4 + i * 0.6,
                    )}
                    size={34}
                  />
                  {text}
                </div>
              );
            },
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function StudioWindow({ frame }: { frame: number }) {
  const c = cues.assistant;
  const enter = pop(frame, 0, { damping: 18, stiffness: 110 });
  const typed = Math.floor(
    prompt.length * span(frame, c.type[0], c.type[1], (t) => t),
  );
  const sent = frame >= c.send * BEAT;
  const applied = frame >= c.applied * BEAT;
  const reframe = pop(frame, c.applied + 0.3, { damping: 17, stiffness: 120 });
  const frameW = mix(640, 214, reframe),
    frameH = mix(360, 380, reframe);
  return (
    <div
      style={{
        ...box(X0, Y0, W, H),
        background: ink.surface,
        borderRadius: 18,
        border: `1.5px solid ${ink.line}`,
        boxShadow: shadow.float,
        overflow: "hidden",
        fontSize: 13,
        color: ink.text,
        transform: `perspective(2600px) translateY(${(1 - enter) * 480}px) rotateX(${(1 - enter) * 24}deg) scale(${mix(0.86, 1, enter)})`,
        opacity: Math.min(1, enter * 2),
      }}
    >
      {/* Navigation rail */}
      <div style={box(0, 0, 72, H, { borderRight: `1px solid ${ink.border}` })}>
        <div
          style={{
            display: "flex",
            gap: 7,
            position: "absolute",
            left: 14,
            top: 14,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span
              key={color}
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: color,
              }}
            />
          ))}
        </div>
        <div style={{ position: "absolute", left: 20, top: 46 }}>
          <BrandBars />
        </div>
        {nav.map(([Icon, label], i) => (
          <div
            key={label}
            style={{
              ...box(8, 104 + i * 70, 56, 60),
              borderRadius: 9,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 10,
              color: i === 0 ? ink.accent : "#676d76",
              background: i === 0 ? ink.accentSoft : undefined,
            }}
          >
            <Icon size={20} strokeWidth={1.8} />
            {label}
          </div>
        ))}
        <div
          style={{
            ...box(8, H - 96, 56, 56),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#676d76",
          }}
        >
          <Settings2 size={20} strokeWidth={1.8} />
        </div>
      </div>
      {/* Top bar */}
      <div
        style={{
          ...box(72, 0, W - 72, 56),
          borderBottom: `1px solid ${ink.border}`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 22px",
        }}
      >
        <Wordmark size={17} />
        <span
          style={{
            fontSize: 9.5,
            letterSpacing: 2,
            color: "#9198a0",
            fontWeight: 500,
          }}
        >
          STUDIO
        </span>
        <span
          style={{
            width: 1,
            height: 20,
            background: "#d6dbe3",
            margin: "0 6px",
          }}
        />
        <FolderOpen size={16} color={ink.muted} />
        <span style={{ fontWeight: 500 }}>城市漫游</span>
        <ChevronDown size={14} color={ink.faint} />
        <span
          style={{
            fontSize: 11,
            padding: "3px 7px",
            borderRadius: 5,
            background: ink.raised,
            color: ink.muted,
            border: `1px solid ${ink.line}`,
          }}
        >
          示例项目
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11.5,
            color: ink.muted,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ink.accent,
            }}
          />
          已保存到本机
        </span>
        <Moon size={17} color={ink.muted} />
        <Bell size={17} color={ink.muted} />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 7,
            background: ink.accentSoft,
            color: ink.accentDeep,
            border: "1px solid #cfdffd",
          }}
        >
          <PanelRight size={15} /> 创作助手
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 16px",
            borderRadius: 7,
            background: ink.accent,
            color: "#fff",
            fontWeight: 600,
          }}
        >
          <ArrowUpRight size={15} /> 导出
        </span>
      </div>
      {/* Workspace tabs */}
      <div
        style={{
          ...box(72, 56, 1138, 44),
          borderBottom: `1px solid ${ink.border}`,
          display: "flex",
          alignItems: "center",
          gap: 30,
          padding: "0 30px",
        }}
      >
        {[
          [Film, "剪辑"],
          [LayoutGrid, "分镜"],
          [BookOpen, "文稿"],
          [MonitorPlay, "应用录制"],
          [Shapes, "创作画布"],
        ].map(([Icon, label], i) => {
          const I = Icon as typeof Film;
          return (
            <span
              key={label as string}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 44,
                fontWeight: i === 0 ? 600 : 400,
                color: i === 0 ? ink.text : ink.muted,
                borderBottom:
                  i === 0 ? `2px solid ${ink.accent}` : "2px solid transparent",
              }}
            >
              <I size={15} /> {label as string}
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: ink.muted,
          }}
        >
          <WandSparkles size={15} /> 创作工具
        </span>
      </div>
      {/* Project media */}
      <div
        style={{
          ...box(72, 100, 250, 490),
          borderRight: `1px solid ${ink.border}`,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 18,
            fontWeight: 600,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              borderBottom: `2px solid ${ink.accent}`,
              paddingBottom: 6,
            }}
          >
            素材
          </span>
          <span style={{ color: ink.muted, fontWeight: 400 }}>资源库</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 32,
            borderRadius: 7,
            border: `1px solid ${ink.line}`,
            padding: "0 10px",
            color: ink.faint,
            fontSize: 12,
            marginBottom: 14,
          }}
        >
          <Search size={14} /> 搜索素材、标签…
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          {shots.map((name, i) => (
            <div key={name}>
              <div style={{ height: 62, borderRadius: 6, overflow: "hidden" }}>
                <Landscape variant={i} lite />
              </div>
              <div style={{ fontSize: 11, marginTop: 6, whiteSpace: "nowrap" }}>
                {name}
              </div>
              <div style={{ fontSize: 10, color: ink.faint }}>1920 × 1080</div>
            </div>
          ))}
        </div>
      </div>
      {/* Preview */}
      <div style={{ ...box(322, 100, 888, 490), background: "#fafbfc" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "11px 18px",
            color: ink.muted,
            fontSize: 12,
          }}
        >
          <span>预览</span>
          <span>{applied ? "1080 × 1920" : "1920 × 1080"} · 30 FPS</span>
        </div>
        <div
          style={{
            ...box((888 - frameW) / 2, 36 + (404 - frameH) / 2, frameW, frameH),
            borderRadius: 4,
            overflow: "hidden",
            boxShadow: "0 8px 24px rgba(16,24,40,.18)",
            background: "#111",
          }}
        >
          <Landscape
            variant={0}
            aspect={frameW / frameH}
            focus={0.56}
            drift={-frame * 0.15}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 30,
              fontWeight: 600,
              textShadow: "0 2px 12px rgba(0,0,0,.4)",
              opacity: 1 - reframe,
            }}
          >
            城市漫游
          </div>
          {applied && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 54,
                textAlign: "center",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                textShadow: "0 1px 6px rgba(0,0,0,.6)",
                opacity: span(frame, c.applied + 0.9, c.applied + 1.3),
              }}
            >
              {[..."清晨，城市醒来"].map((ch, i) => (
                <span
                  key={i}
                  style={{
                    color:
                      frame >= (c.applied + 1.3 + i * 0.12) * BEAT
                        ? "#ffd84d"
                        : "#fff",
                  }}
                >
                  {ch}
                </span>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            ...box(0, 440, 888, 50),
            display: "flex",
            alignItems: "center",
            padding: "0 22px",
            gap: 22,
            color: ink.muted,
          }}
        >
          <span style={{ fontFamily: mono, fontSize: 12, color: ink.text }}>
            00:02:00 / {applied && reframe > 0.5 ? "00:15:00" : "00:24:00"}
          </span>
          <span style={{ flex: 1 }} />
          <SkipBack size={16} />
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: ink.accentSoft,
              color: ink.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Play size={16} fill={ink.accent} />
          </span>
          <SkipForward size={16} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12 }}>适合窗口</span>
        </div>
        <Toast frame={frame} />
      </div>
      <Timeline frame={frame} />
      <AssistantPanel frame={frame} typed={typed} sent={sent} />
      {/* Status bar */}
      <div
        style={{
          ...box(72, H - 24, W - 72, 24),
          borderTop: `1px solid ${ink.border}`,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 16px",
          fontSize: 11,
          color: ink.muted,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ink.accent,
            }}
          />
          本地创作空间
        </span>
        <span>4 个素材 · 4 个分镜</span>
        <span style={{ flex: 1 }} />
        <span>TadaCut 0.2</span>
      </div>
    </div>
  );
}

function Toast({ frame }: { frame: number }) {
  const c = cues.assistant;
  const t =
    pop(frame, c.applied + 1, { damping: 16 }) *
    (1 - span(frame, 17.4, 17.9, accel));
  if (t <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 6,
        transform: `translate(-50%, ${(1 - t) * 30}px)`,
        opacity: Math.min(1, t * 1.5),
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: ink.surface,
        border: `1px solid #c3ecd6`,
        boxShadow: shadow.card,
        fontSize: 13,
        whiteSpace: "nowrap",
      }}
    >
      <CheckDot t={span(frame, c.applied + 1.1, c.applied + 1.6)} size={20} />
      <span style={{ fontWeight: 600 }}>已应用 4 项修改</span>
      <span style={{ color: ink.muted }}>⌘Z 一步撤销</span>
    </div>
  );
}

function Timeline({ frame }: { frame: number }) {
  const c = cues.assistant;
  const applied = frame >= c.applied * BEAT;
  const head = (
    Icon: typeof Film,
    label: string,
    top: number,
    height: number,
  ) => (
    <div
      style={{
        ...box(0, top, 128, height),
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        borderBottom: `1px solid ${ink.border}`,
        borderRight: `1px solid ${ink.border}`,
        fontSize: 12,
      }}
    >
      <Icon size={15} color={ink.muted} /> {label}
    </div>
  );
  const audio = pop(frame, c.applied + 0.3, { damping: 18 });
  return (
    <div
      style={box(72, 590, 1138, 286, { borderTop: `1px solid ${ink.border}` })}
    >
      <div
        style={{
          ...box(0, 0, 1138, 40),
          borderBottom: `1px solid ${ink.border}`,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 16px",
          color: ink.muted,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: ink.text,
            fontSize: 12,
            minWidth: 94,
          }}
        >
          {applied ? "竖版 9:16" : "主时间线"} <ChevronDown size={13} />
        </span>
        <span
          style={{
            width: 28,
            height: 26,
            borderRadius: 6,
            background: ink.accentSoft,
            color: ink.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MousePointer2 size={14} />
        </span>
        <Scissors size={15} />
        <Undo2 size={15} />
        <Redo2 size={15} />
        <span style={{ flex: 1 }} />
        <Magnet size={15} color={ink.accent} />
        <span
          style={{
            width: 90,
            height: 4,
            borderRadius: 2,
            background: ink.line,
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 0,
              width: 40,
              height: 4,
              borderRadius: 2,
              background: ink.accent,
            }}
          />
        </span>
      </div>
      <div
        style={{
          ...box(128, 40, 1010, 24),
          borderBottom: `1px solid ${ink.border}`,
          fontFamily: mono,
          fontSize: 10,
          color: ink.faint,
        }}
      >
        {Array.from({ length: 13 }, (_, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: 10 + i * 2 * PPS - 14,
              top: 6,
            }}
          >
            00:{String(i * 2).padStart(2, "0")}
          </span>
        ))}
      </div>
      {head(Film, "画面 01", 64, 58)}
      {head(Music, "配乐", 122, 50)}
      {head(Type, "字幕", 172, 50)}
      <div style={box(128, 64, 1010, 160)}>
        {shots.map((name, i) => {
          const t = pop(frame, c.applied + i * 0.12, {
            damping: 16,
            stiffness: 150,
          });
          const drop = pop(frame, 0.6 + i * 0.15, { damping: 14 });
          const x = mix(10 + i * 6 * PPS, 10 + i * 3.75 * PPS, applied ? t : 0),
            w = mix(6 * PPS - 2, 3.75 * PPS - 2, applied ? t : 0);
          return (
            <div
              key={name}
              style={{
                ...box(x, 7, w, 44),
                background: clip.video.fill,
                border: `1px solid ${clip.video.line}`,
                borderRadius: 4,
                overflow: "hidden",
                opacity: drop,
                transform: `translateY(${(1 - drop) * -24}px)`,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  padding: "3px 6px",
                  color: clip.video.text,
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
              <div style={{ flex: 1, opacity: 0.85 }}>
                <Landscape variant={i} aspect={w / 24} lite />
              </div>
            </div>
          );
        })}
        <div
          style={{
            ...box(
              10,
              64,
              mix(24 * PPS - 2, 15 * PPS - 2, applied ? audio : 0),
              36,
            ),
            background: clip.audio.fill,
            border: `1px solid ${clip.audio.line}`,
            borderRadius: 4,
            overflow: "hidden",
            color: clip.audio.text,
            fontSize: 10.5,
          }}
        >
          <span style={{ position: "absolute", left: 6, top: 3 }}>
            Ambient · 原创配乐
          </span>
          <svg
            style={{
              position: "absolute",
              left: 0,
              top: 16,
              width: "100%",
              height: 18,
            }}
            viewBox="0 0 400 18"
            preserveAspectRatio="none"
          >
            <path
              d={Array.from({ length: 200 }, (_, i) => {
                const a =
                  2 + Math.abs(Math.sin(i * 0.37) * Math.sin(i * 0.05)) * 7;
                return `M${i * 2} ${9 - a}v${a * 2}`;
              }).join("")}
              stroke={clip.audio.line}
              strokeWidth="1.2"
            />
          </svg>
        </div>
        {captions.map((text, i) => {
          const t = pop(frame, c.applied + 0.6 + i * 0.15, { damping: 15 });
          if (!applied || t <= 0.001) return null;
          return (
            <div
              key={text}
              style={{
                ...box(10 + i * 3.75 * PPS, 116, 3.75 * PPS - 10, 30),
                background: clip.caption.fill,
                border: `1px solid ${clip.caption.line}`,
                borderRadius: 4,
                fontSize: 10.5,
                color: clip.caption.text,
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0 6px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                opacity: t,
                transform: `scale(${mix(0.7, 1, t)})`,
                transformOrigin: "left center",
              }}
            >
              <Type size={11} /> {text}
            </div>
          );
        })}
        <div
          style={{ ...box(10 + 2 * PPS, -24, 2, 184), background: ink.accent }}
        />
        <div
          style={{
            ...box(10 + 2 * PPS - 6, -24, 14, 12),
            background: ink.accent,
            borderRadius: "3px 3px 7px 7px",
          }}
        />
      </div>
    </div>
  );
}

function AssistantPanel({
  frame,
  typed,
  sent,
}: {
  frame: number;
  typed: number;
  sent: boolean;
}) {
  const c = cues.assistant;
  const bubble = pop(frame, c.send, { damping: 16 });
  const reply = "好的，我会这样修改：";
  const replied = Math.floor(
    reply.length * span(frame, c.reply, c.reply + 0.6, (t) => t),
  );
  const proposal = pop(frame, c.proposal, { damping: 15 });
  const pressed = frame >= c.click * BEAT && frame < c.applied * BEAT;
  const applied = frame >= c.applied * BEAT;
  const caret = Math.floor(frame / 18) % 2 === 0 && frame > 2.6 * BEAT && !sent;
  return (
    <div
      style={box(1210, 56, 390, 820, { borderLeft: `1px solid ${ink.border}` })}
    >
      <div
        style={{
          ...box(0, 0, 390, 44),
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 16px",
          fontWeight: 600,
        }}
      >
        <Sparkles size={16} /> 创作助手
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "flex",
            padding: 3,
            borderRadius: 7,
            background: ink.raised,
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          {["手动", "自动", "问答"].map((m, i) => (
            <span
              key={m}
              style={{
                padding: "4px 10px",
                borderRadius: 5,
                background: i === 0 ? ink.surface : undefined,
                color: i === 0 ? ink.accent : ink.muted,
                boxShadow: i === 0 ? "0 1px 2px rgba(0,0,0,.08)" : undefined,
              }}
            >
              {m}
            </span>
          ))}
        </span>
        <RotateCcw size={15} color={ink.faint} />
      </div>
      <div
        style={{
          ...box(16, 48, 358, 24),
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: ink.muted,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ink.accent,
          }}
        />
        <span style={{ color: ink.text }}>城市漫游</span> › 工作台 · 剪辑
      </div>
      {sent && (
        <div
          style={{
            ...box(16, 94, 358, 64),
            borderRadius: 10,
            background: ink.raised,
            border: `1px solid ${ink.line}`,
            padding: "10px 14px",
            opacity: bubble,
            transform: `translateY(${(1 - bubble) * 360}px) scale(${mix(0.96, 1, bubble)})`,
          }}
        >
          <div style={{ fontSize: 11, color: ink.muted, marginBottom: 6 }}>
            你
          </div>
          <div style={{ fontSize: 14 }}>{prompt}</div>
        </div>
      )}
      {frame >= c.reply * BEAT && (
        <>
          <div
            style={{
              ...box(16, 172, 358, 20),
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              color: ink.muted,
            }}
          >
            <Sparkles size={14} color={ink.accent} /> TadaCut
            <span
              style={{
                fontSize: 10.5,
                padding: "1px 6px",
                borderRadius: 4,
                border: `1px solid ${ink.line}`,
              }}
            >
              手动
            </span>
          </div>
          <div style={{ ...box(16, 198, 358, 22), fontSize: 14 }}>
            {reply.slice(0, replied)}
          </div>
        </>
      )}
      {steps.map((step, i) => {
        const t = pop(frame, c.steps[i] - 0.6, { damping: 18 });
        if (t <= 0.001) return null;
        const done = span(frame, c.steps[i], c.steps[i] + 0.5);
        return (
          <div
            key={step.title}
            style={{
              ...box(16, 230 + i * 46, 358, 40),
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderBottom: `1px solid ${ink.border}`,
              opacity: t,
              transform: `translateX(${(1 - t) * 20}px)`,
            }}
          >
            {done > 0 ? <CheckDot t={done} size={20} /> : <Spinner size={20} />}
            <span style={{ fontSize: 14, fontWeight: 600 }}>{step.title}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: ink.muted }}>
              {step.detail}
            </span>
          </div>
        );
      })}
      {proposal > 0.001 && (
        <div
          style={{
            ...box(16, 434, 358, 116),
            borderRadius: 12,
            border: `1.5px solid ${applied ? "#a6e3c2" : "#bcd2fb"}`,
            background: applied ? ink.successSoft : ink.surface,
            boxShadow: shadow.card,
            padding: "14px 16px",
            opacity: proposal,
            transform: `translateY(${(1 - proposal) * 30}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {applied && (
              <CheckDot t={span(frame, c.applied, c.applied + 0.5)} size={20} />
            )}
            {applied ? "已应用 4 项修改" : "修改方案 · 4 项"}
          </div>
          <div style={{ fontSize: 12, color: ink.muted, marginTop: 6 }}>
            {applied
              ? "新时间线“竖版 9:16”已创建"
              : "确认后一次写入，可一步撤销"}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            {applied ? (
              <span
                style={{
                  fontSize: 13,
                  color: ink.accent,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Undo2 size={14} /> 撤销
              </span>
            ) : (
              <>
                <span
                  style={{
                    width: 80,
                    height: 32,
                    borderRadius: 7,
                    background: pressed ? ink.accentDeep : ink.accent,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  应用
                </span>
                <span
                  style={{
                    width: 68,
                    height: 32,
                    borderRadius: 7,
                    background: ink.raised,
                    color: ink.muted,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  放弃
                </span>
              </>
            )}
          </div>
        </div>
      )}
      <div
        style={{
          ...box(16, 668, 358, 124),
          borderRadius: 12,
          border: `1.5px solid ${frame > 2.6 * BEAT && !sent ? "#9dbcf8" : ink.line}`,
          boxShadow:
            frame > 2.6 * BEAT && !sent
              ? "0 0 0 3px rgba(47,111,237,.10)"
              : undefined,
          padding: "12px 14px",
        }}
      >
        <div
          style={{ fontSize: 14, color: typed && !sent ? ink.text : ink.faint }}
        >
          {!sent && typed > 0 ? prompt.slice(0, typed) : "说说要如何调整…"}
          {caret && (
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 17,
                background: ink.accent,
                marginLeft: 1,
                verticalAlign: -3,
              }}
            />
          )}
        </div>
        <Sparkles
          size={16}
          color={ink.muted}
          style={{ position: "absolute", left: 14, bottom: 12 }}
        />
        <span
          style={{
            position: "absolute",
            right: 12,
            bottom: 10,
            fontSize: 11,
            color: ink.faint,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          ↵ 发送 · / 技能
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: typed && !sent ? ink.accent : "#c9d8f8",
              color: "#fff",
            }}
          >
            <ArrowUp size={16} />
          </span>
        </span>
      </div>
      <div
        style={{
          ...box(16, 798, 358, 18),
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: ink.muted,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ink.success,
          }}
        />{" "}
        Codex · 本机运行时
        <ChevronDown size={12} />
      </div>
    </div>
  );
}
