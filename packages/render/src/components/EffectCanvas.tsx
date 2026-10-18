import { advancedShader, needsAdvancedPass } from "../advanced-gl";
import { useEffect, useMemo, useRef } from "react";
import {
  effectParams,
  parseCube,
  type Asset,
  type Clip,
} from "../../../domain/src/index";
import { delayRender, continueRender } from "remotion";
import {
  effectShaders,
  extensionTransition,
  transitionShaders,
} from "../effects-gl";
import type { LayerPlan } from "../plan";
const vertexSource = `#version 300 es\nin vec2 a_position;out vec2 v_uv;void main(){v_uv=(a_position+1.)*.5;gl_Position=vec4(a_position,0.,1.);}`;
// GLSL ES 3.00 has no default precision for sampler3D; ANGLE rejects the shader without one.
const gradeSource = `#version 300 es\nprecision mediump float;precision mediump sampler3D;in vec2 v_uv;uniform sampler2D u_texture;uniform sampler3D u_lut;uniform vec3 u_key;uniform float u_similarity;uniform float u_keyEnabled;uniform vec3 u_lift;uniform vec3 u_gain;uniform float u_gamma;uniform float u_black;uniform float u_white;uniform float u_luma;uniform float u_lutSize;uniform vec3 u_domainMin;uniform vec3 u_domainMax;out vec4 fragColor;void main(){vec4 c=texture(u_texture,v_uv);if(u_luma>=0.)c.a*=smoothstep(u_luma,u_luma+.1,dot(c.rgb,vec3(.2126,.7152,.0722)));c.rgb=pow(max((c.rgb-vec3(u_black))/max(.001,u_white-u_black)+u_lift,vec3(0.)),vec3(1./u_gamma))*u_gain;if(u_keyEnabled>.5)c.a*=smoothstep(u_similarity,u_similarity+.12,distance(c.rgb,u_key));if(u_lutSize>1.)c.rgb=texture(u_lut,clamp((c.rgb-u_domainMin)/(u_domainMax-u_domainMin),0.,1.)*((u_lutSize-1.)/u_lutSize)+vec3(.5/u_lutSize)).rgb;fragColor=c;}`;
const copySource = `#version 300 es\nprecision mediump float;in vec2 v_uv;uniform sampler2D u_texture;out vec4 fragColor;void main(){fragColor=texture(u_texture,v_uv);}`;
/** Whether the clip needs the grading pass. */
export const needsGrade = (e: Clip["effects"]) =>
  Boolean(
    e.chromaKey ||
      e.lutAssetId ||
      e.lumaKey !== undefined ||
      e.gamma !== 1 ||
      e.black !== 0 ||
      e.white !== 1 ||
      e.lift.some((v) => v !== 0) ||
      e.gain.some((v) => v !== 1),
  );
/** Whether a layer is drawn through WebGL at all. */
export const needsEffectCanvas = (e: Clip["effects"]) =>
  needsGrade(e) || Boolean(e.shader) || e.presets.length > 0;
/**
 * Draws a clip's image or video frame through a chain of WebGL passes:
 * library effects in order, then grading, keying and LUT, then a custom
 * shader, then a pixel transition. Passes ping-pong between two framebuffers;
 * the last one draws to the canvas.
 */
export function EffectCanvas({
  asset,
  clip,
  video,
  frameImage,
  redraw,
  assets,
  frame,
  fps = 30,
  transition,
  rendering = false,
  onError,
}: {
  asset: Asset;
  clip: Clip;
  video: React.RefObject<HTMLVideoElement | null>;
  /** The decoded frame an export's OffthreadVideo provides. */
  frameImage?: React.RefObject<CanvasImageSource | null>;
  /** Set to this canvas's draw function, for sources that announce new frames. */
  redraw?: React.RefObject<(() => void) | null>;
  assets: Asset[];
  frame: number;
  fps?: number;
  /** A pixel transition the incoming clip is drawn with. */
  transition?: LayerPlan["transition"];
  rendering?: boolean;
  onError?(message: string): void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    localFrame = useRef(frame),
    progress = useRef(transition?.progress ?? 1),
    params = useRef(clip.effects.presets),
    draw = useRef<() => void>(() => {});
  localFrame.current = frame;
  progress.current = transition?.progress ?? 1;
  params.current = clip.effects.presets;
  const transitionSource = transition
    ? transition.shader
      ? extensionTransition(transition.shader)
      : transitionShaders[transition.kind]
    : undefined;
  const handle = useMemo(
    () => (rendering ? delayRender("WebGL effect") : null),
    [frame, rendering],
  );
  const pending = useRef(handle);
  pending.current = handle;
  useEffect(
    () => () => {
      if (handle !== null) continueRender(handle);
    },
    [handle],
  );
  // A new frame number redraws with the current source. A previewed video
  // redraws from its own frame callbacks instead, so it is not drawn twice,
  // unless something animates with time.
  const animated = Boolean(transitionSource) || clip.effects.presets.length > 0;
  useEffect(() => {
    const element = video.current;
    if (
      !rendering &&
      !animated &&
      asset.kind === "video" &&
      element &&
      "requestVideoFrameCallback" in element
    )
      return;
    draw.current();
  }, [frame, rendering, asset.kind, video, animated]);
  const chain = clip.effects.presets.map((p) => p.id).join(",");
  useEffect(() => {
    const canvas = ref.current!,
      gl = canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
    if (!gl) {
      onError?.("此环境不支持 WebGL2");
      return;
    }
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(reason || "Shader 编译失败");
      }
      return shader;
    };
    const link = (source: string) => {
      const vertex = compile(gl.VERTEX_SHADER, vertexSource),
        fragment = compile(gl.FRAGMENT_SHADER, source),
        program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      // Every program reads the quad from attribute 0.
      gl.bindAttribLocation(program, 0, "a_position");
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) ?? "Shader 链接失败");
      return program;
    };
    type Pass = {
      program: WebGLProgram;
      kind: "preset" | "grade" | "advanced" | "custom" | "transition" | "copy";
      index?: number;
    };
    const passes: Pass[] = [],
      targets: { framebuffer: WebGLFramebuffer; texture: WebGLTexture }[] = [];
    let texture: WebGLTexture | null = null,
      lutTexture: WebGLTexture | null = null,
      buffer: WebGLBuffer | null = null,
      disposed = false,
      size = [0, 0];
    const sourceImage = new Image();
    sourceImage.crossOrigin = "anonymous";
    sourceImage.onload = () => draw.current();
    sourceImage.src = asset.url;
    // Video frames redraw only when the element presents a new frame, not on every animation frame.
    const element = video.current;
    let frameCallback = 0;
    const onVideoFrame = () => {
      draw.current();
      if (element && "requestVideoFrameCallback" in element)
        frameCallback = element.requestVideoFrameCallback(onVideoFrame);
    };
    const onSeeked = () => draw.current();
    if (element && asset.kind === "video") {
      element.addEventListener("seeked", onSeeked);
      element.addEventListener("loadeddata", onSeeked);
      if ("requestVideoFrameCallback" in element)
        frameCallback = element.requestVideoFrameCallback(onVideoFrame);
    }
    const makeTexture = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const init = async () => {
      try {
        clip.effects.presets.forEach((preset, index) => {
          const source = effectShaders[preset.id];
          if (!source) throw new Error(`没有这个特效：${preset.id}`);
          passes.push({ program: link(source), kind: "preset", index });
        });
        if (needsGrade(clip.effects))
          passes.push({ program: link(gradeSource), kind: "grade" });
        if (needsAdvancedPass(clip.advanced))
          passes.push({
            program: link(advancedShader(clip.advanced!)),
            kind: "advanced",
          });
        if (clip.effects.shader)
          passes.push({ program: link(clip.effects.shader), kind: "custom" });
        if (transitionSource)
          passes.push({ program: link(transitionSource), kind: "transition" });
        if (!passes.length)
          passes.push({ program: link(copySource), kind: "copy" });
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        texture = makeTexture();
        // The 3D LUT sampler keeps its own unit: two sampler types on one unit
        // make every draw fail. Without a LUT a 1×1×1 placeholder stays bound.
        lutTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texImage3D(
          gl.TEXTURE_3D,
          0,
          gl.RGB8,
          1,
          1,
          1,
          0,
          gl.RGB,
          gl.UNSIGNED_BYTE,
          new Uint8Array(3),
        );
        gl.activeTexture(gl.TEXTURE0);
        const grade = passes.find((p) => p.kind === "grade")?.program;
        if (grade) {
          gl.useProgram(grade);
          const u = (name: string) => gl.getUniformLocation(grade, name);
          gl.uniform3fv(u("u_lift"), clip.effects.lift);
          gl.uniform3fv(u("u_gain"), clip.effects.gain);
          gl.uniform1f(u("u_gamma"), clip.effects.gamma);
          gl.uniform1f(u("u_black"), clip.effects.black);
          gl.uniform1f(u("u_white"), clip.effects.white);
          gl.uniform1f(u("u_luma"), clip.effects.lumaKey ?? -1);
          gl.uniform1i(u("u_lut"), 1);
          const color =
            /^#([\da-f]{6})$/i.exec(clip.effects.chromaKey ?? "#00ff00")?.[1] ??
            "00ff00";
          gl.uniform3f(
            u("u_key"),
            parseInt(color.slice(0, 2), 16) / 255,
            parseInt(color.slice(2, 4), 16) / 255,
            parseInt(color.slice(4, 6), 16) / 255,
          );
          gl.uniform1f(u("u_keyEnabled"), clip.effects.chromaKey ? 1 : 0);
          gl.uniform1f(u("u_similarity"), clip.effects.chromaSimilarity);
          const lutAsset = assets.find((a) => a.id === clip.effects.lutAssetId);
          if (lutAsset) {
            const lut = parseCube(
              lutAsset.text || (await (await fetch(lutAsset.url)).text()),
            );
            if (disposed) return;
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_3D, lutTexture);
            const values = new Uint8Array(lut.values.length);
            lut.values.forEach(
              (v, i) =>
                (values[i] = Math.round(Math.max(0, Math.min(1, v)) * 255)),
            );
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            // WebGL2 rejects 3D uploads from arrays while UNPACK_FLIP_Y is on.
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage3D(
              gl.TEXTURE_3D,
              0,
              gl.RGB8,
              lut.size,
              lut.size,
              lut.size,
              0,
              gl.RGB,
              gl.UNSIGNED_BYTE,
              values,
            );
            gl.useProgram(grade);
            gl.uniform1f(u("u_lutSize"), lut.size);
            gl.uniform3fv(u("u_domainMin"), lut.domainMin);
            gl.uniform3fv(u("u_domainMax"), lut.domainMax);
            gl.activeTexture(gl.TEXTURE0);
          }
        }
        const resize = (width: number, height: number) => {
          if (size[0] === width && size[1] === height) return;
          size = [width, height];
          // Resizing a canvas reallocates its buffer, so only on a real change.
          canvas.width = width;
          canvas.height = height;
          for (const target of targets) {
            gl.deleteFramebuffer(target.framebuffer);
            gl.deleteTexture(target.texture);
          }
          targets.length = 0;
          if (passes.length > 1)
            for (let i = 0; i < 2; i++) {
              const t = makeTexture();
              gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                width,
                height,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null,
              );
              const framebuffer = gl.createFramebuffer()!;
              gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
              gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                t,
                0,
              );
              targets.push({ framebuffer, texture: t });
            }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        };
        draw.current = () => {
          if (disposed) return;
          const source: CanvasImageSource | null =
            asset.kind === "video"
              ? (frameImage?.current ?? video.current)
              : sourceImage;
          const ready =
            source instanceof HTMLVideoElement
              ? source.readyState >= 2
              : source instanceof HTMLImageElement
                ? source.complete && source.naturalWidth > 0
                : Boolean(source);
          if (!ready) return;
          const width = asset.width ?? 1920,
            height = asset.height ?? 1080;
          resize(width, height);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            source as TexImageSource,
          );
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          let input = texture;
          passes.forEach((pass, i) => {
            const last = i === passes.length - 1,
              target = last ? null : targets[i % 2];
            gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
            gl.viewport(0, 0, width, height);
            gl.useProgram(pass.program);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, input);
            const u = (name: string) =>
              gl.getUniformLocation(pass.program, name);
            gl.uniform1i(u("u_texture"), 0);
            gl.uniform2f(u("u_resolution"), width, height);
            gl.uniform1f(u("u_time"), localFrame.current / fps);
            gl.uniform1f(
              u("u_progress"),
              pass.kind === "transition"
                ? progress.current
                : localFrame.current / Math.max(1, clip.duration),
            );
            if (pass.kind === "preset") {
              const preset = params.current[pass.index!];
              if (preset) {
                let values: Record<string, number> = {};
                try {
                  values = effectParams(preset.id, preset.params);
                } catch {
                  values = {};
                }
                for (const [key, value] of Object.entries(values))
                  gl.uniform1f(u(`u_${key}`), value);
              }
            }
            if (!last) gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            if (target) input = target.texture;
          });
          if (pending.current !== null) continueRender(pending.current);
        };
        if (redraw) redraw.current = () => draw.current();
        draw.current();
      } catch (error) {
        canvas.dataset.error =
          error instanceof Error ? error.message : String(error);
        canvas.style.display = "none";
        onError?.(canvas.dataset.error);
      }
    };
    void init();
    return () => {
      disposed = true;
      draw.current = () => {};
      if (redraw) redraw.current = null;
      sourceImage.onload = null;
      if (element) {
        element.removeEventListener("seeked", onSeeked);
        element.removeEventListener("loadeddata", onSeeked);
        if (frameCallback && "cancelVideoFrameCallback" in element)
          element.cancelVideoFrameCallback(frameCallback);
      }
      for (const target of targets) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
      if (texture) gl.deleteTexture(texture);
      if (lutTexture) gl.deleteTexture(lutTexture);
      if (buffer) gl.deleteBuffer(buffer);
      for (const pass of passes) gl.deleteProgram(pass.program);
    };
  }, [
    asset.url,
    JSON.stringify(clip.advanced),
    chain,
    transitionSource,
    clip.effects.shader,
    clip.effects.chromaKey,
    clip.effects.chromaSimilarity,
    clip.effects.lutAssetId,
    clip.effects.gamma,
    clip.effects.black,
    clip.effects.white,
    clip.effects.lumaKey,
    clip.effects.lift.join(","),
    clip.effects.gain.join(","),
    onError,
    assets.find((a) => a.id === clip.effects.lutAssetId)?.text,
  ]);
  // Parameter changes only need a redraw.
  useEffect(() => {
    draw.current();
  }, [JSON.stringify(clip.effects.presets), transition?.progress]);
  return <canvas className="effect-canvas" ref={ref} />;
}
