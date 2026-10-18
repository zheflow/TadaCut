import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { colorConversionCube } from "@tadacut/domain";
import { conversionFilter } from "../apps/server/src/color-export";
import { mediaBinary } from "../apps/server/src/media";
import { runProcess } from "../apps/server/src/process";

it("preserves more than 8-bit gradient precision through the color pipeline", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-color-"));
  try {
    const width = 512,
      pixels = Buffer.alloc(width * 2 * 6),
      input = path.join(dir, "gradient.rgb48"),
      cube = path.join(dir, "identity.cube");
    for (let i = 0; i < width * 2; i++) {
      const value = Math.round(((i % width) * 65535) / (width - 1));
      for (let c = 0; c < 3; c++) pixels.writeUInt16LE(value, i * 6 + c * 2);
    }
    await fs.writeFile(input, pixels);
    await fs.writeFile(cube, colorConversionCube("rec709", "rec709"));
    const { stdout } = await runProcess(mediaBinary("ffmpeg")!, [
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgb48le",
      "-video_size",
      `${width}x2`,
      "-i",
      input,
      "-vf",
      conversionFilter("rec709", "rec709", cube),
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "yuv444p10le",
      "pipe:1",
    ]);
    expect(stdout.length).toBe(pixels.length);
    // Measure the actual ten-bit luma before any display RGB conversion.
    const levels = new Set<number>();
    let largestError = 0;
    for (let i = 0; i < width; i++) {
      const level = stdout.readUInt16LE(i * 2);
      levels.add(level);
      const expected = 64 + Math.round((i * 876) / (width - 1));
      largestError = Math.max(largestError, Math.abs(level - expected));
      if (i > 0)
        expect(level).toBeGreaterThanOrEqual(stdout.readUInt16LE((i - 1) * 2));
    }
    // An 8-bit detour collapses this ramp to at most 256 distinct levels.
    expect(levels.size).toBeGreaterThan(400);
    // Allow the integer RGB/YUV range rounding of older swscale releases.
    expect(largestError).toBeLessThanOrEqual(8);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}, 30000);
