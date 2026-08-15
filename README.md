# DeepSeek Harness Desktop

一个面向 Windows 的第三方 Electron Agent Desktop。它在本地启动并加载
官方 DeepSeek Harness（dsh）Web profile，同时提供桌面工作台、Workspace 文件
面板、PowerShell 入口、可选 Vision 工具，以及 Codex/DeepSeek 之间的项目上下文
交接。

> **重要身份声明**
> 本项目不是 DeepSeek 官方发布、签名或背书的 Windows Desktop/EXE/MSI，
> 也不是普通的 DeepSeek 聊天客户端。它是基于官方 DeepSeek Harness 的独立
> 社区封装；官方 Harness 仍是 Developer Preview/RC，升级可能造成不兼容。
> 官方项目及其 MIT 许可证见：
> https://github.com/deepseek-ai/deepseek-harness

## 能做什么

- 在 Windows 上以 Electron 窗口运行官方 dsh Web UI；
- 为每个项目使用一个真实 Workspace，支持文件引用、附件、差异查看、
  checkpoint、Skill 和 MCP 状态展示；
- 让官方 Agent 通过其既有工具执行文件操作及 PowerShell。默认 Workspace
  写权限可在 Settings 中关闭；Windows ACL sandbox 是官方实现的部分能力，
  不是完整隔离边界；
- 可选 Vision bridge：将 PNG/JPEG 发送到用户选择的 SiliconFlow 或 BigModel
  兼容视觉 API，再把结果作为官方 Agent 上下文。两者都是外部 API 服务，
  不是随本项目打包的 SDK；
- 在项目目录中维护 .agents/ 共享上下文，供 Codex 和 DeepSeek 通过结构化
  handoff 继续工作，不复制项目也不同步私有聊天数据库；
- 提供安全插件市场浏览界面；默认只展示 GitHub 公开元数据，未知来源只能查看，
  只有本地固定 allowlist、宽松许可证和合法 dsh manifest 同时通过时才允许安装；
- 通过动态 127.0.0.1 回环端口连接桌面壳与 dsh 后端，不监听公网地址。

## 0.4.0 产品层

0.4.0 在不重写官方 Harness Agent 的前提下增加了桌面工作台能力：

- **Agent Level**：低/中/高/极高/最高会分别改变工具并行度、最大 Agent 步数、
  验证/修复策略；DeepSeek 原生 reasoning effort 目前只有 `high`/`max`，所以低、
  中是 Desktop 执行预算策略，不会伪装成官方模型参数；
- **Usage & Billing**：从真实 `assistant/message.usage` 和 Vision 响应统计 Token，
  根据版本化 pricing metadata 计算 `Estimated Cost`。DeepSeek 官方公开余额接口
  不可靠时页面会明确显示不可用并链接 Billing，不会编造余额；
- **完整 Settings / Profile**：常规、外观、个性化、权限、Browser、数据隐私、
  Advanced、About，以及不含密钥的 Profile 导入/导出；密钥仍只通过 Windows
  DPAPI-backed Electron `safeStorage` 保存；
- **Browser Agent**：独立的 Playwright 工具，使用应用专用隔离浏览器 Profile，
  默认关闭，下载/上传需要确认；它与 Web Search 是不同能力。Computer Control
  仍明确为 Deferred/off，不会伪造桌面控制；
- **Skills / Plugin Center**：展示项目和允许读取的全局 Skills；插件市场默认只读，
  只有本地固定 allowlist、固定版本、宽松许可证和合法 dsh manifest 同时通过才可安装；
- **Codex Shared Project**：继续使用同一真实 Workspace/Git 工作树及 `.agents/`
  handoff 文件；Codex 私有数据库只通过官方只读 app-server 按需读取，不篡改内部状态。

详细验收、边界和构建哈希见 `HARNESS_DESKTOP_V0.4_REPORT.md`，新增产品层文档见
`docs/v0.4-product-layer.md`。

## 快速开始（从源码）

前置条件：

- Windows 10/11 x64；
- Node.js 22.19 或更高版本（或 Node.js 24+）及 npm；
- Git；首次安装需要访问 npm registry 下载依赖；
- 可用的 DeepSeek API 账号。API key 不随仓库提供。

在你选择的目录执行：

    git clone https://github.com/tacssen/deepseek-harness-desktop.git
    cd deepseek-harness-desktop
    npm ci
    npm test
    npm run build
    npm start

不要把实际用户目录、API key、settings.secure.json、Workspace、日志或
截图复制到 issue、commit 或公开文档；上面的仓库地址是本项目公开仓库，
当前目录名可以按你的环境调整。构建及 Windows 安装说明见 docs/install.md 和
docs/windows.md。

## 第一次启动

1. 在 Settings 中填写 DeepSeek Base URL、模型和 API key。
2. 点击 Test Connection，确认 /models 和 chat/completions 均可用。
3. 选择一个专用 Workspace；不要授予 Agent 你的整个用户目录或包含凭据的目录。
4. 保存设置。桌面壳会生成 .dsh 配置并启动官方 dsh Web 后端。
5. 如需 Vision，在 Settings 中启用 Vision Bridge、选择 provider、填写对应
   API key，再点击 Test Vision。未配置 Vision key 时，主体 DeepSeek 流程仍
   可用，vision_analyze 会返回 Awaiting API Key。

Key 由 Electron safeStorage 在 Windows 上使用 DPAPI 加密保存，渲染器只能看到
是否已配置及掩码值。若 DPAPI 不可用，应用会拒绝以明文落盘，而不是降级保存。

## 从源码构建安装包

    npm ci
    npm run dist

产物写入仓库的 dist/，文件名包含 package.json 中的版本和架构，例如 NSIS
安装器及 portable EXE。安装器默认按用户安装，可在安装时选择目录；卸载不会
自动删除用户选择的 Workspace。发布前请阅读 docs/release.md、SECURITY.md、
PRIVACY.md 和 THIRD_PARTY_NOTICES.md。

## 文档

- docs/install.md：源码安装、打包、升级与卸载；
- docs/windows.md：Windows 进程、路径、权限和 DPAPI；
- docs/api.md：桌面 IPC、回环 Harness RPC 与可选工具接口；
- docs/vision.md：Vision bridge 数据流、限制和服务条款检查；
- docs/shared-project-context.md：.agents 共享项目上下文及锁；
- docs/architecture.md：启动序列、组件边界和安全边界；
- docs/troubleshooting.md：启动、凭据、端口、Workspace 和 Vision 故障；
- docs/release.md：版本、依赖许可证、敏感信息和 Windows 发行清单；
- THIRD_PARTY_NOTICES.md：当前 package-lock 生产依赖审计及发布义务。

## 运行时边界与隐私

桌面壳、官方 dsh、DeepSeek API、可选视觉服务和用户 Workspace 是不同的
信任边界。默认通过 DSH_TELEMETRY_DISABLED=1 关闭 dsh telemetry；仍会将
用户主动提交的提示词、Workspace 内容和图片发送到相应 API 服务。请在使用
前阅读 DeepSeek、SiliconFlow、BigModel 的最新条款和隐私政策，并遵守你所在
组织的数据处理要求。详见 PRIVACY.md。

## 许可证

本封装代码采用 MIT，详见 LICENSE。官方 DeepSeek Harness 及其 npm 包也声明
MIT，但依赖树包含 Apache-2.0、BSD、ISC、LGPL 等其他许可证；不能用本项目
的 MIT 声明覆盖它们。发布二进制时必须保留适用的版权和许可证通知，尤其是
sharp 的平台 libvips 包（Windows x64 包声明 Apache-2.0 AND LGPL-3.0-or-later）。
完整审计见 THIRD_PARTY_NOTICES.md。

## 贡献和安全

贡献流程见 CONTRIBUTING.md；安全问题请先阅读 SECURITY.md。提交前运行
npm test、npm run build，并检查 git diff 中没有密钥、绝对用户路径、私有
Workspace 状态或日志。
