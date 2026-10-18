import React from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";
import { AppIcon, Words } from "../kit";
import { mix, pop, span } from "../motion";
import { FPS, cues } from "../timeline";
import { ink } from "../theme";

const petals = Array.from({ length: 34 }, (_, i) => ({
  x: random(`x${i}`) * 2100 - 90,
  y: -120 - random(`y${i}`) * 900,
  speed: 70 + random(`s${i}`) * 90,
  sway: 30 + random(`w${i}`) * 70,
  phase: random(`p${i}`) * Math.PI * 2,
  spin: (random(`r${i}`) - 0.5) * 200,
  size: 16 + random(`z${i}`) * 26,
}));

/** The lockup again, with the blossom from the icon drifting down. */
export function Outro() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const enter = pop(frame, 0, { damping: 12, stiffness: 140 });
  const fade = span(frame, cues.outro.fade, 12);
  return (
    <AbsoluteFill style={{ opacity: 1 - fade }}>
      {petals.map((p, i) => {
        const y = p.y + t * p.speed;
        const x = p.x + Math.sin(t * 1.3 + p.phase) * p.sway;
        const far = p.size < 24;
        return (
          <svg
            key={i}
            width={p.size}
            height={p.size}
            viewBox="-16 -22 32 26"
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `rotate(${p.phase * 57 + t * p.spin}deg)`,
              opacity: far ? 0.55 : 0.9,
              filter: far ? "blur(1.5px)" : undefined,
            }}
          >
            <path
              d="M0 0C-13-4-15-17-5-20L0-16L5-20C15-17 13-4 0 0Z"
              fill={i % 3 ? "#f6b3c9" : "#f29bb9"}
            />
          </svg>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 330,
          transform: `translate(-50%, -50%) scale(${mix(0.3, 1, enter)})`,
          opacity: Math.min(1, enter * 2),
          filter: "drop-shadow(0 24px 40px rgba(90,42,60,.22))",
        }}
      >
        <AppIcon size={230} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 480,
          textAlign: "center",
        }}
      >
        <Words
          parts={["Tada", { text: "Cut", color: ink.brand }]}
          at={0.5}
          stagger={0.03}
          size={120}
          weight={700}
          style={{ letterSpacing: "-0.035em" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 660,
          display: "flex",
          justifyContent: "center",
          gap: 28,
        }}
      >
        {["想法", "模型", "工作室"].map((w, i) => (
          <Words
            key={w}
            parts={[{ text: "你的", color: ink.muted }, w + "。"]}
            at={cues.outro.tagline + i * 0.5}
            size={46}
            stagger={0.04}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 760,
          textAlign: "center",
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: 7,
          color: ink.faint,
          opacity: span(frame, 3.6, 4.4),
        }}
      >
        SAY IT. MAKE IT.
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 84,
          textAlign: "center",
          fontSize: 26,
          color: ink.muted,
          opacity: span(frame, cues.outro.line, cues.outro.line + 0.8),
        }}
      >
        开源 AI 视频创作工作室 · github.com/zheflow/TadaCut
      </div>
    </AbsoluteFill>
  );
}
