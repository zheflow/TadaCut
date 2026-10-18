import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as Babel from "@babel/standalone";
const root = createRoot(document.getElementById("root")!);
let previous = "",
  Component: React.ComponentType<any> | null = null;
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "motion:frame") return;
  try {
    const { code, frame, fps, width, height } = event.data;
    if (code !== previous || !Component) {
      const compiled = Babel.transform(code, {
        filename: "motion.tsx",
        presets: [
          "react",
          ["typescript", { isTSX: true, allExtensions: true }],
        ],
        plugins: ["transform-modules-commonjs"],
      }).code;
      const module = { exports: {} as any };
      const require = (name: string) => {
        if (name === "react") return React;
        throw new Error("代码动画仅支持 React，无外部模块");
      };
      new Function("React", "module", "exports", "require", compiled || "")(
        React,
        module,
        module.exports,
        require,
      );
      Component = module.exports.default;
      if (typeof Component !== "function")
        throw new Error("请 default export 一个 React 组件");
      previous = code;
    }
    const Renderer = Component!;
    flushSync(() =>
      root.render(
        <div
          style={{
            width,
            height,
            transform: `scale(${document.documentElement.clientWidth / width})`,
            transformOrigin: "0 0",
          }}
        >
          <Renderer frame={frame} fps={fps} width={width} height={height} />
        </div>,
      ),
    );
    requestAnimationFrame(() =>
      parent.postMessage({ type: "motion:rendered", frame }, "*"),
    );
  } catch (error) {
    parent.postMessage(
      {
        type: "motion:error",
        message: error instanceof Error ? error.message : String(error),
      },
      "*",
    );
  }
});
parent.postMessage({ type: "motion:ready" }, "*");
