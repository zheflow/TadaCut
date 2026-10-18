import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { KeyRound, ShieldCheck, Undo2 } from "lucide-react";
import { Card, CheckDot, Words } from "../kit";
import { accel, mix, pop, span } from "../motion";
import { cues } from "../timeline";
import { ink } from "../theme";

const promises = [
  {
    icon: KeyRound,
    title: "密钥在本机保管",
    text: "本机加密保存，仅在连接所选服务时使用。",
    tag: "本机加密",
  },
  {
    icon: Undo2,
    title: "剪辑修改，一步撤销",
    text: "分镜和时间线一起改，也只占一步历史。",
    tag: "联合撤销",
  },
  {
    icon: ShieldCheck,
    title: "发布之前，先问你",
    text: "生成、联网按你设的权限，发布永远逐次确认。",
    tag: "逐次确认",
  },
];

/** The quiet part of the song: what the assistant will not do on its own. */
export function Trust() {
  const frame = useCurrentFrame();
  const { cards, checks } = cues.trust;
  const exit = span(frame, 7.3, 8, accel);
  return (
    <AbsoluteFill
      style={{ transform: `translateY(${-exit * 120}px)`, opacity: 1 - exit }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 150,
          textAlign: "center",
        }}
      >
        <Words
          parts={["放心", { text: "交给它", color: ink.accent }, "。"]}
          at={0}
          size={100}
        />
        <div
          style={{
            fontSize: 32,
            color: ink.muted,
            marginTop: 18,
            opacity: span(frame, 0.9, 1.5),
          }}
        >
          能做的事很多，边界一样清楚。
        </div>
      </div>
      {promises.map((p, i) => {
        const t = pop(frame, cards[i], { damping: 16, stiffness: 140 });
        const Icon = p.icon;
        return (
          <Card
            key={p.title}
            style={{
              left: 192 + i * 528,
              top: 450,
              width: 480,
              height: 360,
              padding: "44px 40px",
              opacity: Math.min(1, t * 1.4),
              transform: `translateY(${(1 - t) * 90}px) scale(${mix(0.92, 1, t)})`,
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: 22,
                background: ink.accentSoft,
                color: ink.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={40} strokeWidth={2} />
            </div>
            <div style={{ fontSize: 40, fontWeight: 600, marginTop: 34 }}>
              {p.title}
            </div>
            <div
              style={{
                fontSize: 25,
                color: ink.muted,
                marginTop: 14,
                lineHeight: 1.5,
              }}
            >
              {p.text}
            </div>
            <div
              style={{
                position: "absolute",
                left: 40,
                bottom: 34,
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 22,
                fontWeight: 600,
                color: ink.success,
                opacity: span(frame, checks[i], checks[i] + 0.3),
              }}
            >
              <CheckDot t={span(frame, checks[i], checks[i] + 0.6)} size={28} />
              {p.tag}
            </div>
          </Card>
        );
      })}
    </AbsoluteFill>
  );
}
