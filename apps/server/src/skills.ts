import crypto from "node:crypto";
import type { Skill } from "./storage";

/**
 * Skills in the SKILL.md layout: YAML-style front matter (name, description,
 * allowed-tools, context, command) followed by Markdown instructions, plus
 * optional support files the agent reads on demand. Imported skills are
 * instructions only: they never widen what tools may do.
 */
export interface SkillFile {
  path: string;
  content: string;
}
const textFile = /\.(md|txt|json|ya?ml|csv|ts|js|mjs|tsv|xml|html?)$/i;
/** Front matter values: strings, or lists written inline or as dashes. */
export function parseFrontMatter(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match)
    return { data: {} as Record<string, string | string[]>, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey = "";
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    if (!value) {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value.trim())) {
      data[key] = value
        .trim()
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
      listKey = "";
    } else {
      data[key] = unquote(value.trim());
      listKey = "";
    }
  }
  return { data, body: text.slice(match[0].length) };
}
const unquote = (v: string) => v.replace(/^["']|["']$/g, "");
const list = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v : v ? v.split(/[,\s]+/).filter(Boolean) : [];
/** A skill record from a SKILL.md text and its support files. */
export function skillFromMarkdown(
  markdown: string,
  files: SkillFile[] = [],
  source?: string,
): Skill {
  if (markdown.length > 100000) throw new Error("技能文件过大");
  const { data, body } = parseFrontMatter(markdown);
  const name =
    (typeof data.name === "string" && data.name) ||
    /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ||
    "导入的技能";
  const script = files.find((f) => /^(script|main)\.ts$/i.test(f.path));
  return {
    id: crypto.randomUUID(),
    name: name.slice(0, 100),
    category: (typeof data.category === "string" && data.category) || "导入",
    description: (
      (typeof data.description === "string" && data.description) ||
      "导入的工作流 · 使用前请查看内容"
    ).slice(0, 1000),
    prompt: body.trim(),
    tools: list(data["allowed-tools"] ?? data.tools),
    enabled: true,
    ...(script ? { script: script.content } : {}),
    files: files.filter((f) => f !== script),
    context: data.context === "fork" ? "fork" : "inline",
    ...(typeof data.command === "string"
      ? { command: slug(data.command) }
      : { command: slug(name) }),
    ...(source ? { source } : {}),
  };
}
export const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "skill";
/** SKILL.md for a stored skill, so it can be shared. */
export function skillToMarkdown(skill: Skill) {
  const lines = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description.replace(/\n/g, " ")}`,
    `category: ${skill.category}`,
    ...(skill.tools.length
      ? [`allowed-tools: [${skill.tools.join(", ")}]`]
      : []),
    ...(skill.context === "fork" ? ["context: fork"] : []),
    ...(skill.command ? [`command: ${skill.command}`] : []),
    "---",
    "",
    skill.prompt,
  ];
  return lines.join("\n");
}
const fetchText = async (url: string, signal: AbortSignal, limit: number) => {
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok)
    throw new Error(`无法读取 ${url}（HTTP ${response.status}）`);
  const text = await response.text();
  if (text.length > limit) throw new Error("文件过大");
  return text;
};
/**
 * A skill from GitHub: a link to a SKILL.md (or any Markdown) file, or to a
 * folder holding SKILL.md and its support files.
 */
export async function installFromGitHub(
  input: string,
  signal: AbortSignal,
): Promise<Skill> {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("仅支持 HTTPS 链接");
  if (url.hostname === "raw.githubusercontent.com")
    return skillFromMarkdown(
      await fetchText(url.href, signal, 100000),
      [],
      url.href,
    );
  if (url.hostname !== "github.com") throw new Error("仅支持 GitHub 上的技能");
  const [, owner, repo, type, ref, ...rest] = url.pathname.split("/");
  if (!owner || !repo || !ref || (type !== "blob" && type !== "tree"))
    throw new Error("请使用 GitHub 文件或文件夹链接");
  const target = rest.join("/");
  if (type === "blob") {
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${target}`;
    return skillFromMarkdown(
      await fetchText(raw, signal, 100000),
      [],
      url.href,
    );
  }
  // A folder: SKILL.md plus text support files, two levels deep.
  const files: SkillFile[] = [];
  let total = 0;
  const walk = async (dir: string, depth: number) => {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`,
      {
        signal,
        headers: { Accept: "application/vnd.github+json" },
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(`无法读取 GitHub 文件夹（HTTP ${response.status}）`);
    const entries = (await response.json()) as {
      type: string;
      path: string;
      size: number;
      download_url: string | null;
    }[];
    if (!Array.isArray(entries)) throw new Error("链接不是文件夹");
    for (const entry of entries) {
      if (files.length >= 40) break;
      if (entry.type === "dir" && depth < 2) await walk(entry.path, depth + 1);
      else if (
        entry.type === "file" &&
        entry.download_url &&
        textFile.test(entry.path) &&
        entry.size <= 200000
      ) {
        total += entry.size;
        if (total > 2 * 1024 * 1024) throw new Error("技能文件夹过大");
        const download = new URL(entry.download_url);
        if (download.hostname !== "raw.githubusercontent.com") continue;
        files.push({
          path: entry.path.slice(target.length).replace(/^\/+/, ""),
          content: await fetchText(download.href, signal, 200000),
        });
      }
    }
  };
  await walk(target, 0);
  const main = files.find((f) => /^skill\.md$/i.test(f.path));
  if (!main) throw new Error("文件夹里没有 SKILL.md");
  return skillFromMarkdown(
    main.content,
    files.filter((f) => f !== main),
    url.href,
  );
}
