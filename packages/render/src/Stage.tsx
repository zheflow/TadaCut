import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  cancelRender,
} from "remotion";
import {
  clipOpacity,
  sampleProperty,
  type Asset,
  type Clip,
  type Timeline,
  type Watermark,
} from "../../domain/src/index";
import { MotionLayer } from "./components/MotionLayer";
import { EffectCanvas, needsEffectCanvas } from "./components/EffectCanvas";
import { TextLayer } from "./components/TextLayer";
import {
  audioVoices,
  layersAt,
  maxSequenceDepth,
  nestedFrame,
  sequenceTimeline,
  type LayerPlan,
  type Voice,
} from "./plan";
import { transitionLook } from "./transitions";
export function Stage({
  timeline,
  assets,
  frame,
  playing = false,
  rate = 1,
  rendering = false,
  motionOrigin,
  timelines,
  depth = 0,
  audio = true,
}: {
  timeline: Timeline;
  assets: Asset[];
  frame: number;
  playing?: boolean;
  /** Preview shuttle speed; media play natively only forwards. */
  rate?: number;
  rendering?: boolean;
  motionOrigin?: string;
  /** Every timeline of the project, for nested sequences. */
  timelines?: Timeline[];
  /** How deep this stage is nested inside sequences. */
  depth?: number;
  /** Nested stages leave sound to the outermost stage. */
  audio?: boolean;
}) {
  // Backwards or paused, media elements are positioned frame by frame instead of playing.
  const forward = playing && rate > 0 ? rate : 0;
  const voices = audio
    ? audioVoices(timeline, assets, timelines ?? [timeline])
    : [];
  return (
    <div className="composition" style={{ background: timeline.background }}>
      {layersAt(timeline, assets, frame).map((layer) => (
        <StageLayer
          key={layer.clip.id}
          layer={layer}
          timeline={timeline}
          forward={forward}
          rendering={rendering}
          assets={assets}
          motionOrigin={motionOrigin}
          timelines={timelines}
          depth={depth}
          rate={rate}
          playing={playing}
        />
      ))}
      {timeline.watermark && depth === 0 && (
        <WatermarkLayer
          watermark={timeline.watermark}
          assets={assets}
          timeline={timeline}
          rendering={rendering}
        />
      )}
      {voices.map((v) =>
        rendering ? (
          <Sequence
            key={"sound-" + v.key}
            from={v.start}
            durationInFrames={v.duration}
            layout="none"
          >
            <Audio
              src={v.asset.url}
              trimBefore={Math.round(v.sourceStart * timeline.fps)}
              playbackRate={v.rate}
              volume={(local) => v.gain(local)}
            />
          </Sequence>
        ) : frame >= v.start && frame < v.start + v.duration ? (
          <PreviewAudio
            key={"sound-" + v.key}
            voice={v}
            local={frame - v.start}
            fps={timeline.fps}
            forward={forward}
          />
        ) : null,
      )}
    </div>
  );
}
/** Where a clip's source is at a clip-local frame, kept inside the media. */
const sourceTime = (c: Clip, local: number, fps: number, duration?: number) => {
  const time = Math.max(0, c.sourceOffset + (local / fps) * c.speed);
  return duration ? Math.min(time, Math.max(0, duration - 0.5 / fps)) : time;
};
/** Keeps a preview media element on the timeline: playing natively forwards, positioned per frame otherwise. */
function useMediaSync(
  ref: React.RefObject<HTMLMediaElement | null>,
  target: number,
  speed: number,
  forward: number,
) {
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    const seek = () => {
      const time = Number.isFinite(e.duration)
        ? Math.min(target, Math.max(0, e.duration - 0.001))
        : target;
      // Playing forwards, small drift is left to the element; larger drift is corrected.
      const drift = Math.abs(e.currentTime - time);
      if (forward ? drift > 0.25 * Math.max(1, forward) : drift > 0.001)
        e.currentTime = time;
    };
    e.addEventListener("loadedmetadata", seek);
    if (e.readyState >= 1) seek();
    e.playbackRate = Math.max(0.0625, Math.min(16, speed * (forward || 1)));
    if (forward) {
      if (e.paused) void e.play().catch(() => {});
    } else if (!e.paused) e.pause();
    return () => e.removeEventListener("loadedmetadata", seek);
  }, [ref, target, forward, speed]);
}
const pct = (v: number) => `${(v * 100).toFixed(4)}%`;
function StageLayer({
  layer,
  timeline,
  forward,
  rendering,
  assets,
  motionOrigin,
  timelines,
  depth,
  rate,
  playing,
}: {
  layer: LayerPlan;
  timeline: Timeline;
  forward: number;
  rendering: boolean;
  assets: Asset[];
  motionOrigin?: string;
  timelines?: Timeline[];
  depth: number;
  rate: number;
  playing: boolean;
}) {
  const { clip: c, asset, local, transition } = layer;
  const video = useRef<HTMLVideoElement>(null),
    // In exports the effect canvas reads the frame image OffthreadVideo extracted.
    frameImage = useRef<CanvasImageSource | null>(null),
    redraw = useRef<(() => void) | null>(null),
    [effectError, setEffectError] = useState("");
  useEffect(() => {
    setEffectError("");
  }, [c.effects]);
  useMediaSync(
    video,
    sourceTime(c, local, timeline.fps),
    c.speed,
    rendering ? 0 : forward,
  );
  const at = Math.max(0, local),
    scale = sampleProperty(c, "scale", at),
    sx = scale * sampleProperty(c, "scaleX", at),
    sy = scale * sampleProperty(c, "scaleY", at),
    radius = sampleProperty(c, "radius", at),
    pixels = asset.kind === "image" || asset.kind === "video",
    // Pixel transitions need the WebGL canvas, which draws images and video.
    look = transitionLook(transition, pixels);
  const transform =
    (look.transform ? look.transform + " " : "") +
    `translate(${(sampleProperty(c, "x", at) / timeline.width) * 100}%,${(sampleProperty(c, "y", at) / timeline.height) * 100}%) scale(${sx},${sy}) rotate(${sampleProperty(c, "rotation", at)}deg)`;
  const crop = c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 },
    cropped =
      crop.left || crop.top || crop.right || crop.bottom || radius > 0
        ? `inset(${pct(crop.top)} ${pct(crop.right)} ${pct(crop.bottom)} ${pct(crop.left)}${
            radius > 0
              ? ` round ${pct(radius / Math.max(0.01, sx) / timeline.width)} / ${pct(radius / Math.max(0.01, sy) / timeline.height)}`
              : ""
          })`
        : undefined;
  const style: React.CSSProperties = {
    ...look.style,
    opacity:
      (local < 0 ? sampleProperty(c, "opacity", 0) : clipOpacity(c, local)) *
      (look.style.opacity === undefined ? 1 : Number(look.style.opacity)),
    transform,
    transformOrigin: `${sampleProperty(c, "focusX", at) * 100}% ${sampleProperty(c, "focusY", at) * 100}%`,
  };
  const filter =
    [
      c.effects.brightness !== 1 ? `brightness(${c.effects.brightness})` : "",
      c.effects.contrast !== 1 ? `contrast(${c.effects.contrast})` : "",
      c.effects.saturation !== 1 ? `saturate(${c.effects.saturation})` : "",
      c.effects.blur ? `blur(${c.effects.blur}px)` : "",
      look.mediaFilter ?? "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const onEffectError = useCallback(
    (message: string) => {
      setEffectError(message);
      if (rendering) cancelRender(new Error(message));
    },
    [rendering],
  );
  // Stable, since OffthreadVideo fetches the frame again whenever its handlers change.
  const onVideoError = useCallback(
    (error: Error) =>
      cancelRender(
        new Error(`无法读取视频：${asset.name}（${error.message}）`),
      ),
    [asset.name],
  );
  const onVideoFrame = useCallback((image: CanvasImageSource) => {
    frameImage.current = image;
    // Drawn before the frame is released, so the export captures this frame.
    redraw.current?.();
  }, []);
  if (asset.kind === "audio") return null;
  const clipStyle: React.CSSProperties = {
    clipPath: cropped,
    filter,
    opacity: look.mediaOpacity,
  };
  let content: React.ReactNode;
  if (asset.kind === "text")
    content = (
      <TextLayer clip={c} asset={asset} local={local} timeline={timeline} />
    );
  else if (asset.kind === "motion")
    content = (
      <MotionLayer
        code={asset.code ?? ""}
        frame={at}
        fps={timeline.fps}
        width={timeline.width}
        height={timeline.height}
        origin={motionOrigin}
        rendering={rendering}
      />
    );
  else if (asset.kind === "sequence") {
    const nested = sequenceTimeline(asset, timelines);
    content =
      nested && depth < maxSequenceDepth ? (
        <Stage
          timeline={{
            ...nested,
            background: "transparent",
            watermark: undefined,
          }}
          assets={assets}
          frame={nestedFrame(c, local, timeline.fps, nested)}
          playing={playing}
          rate={rate * c.speed}
          rendering={rendering}
          motionOrigin={motionOrigin}
          timelines={timelines}
          depth={depth + 1}
          audio={false}
        />
      ) : (
        <div className="motion-error">
          {nested ? "嵌套层级过深" : "嵌套序列的时间线不存在"}
        </div>
      );
  } else {
    const effect =
        (needsEffectCanvas(c.effects) || Boolean(look.gl)) && !effectError,
      mediaStyle = {
        objectFit: c.fit,
        objectPosition: `${sampleProperty(c, "focusX", at) * 100}% ${sampleProperty(c, "focusY", at) * 100}%`,
        opacity: effect ? 0 : 1,
        width: "100%",
        height: "100%",
      } as const;
    content = (
      <>
        {asset.kind === "video" ? (
          rendering ? (
            // FFmpeg extracts the exact frame instead of the browser seeking a <video>.
            <Freeze
              frame={
                sourceTime(c, at, timeline.fps, asset.duration) * timeline.fps
              }
            >
              <OffthreadVideo
                src={asset.url}
                muted
                style={mediaStyle}
                onVideoFrame={effect ? onVideoFrame : undefined}
                onError={onVideoError}
              />
            </Freeze>
          ) : (
            <video
              crossOrigin="anonymous"
              ref={video}
              src={asset.url}
              preload="auto"
              muted
              playsInline
              style={mediaStyle}
            />
          )
        ) : rendering ? (
          <Img crossOrigin="anonymous" src={asset.url} style={mediaStyle} />
        ) : (
          <img
            crossOrigin="anonymous"
            src={asset.url}
            alt=""
            style={mediaStyle}
          />
        )}
        {(needsEffectCanvas(c.effects) || look.gl) && (
          <EffectCanvas
            asset={asset}
            clip={c}
            video={video}
            frameImage={frameImage}
            redraw={redraw}
            assets={assets}
            frame={at}
            fps={timeline.fps}
            transition={look.gl ? transition : undefined}
            rendering={rendering}
            onError={onEffectError}
          />
        )}
        {effectError && (
          <div className="motion-error">效果错误：{effectError}</div>
        )}
      </>
    );
  }
  return (
    <div
      className={`stage-layer ${asset.kind === "text" ? "text" : ""}`}
      style={style}
    >
      <div className="stage-clip" style={clipStyle}>
        {content}
      </div>
      {look.overlay && (
        <div
          className="stage-overlay"
          style={{
            background: look.overlay.color,
            opacity: look.overlay.opacity,
          }}
        />
      )}
    </div>
  );
}
/** A logo or text mark in a corner, above everything else. */
function WatermarkLayer({
  watermark,
  assets,
  timeline,
  rendering,
}: {
  watermark: Watermark;
  assets: Asset[];
  timeline: Timeline;
  rendering: boolean;
}) {
  const asset = watermark.assetId
      ? assets.find((a) => a.id === watermark.assetId)
      : undefined,
    marginX = pct(watermark.margin),
    marginY = pct((watermark.margin * timeline.width) / timeline.height),
    position = watermark.position;
  const place: React.CSSProperties =
    position === "center"
      ? { left: "50%", top: "50%", transform: "translate(-50%,-50%)" }
      : {
          [position.endsWith("left") ? "left" : "right"]: marginX,
          [position.startsWith("top") ? "top" : "bottom"]: marginY,
        };
  return (
    <div
      className="stage-watermark"
      style={{
        ...place,
        opacity: watermark.opacity,
        width: asset ? pct(watermark.scale) : undefined,
        fontSize: `${((watermark.scale * timeline.width) / 6 / timeline.height) * 100}cqh`,
      }}
    >
      {asset?.kind === "image" ? (
        rendering ? (
          <Img src={asset.url} style={{ width: "100%", display: "block" }} />
        ) : (
          <img
            src={asset.url}
            alt=""
            style={{ width: "100%", display: "block" }}
          />
        )
      ) : (
        watermark.text
      )}
    </div>
  );
}

let mixer: AudioContext | undefined;
function PreviewAudio({
  voice,
  local,
  fps,
  forward,
}: {
  voice: Voice;
  local: number;
  fps: number;
  forward: number;
}) {
  const ref = useRef<HTMLAudioElement>(null),
    gain = useRef<GainNode | null>(null),
    sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  useEffect(() => {
    const element = ref.current!;
    mixer ??= new AudioContext();
    sourceRef.current ??= mixer.createMediaElementSource(element);
    const source = sourceRef.current,
      node = mixer.createGain();
    gain.current = node;
    source.connect(node).connect(mixer.destination);
    return () => {
      element.pause();
      source.disconnect();
      node.disconnect();
      gain.current = null;
    };
  }, []);
  useMediaSync(
    ref,
    voice.sourceStart + (local / fps) * voice.rate,
    voice.rate,
    forward,
  );
  const level = voice.gain(local);
  useEffect(() => {
    if (gain.current) gain.current.gain.value = level;
    if (forward) void mixer?.resume();
  }, [level, forward]);
  return <audio ref={ref} src={voice.asset.url} preload="auto" />;
}
