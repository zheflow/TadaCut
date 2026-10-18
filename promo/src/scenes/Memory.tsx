import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ArrowDown, BrainCircuit, Check, Sparkles } from "lucide-react";
import { Card, Cursor, Ripple, Words } from "../kit";
import { accel, keys, pop, span } from "../motion";
import { BEAT, cues } from "../timeline";
import { ink } from "../theme";

/** Learning is opt-in. Only the accepted preference carries into a new project. */
export function Memory() {
  const frame = useCurrentFrame();
  const c = cues.memory;
  const saved = frame >= c.confirm * BEAT;
  const exit = span(frame, 15.3, 16, accel);
  const appear = (beat: number): React.CSSProperties => ({
    opacity: span(frame, beat, beat + 0.7),
    transform: `translateY(${(1 - pop(frame, beat)) * 28}px)`,
  });
  const press =
    span(frame, c.confirm - 0.1, c.confirm) *
    (1 - span(frame, c.confirm + 0.1, c.confirm + 0.3));
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div style={{ position: "absolute", left: 130, top: 260, width: 770 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: ink.brand,
            fontSize: 28,
            fontWeight: 600,
            marginBottom: 36,
            ...appear(0),
          }}
        >
          <BrainCircuit size={34} /> 创作记忆
        </div>
        <Words parts={["越用，"]} at={0.3} size={88} />
        <Words
          parts={[{ text: "越了解你的习惯", color: ink.brand }, "。"]}
          at={0.8}
          size={76}
          style={{ marginTop: 16, whiteSpace: "nowrap" }}
        />
        <div
          style={{
            fontSize: 31,
            lineHeight: 1.8,
            color: ink.muted,
            marginTop: 38,
            ...appear(2),
          }}
        >
          记住你的节奏、字幕风格和项目约定。
          <br />
          下一次创作，少解释一点。
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 38,
            ...appear(4),
          }}
        >
          {["长期偏好", "项目约定"].map((label) => (
            <span
              key={label}
              style={{
                background: "#fcebf1",
                color: ink.brand,
                padding: "12px 22px",
                borderRadius: 16,
                fontSize: 25,
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <div
          style={{
            color: ink.muted,
            fontSize: 24,
            marginTop: 30,
            ...appear(c.confirm + 0.5),
          }}
        >
          经你确认后保存，随时可改、可删除。
        </div>
      </div>
      <Card
        style={{
          left: 960,
          top: 190,
          width: 800,
          height: 330,
          padding: 34,
          boxSizing: "border-box",
          ...appear(0.5),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Sparkles size={27} color={ink.brand} />
          <strong style={{ fontSize: 27 }}>这次，记住你的偏好</strong>
          <span style={{ marginLeft: "auto", fontSize: 20, color: ink.muted }}>
            偏好学习已开启
          </span>
        </div>
        <div
          style={{
            background: ink.raised,
            borderRadius: 18,
            padding: "22px 24px",
            marginTop: 28,
            fontSize: 29,
            ...appear(c.preference),
          }}
        >
          我习惯 15 秒竖屏，字幕用白色。
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 30,
            fontSize: 26,
            ...appear(c.candidate),
          }}
        >
          <span style={{ color: saved ? ink.success : ink.muted }}>
            {saved ? "已保存到长期偏好" : "要记住这个创作习惯吗？"}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: 178,
              height: 58,
              borderRadius: 14,
              background: saved ? ink.successSoft : ink.accent,
              color: saved ? ink.success : "#fff",
              fontWeight: 600,
              transform: `scale(${1 - press * 0.06})`,
            }}
          >
            {saved && <Check size={26} />}
            {saved ? "已记住" : "确认记住"}
          </span>
        </div>
      </Card>
      <ArrowDown
        size={32}
        color={ink.brand}
        style={{ position: "absolute", left: 1344, top: 545, ...appear(8) }}
      />
      <Card
        style={{
          left: 960,
          top: 606,
          width: 800,
          height: 320,
          padding: 34,
          boxSizing: "border-box",
          ...appear(c.recall),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrainCircuit size={27} color={ink.brand} />
          <strong style={{ fontSize: 27 }}>下个项目，带着习惯开始</strong>
        </div>
        <div style={{ marginTop: 24, fontSize: 29 }}>帮我剪这段旅行视频。</div>
        <div
          style={{
            marginTop: 24,
            background: "#fdf3f7",
            borderRadius: 18,
            padding: "20px 24px",
            ...appear(c.reply),
          }}
        >
          <div style={{ fontSize: 27, color: ink.brand, fontWeight: 600 }}>
            按你的习惯：15 秒 · 竖屏 · 白色字幕
          </div>
          <div style={{ fontSize: 21, marginTop: 12, color: ink.muted }}>
            已参考你的偏好，准备剪辑草稿
          </div>
        </div>
      </Card>
      <Ripple x={1638} y={422} t={span(frame, c.confirm, c.confirm + 0.8)} />
      <Cursor
        x={keys(frame, [
          [4.6, 1860],
          [5.7, 1638],
          [6.8, 1638],
          [7.5, 1800],
        ])}
        y={keys(frame, [
          [4.6, 720],
          [5.7, 422],
          [6.8, 422],
          [7.5, 580],
        ])}
        press={press}
        opacity={span(frame, 4.6, 5) * (1 - span(frame, 6.9, 7.5))}
      />
    </AbsoluteFill>
  );
}
