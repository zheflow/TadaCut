import crypto from "node:crypto";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AgentTool } from "../../../packages/agent/src/runner";
import { modelToolResult } from "../../../packages/agent/src/output";

/** One short-lived connection exposes only the tools bound to this app run. */
export async function serveExternalTools(
  tools: AgentTool[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const token = crypto.randomBytes(32).toString("base64url");
  const http = createServer(async (request, response) => {
    if (
      request.url !== "/mcp" ||
      request.headers.authorization !== `Bearer ${token}` ||
      request.headers.origin
    ) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) throw new Error("工具请求过大");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const server = new Server(
        { name: "tadacut-run", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters as any,
        })),
      }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try {
          signal.throwIfAborted();
          const tool = tools.find((tool) => tool.name === params.name);
          if (!tool) throw new Error("工具不在本轮授权目录中");
          const output = await tool.execute(params.arguments ?? {});
          const result = modelToolResult(output);
          return {
            content: [
              { type: "text", text: result.text },
              ...result.images.map((image) => {
                const match = /^data:([^;]+);base64,(.*)$/.exec(image);
                return {
                  type: "image",
                  mimeType: match?.[1] ?? "image/jpeg",
                  data: match?.[2] ?? "",
                };
              }),
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("连接未启动");
  const abort = () => http.closeAllConnections();
  signal.addEventListener("abort", abort, { once: true });
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    close: async () => {
      signal.removeEventListener("abort", abort);
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
