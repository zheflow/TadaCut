import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Backdrop } from "./kit";
import {
  BAR,
  sceneBars,
  sceneOrder,
  sceneStart,
  type SceneId,
} from "./timeline";
import { ink, sans } from "./theme";
import { Hook } from "./scenes/Hook";
import { Logo } from "./scenes/Logo";
import { Assistant } from "./scenes/Assistant";
import { Memory } from "./scenes/Memory";
import { Features } from "./scenes/Features";
import { Models } from "./scenes/Models";
import { Trust } from "./scenes/Trust";
import { Numbers } from "./scenes/Numbers";
import { Outro } from "./scenes/Outro";

const scenes: Record<SceneId, () => React.ReactNode> = {
  hook: Hook,
  logo: Logo,
  assistant: Assistant,
  memory: Memory,
  features: Features,
  models: Models,
  trust: Trust,
  numbers: Numbers,
  outro: Outro,
};

/** A slow push-in under every scene, so held moments never sit still. */
function Drift({
  length,
  children,
}: {
  length: number;
  children: React.ReactNode;
}) {
  const t = useCurrentFrame() / length;
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + 0.025 * t})` }}>
      {children}
    </AbsoluteFill>
  );
}

export function Promo({ soundtrack }: { soundtrack: boolean }) {
  return (
    <AbsoluteFill
      style={{ fontFamily: sans, color: ink.text, background: ink.surface }}
    >
      <Backdrop />
      {sceneOrder.map((id) => {
        const Scene = scenes[id];
        return (
          <Sequence
            key={id}
            name={id}
            from={sceneStart[id] * BAR}
            durationInFrames={sceneBars[id] * BAR}
          >
            <Drift length={sceneBars[id] * BAR}>
              <Scene />
            </Drift>
          </Sequence>
        );
      })}
      {soundtrack && <Audio src={staticFile("soundtrack.wav")} />}
    </AbsoluteFill>
  );
}
