# 第三方组件与授权

TadaCut 自身的代码以 [MIT 授权](../LICENSE) 发布。依赖与安装包中的第三方组件保留各自的授权，分发安装包或在公司内使用前请留意下面几项。

## 需要注意的授权

| 组件                                  | 授权                    | 说明                                                                                                                                                                                                                 |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remotion（`remotion`、`@remotion/*`） | Remotion License        | 源码公开，但不是 OSI 开源授权。个人、3 人及以下的营利组织和非营利组织可以免费使用（包括商业用途）；其他公司需要购买 [Company License](https://www.remotion.pro/license)。全文见 `node_modules/remotion/LICENSE.md`。 |
| FFmpeg / FFprobe（macOS 安装包）      | LGPL-2.1-or-later       | 由 `scripts/build-ffmpeg.mjs` 从官方源码 FFmpeg 8.1.3 原样编译（校验 SHA-256），不启用 GPL 与 nonfree，也不链接外部编解码库。安装包的 `Resources/ffmpeg` 中附有许可证全文、源码地址和编译参数。                      |
| FFmpeg / FFprobe（Windows 安装包）    | GPL-3.0                 | 来自 `@ffmpeg-installer/win32-x64` 与 `@ffprobe-installer/win32-x64` 的预编译版本（FFmpeg 4.1、FFprobe 5.1，含 x264、x265 等 GPL 库，均未启用 nonfree）。分发 Windows 安装包时需要按 GPLv3 提供对应源码。            |
| Chrome Headless Shell                 | Chromium 授权（BSD 等） | 由 `scripts/build-browser.mjs` 从 Chrome for Testing 下载固定版本，只用于渲染成片；第三方声明随浏览器文件一起分发。                                                                                                  |
| sharp / libvips                       | Apache-2.0 / LGPL-3.0   | libvips 以动态库形式随 sharp 分发。                                                                                                                                                                                  |

开发依赖中的 `@ffmpeg-installer/darwin-arm64` 是 GPL + nonfree 构建，FFmpeg 自身声明它不能再分发。它只作为未编译 LGPL 版本时的本机开发后备，macOS 安装包不包含它。

## 其他依赖

Electron、Fastify、React、Zod、lucide-react、fflate、`@modelcontextprotocol/sdk`、`@github/copilot-sdk`、`capcut-cli` 等为 MIT / ISC 授权；Playwright Core、nut.js、`@huggingface/transformers` 为 Apache-2.0 授权。完整列表以 `package-lock.json` 为准。

## 模型

语音识别、物体检测与音频标签模型（如 `onnx-community/whisper-tiny`、`Xenova/detr-resnet-50`、`Xenova/clap-htsat-unfused`）在首次使用时从 Hugging Face 下载，不随仓库或安装包分发，遵循各自模型卡上的授权。在线模型服务按各供应商的条款使用。

## 商标

CapCut、剪映、Codex、Claude Code、GitHub Copilot 等名称属于各自的所有者。TadaCut 只用它们说明导出格式或可连接的工具，与这些产品及其所有者没有关联。
