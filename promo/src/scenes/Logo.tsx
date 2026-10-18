import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AppIcon, Words } from "../kit";
import { accel, inOut, mix, pop, pulse, span } from "../motion";
import { cues } from "../timeline";
import { ink } from "../theme";

/** The icon lands on the drop, builds its bars, then the name and the promise. */
export function Logo() {
  const frame = useCurrentFrame();
  const { bars, blossom, wordmark, tagline } = cues.logo;
  const enter = pop(frame, 0, { damping: 11, stiffness: 140 });
  const rise = span(frame, wordmark, wordmark + 1, inOut);
  const exit = span(frame, 7.4, 8, accel);
  const y = mix(540, 330, rise);
  return (
    <AbsoluteFill
      style={{
        opacity: 1 - exit,
        transform: `scale(${1 - exit * 0.08})`,
        filter: exit > 0 ? `blur(${exit * 12}px)` : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 960 - 460,
          top: y - 460,
          width: 920,
          height: 920,
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(242,155,185,.34), rgba(242,155,185,0))",
          opacity: enter * (0.6 + 0.4 * pulse(frame)),
          transform: `scale(${mix(0.6, 1, enter) * mix(1, 0.8, rise)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 960,
          top: y,
          transform: `translate(-50%, -50%) scale(${mix(0.2, 1, enter) * mix(1, 0.72, rise)})`,
          opacity: Math.min(1, enter * 2),
          filter: "drop-shadow(0 26px 40px rgba(90,42,60,.22))",
        }}
      >
        <AppIcon
          size={300}
          bars={bars.map((b) => pop(frame, b, { damping: 12, stiffness: 160 }))}
          blossom={pop(frame, blossom, { damping: 13 })}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 470,
          textAlign: "center",
        }}
      >
        <Words
          parts={["Tada", { text: "Cut", color: ink.brand }]}
          at={wordmark + 0.2}
          stagger={0.035}
          size={128}
          weight={700}
          style={{ letterSpacing: "-0.035em" }}
        />
        <div
          style={{
            fontSize: 26,
            letterSpacing: 12,
            color: ink.faint,
            fontWeight: 500,
            marginTop: 4,
            opacity: span(frame, wordmark + 1, wordmark + 1.6),
          }}
        >
          SAY IT. MAKE IT.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 720,
          display: "flex",
          justifyContent: "center",
          gap: 30,
        }}
      >
        {["想法", "模型", "工作室"].map((w, i) => (
          <Words
            key={w}
            parts={[{ text: "你的", color: ink.muted }, w + "。"]}
            at={tagline[i]}
            size={50}
            stagger={0.04}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 805,
          textAlign: "center",
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: 7,
          color: ink.faint,
          opacity: span(frame, 6.5, 7.2),
        }}
      >
        开源 AI 视频创作工作室
      </div>
    </AbsoluteFill>
  );
}
