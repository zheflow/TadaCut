# 供应商配置

在“模型”添加多个供应商。每项能力可以填写独立模型，例如同一个 OpenAI 兼容服务使用聊天模型、图片模型、ASR 模型和 embedding 模型，也可以拆成多个地址。

## 常用入口

| 接口类型         | 地址例子                       | 协议                                            |
| ---------------- | ------------------------------ | ----------------------------------------------- |
| OpenAI Responses | `https://api.openai.com/v1`    | Responses 流式文本、function calls、input_image |
| OpenAI 兼容      | 用户服务的 `/v1` 地址          | Chat Completions SSE 与工具调用                 |
| Ollama 原生      | `http://127.0.0.1:11434`       | `/api/chat`、`/api/tags`、`/api/embed`          |
| LM Studio        | `http://127.0.0.1:1234/v1`     | OpenAI 兼容接口                                 |
| Anthropic        | `https://api.anthropic.com/v1` | Messages SSE、tool_use、base64 图片             |
| ElevenLabs       | `https://api.elevenlabs.io/v1` | TTS、参考录音创建音色                           |

点击“发现模型”或“检测连接”才会查询服务。配置存在不代表已经连接成功。远端图像 / 视频 / 音乐、工具调用、视觉理解和词级 ASR 需要对应模型实际支持。

API Key 放在专用凭据字段；不要把密钥写进名称、地址、提示词或 JSON 路由。编辑已保存配置时，留空表示保留现有凭据；勾选删除凭据才会移除。

## 自定义媒体路由

高级路由以能力名称作为 key。`path` 是相对于服务地址的路径，`pollPath` 可用 `{id}`，`resultPath` 使用点路径读取返回 URL。默认处理常见的 `id / task_id`、`status` 与 `progress`。

```json
{
  "music": {
    "path": "/music/generate",
    "method": "POST",
    "body": { "instrumental": true },
    "pollPath": "/music/tasks/{id}",
    "resultPath": "output.audio_url"
  }
}
```

媒体任务提交会包含 `model`、`prompt` 和 `duration`。OpenAI 视频使用 `seconds`。图片生成支持 `data[0].b64_json` 或 URL；已确认角色 / 场景参考图使用 multipart image edits 路径。配音默认读取返回音频字节。自定义路由需要与目标服务的字段和响应约定匹配。

自定义音乐服务或特殊厂商适配可以在 `packages/providers` 增加一个纯 HTTP 函数，并在 `handlers.ts` 的相应任务注册位置调用。供应商 DTO 与宿主密钥始终分开。

## MCP 与外部运行时

桌面默认服务：`http://127.0.0.1:4319/mcp`。在“设置 → 连接外部 Agent”复制当前连接配置。Bearer Token 是本机连接凭据，工程包不携带它。

MCP 修改工具需要 `projectId` 和从 `read_project` 读取的 `expectedRevision`。服务只创建提案；工作台确认后才提交事务。不同客户端的读取版本不共享隐式写入授权。

Codex 使用 stdio App Server 的动态工具；Claude Code 限定到本应用 MCP 工具；Copilot SDK 的 availableTools 只包含本应用目录。安装和登录由对应运行时管理，项目中不保存这些账号的登录凭据。

协议依据：[OpenAI App Server](https://learn.chatgpt.com/docs/app-server)、[Ollama OpenAI 兼容文档](https://docs.ollama.com/api/openai-compatibility)、[Copilot SDK](https://github.com/github/copilot-sdk)、[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
