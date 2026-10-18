import { useEffect, useMemo, useRef, useState } from "react";
import { continueRender, delayRender, cancelRender } from "remotion";
export function MotionLayer({
  code,
  frame,
  fps,
  width,
  height,
  onReady,
  rendering = false,
  origin = typeof location === "undefined" ? "" : location.origin,
}: {
  code: string;
  frame: number;
  fps: number;
  width: number;
  height: number;
  onReady?: () => void;
  origin?: string;
  rendering?: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null),
    latest = useRef({ code, frame, fps, width, height }),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  latest.current = { code, frame, fps, width, height };
  const handle = useMemo(
    () => (rendering ? delayRender("Motion graphics frame") : null),
    [frame, code, rendering],
  );
  const pending = useRef(handle);
  pending.current = handle;
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (event.data?.type === "motion:ready") {
        setReady(true);
        ref.current.contentWindow?.postMessage(
          { type: "motion:frame", ...latest.current },
          "*",
        );
      }
      if (
        event.data?.type === "motion:rendered" &&
        event.data.frame === latest.current.frame
      ) {
        setError("");
        onReady?.();
        if (pending.current !== null) continueRender(pending.current);
      }
      if (event.data?.type === "motion:error") {
        const message = String(event.data.message).slice(0, 200);
        setError(message);
        if (rendering) cancelRender(new Error(message));
        onReady?.();
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onReady, rendering]);
  useEffect(() => {
    if (ready)
      ref.current?.contentWindow?.postMessage(
        { type: "motion:frame", ...latest.current },
        "*",
      );
    return () => {
      if (handle !== null) continueRender(handle);
    };
  }, [code, frame, fps, width, height, ready, handle]);
  return (
    <>
      <iframe
        ref={ref}
        className="motion-frame"
        title="代码动画预览"
        sandbox="allow-scripts"
        src={`${origin}/motion-frame.html`}
      />
      {error && <div className="motion-error">{error}</div>}
    </>
  );
}
