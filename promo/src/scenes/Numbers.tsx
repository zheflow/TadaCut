import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Words } from "../kit";
import { accel, mix, out, pop, span } from "../motion";
import { cues } from "../timeline";
import { ink, sans } from "../theme";

const stats = [
  { value: 235, label: "项能力，按需调用" },
  { value: 46, label: "个内置技能" },
  { value: 8, label: "个页面，一个助手" },
];

/** Counters roll in on the drop, then the studio's own line. */
export function Numbers() {
  const frame = useCurrentFrame();
  const { counts, line } = cues.numbers;
  const lift = span(frame, line - 0.5, line + 0.3);
  const exit = span(frame, 7.4, 8, accel);
  return (
    <AbsoluteFill
      style={{
        opacity: 1 - exit,
        transform: `scale(${1 - exit * 0.1})`,
        filter: exit > 0 ? `blur(${exit * 10}px)` : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: mix(330, 250, lift),
          display: "flex",
          justifyContent: "center",
        }}
      >
        {stats.map((s, i) => {
          const t = span(frame, counts[i], counts[i] + 0.9, out);
          // Already on its way at the beat, so the drop lands on a number.
          const shown = pop(frame, counts[i] - 0.12, { damping: 16 });
          return (
            <div
              key={s.label}
              style={{
                width: 520,
                textAlign: "center",
                borderLeft: i ? `1.5px solid ${ink.line}` : undefined,
                opacity: shown,
                transform: `translateY(${(1 - shown) * 40}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 200,
                  fontWeight: 700,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                  color: ink.text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(s.value * t)}
              </div>
              <div style={{ fontSize: 34, color: ink.muted, marginTop: 18 }}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 700,
          textAlign: "center",
        }}
      >
        <Words
          parts={[
            "从灵感，到",
            {
              text: "每一处细节",
              color: ink.accent,
              mark: span(frame, line + 1, line + 1.6),
            },
            "。",
          ]}
          at={line}
          size={84}
        />
      </div>
    </AbsoluteFill>
  );
}
