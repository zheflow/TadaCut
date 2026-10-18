import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { LucideIcon } from "lucide-react";
import { FPS } from "./timeline";
import { pop } from "./motion";
import { ink, sans, shadow } from "./theme";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

/** White page with two slow color washes and a fading dot grid. */
export function Backdrop() {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ background: ink.surface, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 1400,
          height: 1400,
          left: -520 + Math.sin(t * 0.35) * 80,
          top: -760 + Math.cos(t * 0.28) * 60,
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(242,155,185,.16), rgba(242,155,185,0))",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1600,
          height: 1600,
          right: -700 + Math.cos(t * 0.31) * 90,
          bottom: -900 + Math.sin(t * 0.24) * 70,
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(47,111,237,.10), rgba(47,111,237,0))",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(#d9dee6 1.5px, transparent 1.7px)",
          backgroundSize: "40px 40px",
          backgroundPosition: `${(t * 6) % 40}px 0`,
          maskImage:
            "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(0,0,0,.55), transparent)",
        }}
      />
    </AbsoluteFill>
  );
}

const barPaths = [
  "M300 310q0-32 32-42t32 32v424q0 32-32 42t-32-32z",
  "M480 367q0-32 32-17t32 47v260q0 32-32 17t-32-47z",
  "M660 310q0-32 32-17t32 47v424q0 32-32 17t-32-47z",
];
const petal = "M0 0C-13-4-15-17-5-20L0-16L5-20C15-17 13-4 0 0Z";

/** The app icon, with each bar and the blossom animatable. */
export function AppIcon({
  size,
  bars = [1, 1, 1],
  blossom = 1,
  style,
}: {
  size: number;
  bars?: number[];
  blossom?: number;
  style?: React.CSSProperties;
}) {
  const id = safeId(useId());
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      style={{ overflow: "visible", ...style }}
    >
      <defs>
        <linearGradient id={`${id}b`} x2="0" y2="1">
          <stop stopColor="#fffdfe" />
          <stop offset="1" stopColor="#fbe2eb" />
        </linearGradient>
        <linearGradient
          id={`${id}g`}
          gradientUnits="userSpaceOnUse"
          x1="300"
          y1="270"
          x2="724"
          y2="800"
        >
          <stop stopColor="#ee93b3" />
          <stop offset="1" stopColor="#b83e6c" />
        </linearGradient>
        <radialGradient id={`${id}p`}>
          <stop stopColor="#fbd3e0" />
          <stop offset="1" stopColor="#f29bb9" />
        </radialGradient>
      </defs>
      <rect
        x="24"
        y="24"
        width="976"
        height="976"
        rx="222"
        fill={`url(#${id}b)`}
        stroke="#f1c9d7"
        strokeWidth="8"
      />
      {barPaths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill={`url(#${id}g)`}
          style={{
            transformBox: "fill-box",
            transformOrigin: "50% 100%",
            transform: `scaleY(${Math.max(0.001, bars[i])})`,
          }}
        />
      ))}
      <g
        transform={`translate(818 214) rotate(${14 - (1 - blossom) * 120}) scale(${3.4 * Math.max(0.001, blossom)})`}
      >
        {[0, 72, 144, 216, 288].map((a) => (
          <path
            key={a}
            d={petal}
            transform={`rotate(${a})`}
            fill={`url(#${id}p)`}
          />
        ))}
        <circle r="2.4" fill="#c4507c" />
      </g>
    </svg>
  );
}

/** One five-petal blossom, for the closing scene. */
export function Blossom({
  size,
  opacity = 1,
}: {
  size: number;
  opacity?: number;
}) {
  const id = safeId(useId());
  return (
    <svg width={size} height={size} viewBox="-24 -24 48 48" style={{ opacity }}>
      <defs>
        <radialGradient id={`${id}p`}>
          <stop stopColor="#fbd3e0" />
          <stop offset="1" stopColor="#f29bb9" />
        </radialGradient>
      </defs>
      {[0, 72, 144, 216, 288].map((a) => (
        <path
          key={a}
          d={petal}
          transform={`rotate(${a})`}
          fill={`url(#${id}p)`}
        />
      ))}
      <circle r="2.6" fill="#c4507c" />
    </svg>
  );
}

/** The three skewed bars of the in-app mark, as drawn by the studio's CSS. */
export function BrandBars({ scale = 1 }: { scale?: number }) {
  const bar = (left: number, top: number, height: number, skew: number) => (
    <i
      style={{
        position: "absolute",
        left: left * scale,
        top: top * scale,
        width: 5 * scale,
        height: height * scale,
        borderRadius: 2 * scale,
        background: ink.brand,
        transform: `skewY(${skew}deg)`,
      }}
    />
  );
  return (
    <div
      style={{ position: "relative", width: 33 * scale, height: 33 * scale }}
    >
      {bar(3, 3, 26, -20)}
      {bar(14, 8, 16, 28)}
      {bar(25, 3, 26, 20)}
    </div>
  );
}

export function Wordmark({
  size,
  style,
}: {
  size: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: sans,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.035em",
        color: ink.text,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      Tada<span style={{ color: ink.brand }}>Cut</span>
    </span>
  );
}

export type Part = string | { text: string; color?: string; mark?: number };

/** Text that settles in character by character: up, out of blur, opaque. */
export function Words({
  parts,
  at,
  stagger = 0.045,
  size,
  weight = 600,
  color = ink.text,
  style,
}: {
  parts: Part[];
  at: number;
  stagger?: number;
  size: number;
  weight?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  const frame = useCurrentFrame();
  let index = 0;
  return (
    <div
      style={{
        fontFamily: sans,
        fontSize: size,
        fontWeight: weight,
        color,
        letterSpacing: "-0.02em",
        lineHeight: 1.22,
        ...style,
      }}
    >
      {parts.map((part, i) => {
        const p = typeof part === "string" ? { text: part } : part;
        return (
          <span
            key={i}
            style={{
              color: p.color,
              backgroundImage:
                p.mark === undefined
                  ? undefined
                  : "linear-gradient(transparent 64%, rgba(47,111,237,.2) 64%, rgba(47,111,237,.2) 92%, transparent 92%)",
              backgroundSize: `${(p.mark ?? 0) * 100}% 100%`,
              backgroundRepeat: "no-repeat",
            }}
          >
            {[...p.text].map((ch, j) => {
              if (ch === "\n") return <br key={j} />;
              const t = pop(frame, at + index++ * stagger, {
                damping: 20,
                stiffness: 190,
              });
              return (
                <span
                  key={j}
                  style={{
                    display: "inline-block",
                    whiteSpace: "pre",
                    opacity: clamp(t * 1.4),
                    transform: `translateY(${(1 - t) * 0.42}em)`,
                    filter: t < 0.98 ? `blur(${(1 - t) * 10}px)` : undefined,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}

export type Tone = "neutral" | "accent" | "success" | "danger" | "quiet";
const tones: Record<Tone, [string, string, string]> = {
  neutral: [ink.surface, ink.text, ink.border],
  accent: [ink.accentSoft, ink.accentDeep, "#cfdffd"],
  success: [ink.successSoft, ink.success, "#c3ecd6"],
  danger: [ink.dangerSoft, ink.danger, "#fecdca"],
  quiet: [ink.raised, ink.muted, ink.raised],
};

export function Chip({
  icon: Icon,
  label,
  tone = "neutral",
  size = 26,
  dot,
  style,
}: {
  icon?: LucideIcon;
  label: React.ReactNode;
  tone?: Tone;
  size?: number;
  dot?: string;
  style?: React.CSSProperties;
}) {
  const [background, color, line] = tones[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.42,
        padding: `${size * 0.42}px ${size * 0.72}px`,
        borderRadius: 999,
        background,
        color,
        border: `1.5px solid ${line}`,
        fontFamily: sans,
        fontSize: size,
        fontWeight: 600,
        whiteSpace: "nowrap",
        boxShadow: tone === "neutral" ? shadow.card : undefined,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: "50%",
            background: dot,
          }}
        />
      )}
      {Icon && <Icon size={size * 1.02} strokeWidth={2.2} />}
      {label}
    </div>
  );
}

export function Cursor({
  x,
  y,
  press = 0,
  opacity = 1,
  size = 46,
}: {
  x: number;
  y: number;
  press?: number;
  opacity?: number;
  size?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - size * 0.08,
        top: y - size * 0.06,
        width: size,
        height: size * 1.4,
        opacity,
        transform: `scale(${1 - press * 0.14})`,
        transformOrigin: "8% 6%",
        filter: "drop-shadow(0 3px 5px rgba(0,0,0,.28))",
      }}
    >
      <svg viewBox="0 0 20 28" width="100%" height="100%">
        <path
          d="M2 2v20.5l5-4.8 3.4 7.7 3.6-1.6-3.4-7.5h7.1z"
          fill="#16181d"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** A ring that spreads from a click. */
export function Ripple({ x, y, t }: { x: number; y: number; t: number }) {
  if (t <= 0 || t >= 1) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x - 50,
        top: y - 50,
        width: 100,
        height: 100,
        borderRadius: "50%",
        border: `4px solid ${ink.accent}`,
        opacity: 1 - t,
        transform: `scale(${0.15 + t})`,
      }}
    />
  );
}

/** A green dot whose check mark draws itself as t goes 0 → 1. */
export function CheckDot({ t, size = 28 }: { t: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r={11 * clamp(t * 1.8)} fill={ink.success} />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1 - clamp((t - 0.35) / 0.65)}
      />
    </svg>
  );
}

export function Spinner({
  size = 24,
  color = ink.accent,
}: {
  size?: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ transform: `rotate(${frame * 8}deg)` }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke={ink.line}
        strokeWidth="3"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Card({
  children,
  style,
}: {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        background: ink.surface,
        border: `1.5px solid ${ink.border}`,
        borderRadius: 28,
        boxShadow: shadow.float,
        overflow: "hidden",
        fontFamily: sans,
        color: ink.text,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export { Landscape, trail } from "./art";
