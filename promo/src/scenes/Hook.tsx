import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import {
  AudioWaveform,
  Blend,
  Captions,
  Crop,
  LayoutGrid,
  Palette,
  RefreshCw,
  Search,
} from "lucide-react";
import { Chip, Words } from "../kit";
import { accel, mix, pop, span } from "../motion";
import { BEAT, cues } from "../timeline";
import { ink } from "../theme";

const chores = [
  { label: "找素材", icon: Search, x: -610, y: -250, r: -6 },
  { label: "对字幕", icon: Captions, x: 560, y: -300, r: 5 },
  { label: "卡节拍", icon: AudioWaveform, x: -690, y: 70, r: 4 },
  { label: "改比例", icon: Crop, x: 650, y: 20, r: -4 },
  { label: "加转场", icon: Blend, x: -420, y: 320, r: 3 },
  { label: "调色", icon: Palette, x: 430, y: 300, r: -5 },
  { label: "写分镜", icon: LayoutGrid, x: -60, y: -390, r: 2 },
  { label: "再导出一遍", icon: RefreshCw, x: 90, y: 400, r: -3 },
];

/** The chores of a short film pile up, then fold into one sentence. */
export function Hook() {
  const frame = useCurrentFrame();
  const { chips, collapse, lines } = cues.hook;
  const gather = span(frame, collapse, collapse + 0.5, accel);
  const fade = span(frame, collapse - 0.25, collapse, accel);
  const push = mix(
    1,
    1.05,
    span(frame, 0, collapse, (t) => t),
  );
  const exit = span(frame, 7.25, 8, accel);
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${push * (1 + exit * 1.6)})`,
        opacity: 1 - exit,
        filter: exit > 0 ? `blur(${exit * 16}px)` : undefined,
      }}
    >
      {chores.map((c, i) => {
        const t = pop(frame, chips[i], { damping: 11, stiffness: 200 });
        const bob = Math.sin(frame / 40 + i * 1.7) * 6;
        const x = mix(c.x, 0, gather),
          y = mix(c.y + bob, 0, gather);
        return (
          <div
            key={c.label}
            style={{
              position: "absolute",
              left: 960,
              top: 540,
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${c.r * (1 - gather)}deg) scale(${mix(0.5, 1, t) * mix(1, 0.2, gather)})`,
              opacity: Math.min(1, t * 1.5) * (1 - gather),
            }}
          >
            <Chip icon={c.icon} label={c.label} size={38} />
          </div>
        );
      })}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: 1 - fade,
          transform: `scale(${1 - 0.1 * fade})`,
        }}
      >
        <Words
          parts={["做一条短片，"]}
          at={0}
          size={52}
          weight={500}
          color={ink.muted}
        />
        <Words
          parts={["要忙多少件事？"]}
          at={1}
          size={96}
          style={{ marginTop: 14 }}
        />
      </AbsoluteFill>
      {frame >= collapse * BEAT && (
        <AbsoluteFill
          style={{ alignItems: "center", justifyContent: "center" }}
        >
          <Words parts={["想法到成片，"]} at={lines[0]} size={128} />
          <Words
            parts={[
              "只差",
              {
                text: "一句话",
                color: ink.accent,
                mark: span(frame, 6.25, 6.9),
              },
              "。",
            ]}
            at={lines[1]}
            size={128}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
