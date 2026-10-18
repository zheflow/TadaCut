import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Font families installed on this computer, read from the font files' own
 * name tables, so the studio can offer them for captions and titles. The
 * renderer uses the same system fonts, so previews and exports match.
 */
const directories = () =>
  process.platform === "darwin"
    ? [
        "/System/Library/Fonts",
        "/Library/Fonts",
        path.join(os.homedir(), "Library/Fonts"),
      ]
    : process.platform === "win32"
      ? [
          path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"),
          path.join(os.homedir(), "AppData/Local/Microsoft/Windows/Fonts"),
        ]
      : [
          "/usr/share/fonts",
          "/usr/local/share/fonts",
          path.join(os.homedir(), ".fonts"),
          path.join(os.homedir(), ".local/share/fonts"),
        ];
function decode(bytes: Buffer, platform: number, encoding: number) {
  if (platform === 3 || platform === 0) {
    // UTF-16 big endian.
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2)
      out += String.fromCharCode(bytes.readUInt16BE(i));
    return out;
  }
  return platform === 1 && encoding === 0 ? bytes.toString("latin1") : "";
}
/** Family names in one font (a .ttc holds several). Preferred Chinese, then English names. */
function familiesIn(file: string): string[] {
  const data = fs.readFileSync(file);
  if (data.length < 12) return [];
  const offsets =
    data.toString("latin1", 0, 4) === "ttcf"
      ? Array.from({ length: Math.min(64, data.readUInt32BE(8)) }, (_, i) =>
          data.readUInt32BE(12 + i * 4),
        )
      : [0];
  const names = new Set<string>();
  for (const offset of offsets) {
    if (offset + 12 > data.length) continue;
    const tables = data.readUInt16BE(offset + 4);
    let nameTable = -1;
    for (let i = 0; i < tables; i++) {
      const record = offset + 12 + i * 16;
      if (record + 16 > data.length) break;
      if (data.toString("latin1", record, record + 4) === "name") {
        nameTable = data.readUInt32BE(record + 8);
        break;
      }
    }
    if (nameTable < 0 || nameTable + 6 > data.length) continue;
    const count = data.readUInt16BE(nameTable + 2),
      strings = nameTable + data.readUInt16BE(nameTable + 4);
    const found: {
      id: number;
      language: number;
      platform: number;
      text: string;
    }[] = [];
    for (let i = 0; i < count; i++) {
      const r = nameTable + 6 + i * 12;
      if (r + 12 > data.length) break;
      const platform = data.readUInt16BE(r),
        encoding = data.readUInt16BE(r + 2),
        language = data.readUInt16BE(r + 4),
        nameId = data.readUInt16BE(r + 6),
        length = data.readUInt16BE(r + 8),
        start = strings + data.readUInt16BE(r + 10);
      if ((nameId !== 1 && nameId !== 16) || start + length > data.length)
        continue;
      const text = decode(
        data.subarray(start, start + length),
        platform,
        encoding,
      ).trim();
      if (text) found.push({ id: nameId, language, platform, text });
    }
    // Typographic family (16) wins over the legacy family (1).
    const best = (lang: (l: number, p: number) => boolean) =>
      found
        .filter((f) => lang(f.language, f.platform))
        .sort((a, b) => b.id - a.id)[0]?.text;
    const chinese = best(
      (l, p) => p === 3 && [0x804, 0x404, 0xc04, 0x1004].includes(l),
    );
    const english =
      best((l, p) => (p === 3 && l === 0x409) || (p === 1 && l === 0)) ??
      found[0]?.text;
    if (english && !english.startsWith(".")) names.add(english);
    if (chinese) names.add(chinese);
  }
  return [...names];
}
let cache:
  | { at: number; fonts: { family: string; file: string }[] }
  | undefined;
export function localFonts() {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.fonts;
  const seen = new Map<string, string>();
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (/\.(ttf|otf|ttc|otc)$/i.test(entry.name))
        try {
          for (const family of familiesIn(full))
            if (!seen.has(family)) seen.set(family, full);
        } catch {}
      if (seen.size > 3000) return;
    }
  };
  for (const dir of directories()) walk(dir, 0);
  const fonts = [...seen.entries()]
    .map(([family, file]) => ({ family, file: path.basename(file) }))
    .sort((a, b) => a.family.localeCompare(b.family, "zh-CN"));
  cache = { at: Date.now(), fonts };
  return fonts;
}
