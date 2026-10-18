import type React from "react";
import type { LayerPlan } from "./plan";

/**
 * How the incoming clip is drawn during a transition. The outgoing clip keeps
 * playing underneath, so every transition is expressed on the incoming layer:
 * its opacity, transform, clip path or mask, and an optional color overlay.
 * Kinds that need pixels (noise, pixelate, glitch, ripple, extension shaders)
 * are drawn by the WebGL effect canvas; `gl` says so.
 */
export interface TransitionLook {
  style: React.CSSProperties;
  /** Prepended to the layer's own transform. */
  transform?: string;
  /** Hides the media while a flash or dip covers the frame. */
  mediaOpacity?: number;
  mediaFilter?: string;
  overlay?: { color: string; opacity: number };
  gl?: boolean;
}
const ease = (t: number) => t * t * (3 - 2 * t);
export function transitionLook(
  transition: LayerPlan["transition"],
  canUseGl: boolean,
): TransitionLook {
  if (!transition) return { style: {} };
  const p = Math.min(1, Math.max(0, transition.progress)),
    e = ease(p),
    dir = transition.direction ?? "right",
    pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  if (transition.shader && canUseGl) return { style: {}, gl: true };
  switch (transition.kind) {
    case "dissolve":
    case "fade":
      return { style: { opacity: p } };
    case "dip":
      return {
        style: { opacity: Math.min(1, p * 2) },
        mediaFilter: `brightness(${Math.max(0, p * 2 - 1)})`,
      };
    case "flash":
      return {
        style: { opacity: Math.min(1, p * 2) },
        mediaOpacity: p < 0.5 ? 0 : 1,
        overlay: { color: "#ffffff", opacity: p < 0.5 ? 1 : 2 - p * 2 },
      };
    case "wipe": {
      const hidden = pct(1 - e);
      const inset =
        dir === "left"
          ? `0 0 0 ${hidden}`
          : dir === "up"
            ? `${hidden} 0 0 0`
            : dir === "down"
              ? `0 0 ${hidden} 0`
              : `0 ${hidden} 0 0`;
      return { style: { clipPath: `inset(${inset})` } };
    }
    case "soft-wipe": {
      const to =
          dir === "left"
            ? "to left"
            : dir === "up"
              ? "to top"
              : dir === "down"
                ? "to bottom"
                : "to right",
        edge = p * 1.3 - 0.15,
        mask = `linear-gradient(${to}, #000 ${pct(edge - 0.15)}, transparent ${pct(edge + 0.15)})`;
      return { style: { maskImage: mask, WebkitMaskImage: mask } };
    }
    case "slide": {
      const offset = pct(1 - e);
      return {
        style: {},
        transform:
          dir === "left"
            ? `translateX(-${offset})`
            : dir === "up"
              ? `translateY(${offset})`
              : dir === "down"
                ? `translateY(-${offset})`
                : `translateX(${offset})`,
      };
    }
    case "circle":
      return { style: { clipPath: `circle(${pct(e * 0.72)} at 50% 50%)` } };
    case "diamond": {
      const r = e;
      return {
        style: {
          clipPath: `polygon(50% ${pct(0.5 - r)}, ${pct(0.5 + r)} 50%, 50% ${pct(0.5 + r)}, ${pct(0.5 - r)} 50%)`,
        },
      };
    }
    case "clock": {
      const angle = (p * 360).toFixed(2),
        mask = `conic-gradient(from 0deg, #000 ${angle}deg, transparent ${angle}deg)`;
      return { style: { maskImage: mask, WebkitMaskImage: mask } };
    }
    case "blinds": {
      const to = dir === "up" || dir === "down" ? "to bottom" : "to right",
        open = (p * 10).toFixed(3),
        mask = `repeating-linear-gradient(${to}, #000 0%, #000 ${open}%, transparent ${open}%, transparent 10%)`;
      return { style: { maskImage: mask, WebkitMaskImage: mask } };
    }
    case "checker": {
      // Half the squares appear first, then the others.
      const a = Math.min(1, p * 2),
        b = Math.max(0, p * 2 - 1),
        mask = `conic-gradient(rgba(0,0,0,${a}) 0 25%, rgba(0,0,0,${b}) 0 50%, rgba(0,0,0,${a}) 0 75%, rgba(0,0,0,${b}) 0)`;
      return {
        style: {
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: "12.5% 22.222%",
          WebkitMaskSize: "12.5% 22.222%",
        },
      };
    }
    case "zoom":
      return {
        style: { opacity: Math.min(1, p * 1.6) },
        transform: `scale(${(1 + (1 - e) * 0.6).toFixed(4)})`,
      };
    case "spin":
      return {
        style: { opacity: Math.min(1, p * 1.4) },
        transform: `rotate(${((1 - e) * -120).toFixed(2)}deg) scale(${(0.4 + e * 0.6).toFixed(4)})`,
      };
    case "noise":
    case "pixelate":
    case "glitch":
    case "ripple":
      return canUseGl ? { style: {}, gl: true } : { style: { opacity: p } };
    default:
      return { style: { opacity: p } };
  }
}
