import { describe, expect, it } from "vitest";
import {
  completeChat,
  embedTexts,
  generateImage,
  providerSchema,
  readSse,
  type ProviderContext,
} from "@tadacut/providers";
import { runAgent } from "../packages/agent/src/runner";
import {
  computerActionSchema,
  assertSession,
} from "../packages/platform/src/validation";
const encode = new TextEncoder();
function sse(events: unknown[]) {
  const bytes = encode.encode(
    events.map((e) => "data: " + JSON.stringify(e) + "\r\n\r\n").join("") +
      "data: [DONE]\r\n\r\n",
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
  );
}
function context(
  kind: "openai" | "compatible" | "anthropic" | "ollama",
  response: (body: any, url: string) => Response,
) {
  const ctx: ProviderContext = {
    provider: providerSchema.parse({
      id: "test",
      name: "Test",
      kind,
      baseUrl: "http://127.0.0.1:1234",
      model: "test",
    }),
    apiKey: "test-key",
    signal: new AbortController().signal,
    fetcher: (async (url, init) =>
      response(
        JSON.parse((init?.body as string) ?? "{}"),
        String(url),
      )) as typeof fetch,
  };
  return ctx;
}
describe("model adapters", () => {
  it("decodes UTF-8 split between arbitrary SSE network chunks", async () => {
    const events = [];
    for await (const event of readSse(sse([{ text: "城市漫游" }]).body!))
      events.push(event);
    expect(events).toEqual([{ text: "城市漫游" }]);
  });
  it("assembles streamed OpenAI-compatible tool arguments", async () => {
    const ctx = context("compatible", () =>
      sse([
        {
          choices: [
            {
              delta: {
                content: "Plan",
                tool_calls: [
                  {
                    index: 0,
                    id: "call1",
                    function: { name: "read_", arguments: "{" },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { name: "project", arguments: "}" } },
                ],
              },
            },
          ],
        },
        { usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ]),
    );
    const result = await completeChat(
      ctx,
      "system",
      [{ role: "user", content: "hi" }],
      [],
      () => {},
    );
    expect(result.calls).toEqual([
      { id: "call1", name: "read_project", arguments: "{}" },
    ]);
    expect(result.usage).toMatchObject({
      input: 10,
      output: 5,
      reported: true,
    });
  });
  it("uses Responses call_id and input_image for screenshots", async () => {
    const ctx = context("openai", (body) => {
      expect(body.input[0].content[1]).toEqual({
        type: "input_image",
        image_url: "data:image/png;base64,AA==",
      });
      return sse([
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { type: "function_call", call_id: "c", name: "read_project" },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          delta: "{}",
        },
        {
          type: "response.completed",
          response: { usage: { input_tokens: 12, output_tokens: 2 } },
        },
      ]);
    });
    const result = await completeChat(
      ctx,
      "system",
      [
        {
          role: "user",
          content: "screenshot",
          images: ["data:image/png;base64,AA=="],
        },
      ],
      [],
      () => {},
    );
    expect(result.calls[0].id).toBe("c");
    expect(result.usage.input).toBe(12);
  });
  it("maps Anthropic images and tool-use events", async () => {
    const ctx = context("anthropic", (body) => {
      expect(body.messages[0].content[1].source.type).toBe("base64");
      return sse([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "c", name: "read_project" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{}" },
        },
        { type: "message_start", message: { usage: { input_tokens: 4 } } },
        { type: "message_delta", usage: { output_tokens: 1 } },
      ]);
    });
    const result = await completeChat(
      ctx,
      "",
      [
        {
          role: "user",
          content: "screenshot",
          images: ["data:image/jpeg;base64,AA=="],
        },
      ],
      [],
      () => {},
    );
    expect(result.calls[0].name).toBe("read_project");
    expect(result.usage.reported).toBe(true);
  });
  it("keeps local Ollama native tools and image bytes in the native request", async () => {
    const ctx = context("ollama", (body, url) => {
      expect(url).toContain("/api/chat");
      expect(body.messages[1].images).toEqual(["AA=="]);
      return Response.json({
        message: { content: "done", tool_calls: [] },
        prompt_eval_count: 4,
        eval_count: 1,
      });
    });
    expect(
      (
        await completeChat(
          ctx,
          "",
          [
            {
              role: "user",
              content: "",
              images: ["data:image/png;base64,AA=="],
            },
          ],
          [],
          () => {},
        )
      ).text,
    ).toBe("done");
  });
  it("rejects failed provider requests without echoing secret-bearing bodies", async () => {
    const ctx = context(
      "compatible",
      () => new Response("key=test-secret", { status: 401 }),
    );
    await expect(completeChat(ctx, "", [], [], () => {})).rejects.toThrow(
      "HTTP 401",
    );
  });
  it("restores embedding ordering and rejects missing vectors", async () => {
    const ctx = context("compatible", () =>
      Response.json({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    expect(await embedTexts(ctx, ["a", "b"])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    await expect(embedTexts(ctx, ["a"])).rejects.toThrow("有效 embedding");
  });
  it("registers base64 images as bytes rather than filesystem paths", async () => {
    const ctx = context("compatible", () =>
      Response.json({ data: [{ b64_json: "AQID" }] }),
    );
    const result = await generateImage(ctx, "original");
    expect([...result.bytes!]).toEqual([1, 2, 3]);
  });
  it("terminates an Agent run when a tool explicitly waits for the user", async () => {
    let calls = 0;
    const ctx = context("compatible", () => {
      calls++;
      return sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "a",
                    function: {
                      name: "ask_user",
                      arguments: '{"question":"多长？"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    });
    const result = await runAgent({
      context: ctx,
      system: "",
      messages: [{ role: "user", content: "create" }],
      tools: [
        {
          name: "ask_user",
          description: "",
          parameters: {},
          execute: async () => ({ _wait: true, question: "多长？" }),
        },
      ],
      onText: () => {},
      onTool: () => {},
    });
    expect(calls).toBe(1);
    expect(result.text).toBe("多长？");
  });
});
describe("desktop contract", () => {
  it.each([
    { type: "click", x: 1.1, y: 0.2 },
    { type: "key", key: "Meta+R" },
    { type: "shell", command: "any" },
    { type: "scroll", direction: "up", amount: 100 },
    { type: "type", text: "", extra: true },
  ])("rejects actions outside the typed capability", (action) =>
    expect(() => computerActionSchema.parse(action)).toThrow(),
  );
  it("rejects expired session grants", () => {
    expect(() => assertSession({ expiresAt: 20 }, 21)).toThrow("结束");
    expect(() => assertSession({ expiresAt: 30 }, 21)).not.toThrow();
  });
});
