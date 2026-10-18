import { relevance } from "../../../packages/agent/src/catalog";
export const memoryKey = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");
export function cleanMemoryText(value: unknown, limit = 1000) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("记忆不能为空");
  const text = value.trim();
  if (
    /sk-[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(
      text,
    )
  )
    throw new Error("记忆不能保存密钥或认证凭据");
  if (text.length > limit) throw new Error(`记忆最多 ${limit} 个字符`);
  return text;
}

export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  updatedAt: string;
}
/** Recall is bounded and deterministic; it never deletes or rewrites stored preferences. */
export function recallMemories<T extends MemoryEntry>(
  items: T[],
  query: string,
  options: { limit?: number; chars?: number; relevantOnly?: boolean } = {},
) {
  const seen = new Set<string>();
  const sorted = items
    .map((item) => ({
      item,
      score: relevance(query, `${item.text} ${item.tags.join(" ")}`),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt),
    );
  const result: T[] = [];
  let chars = 0;
  for (const { item, score } of sorted) {
    const normalized = item.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized) || (options.relevantOnly && !score))
      continue;
    seen.add(normalized);
    if (chars + item.text.length > (options.chars ?? 3000)) continue;
    result.push(item);
    chars += item.text.length;
    if (result.length >= (options.limit ?? 8)) break;
  }
  return result;
}
