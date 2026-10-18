import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { extractBrowserArchive } from "./extract-browser-archive.mjs";
// Pin the stable browser tested with this release instead of a nightly build.
// Remotion renders with Chrome Headless Shell: about half the size of full
// Chrome for Testing, and video frames are decoded by FFmpeg, not the browser.
const version = "155.0.8059.39";
const platform =
  process.platform === "darwin"
    ? `mac-${process.arch === "arm64" ? "arm64" : "x64"}`
    : process.platform === "win32"
      ? "win64"
      : process.arch === "arm64"
        ? "linux-arm64"
        : "linux64";
const target = path.resolve("build/render-browser"),
  meta = path.join(target, "tadacut-browser.json");
try {
  const current = JSON.parse(await fs.readFile(meta));
  if (
    current.version === version &&
    current.platform === platform &&
    current.kind === "headless-shell"
  ) {
    console.log("Bundled stable render browser cached");
    process.exit(0);
  }
} catch {}
const cache = path.resolve("build/browser-downloads");
await fs.mkdir(cache, { recursive: true });
const archive = path.join(
  cache,
  `chrome-headless-shell-${version}-${platform}.zip`,
);
try {
  await fs.stat(archive);
} catch {
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-headless-shell-${platform}.zip`;
  console.log(`Downloading stable render browser ${version} (${platform})`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body)
    throw new Error("Render browser download failed: " + response.status);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(archive + ".partial"),
  );
  await fs.rename(archive + ".partial", archive);
}
const unpack = path.join(cache, `unpack-${platform}`);
await fs.rm(unpack, { recursive: true, force: true });
await extractBrowserArchive(archive, unpack);
const source = path.join(unpack, `chrome-headless-shell-${platform}`);
await fs.rm(target, { recursive: true, force: true });
await fs.cp(source, target, { recursive: true, verbatimSymlinks: true });
const executable =
  process.platform === "win32"
    ? "chrome-headless-shell.exe"
    : "chrome-headless-shell";
await fs.chmod(path.join(target, executable), 0o755);
await fs.writeFile(
  meta,
  JSON.stringify({
    executable,
    version,
    platform,
    kind: "headless-shell",
    arch: process.arch,
  }),
);
await fs.rm(unpack, { recursive: true, force: true });
console.log("Bundled stable render browser ready");
