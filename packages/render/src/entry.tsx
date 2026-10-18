import React from "react";
import {
  Composition,
  registerRoot,
  useCurrentFrame,
  AbsoluteFill,
} from "remotion";
import {
  makeProject,
  activeTimeline,
  durationInFrames,
  type Asset,
  type Timeline,
} from "../../domain/src/index";
import { Stage } from "./Stage";
import "./composition.css";
interface Props extends Record<string, unknown> {
  timeline: Timeline;
  /** All of the project's timelines, for nested sequences. */
  timelines?: Timeline[];
  assets: Asset[];
  baseUrl: string;
  transparent: boolean;
}
const defaults = makeProject(
  "render-default",
  "Render",
  new Date(0).toISOString(),
);
function Movie({ timeline, timelines, assets, baseUrl, transparent }: Props) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Stage
        timeline={{
          ...timeline,
          background: transparent ? "transparent" : timeline.background,
        }}
        assets={assets}
        timelines={timelines}
        frame={frame}
        rendering
        motionOrigin={baseUrl}
      />
    </AbsoluteFill>
  );
}
registerRoot(() => (
  <Composition
    id="TadaCut"
    component={Movie}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{
      timeline: activeTimeline(defaults),
      assets: [],
      baseUrl: "",
      transparent: false,
    }}
    calculateMetadata={({ props }) => ({
      width: props.timeline.width,
      height: props.timeline.height,
      fps: props.timeline.fps,
      durationInFrames: Math.max(1, durationInFrames(props.timeline)),
    })}
  />
));
