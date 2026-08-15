# Harness Workbench 本地验收报告

验收基线：Desktop wrapper `0.3.0`；官方 `@deepseek-ai/dsh@0.1.0-rc.6`。

> 本项目是基于官方 DeepSeek Harness 构建的第三方 Windows Agent Desktop，不是 DeepSeek 官方发布、签名或背书的桌面客户端。官方 Harness 仍为 Developer Preview/RC。

## 1. 已真正实现的 Codex ↔ DeepSeek 共享能力

- “打开已有项目”直接选择同一真实目录，不复制项目、不创建第二个 worktree。
- 项目根 `AGENTS.md` 同时被 Codex 和官方 Harness 原生加载。
- 项目 `.agents/skills` 同时处于 Codex 与官方 Harness 的项目 Skill 搜索路径。
- `.agents/HANDOFF.md`、`TASKS.md`、`MEMORY.md`、`DECISIONS.md`、`TESTS.md` 与 `project-state.json` 构成结构化交接层。
- Continue From Codex 把 Handoff 及可选的 Codex task 摘要作为不可信上下文交给 DeepSeek，要求先核对真实工作树。
- Prepare Handoff for Codex 原子写入脱敏摘要并释放 DeepSeek 项目锁。
- Codex task 只通过官方 `codex app-server` 的 `thread/list` 和 `thread/read` 读取；客户端白名单拒绝写方法。

## 2. 项目文件共享情况

两边操作同一 Workspace 中的同一文件。附件、文件引用、Vision path、PowerShell cwd、Git 与 Handoff 都以该 Workspace 为边界。应用不会创建用于交接的项目副本。

## 3. Git 共享情况

Workbench 显示真实 branch、HEAD、dirty 状态、文件列表和 Git diff。Checkpoint/恢复会先比较当前文件与记录的 `newText`；如果文件在 checkpoint 后变化，就拒绝覆盖。应用不会自动 commit、push、reset 或 clean。

## 4. AGENTS / Skills 共享情况

- 若项目没有 `AGENTS.md`，初始化会创建一份最小协作规则；已有文件不会被覆盖。
- `.agents/skills/<name>/SKILL.md` 是两边共用的项目 Skill 位置。
- 本机用户级 Skills 不会复制进项目，也不会自动上传或提交。

## 5. Todo / Memory / Handoff 共享情况

实时 Handoff、Task、Memory、Test 和 machine state 默认由 `.agents/.gitignore` 忽略；仓库只提交无隐私的模板。团队若要版本化共享文档，必须先人工脱敏并显式调整 ignore。

## 6. 聊天上下文共享情况

没有伪造“完整聊天实时同步”。Codex 私有 task 可以由官方 App Server 按精确 cwd 只读列出；用户选中后只裁剪最近的 user/agent message 作为一次性继续上下文。DeepSeek 原始会话不会写入 Codex 数据库；可靠的反向路径是结构化 Handoff。

## 7. 因 Codex 官方限制暂时无法实现的内容

- 两个产品不存在官方双向原始聊天导入协议。
- Codex thread 内部 Goal、plan、todo 和 memory 不会自动成为项目状态。
- Codex 没有跨产品强制锁 API；Codex 侧依赖项目 AGENTS 规则和共享脚本协作。
- 当前 Codex task 若以父目录而不是项目精确根目录启动，按 cwd 的 task 筛选不会把它自动归入子项目；下次应在 Codex 中直接打开项目根。

## 8. 冲突保护机制

- `.agents/locks/project-lock.json` 使用 owner、token hash、heartbeat、TTL 和原子 rename。
- DeepSeek 侧持锁期间约每 30 秒 heartbeat，正常退出或 handoff 释放。
- Workbench 的 chokidar 只观察当前 Workspace，提示 Agent/编辑器/外部进程造成的变化。
- Git 状态、checkpoint stale-content guard、Workspace realpath 边界共同防止静默覆盖。
- 锁是 advisory：它不能替代 Git 分支、人工审阅和备份。

## 9. 双向实际验收结果

在同一个真实仓库完成了连续任务：

1. Codex 创建 `test/fixtures/agent-handoff-continuity.txt` 的 `phase-a=codex` 并准备 Handoff。
2. DeepSeek V4 Flash 读取该 Handoff，实际调用官方 `read`、`edit` 工具，在同一文件追加 `phase-b=deepseek`；Harness `turn/end` 为 `completed`。
3. Workbench 生成 DeepSeek → Codex Handoff；Codex 读取后追加 `phase-c=codex`。
4. `test/shared-continuity.test.cjs` 验证三个阶段顺序，测试通过。

## 10. 当前 Desktop 功能状态

- 官方 Harness Web UI、Workspace、文件工具、PowerShell、Tool Calling、多步骤 Agent、Goal/Plan、Skills、MCP seam：可用。
- DeepSeek 默认 `deepseek-v4-flash`：真实会话通过；`deepseek-v4-pro` 保留为可选模型。
- Workbench：深色简洁外壳、任务/轨迹/更改/上下文/能力 rail、诊断 dock、文件/附件、checkpoint 与共享项目状态。
- Vision：SiliconFlow endpoint，实际账户 advertised/selected model 为 `zai-org/GLM-4.5V`；真实 Test Vision 返回 `Vision Ready`。DeepSeek 仍是主 Agent，Vision 只返回视觉上下文。
- 插件市场：真实 GitHub metadata 搜索；未知来源只允许查看。只有固定 allowlist、宽松许可证、合法 dsh manifest、归档路径/大小/链接检查全部通过时才允许进入安装管线。当前默认 allowlist 为空，不伪装任何第三方插件为已验证。
- API key 由 Electron safeStorage/Windows DPAPI 保存，renderer 只看到固定掩码；未写入源码、Git、报告或日志。
- 已安装 Desktop `0.3.0` 可从桌面快捷方式双击启动；实测后端动态端口 Ready，主窗口正常关闭，未留下后端进程。已安装包再次执行 Vision Test 返回 `Vision Ready`。

## 11. 未来 GitHub 开源准备度

已准备 README、安装/Windows/API/Vision/Handoff/Architecture/Troubleshooting/Release 文档、Security、Privacy、Contributing、Changelog、MIT License、Third-Party Notices、截图目录、Windows CI 草案、NSIS/portable 构建与本地 secret scan。当前没有创建远程仓库、没有 push、没有 Tag 或 Release。

本地构建产物：

- NSIS `DeepSeek-Harness-Desktop-0.3.0-x64.exe`，191,269,112 bytes，SHA-256 `656F7A7C35BC6785A9CAE1E816B5B3BE25154329E4CC32A7F89D7E46687273E6`。
- Portable `DeepSeek-Harness-Desktop-0.3.0-portable.exe`，191,018,274 bytes，SHA-256 `4D3A28F9BA53F8FCB9F14C0E93DD7D144A65436F8F4C5FF77C9A61A498032682`。
- 安装后的 `resources/legal` 已包含本项目、官方 Harness、Electron/Chromium、Privacy 与 Third-Party notices。

## 12. Secret Scan 结果

`npm run security:scan` 已通过；源码、待提交文档与示例未发现 API Key、Bearer token、私钥或开发机个人绝对路径。扫描只输出文件/行号和类别，不打印可疑值；排除依赖、构建产物、上游镜像、DPAPI 配置以及 Git-ignored 的实时 Handoff。应用日志最近 500 行也未发现 key、Bearer 或 Authorization 值。真正发布前仍需对最终安装包、公开截图和完整 Git 历史再做一次人工复核。

## 13. 第三方 License 审计结果

- 本桌面封装：MIT。
- 官方 DeepSeek Harness/dsh：MIT（仍需随分发保留上游许可证）。
- 当前 npm dependency audit 的详细许可证统计在 `THIRD_PARTY_NOTICES.md`。
- Electron/Chromium/Node/V8/FFmpeg 有独立 notices；sharp 平台包涉及 libvips LGPL 条件。
- SiliconFlow/BigModel 仅为外部 API 服务，没有 bundled SDK；发布前仍需人工确认最新服务条款、隐私、商标和商用条件。

## 14. 真正发布 GitHub 前仍需完成

1. 由用户最终确认产品功能、名称和 UI；建议采用更中性的公开名称，避免被误认成官方 DeepSeek 产品。
2. 人工复核 DeepSeek 名称/商标/Logo 使用方式；当前自制 H 图标不是官方 Logo。
3. 在干净环境重建并复验 NSIS/portable，记录最终 SHA-256 和软件物料清单。
4. 确认 Electron/Chromium 与 libvips notices 已随二进制可访问。
5. 对截图、示例 Handoff、日志、diagnostics 和 Git 历史做最终隐私审查。
6. 用户明确说“现在可以发布 GitHub”后，才创建远程仓库、push、Tag 和 Release。

## 恢复方法

- 后端失败：退出应用，检查应用日志目录中的 `desktop.log`，然后重启；端口会重新动态选择。
- 配置损坏：先备份用户数据与 Workspace，再通过 Settings 重置；不要公开 DPAPI 密文。
- Handoff 锁异常：确认没有 Agent 工作后等待 TTL 过期；不要在另一 Agent 活跃时强删锁。
- 文件恢复：优先使用 Git/备份；Workbench 只会在当前内容仍与 checkpoint 基线一致时恢复。
