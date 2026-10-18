import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
/** Extract vendor browser files without allowing links or paths to escape the staging directory. */
export async function extractBrowserArchive(archive, destination) {
  const data = await fs.readFile(archive),
    end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > data.length)
    throw new Error("Invalid browser ZIP directory");
  const metadata = new Map();
  let cursor = data.readUInt32LE(end + 16),
    total = 0;
  while (
    cursor + 46 <= data.length &&
    data.readUInt32LE(cursor) === 0x02014b50
  ) {
    const nameLength = data.readUInt16LE(cursor + 28),
      extraLength = data.readUInt16LE(cursor + 30),
      commentLength = data.readUInt16LE(cursor + 32);
    const name = data
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[a-z]:/i.test(name) ||
      name.split("/").some((p) => p === ".." || p === ".")
    )
      throw new Error("Unsafe browser archive path");
    total += data.readUInt32LE(cursor + 24);
    if (total > 1.5 * 1024 ** 3 || metadata.size > 30000)
      throw new Error("Browser archive is too large");
    metadata.set(name, data.readUInt32LE(cursor + 38) >>> 16);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const files = unzipSync(data),
    links = [],
    root = path.resolve(destination);
  await fs.mkdir(root, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    if (!metadata.has(name))
      throw new Error("ZIP file missing directory metadata");
    const file = path.join(root, name),
      mode = metadata.get(name);
    if ((mode & 0xf000) === 0xa000) {
      links.push({ file, target: new TextDecoder().decode(bytes) });
      continue;
    }
    if (name.endsWith("/")) {
      await fs.mkdir(file, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, {
      flag: "wx",
      mode: mode & 0o777 || 0o644,
    });
  }
  for (const { file, target } of links) {
    const resolved = path.resolve(path.dirname(file), target);
    if (path.isAbsolute(target) || !resolved.startsWith(root + path.sep))
      throw new Error("Unsafe browser archive symlink");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.symlink(target, file);
  }
  for (const { file } of links)
    if (!(await fs.realpath(file)).startsWith(root + path.sep))
      throw new Error("Browser link leaves staging directory");
}
