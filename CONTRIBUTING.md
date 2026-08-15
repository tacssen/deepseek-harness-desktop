# Contributing

感谢参与。请记住这是基于官方 DeepSeek Harness 的第三方 Windows Agent
Desktop，不是 DeepSeek 官方客户端。贡献应保持桌面壳与官方 dsh 的边界，
不要把上游私有实现、用户数据或服务凭据提交到本仓库。

## 本地开发

    git clone <repository-url>
    cd DeepSeekHarnessDesktop
    npm ci
    npm test
    npm run build
    npm start

Node.js 版本应满足 package.json 与官方 dsh 当前要求。Windows 构建还需要
可用的 Git、PowerShell 和 x64 Electron 工具链。不要直接修改 node_modules；
需要更新依赖时同时更新 package.json、package-lock.json，并重新做许可证审计。

## 提交前检查

- npm test；
- npm run build；
- 如涉及打包，npm run dist，并在干净 Workspace 中启动 NSIS/portable 产物；
- 检查动态路径：文档和测试不得写入维护者的用户目录、机器名或绝对 Workspace
  状态；
- 检查敏感内容：API key、Authorization header、cookie、DPAPI 密文、
  settings.secure.json、.dsh 会话、.agents/sessions、日志原文和截图；
- 如涉及网络、Vision、MCP 或服务端点，更新 PRIVACY.md、SECURITY.md、
  docs/vision.md 或 docs/api.md；
- 如涉及依赖，更新 THIRD_PARTY_NOTICES.md，核对 package-lock 生产闭包、
  optional platform 包和许可证文本。

## 代码约定

- 保持 Electron renderer 的 contextIsolation、sandbox、nodeIntegration=false；
- API 输入在主进程校验；Workspace 路径必须限制在当前根目录；
- 失败时返回可诊断但脱敏的错误，不打印 key 或完整用户内容；
- 文件更新使用临时文件/原子替换，避免破坏用户 Workspace；
- 不把 Vision tool 放进主机权限平面；它应通过官方 Agent tool seam 调用；
- 共享上下文只写结构化、非秘密摘要；不要复制私有聊天数据库。

## Issue 和 Pull Request

描述问题时使用最小复现、版本、平台和脱敏日志。PR 说明：

- 用户可见行为与兼容性影响；
- 是否改变 API、权限、存储或网络数据流；
- 测试命令及结果；
- 若新增依赖，许可证、来源、是否进入 production bundle，以及通知更新；
- 是否需要人工确认 DeepSeek/SiliconFlow/BigModel 条款。

不要在未获得维护者同意时创建远程仓库、推送分支或发布安装包；本地验证
应保持可逆且不影响其他贡献者的工作树。
