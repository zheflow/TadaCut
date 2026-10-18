import { build } from "esbuild";
await build({
  entryPoints: ["packages/motion/src/iframe-runtime.tsx"],
  outfile: "apps/studio/public/motion-runtime.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  target: "es2022",
});
