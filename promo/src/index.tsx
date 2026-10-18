import React from "react";
import { AbsoluteFill, Composition, registerRoot } from "remotion";
import { Promo } from "./Promo";
import { Landscape } from "./art";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

/** The four sample shots side by side, or one of them, for checking the artwork. */
function Shots({ variant }: { variant?: number }) {
  const hiker = (v: number) => (v === 1 ? 900 : undefined);
  if (variant !== undefined)
    return <Landscape variant={variant} walker={hiker(variant)} />;
  return (
    <AbsoluteFill
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        background: "#fff",
      }}
    >
      {[0, 1, 2, 3].map((v) => (
        <Landscape key={v} variant={v} walker={hiker(v)} />
      ))}
    </AbsoluteFill>
  );
}

registerRoot(() => (
  <>
    <Composition
      id="Shots"
      component={Shots}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={DURATION}
    />
    <Composition
      id="Promo"
      component={Promo}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={DURATION}
      defaultProps={{ soundtrack: true }}
    />
  </>
));
