import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioServer } from "../apps/server/src/server";
import { sampleArt } from "../apps/server/src/sample-art";
import { renderSampleArt } from "../promo/sample-art";

describe("sample project artwork", () => {
  it("is the promo's drawing, saved as standalone 1920 × 1080 SVG", () => {
    expect(renderSampleArt()).toEqual(sampleArt);
    for (const svg of sampleArt)
      expect(svg).toMatch(
        /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1920 1080" width="1920" height="1080">/,
      );
  });

  it("seeds the sample and redraws artwork left by an earlier version", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-art-"));
    const file = path.join(dir, "media", "demo-landscape-1.svg");
    const start = () =>
      createStudioServer({ root: process.cwd(), dataDir: dir, port: 0 });
    try {
      let server = await start();
      expect(await fs.readFile(file, "utf8")).toBe(sampleArt[1]);
      await server.close();
      await fs.writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
      server = await start();
      expect(await fs.readFile(file, "utf8")).toBe(sampleArt[1]);
      const session = await server.app.inject({
        url: "/api/session",
        headers: { host: "127.0.0.1" },
      });
      const projects = await server.app.inject({
        url: "/api/projects",
        headers: {
          host: "127.0.0.1",
          cookie: session.headers["set-cookie"]!.toString().split(";")[0],
        },
      });
      expect(projects.json()).toHaveLength(1);
      await server.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
