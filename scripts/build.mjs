import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { bundle } from "@remotion/bundler";
import fs from "node:fs/promises";
import path from "node:path";
import "./build-motion.mjs";
import "./build-icons.mjs";
const root = process.cwd();
await viteBuild({ configFile: path.join(root, "apps/studio/vite.config.ts") });
await build({
  entryPoints: ["apps/server/src/main.ts"],
  outfile: "dist/server/main.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
});
await build({
  entryPoints: ["apps/desktop/src/main.ts"],
  outfile: "dist/desktop/main.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
});
await build({
  entryPoints: ["apps/desktop/src/preload.ts"],
  outfile: "dist/desktop/preload.cjs",
  bundle: true,
  external: ["electron"],
  platform: "node",
  format: "cjs",
  target: "node22",
});
await bundle({
  entryPoint: path.join(root, "packages/render/src/entry.tsx"),
  outDir: path.join(root, "dist/render"),
  publicDir: path.join(root, "apps/studio/public"),
  onProgress: (progress) => {
    if (progress === 100) console.log("Render composition built");
  },
});
await fs.writeFile(
  "dist/build.json",
  JSON.stringify(
    {
      name: "TadaCut",
      version: "0.1.0",
      builtAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2,
  ),
);
console.log("TadaCut production build ready");
