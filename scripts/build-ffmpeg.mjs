import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
// Builds the FFmpeg and FFprobe that ship with the macOS and Linux apps from
// the official release source, under the LGPL: no --enable-gpl, no
// --enable-nonfree and no external codec libraries. The app only decodes,
// filters (scale, select, loudnorm, afftdn…) and writes PCM / JPEG frames, all
// of which FFmpeg does natively; movie encoding goes through Remotion.
// Windows packages keep the GPLv3 build from @ffmpeg-installer (see
// docs/third-party.md).
const version = "8.1.3";
const sha256 =
  "7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3";
const source = `https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz`;
if (process.platform === "win32") {
  console.log("Windows packages use the GPLv3 FFmpeg from @ffmpeg-installer");
  process.exit(0);
}
const minimum = "12.0";
const configure = [
  "--disable-autodetect",
  "--enable-zlib",
  "--disable-doc",
  "--disable-debug",
  "--disable-network",
  "--disable-avdevice",
  "--disable-programs",
  "--enable-ffmpeg",
  "--enable-ffprobe",
  "--enable-static",
  "--disable-shared",
  ...(process.platform === "darwin"
    ? [
        "--enable-videotoolbox",
        "--enable-audiotoolbox",
        `--extra-cflags=-mmacosx-version-min=${minimum}`,
        `--extra-ldflags=-mmacosx-version-min=${minimum}`,
      ]
    : []),
  ...(process.arch === "x64" &&
  spawnSync("nasm", ["-v"], { stdio: "ignore" }).status !== 0
    ? ["--disable-x86asm"]
    : []),
];
const target = path.resolve("build/ffmpeg"),
  meta = path.join(target, "tadacut-ffmpeg.json"),
  platform = `${process.platform}-${process.arch}`;
try {
  const current = JSON.parse(await fs.readFile(meta));
  if (
    current.version === version &&
    current.platform === platform &&
    current.configure.join(" ") === configure.join(" ")
  ) {
    console.log("Bundled LGPL FFmpeg cached");
    process.exit(0);
  }
} catch {}
const cache = path.resolve("build/ffmpeg-downloads");
await fs.mkdir(cache, { recursive: true });
const archive = path.join(cache, `ffmpeg-${version}.tar.xz`);
try {
  await fs.stat(archive);
} catch {
  console.log(`Downloading FFmpeg ${version} source`);
  const response = await fetch(source, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body)
    throw new Error("FFmpeg source download failed: " + response.status);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(archive + ".partial"),
  );
  await fs.rename(archive + ".partial", archive);
}
const digest = crypto
  .createHash("sha256")
  .update(await fs.readFile(archive))
  .digest("hex");
if (digest !== sha256) {
  await fs.rm(archive, { force: true });
  throw new Error(`FFmpeg source checksum mismatch: ${digest}`);
}
const work = path.join(cache, `build-${platform}`);
await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(work, { recursive: true });
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(`${command} ${args[0] ?? ""} failed (${result.status})`);
};
run("tar", ["-xf", archive, "-C", work]);
const tree = path.join(work, `ffmpeg-${version}`);
console.log(`Building LGPL FFmpeg ${version} (${platform})`);
run("./configure", configure, tree);
run("make", [`-j${os.availableParallelism()}`, "ffmpeg", "ffprobe"], tree);
// The configured license, as FFmpeg itself reports it.
const license = spawnSync(path.join(tree, "ffmpeg"), ["-hide_banner", "-L"], {
  encoding: "utf8",
}).stdout;
if (!/GNU Lesser General Public/.test(license) || /nonfree/i.test(license))
  throw new Error("FFmpeg build is not LGPL");
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
for (const file of ["ffmpeg", "ffprobe"]) {
  await fs.copyFile(path.join(tree, file), path.join(target, file));
  await fs.chmod(path.join(target, file), 0o755);
}
await fs.copyFile(
  path.join(tree, "COPYING.LGPLv2.1"),
  path.join(target, "COPYING.LGPLv2.1"),
);
await fs.writeFile(
  path.join(target, "README.txt"),
  `FFmpeg ${version}, built unmodified from ${source}
(sha256 ${sha256}) by scripts/build-ffmpeg.mjs under the GNU LGPL 2.1 or later.
Configure flags: ${configure.join(" ")}
`,
);
await fs.writeFile(
  meta,
  JSON.stringify({
    version,
    platform,
    source,
    sha256,
    configure,
    license: "LGPL-2.1-or-later",
  }),
);
await fs.rm(work, { recursive: true, force: true });
console.log("Bundled LGPL FFmpeg ready");
