import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AppIcon, Chip, Words } from "../kit";
import { accel, mix, pop, pulse, span } from "../motion";
import { FPS, cues } from "../timeline";
import { ink } from "../theme";

const kinds = {
  api: { color: ink.accent, name: "云端 API" },
  agent: { color: ink.warning, name: "外部 Agent" },
  local: { color: ink.success, name: "本地模型" },
};
const outer: [string, keyof typeof kinds][] = [
  ["OpenAI 兼容", "api"],
  ["Codex", "agent"],
  ["Anthropic", "api"],
  ["Claude Code", "agent"],
  ["ElevenLabs", "api"],
  ["Copilot", "agent"],
  ["自定义 JSON 路由", "api"],
];
const inner: [string, keyof typeof kinds][] = [
  ["Ollama", "local"],
  ["Whisper", "local"],
  ["LM Studio", "local"],
  ["CLAP", "local"],
  ["DETR", "local"],
];
const CX = 960,
  CY = 650;

/** Services, local models and external agents orbit one studio. */
export function Models() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const exit = span(frame, 7.55, 8, accel);
  const nodes = [
    ...outer.map(([label, kind], i) => ({
      label,
      kind,
      angle: (i / outer.length) * Math.PI * 2 + t * 0.12 - 0.4,
      rx: 650,
      ry: 235,
    })),
    ...inner.map(([label, kind], i) => ({
      label,
      kind,
      angle: (i / inner.length) * Math.PI * 2 - t * 0.16 + 0.3,
      rx: 390,
      ry: 135,
    })),
  ].map((n, i) => {
    const depth = Math.sin(n.angle);
    const appear = pop(frame, cues.models.chips[i % cues.models.chips.length], {
      damping: 13,
    });
    const reach = mix(0.2, 1, appear) * (1 + exit * 0.5);
    return {
      ...n,
      depth,
      appear,
      x: CX + Math.cos(n.angle) * n.rx * reach,
      y: CY + depth * n.ry * reach,
    };
  });
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 96,
          textAlign: "center",
        }}
      >
        <Words
          parts={["接入", { text: "你自己的", color: ink.accent }, "模型"]}
          at={0}
          size={88}
        />
        <div
          style={{
            fontSize: 32,
            color: ink.muted,
            marginTop: 18,
            opacity: span(frame, 0.8, 1.4),
          }}
        >
          云端、本地、外部 Agent，都遵循同一套权限。
        </div>
      </div>
      <svg
        style={{ position: "absolute", inset: 0 }}
        width={1920}
        height={1080}
      >
        {nodes.map((n) => (
          <line
            key={n.label}
            x1={CX}
            y1={CY}
            x2={n.x}
            y2={n.y}
            stroke={kinds[n.kind].color}
            strokeOpacity={0.28 * n.appear}
            strokeWidth="2"
            strokeDasharray="6 10"
            strokeDashoffset={-frame * 1.2}
          />
        ))}
      </svg>
      {nodes
        .filter((n) => n.depth < 0)
        .map((n) => (
          <Node key={n.label} {...n} />
        ))}
      <div
        style={{
          position: "absolute",
          left: CX,
          top: CY,
          transform: `translate(-50%, -50%) scale(${mix(0.6, 1, pop(frame, 0, { damping: 12 })) * (1 + 0.03 * pulse(frame))})`,
          filter: "drop-shadow(0 20px 36px rgba(90,42,60,.22))",
        }}
      >
        <AppIcon size={190} />
      </div>
      {nodes
        .filter((n) => n.depth >= 0)
        .map((n) => (
          <Node key={n.label} {...n} />
        ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 70,
          display: "flex",
          justifyContent: "center",
          gap: 44,
          fontSize: 24,
          color: ink.muted,
          opacity: span(frame, 5, 5.6),
        }}
      >
        {Object.values(kinds).map((k) => (
          <span
            key={k.name}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: k.color,
              }}
            />
            {k.name}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Node({
  label,
  kind,
  x,
  y,
  depth,
  appear,
}: {
  label: string;
  kind: keyof typeof kinds;
  x: number;
  y: number;
  depth: number;
  appear: number;
}) {
  const near = (depth + 1) / 2;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${mix(0.82, 1.06, near) * mix(0.4, 1, appear)})`,
        opacity: mix(0.55, 1, near) * Math.min(1, appear * 1.5),
      }}
    >
      <Chip label={label} dot={kinds[kind].color} size={28} />
    </div>
  );
}
