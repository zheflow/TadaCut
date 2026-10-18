import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { findBrowser } from "../apps/server/src/process.ts";
import {
  effectShaders,
  transitionShaders,
  extensionTransition,
} from "../packages/render/src/effects-gl.ts";

const executablePath = findBrowser();
if (!executablePath)
  throw new Error("Set TADACUT_CHROME_PATH to a Chromium executable");
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const report = await page.evaluate(
    ({ shaders, probe }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
      if (!gl) throw new Error("WebGL2 is unavailable");
      function compile(kind: number, source: string) {
        const shader = gl!.createShader(kind)!;
        gl!.shaderSource(shader, source);
        gl!.compileShader(shader);
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS))
          throw new Error(
            gl!.getShaderInfoLog(shader) ?? "Shader compilation failed",
          );
        return shader;
      }
      const vertex = compile(
        gl.VERTEX_SHADER,
        `#version 300 es
      out vec2 v_uv;
      void main() {
        vec2 points[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
        gl_Position = vec4(points[gl_VertexID], 0., 1.);
        v_uv = gl_Position.xy * .5 + .5;
      }`,
      );
      function link(source: string) {
        const fragment = compile(gl!.FRAGMENT_SHADER, source);
        const program = gl!.createProgram()!;
        gl!.attachShader(program, vertex);
        gl!.attachShader(program, fragment);
        gl!.linkProgram(program);
        gl!.deleteShader(fragment);
        if (!gl!.getProgramParameter(program, gl!.LINK_STATUS))
          throw new Error(
            gl!.getProgramInfoLog(program) ?? "Shader link failed",
          );
        return program;
      }
      for (const [name, source] of Object.entries(shaders)) {
        try {
          gl.deleteProgram(link(source));
        } catch (error) {
          throw new Error(`${name}: ${String(error)}`);
        }
      }
      const program = link(probe);
      gl.useProgram(program);
      const mode = gl.getUniformLocation(program, "testMode");
      const hsv = gl.getUniformLocation(program, "testHsv");
      const offset = gl.getUniformLocation(program, "testOffset");
      function draw(modeValue: number, color = [0, 0, 0], shift = 0) {
        gl!.uniform1i(mode, modeValue);
        gl!.uniform3fv(hsv, color);
        gl!.uniform1f(offset, shift);
        gl!.viewport(0, 0, 64, 64);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
        const pixels = new Uint8Array(64 * 64 * 4);
        gl!.readPixels(0, 0, 64, 64, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels);
        if (gl!.getError() !== gl!.NO_ERROR)
          throw new Error("WebGL draw failed");
        return pixels;
      }
      const colors = [
        { hsv: [0, 1, 1], rgb: [255, 0, 0] },
        { hsv: [1 / 6, 1, 1], rgb: [255, 255, 0] },
        { hsv: [2 / 6, 1, 1], rgb: [0, 255, 0] },
        { hsv: [3 / 6, 1, 1], rgb: [0, 255, 255] },
        { hsv: [4 / 6, 1, 1], rgb: [0, 0, 255] },
        { hsv: [5 / 6, 1, 1], rgb: [255, 0, 255] },
        { hsv: [1, 1, 1], rgb: [255, 0, 0] },
        { hsv: [-1 / 6, 1, 1], rgb: [255, 0, 255] },
        { hsv: [0.3, 0, 0.5], rgb: [128, 128, 128] },
        { hsv: [0.2, 1, 0], rgb: [0, 0, 0] },
        { hsv: [0, 0.5, 0.8], rgb: [204, 102, 102] },
      ];
      for (const sample of colors) {
        const actual = draw(0, sample.hsv);
        if (sample.rgb.some((channel, i) => Math.abs(channel - actual[i]) > 1))
          throw new Error(
            `HSV ${sample.hsv}: got ${actual.slice(0, 3)}, expected ${sample.rgb}`,
          );
      }
      const a = draw(1),
        b = draw(1),
        shifted = draw(1, undefined, 0.25);
      const bins = Array(16).fill(0) as number[];
      let sum = 0,
        changed = 0,
        min = 255,
        max = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i])
          throw new Error("Random texture is not deterministic");
        if (a[i] !== shifted[i]) changed++;
        if (a[i] !== a[i + 1] || a[i] !== a[i + 2] || a[i + 3] !== 255)
          throw new Error("Invalid random texture channels");
        sum += a[i];
        min = Math.min(min, a[i]);
        max = Math.max(max, a[i]);
        bins[Math.floor(a[i] / 16)]++;
      }
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      return {
        compiled: Object.keys(shaders).length,
        colors: colors.length,
        mean: sum / 4096,
        min,
        max,
        bins,
        changed,
      };
    },
    {
      shaders: {
        ...effectShaders,
        ...Object.fromEntries(
          Object.entries(transitionShaders).map(([key, value]) => [
            `transition:${key}`,
            value,
          ]),
        ),
      },
      probe: extensionTransition(`uniform int testMode;
      uniform vec3 testHsv;
      uniform float testOffset;
      vec4 transition(vec2 uv) {
        if (testMode == 0) return vec4(hsv2rgb(testHsv), 1.);
        return vec4(vec3(hash(floor(uv * 64.) + testOffset)), 1.);
      }`),
    },
  );
  assert.ok(
    report.min <= 2 && report.max >= 253,
    "Random texture must span the output range",
  );
  assert.ok(
    report.mean > 115 && report.mean < 140,
    "Random texture is strongly biased",
  );
  assert.ok(
    report.bins.every((n) => n > 170 && n < 340),
    "Random texture distribution is uneven",
  );
  assert.ok(
    report.changed > 3900,
    "Fractional coordinates must change the texture",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
