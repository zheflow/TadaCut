import fs from "node:fs";
import path from "node:path";
import {
  assetSchema,
  energyOnTimeline,
  highlightWindows,
  type Command,
} from "@tadacut/domain";
import {
  completeChat,
  mapSite,
  readPage,
  searchStock,
  webSearch,
} from "@tadacut/providers";
import type { AgentTool } from "../../../../packages/agent/src/runner";
import { audioAnalysis } from "../analysis-cache";
import { fetchPublic, htmlText } from "../public-web";
import { compactAsset } from "../project-view";
import { s, timelineOf, tool, type ToolHost } from "./host";

const mediaPattern =
  /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|avif|svg|cube)$/i;
export function mediaTools(h: ToolHost): AgentTool[] {
  const g = "media",
    web = "web";
  /** A path inside one of the folders the user granted, resolved for real. */
  const granted = (input: string) => {
    const real = fs.realpathSync(input),
      roots = h.allowedDirectories().map((d) => fs.realpathSync(d));
    if (
      !roots.some((root) => real === root || real.startsWith(root + path.sep))
    )
      throw new Error("只能访问你授权过的文件夹");
    return real;
  };
  const pageText = async (url: string, providerId?: string) => {
    const id = (() => {
      try {
        return h.provider("web", providerId);
      } catch {
        return undefined;
      }
    })();
    if (id) {
      const page = await readPage(h.context(id), url);
      if (page) return { ...page, via: "provider" };
    }
    const fetched = await fetchPublic(url, h.signal);
    if (!/html|text|xml/.test(fetched.type))
      throw new Error("这个地址不是网页");
    const { title, text } = htmlText(fetched.bytes.toString("utf8"));
    return { url: fetched.url, title, markdown: text, via: "direct" };
  };
  return [
    tool(
      g,
      "read",
      "search_media",
      "按名称、标签与描述搜索项目素材。",
      s.object({ query: s.string(), kind: s.string() }, ["query"]),
      (a) => {
        const q = String(a.query).toLowerCase();
        return h
          .project()
          .assets.filter(
            (x) =>
              (!a.kind || x.kind === a.kind) &&
              (x.name + x.description + x.tags.join(" "))
                .toLowerCase()
                .includes(q),
          )
          .slice(0, 100)
          .map(compactAsset);
      },
    ),
    tool(
      g,
      "edit",
      "organize_assets",
      "整理素材：改名、移动到文件夹、设置标签或描述。",
      s.object(
        {
          assetIds: s.array(s.string()),
          name: s.string(),
          folder: s.string(),
          tags: s.array(s.string()),
          description: s.string(),
        },
        ["assetIds"],
      ),
      (a) =>
        h.edit(
          "整理素材",
          (a.assetIds as string[]).map(
            (assetId): Command => ({
              type: "asset.update",
              assetId,
              patch: {
                ...(a.name ? { name: a.name } : {}),
                ...(a.folder ? { folder: a.folder } : {}),
                ...(a.tags ? { tags: a.tags } : {}),
                ...(a.description !== undefined
                  ? { description: a.description }
                  : {}),
              },
            }),
          ),
        ),
    ),
    tool(
      g,
      "edit",
      "remove_assets",
      "从项目移除素材（时间线仍在使用的素材不能移除）。",
      s.object({ assetIds: s.array(s.string()) }, ["assetIds"]),
      (a) =>
        h.edit(
          "移除素材",
          (a.assetIds as string[]).map(
            (assetId): Command => ({ type: "asset.remove", assetId }),
          ),
        ),
    ),
    tool(
      g,
      "external",
      "search_stock",
      "在你配置的在线素材库（Pexels、Pixabay 图片视频，Freesound 音效）检索素材，返回可导入的条目与许可。",
      s.object(
        {
          query: s.string(),
          kind: s.string(undefined, ["image", "video", "audio"]),
          providerId: s.string(),
          page: s.integer(),
          orientation: s.string(undefined, ["landscape", "portrait", "square"]),
        },
        ["query", "kind"],
      ),
      async (a) => {
        const providerId = h.provider("stock", a.providerId);
        const items = await searchStock(h.context(providerId), {
          query: a.query,
          kind: a.kind,
          page: a.page,
          orientation: a.orientation,
        });
        return { providerId, items: items.slice(0, 24) };
      },
    ),
    tool(
      g,
      "external",
      "import_from_url",
      "下载素材到项目：在线素材库的条目（带许可与作者）或任意公开的媒体直链。",
      s.object(
        {
          url: s.string(),
          name: s.string(),
          license: s.string(),
          author: s.string(),
          sourceUrl: s.string(),
          sourceName: s.string("来源名称，如 Pexels"),
        },
        ["url"],
      ),
      (a) => h.enqueue("url-import", `导入「${a.name ?? "网络素材"}」`, a),
    ),
    tool(
      g,
      "job",
      "import_files",
      "从你授权的本机文件夹导入媒体文件。",
      s.object({ paths: s.array(s.string()) }, ["paths"]),
      (a) => {
        const files = (a.paths as string[]).slice(0, 50).map(granted);
        return h.enqueue("file-import", `导入 ${files.length} 个文件`, {
          files,
        });
      },
    ),
    tool(
      g,
      "read",
      "browse_folder",
      "浏览你授权的本机文件夹中的媒体文件（不填 path 列出已授权的文件夹）。",
      s.object({ path: s.string(), recursive: s.boolean() }),
      (a) => {
        if (!a.path) return { folders: h.allowedDirectories() };
        const root = granted(a.path),
          out: { path: string; size: number }[] = [];
        const walk = (dir: string, depth: number) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (out.length >= 300 || entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (a.recursive && depth < 3) walk(full, depth + 1);
            } else if (mediaPattern.test(entry.name))
              out.push({ path: full, size: fs.statSync(full).size });
          }
        };
        walk(root, 0);
        return { folder: root, files: out };
      },
    ),
    tool(
      g,
      "job",
      "detect_scenes",
      "检测视频里的镜头切换（场景变化），返回切换时间；可再用 split_clips 在这些位置切开。",
      s.object(
        {
          assetId: s.string(),
          threshold: s.number("0–1，默认 0.3，越小越敏感"),
        },
        ["assetId"],
      ),
      async (a) => {
        const job = h.enqueue("scene-detect", "场景切换检测", a) as {
          jobId: string;
        };
        const done = await h.waitJob(job.jobId, 180);
        return done?.status === "completed"
          ? done.result
          : { ...job, note: "检测仍在进行，稍后用 wait_for_job 读取结果" };
      },
    ),
    tool(
      g,
      "read",
      "find_highlights",
      "在时间线上找高光片段候选：语速紧凑、情绪起伏、声音饱满的时段。length 为每段秒数。",
      s.object({
        length: s.number("秒，默认 15"),
        count: s.integer("默认 5"),
        timelineId: s.string(),
      }),
      async (a) => {
        const p = h.project(),
          tl = timelineOf(p, a.timelineId);
        // Energy of the main sound: the first clip with a transcript, else the first audio clip.
        const lead =
          tl.clips.find((c) =>
            p.transcripts.some((tr) => tr.assetId === c.assetId),
          ) ??
          tl.clips.find(
            (c) => p.assets.find((x) => x.id === c.assetId)?.kind === "audio",
          );
        let energy: number[] | undefined;
        if (lead) {
          const asset = p.assets.find((x) => x.id === lead.assetId)!;
          try {
            const analysis = await audioAnalysis(
              h.repo,
              h.media,
              h.projectId,
              asset,
              h.signal,
            );
            energy = energyOnTimeline(tl, lead, analysis.energy);
          } catch {}
        }
        return highlightWindows(p, tl, {
          length: a.length,
          count: a.count,
          energy,
        }).map((x) => ({
          ...x,
          startSeconds: x.start / tl.fps,
          endSeconds: x.end / tl.fps,
        }));
      },
    ),
    tool(
      g,
      "job",
      "understand_media",
      "让多模态模型看图片或视频取样，写入描述与标签。",
      s.object({ assetId: s.string(), providerId: s.string() }, ["assetId"]),
      (a) =>
        h.enqueue("understand", "素材理解", {
          assetId: a.assetId,
          providerId: h.provider("chat", a.providerId),
        }),
    ),
    tool(
      g,
      "job",
      "index_media",
      "为全部素材建立语义索引，之后可按意思搜索。",
      s.object({ providerId: s.string() }),
      (a) =>
        h.enqueue("semantic", "建立语义索引", {
          providerId: h.provider("embedding", a.providerId),
        }),
    ),
    tool(
      web,
      "external",
      "web_search",
      "网页搜索（使用你配置的 Firecrawl、Jina 或 SearXNG）。",
      s.object(
        { query: s.string(), limit: s.integer(), providerId: s.string() },
        ["query"],
      ),
      async (a) =>
        webSearch(
          h.context(h.provider("web", a.providerId)),
          a.query,
          a.limit ?? 8,
        ),
    ),
    tool(
      web,
      "external",
      "read_webpage",
      "读取公开网页的正文（有网页服务时转为 Markdown，否则直接读取文字）。",
      s.object(
        { url: s.string(), providerId: s.string(), maxChars: s.integer() },
        ["url"],
      ),
      async (a) => {
        const page = await pageText(a.url, a.providerId);
        return {
          ...page,
          markdown: page.markdown.slice(
            0,
            Math.min(30000, a.maxChars ?? 15000),
          ),
        };
      },
    ),
    tool(
      web,
      "external",
      "map_site",
      "列出网站的页面地址（Firecrawl 站点地图，或读取 sitemap.xml）。",
      s.object(
        { url: s.string(), providerId: s.string(), limit: s.integer() },
        ["url"],
      ),
      async (a) => {
        const limit = Math.min(500, a.limit ?? 100);
        try {
          const links = await mapSite(
            h.context(h.provider("web", a.providerId)),
            a.url,
            limit,
          );
          if (links) return { links };
        } catch {}
        const fetched = await fetchPublic(
          new URL("/sitemap.xml", a.url).href,
          h.signal,
        );
        return {
          links: [
            ...fetched.bytes
              .toString("utf8")
              .matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g),
          ]
            .map((m) => m[1])
            .slice(0, limit),
        };
      },
    ),
    tool(
      web,
      "external",
      "capture_webpage",
      "截取公开网页的画面作为参考素材（含页面文字描述）。",
      s.object({ url: s.string() }, ["url"]),
      (a) => h.enqueue("web", "网页采集", { prompt: a.url }),
    ),
    tool(
      web,
      "external",
      "extract_product",
      "从产品网页提取名称、卖点、价格与图片地址，供营销视频脚本使用。",
      s.object({ url: s.string(), providerId: s.string() }, ["url"]),
      async (a) => {
        const page = await pageText(a.url),
          context = h.context(h.provider("chat", a.providerId));
        let text = "";
        await completeChat(
          context,
          "从网页正文提取产品信息，只用正文中出现的事实。输出 JSON：{name, tagline, audience, features:[], specs:[], price, callToAction, imageUrls:[]}，没有的字段留空。",
          [
            {
              role: "user",
              content: `${page.title}\n${page.url}\n\n${page.markdown.slice(0, 20000)}`,
            },
          ],
          [],
          (d) => (text += d),
        );
        try {
          return {
            url: page.url,
            product: JSON.parse(
              text
                .trim()
                .replace(/^```(?:json)?\s*/, "")
                .replace(/\s*```$/, ""),
            ),
          };
        } catch {
          return { url: page.url, product: text.slice(0, 4000) };
        }
      },
    ),
    tool(
      g,
      "edit",
      "add_text_asset",
      "新建文字素材（标题、说明、脚本片段），可再用 add_clip 放到时间线。",
      s.object({ name: s.string(), text: s.string() }, ["name", "text"]),
      (a) => {
        const asset = assetSchema.parse({
          id: h.makeId(),
          name: a.name,
          kind: "text",
          text: a.text,
          createdAt: h.now(),
        });
        return {
          assetId: asset.id,
          ...h.edit("新建文字素材", [{ type: "asset.add", asset }]),
        };
      },
    ),
  ];
}
