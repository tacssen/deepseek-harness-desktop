# Changelog

本文件记录本仓库公开可复现的变化。版本号来自 package.json；“未发布”表示
尚未完成 Windows 产物、许可证、服务条款和敏感信息审核，不代表官方 DeepSeek
发行版本。

## [Unreleased]

- 发布前准备文档：安装、Windows 运行时、API、Vision、共享项目上下文、
  架构、故障排查和发布清单；
- 增加第三方依赖许可证审计和 Electron/Chromium/Sharp 通知说明；
- 明确第三方身份、隐私边界、动态路径要求以及 SiliconFlow/BigModel
  条款需人工确认。

## [0.4.0] — 2026-08-15

正式公开发布。Windows NSIS/Portable 安装包、SHA256SUMS 和 SBOM 随 GitHub
Release 提供；本项目仍是基于官方 DeepSeek Harness Developer Preview/RC 的
第三方桌面封装，不代表 DeepSeek 官方桌面版或官方背书。

- 五级 Agent Level：Low/Medium/High/Extra High/Max，真实改变 Desktop 执行预算、并行工具和验证/修复策略；
- Usage & Billing：真实 session/API usage、版本化 pricing metadata、Estimated Cost 和诚实的余额不可用状态；
- 扩展 Settings、个性化、权限 preset、Profile 导入/导出、Data & Privacy、Advanced/About；
- 独立 Playwright Browser plugin 和隔离浏览器 profile；Computer Control 保持 Deferred/off；
- Skills catalog、Workbench 状态栏和安全插件市场继续复用官方 Harness 能力；
- 保持真实 Workspace/Git/Codex handoff，不修改 Codex 私有数据库；
- 增加 Browser/Usage/Agent/Profile/Permission 回归测试和本地 0.4.0 NSIS/Portable 产物。

## [0.3.0] — 本地验收，未发布

- Open Existing Project 直接打开同一真实目录，不复制 Workspace；
- 项目级 AGENTS.md、.agents/skills、结构化 Handoff/Task/Memory/Test 状态；
- 官方 Codex App Server 只读 task adapter，精确按 cwd 过滤且不修改 Codex 数据库；
- DeepSeek/Codex advisory lock、heartbeat、Git 状态、外部工作区变化与 stale rollback 防护；
- Continue From Codex、Prepare Handoff for Codex 和 Codex task 选择器；
- 安全插件市场浏览，未知来源只查看，verified allowlist/许可证/manifest/归档边界校验；
- SiliconFlow Vision 实际模型适配、Workbench UI、依赖升级和本地 secret scan；
- Codex → DeepSeek V4 Flash → Codex 同一工作树连续任务验收。

## [0.2.0] — 未发布

- Electron Windows workbench shell；
- 官方 dsh Web backend 固定使用 package.json 中的版本；
- DeepSeek 设置、safeStorage/DPAPI 加密凭据、动态回环端口和单实例；
- Workspace 文件面板、差异/checkpoint、PowerShell 入口和 Skill/MCP 状态；
- 可选 Vision bridge 与 vision_analyze Agent tool；
- .agents 共享项目上下文和 Codex read-only handoff；
- NSIS/portable x64 构建脚本。

## 版本说明

- 本项目版本与官方 DeepSeek Harness 版本独立；
- 官方 dsh 是 Developer Preview/RC，升级可能要求重新验收；
- 安装包未自动获得 DeepSeek 官方代码签名或品牌背书；
- 详细已知限制和迁移动作见 docs/release.md 与 docs/troubleshooting.md。
