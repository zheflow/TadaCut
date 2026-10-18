// Renders the promo: synthesizes the soundtrack, bundles the Remotion
// composition and encodes it, all from this folder's code.
//
//   npm run promo                      full video → output/promo/TadaCut-promo.mp4
//   npm run promo -- --stills=300,900  PNG frames for checking layout
//   npm run promo -- --audio           soundtrack only
//   npm run promo -- --shots           the four sample shots, on one sheet and alone
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { findBrowser } from "../apps/server/src/process";
import { RATE, writeWav } from "./audio/dsp";
import { renderSoundtrack } from "./audio/score";
import { BEAT, sceneStart } from "./src/timeline";

const root = process.cwd();
const out = path.join(root, "output/promo");
const publicDir = path.join(out, "public");
const args = process.argv.slice(2);
const stills = args
  .find((a) => a.startsWith("--stills="))
  ?.slice("--stills=".length)
  .split(",")
  .map(Number);

await fs.mkdir(publicDir, { recursive: true });
const started = Date.now();
const { track, before, after } = renderSoundtrack();
await writeWav(path.join(publicDir, "soundtrack.wav"), track);
console.log(
  `Soundtrack ${(track.length / RATE).toFixed(1)} s · mix peak ${before.peakDb.toFixed(1)} dBFS → peak ${after.peakDb.toFixed(1)} dBFS, RMS ${after.rmsDb.toFixed(1)} dBFS · ${Date.now() - started} ms`,
);
if (args.includes("--audio")) process.exit(0);

const serveUrl = await bundle({
  entryPoint: path.join(root, "promo/src/index.tsx"),
  publicDir,
  outDir: path.join(out, "bundle"),
});
const browserExecutable = findBrowser() ?? undefined;
const inputProps = { soundtrack: !stills };
const composition = await selectComposition({
  serveUrl,
  id: args.includes("--shots") ? "Shots" : "Promo",
  inputProps,
  browserExecutable,
});
if (args.includes("--shots")) {
  for (const variant of [undefined, 0, 1, 2, 3]) {
    const output = path.join(out, `shots${variant ?? ""}.png`);
    const props = { variant };
    await renderStill({
      serveUrl,
      composition: await selectComposition({
        serveUrl,
        id: "Shots",
        inputProps: props,
        browserExecutable,
      }),
      frame: 0,
      output,
      inputProps: props,
      browserExecutable,
    });
    console.log(output);
  }
} else if (stills) {
  for (const frame of stills) {
    const output = path.join(
      out,
      `still-${String(frame).padStart(4, "0")}.png`,
    );
    await renderStill({
      serveUrl,
      composition,
      frame,
      output,
      inputProps,
      browserExecutable,
    });
    console.log(output);
  }
} else {
  const output = path.join(out, "TadaCut-promo.mp4");
  let shown = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    jpegQuality: 95,
    audioCodec: "aac",
    audioBitrate: "320k",
    outputLocation: output,
    concurrency: Math.max(
      1,
      Math.min(
        4,
        os.cpus().length - 2,
        Math.floor(os.freemem() / 1_500_000_000),
      ),
    ),
    onProgress: ({ progress }) => {
      const step = Math.floor(progress * 10);
      if (step !== shown) console.log(`${(shown = step) * 10}%`);
    },
  });
  // The logo with its tagline, for platforms that ask for a cover image.
  const cover = path.join(out, "cover.png");
  await renderStill({
    serveUrl,
    composition,
    frame: Math.round((sceneStart.logo * 4 + 7.2) * BEAT),
    output: cover,
    inputProps,
    browserExecutable,
  });
  console.log(
    `${output}\n${cover} · ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
}
