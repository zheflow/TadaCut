import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Project } from "@tadacut/domain";
import type { Skill } from "./storage";
import { executable, runProcess } from "./process";
import type { MediaService } from "./media";
export async function executeSkillScript(
  skill: Skill,
  project: Project,
  media: MediaService,
  input: unknown,
  signal: AbortSignal,
) {
  const deno = executable("deno");
  if (!deno) throw new Error("TypeScript 技能脚本需要 Deno；安装后会自动识别");
  if (!skill.enabled || !skill.script?.trim())
    throw new Error("技能没有启用脚本");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tadacut-skill-"));
  try {
    const output = path.join(dir, "output");
    await fs.mkdir(output);
    const snapshot = {
      ...project,
      assets: project.assets.map(({ originalPath, embedding, ...a }) => ({
        ...a,
        ...(a.url.startsWith("/media/") ? { localFile: media.file(a) } : {}),
      })),
    };
    await fs.writeFile(
      path.join(dir, "input.json"),
      JSON.stringify({ project: snapshot, input, output }),
    );
    await fs.writeFile(path.join(dir, "skill.ts"), skill.script);
    await fs.writeFile(
      path.join(dir, "main.ts"),
      `import run from './skill.ts';\nconst input = JSON.parse(await Deno.readTextFile(Deno.args[0]));\nconsole.log(JSON.stringify(await run(input)));\n`,
    );
    const files = project.assets
      .filter((a) => a.url.startsWith("/media/"))
      .map((a) => media.file(a));
    const result = await runProcess(
      deno,
      [
        "run",
        "--no-prompt",
        "--no-remote",
        "--no-npm",
        `--allow-read=${[dir, ...files].join(",")}`,
        `--allow-write=${output}`,
        path.join(dir, "main.ts"),
        path.join(dir, "input.json"),
      ],
      signal,
      2 * 1024 * 1024,
    );
    const line = result.stdout.toString().trim().split("\n").pop();
    if (!line) throw new Error("脚本没有返回 JSON 结果");
    return JSON.parse(line) as {
      commands?: unknown[];
      label?: string;
      summary?: string;
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
