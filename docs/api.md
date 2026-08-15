# API 与集成边界

本项目有三层接口：Electron preload IPC、桌面壳调用的本机 Harness RPC，
以及官方 Agent tool/外部模型服务。只有少数数据形状由测试覆盖；内部 IPC
和官方 dsh RPC 可能随 RC 升级变化，不构成第三方稳定公共 API。

## 本机 Harness HTTP

Desktop 启动官方 dsh：

    http://127.0.0.1:<dynamic-port>/

端口由运行时随机申请，只能从当前机器和当前应用使用。WorkBench 通过
POST /api/<method> 发送 JSON envelope：

    {
      "type": "client-request",
      "rpcId": "desktop-<random-id>",
      "method": "session.list",
      "payload": {}
    }

响应应包含 result.ok 和 result.value。常见调用：

| 方法 | 作用 | 典型 payload |
| --- | --- | --- |
| session.list | 列出会话 | {} |
| session.create | 在 Workspace 创建会话 | { cwd, agentPreset: "deepseek-desktop" } |
| session.history | 读取当前会话历史与 projections | { sessionId, maxMessages: 80 } |
| session.prompt | 排队一条 Agent prompt | { sessionId, mode: "queue", content: [{ type: "text", text }], clientTimeZone } |
| skill.list | 列出当前会话 Skill | { sessionId } |
| commands/execute | 执行官方命令（如 /plan、/goal） | { args: { agentId, line } } |

这些方法是官方 dsh Web surface 的当前观察结果。不要写死端口、session id、
用户路径或凭据；升级 dsh 后重新验证。Desktop 会先检查 response.ok，
再检查 result.ok，失败只向用户显示脱敏错误。

## Electron IPC

renderer 通过 preload 暴露受限接口，主进程注册的通道包括：

| 通道 | 用途 |
| --- | --- |
| get-status | 返回后端 ready/port、公共设置和 Vision status |
| settings-load / settings-save | 读取或保存偏好；secret 只在主进程接收 |
| clear-secrets | 清除 DeepSeek/Vision key |
| test-deepseek / test-vision | 发起连接测试 |
| vision-analyze | 调用 Vision bridge |
| open-settings / settings-close / open-logs | 打开设置/日志 |
| clear-vision-cache | 删除应用拥有的 Vision 结果缓存 |

WorkBench IPC 使用 workbench:<name> 前缀：

    getSnapshot, setLayout, setMode, runTerminal, listFiles, attachFiles,
    insertReference, createCheckpoint, restoreCheckpoint, invokeSkill,
    revertDiff, acceptDiff, initializeSharedProject, continueFromCodex,
    prepareHandoffForCodex, openProject, openMarketplace, openSettings,
    openPath

这些通道只能由本地受信任窗口通过 contextIsolation 使用。不要把 Electron
webContents.send 或 preload API 暴露给未知远程页面。

## DeepSeek 连接测试

Test Connection 使用用户设置的 Base URL：

    GET  <baseURL>/models
    POST <baseURL>/chat/completions

请求使用 Authorization: Bearer <key>，正文包含所选 model、最小提示词、
max_tokens=8 和 stream=false。文档、日志和示例中永远使用 <key> 占位符。

DeepSeek API、SiliconFlow、BigModel 是外部服务；Desktop 不验证其合同条款，
只做 URL、model 字符串和超时/错误处理。服务端返回内容必须按不可信数据处理。

## Vision Agent tool

Vision bridge 通过官方 dsh preset 的 Agent tool seam 注册
vision_analyze。DeepSeek Agent 可以请求工具，工具把图片发送给 Vision
provider，再返回结构化结果让主 Agent 继续。它不是一个面向公网的 HTTP
endpoint，也不应在 dsh 的 host plane 直接注入。

输入必须是 Workspace 内图片或经 Desktop 复制的附件，限制和 provider 请求
见 docs/vision.md。没有 Vision key 时返回结构化 Awaiting API Key，不阻断
DeepSeek 主回合。

## 兼容性和扩展

- 需要向其他应用集成时，优先调用官方 dsh 文档支持的 API，不抓取桌面 HTML；
- 不要读取 .dsh/session 私有数据库或 .agents/sessions 代替公开 handoff；
- 自定义插件只写入不含凭据的 .dsh/cordis.patch.yml 或官方配置 seam；
- API 变更须同步测试、docs、隐私/安全说明和第三方服务条款审查。
