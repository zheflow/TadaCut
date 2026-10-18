import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export function isPrivateAddress(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value.includes(":"))
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb") ||
      (value.startsWith("::ffff:") && isPrivateAddress(value.slice(7)))
    );
  const [a, b] = value.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
export async function assertPublicUrl(input: string) {
  const url = new URL(input);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("网页采集需要公共 HTTP/HTTPS 地址");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  )
    throw new Error("网页采集不访问本机或内部地址");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  )
    throw new Error("网页采集不访问本机或内部地址");
  return url;
}
/**
 * Fetches a public page, checking every redirect hop against the same rules
 * so a redirect cannot lead to a local or internal address.
 */
export async function fetchPublic(
  input: string,
  signal: AbortSignal,
  maxBytes = 4 * 1024 * 1024,
) {
  let url = await assertPublicUrl(input);
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers: { "User-Agent": "TadaCut/0.1 (+local studio)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw new Error("网页重定向没有目标地址");
      url = await assertPublicUrl(new URL(next, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`网页返回 HTTP ${response.status}`);
    }
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("网页内容过大");
      }
      chunks.push(value);
    }
    return {
      url: url.href,
      type: response.headers.get("content-type") ?? "",
      bytes: Buffer.concat(chunks),
    };
  }
  throw new Error("网页重定向次数过多");
}
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
/** Readable text of an HTML page: scripts, styles and tags removed, blocks kept as lines. */
export function htmlText(html: string) {
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, code: string) =>
      code[0] === "#"
        ? String.fromCodePoint(
            code[1].toLowerCase() === "x"
              ? parseInt(code.slice(2), 16)
              : Number(code.slice(1)),
          )
        : (entities[code.toLowerCase()] ?? m),
    )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title: htmlEntities(title), text };
}
const htmlEntities = (s: string) =>
  s.replace(/&(\w+);/g, (m, code: string) => entities[code.toLowerCase()] ?? m);
