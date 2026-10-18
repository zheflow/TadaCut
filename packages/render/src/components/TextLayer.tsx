import type React from "react";
import {
  cubicBezier,
  type Asset,
  type Clip,
  type TextStyle,
  type Timeline,
} from "../../../domain/src/index";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const overshoot = (t: number) => cubicBezier([0.34, 1.56, 0.64, 1], clamp01(t));
/** Text clips made before styles existed keep their original spacing. */
const legacy: TextStyle = {
  fontSize: 48,
  color: "#ffffff",
  align: "center",
  bottom: 0.12,
  background: "transparent",
  strokeWidth: 0,
  letterSpacing: 0.09,
  lineHeight: 1.4,
  maxWidth: 0.9,
  uppercase: false,
  padding: 0,
  boxRadius: 0,
};
/**
 * A text or caption clip. Sizes are timeline pixels converted to container
 * units, so the preview and every export size match. Caption animations
 * run on clip-local frames; word animations use the clip's word timing.
 */
export function TextLayer({
  clip,
  asset,
  local,
  timeline,
}: {
  clip: Clip;
  asset: Asset;
  local: number;
  timeline: Timeline;
}) {
  const s = clip.textStyle ?? legacy,
    unit = (px: number) => `${((px / timeline.height) * 100).toFixed(4)}cqh`,
    text = clip.text ?? asset.text ?? clip.name,
    caption = clip.caption,
    animation = caption?.animation ?? "none",
    highlight = caption?.highlight ?? "#ffd84a",
    frame = Math.max(0, local);
  // Word timing applies only while the text still matches it.
  const words =
    caption?.words?.length &&
    caption.words
      .map((w) => w.text)
      .join("")
      .trim() === text.trim()
      ? caption.words
      : undefined;
  const enter = Math.max(1, Math.min(8, Math.floor(clip.duration / 3))),
    exit = Math.max(1, Math.min(5, Math.floor(clip.duration / 4))),
    e = clamp01(frame / enter),
    out = animation === "none" ? 1 : clamp01((clip.duration - frame) / exit);
  let opacity = out,
    transform = "";
  switch (animation) {
    case "fade":
      opacity *= smooth(e);
      break;
    case "fade-up":
      opacity *= smooth(e);
      transform = `translateY(${((1 - smooth(e)) * 0.6).toFixed(4)}em)`;
      break;
    case "pop":
      opacity *= clamp01(e * 2);
      transform = `scale(${(0.6 + 0.4 * overshoot(e)).toFixed(4)})`;
      break;
    case "slide-up":
      opacity *= clamp01(e * 1.5);
      transform = `translateY(${((1 - smooth(e)) * 1.2).toFixed(4)}em)`;
      break;
    case "bounce": {
      const t = clamp01(frame / (enter * 2));
      opacity *= clamp01(e * 2);
      transform = `translateY(${(-Math.abs(Math.sin(t * Math.PI * 2.5)) * (1 - t) * 0.5).toFixed(4)}em)`;
      break;
    }
  }
  const lineStyle: React.CSSProperties = {
    color: s.color,
    background: s.background,
    padding: s.padding
      ? `${unit(s.padding * 0.5)} ${unit(s.padding)}`
      : undefined,
    borderRadius: s.boxRadius ? unit(s.boxRadius) : undefined,
    WebkitTextStroke: s.strokeWidth
      ? `${unit(s.strokeWidth)} ${s.strokeColor ?? "#000"}`
      : undefined,
    paintOrder: s.strokeWidth ? "stroke fill" : undefined,
    textShadow: s.shadow,
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  };
  let content: React.ReactNode;
  if (animation === "typewriter") {
    const until = words
        ? Math.max(1, words[words.length - 1].start + 1)
        : Math.max(1, clip.duration * 0.7),
      shown = Math.ceil(text.length * clamp01(frame / until));
    content = (
      <span style={lineStyle}>
        {text.slice(0, shown)}
        <span style={{ visibility: "hidden" }}>{text.slice(shown)}</span>
      </span>
    );
  } else if (
    words &&
    (animation === "word-pop" ||
      animation === "karaoke" ||
      animation === "highlight")
  ) {
    content = (
      <span style={lineStyle}>
        {words.map((w, i) => {
          const spoken = frame >= w.end,
            current = frame >= w.start && frame < w.end;
          let style: React.CSSProperties = {};
          if (animation === "word-pop") {
            const k = clamp01((frame - w.start) / 4);
            style =
              frame < w.start
                ? { visibility: "hidden" }
                : {
                    display: "inline-block",
                    whiteSpace: "pre",
                    transform: `scale(${(0.5 + 0.5 * overshoot(k)).toFixed(4)})`,
                  };
          } else if (animation === "karaoke") {
            const fill = spoken
              ? 100
              : current
                ? ((frame - w.start) / Math.max(1, w.end - w.start)) * 100
                : 0;
            style =
              fill >= 100
                ? { color: highlight }
                : fill > 0
                  ? {
                      backgroundImage: `linear-gradient(90deg, ${highlight} ${fill.toFixed(1)}%, ${s.color} ${fill.toFixed(1)}%)`,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }
                  : {};
          } else if (current)
            style = {
              color: highlight,
              display: "inline-block",
              whiteSpace: "pre",
              transform: "scale(1.08)",
            };
          return (
            <span key={i} style={style}>
              {w.text}
            </span>
          );
        })}
      </span>
    );
  } else content = <span style={lineStyle}>{text}</span>;
  const horizontal: React.CSSProperties =
    s.align === "left"
      ? { left: "5%", width: `${s.maxWidth * 100}%` }
      : s.align === "right"
        ? { right: "5%", width: `${s.maxWidth * 100}%` }
        : {
            left: `${((1 - s.maxWidth) / 2) * 100}%`,
            width: `${s.maxWidth * 100}%`,
          };
  return (
    <div
      className="stage-text-layer"
      style={{
        ...horizontal,
        ...(s.top !== undefined
          ? { top: `${s.top * 100}%` }
          : { bottom: `${s.bottom * 100}%` }),
        fontSize: unit(s.fontSize),
        textAlign: s.align,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        letterSpacing: `${s.letterSpacing}em`,
        lineHeight: s.lineHeight,
        textTransform: s.uppercase ? "uppercase" : undefined,
        textShadow: s.shadow === undefined ? undefined : "none",
        opacity,
        transform: transform || undefined,
        transformOrigin:
          s.align === "left"
            ? "left bottom"
            : s.align === "right"
              ? "right bottom"
              : "center bottom",
      }}
    >
      {content}
    </div>
  );
}
