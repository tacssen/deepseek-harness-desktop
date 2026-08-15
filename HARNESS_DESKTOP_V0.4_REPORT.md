# DeepSeek Harness Desktop v0.4.0 本地验收报告

> 生成日期：2026-08-15（本地）  
> 身份：第三方 Windows Electron Desktop Workbench，**不是 DeepSeek 官方桌面版**。  
> 发布状态：仅本地开发、构建、安装和验收；没有创建远程仓库、没有 push、没有发布 Release。

## 结论摘要

| 项目 | 状态 | 证据/边界 |
| --- | --- | --- |
| Desktop 0.4.0 | Ready | Electron 43.4.0，动态 loopback，WorkBench + 官方 dsh Web UI |
| 官方 Harness | Ready | `@deepseek-ai/dsh@0.1.0-rc.6`，Developer Preview/RC |
| DeepSeek | Ready | 实测 `deepseek-v4-flash` connection test 成功；Key 只存在 DPAPI safeStorage |
| Vision | Ready | SiliconFlow `zai-org/GLM-4.5V` 实测成功；Key 不写入源码、日志或报告 |
| Agent Levels | Ready | Low/Medium/High/Extra High/Max 均改变真实执行预算/策略 |
| Usage | Ready | 真实 response usage/session event 统计，版本化估价 |
| Balance | Honest unavailable | 官方公开余额接口不可靠；不显示伪造余额，只提供 Billing 链接 |
| Settings/Profile | Ready | 常规、外观、个性化、权限、Browser、Data/Privacy、Advanced、About、Profile |
| Browser | Ready | Playwright Core + 隔离 Edge/Chrome profile；真实 smoke test 通过 |
| Computer Control | Deferred | 默认关闭；没有安全 STOP/审批闭环，不伪造实现 |
| Permissions | Ready | Read Only / Safe Coding / Full Workspace / Browser Agent / Full Agent |
| Skills | Ready | 项目 `.agents/skills` +允许读取的用户 `.agents/skills`，不碰 Codex 私有目录 |
| Plugins | Ready (safe preview) | 未知仓库只读；allowlist/pinned ref/license/manifest 全通过才安装 |
| Codex Collaboration | Ready (handoff) | 同一真实工作树；官方 app-server 只读；不改 Codex DB |
| Security/Secret Scan | Passed | `npm run security:scan` 通过；Key 未进入 Git/报告/日志 |
| NSIS / Portable | Built | 0.4.0 x64 产物和 SHA-256 已生成 |
| GitHub | NOT PUBLISHED | 无 remote、无 push、无公开仓库 |

## 1. 修改内容

本轮在已有 0.3.0 架构上增量改造，没有复制 Workspace、没有重写官方 Agent：

- `src/agent-levels.cjs`：五级 Agent policy，Provider effort 与 Desktop execution budget 分层；
- `src/app-data-service.cjs` + `src/pricing-metadata.json`：带 schema/migration/atomic write/backup 的 Usage 数据层和定价 metadata；
- `src/secure-store.cjs`：新增常规、外观、个性化、权限、Browser、Advanced defaults，DPAPI secret 保持不变，Profile 不导出密钥；
- `src/main.cjs`：Usage、Profile、Data/Privacy、Agent level、Tray/开机启动、Browser 环境隔离、动态端口、真实 DeepSeek/Vision test IPC；
- `src/settings.html` / `src/settings-renderer.js` / preload：渐进披露 Settings；
- `src/usage.html` / renderer / preload：Usage & Billing 独立窗口；
- `src/workbench-*`：顶部 Agent Level/Usage 状态、Skills catalog、权限状态、个性化 prompt、Agent budget enforcement；官方 Web UI 仍作为主聊天和工具界面；
- `browser-plugin/`：独立 Playwright Browser tool，默认关闭、独立 profile、域名/上传/下载边界；
- `src/marketplace-service.cjs` 及既有插件市场 UI：公开元数据浏览和严格安全安装边界；
- 文档：README、`docs/v0.4-product-layer.md` 和本报告，继续保留 MIT/上游/隐私/安全说明。

## 2. 官方来源和版本边界

确认使用的上游是 [DeepSeek 官方 Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)，
运行包为 `@deepseek-ai/dsh@0.1.0-rc.6`。官方 README 将它定义为 Developer Preview，GitHub
目前没有正式 Release/Tag，也没有官方 Windows `.exe/.msi` Desktop 产品；本项目是外层
Electron Workbench，主区域加载官方 Web profile。模型 ID 以官方接口为准：
`deepseek-v4-flash` / `deepseek-v4-pro`。

DeepSeek API 文档：

- [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [FAQ](https://api-docs.deepseek.com/faq)

## 3. Agent Level 实际映射

| UI | Provider effort | 并行工具上限 | 基础 max steps | verify | repair |
| --- | --- | ---: | ---: | --- | --- |
| Low（低） | `high`（官方兼容） | 2 | 8 | false | false |
| Medium（中） | `high` | 4 | 16 | true | false |
| High（高） | `high` | 6 | 28 | true | true |
| Extra High（极高） | `max` | 8 | 48 | true | true |
| Max（最高） | `max` | 10 | 80 | true | true |

官方 API 当前原生 effort 只有 `high`/`max`。因此 Low/Medium 的差异来自 Desktop
预算、并行工具和验证策略，不会向 API 发送不存在的 `low` 或 `medium` 枚举。Workbench
会读取会话 step 数，超过有效预算时调用官方 `session.cancel`；配置和实际值均在
状态栏显示。测试 `Agent Levels map to distinct provider effort and execution budgets` 证明五级值不同。

## 4. Usage / Token / Balance

### 数据来源

- 官方 `assistant/message.usage`（通过 `session.history`）；
- DeepSeek Test Connection 的真实 response usage；
- Vision Bridge 返回的真实 usage（provider 返回时）。

记录字段包括 provider、model、session、workspace 标识、request time、duration、prompt/
completion/total/reasoning/cache hit/cache miss tokens，以及成本估算。只保存结构化
用量，不保存 prompt、回复、图片、Authorization 或 Key。重复的 `sessionId:eventSeq`
会去重，记录上限 20,000。

### Pricing

`src/pricing-metadata.json` 独立保存来源和生效日期。当前 DeepSeek V4 metadata 使用
官方 pricing 页面中的 Flash/Pro 输入、输出、cache hit/miss 单价；UI 标签是
**Estimated Cost**，不是官方账单金额。未来价格变化应更新 metadata 和日期，而不是
散落在业务代码中。

### Balance

已调查官方公开 API；目前没有足够稳定、可依赖的余额查询契约。UI 显示
“官方余额接口不可用”，金额、币种和时间保持空值，并打开官方 Billing 页面。禁止
根据本地 Token 推算余额。

## 5. Vision Bridge

Vision 使用独立 provider，不把图片发送到文本 DeepSeek endpoint。当前本机已用用户
提供的 SiliconFlow credential 完成真实测试：provider `siliconflow`，endpoint
`https://api.siliconflow.cn/v1/chat/completions`，model `zai-org/GLM-4.5V`，结果
为 `Vision Ready`。credential 仅由 safeStorage 解密到进程内请求，测试输出只保留
状态和 model，不保留 Key。图片校验为 PNG/JPEG、28–6000 px、≤5 MB；cache key 包含
图片、prompt、provider、model 和 endpoint，避免不同请求误复用。

## 6. Browser 架构和验收

Browser 不是 Web Search 的别名，而是 `browser-plugin` 中的官方 dsh tool registration：

- Playwright Core 复用系统 Edge/Chrome executable；
- 独立应用 profile，不读取个人浏览器 cookies；默认 `enabled=false`；
- 允许 open/new tab/close/switch/back/forward/reload/click/type/scroll/read/screenshot/
  wait，以及受确认和 Workspace 边界约束的 upload/download；
- Allowed/Blocked domains、headless、cookie policy、下载/上传确认可在 Settings 配置；
- 只有 Browser 设置和 Browser permission 同时开启才把 tool 挂到 Harness preset。

自动化测试 `real Browser smoke` 使用隔离 profile 完成测试页打开、读取、点击、输入和
screenshot，26 个 Node tests 全部通过。Computer Control 当前明确 Deferred/off：没有
可靠的屏幕权限、可见“DeepSeek is controlling this computer”、STOP 和高风险审批闭环，
因此不启动鼠标键盘控制，也不把它放进 Full Agent preset。

## 7. Settings / Profile / Permissions

Settings 已覆盖：

- General：启动行为、开机启动、托盘、恢复 Workspace/Session、Enter、preset、下载/临时目录；
- Appearance：theme、scale、font、compact、sidebar density、动画、code/editor font；
- Personalization：Global/Workspace instructions、语言、注释语言、代码风格、解释/测试/总结偏好；
- Agent：五级和预算 override；
- Models：DeepSeek 与 Vision base URL/model/connection test；
- Permissions：五种 preset，Computer 固定 false；
- Browser：开关、可见/无头、可执行路径、域名和确认策略；
- Data & Privacy：Usage、日志、sessions、handoff、cache 清理和数据导出；
- Advanced/About：端口、timeout、retry、logging、developer mode、proxy、版本和 notices。

Profile export 只包含可移植偏好，清空 machine-specific workspace/download/temp/executable
path；拒绝含 `apiKey`、`token`、`cookie`、`DPAPI`、`credential`、`password`、`secret`
字段的导入文件。API Keys 默认隐藏，只显示固定掩码和 configured 状态。

## 8. Codex Shared Project / Handoff

保留并产品化已有共享层：DeepSeek 和 Codex 选择同一真实项目目录、同一 `.git`、
`AGENTS.md`、`.agents/skills`、`TASKS.md`、`MEMORY.md`、`HANDOFF.md` 和锁状态，
不创建第二份项目。Workbench 展示 Project/Branch/Dirty/Current Agent/Lock/Last Handoff、
Tasks、Git diff、Context、Skills，并提供 Continue From Codex / Prepare Handoff for Codex。

Codex 私有 SQLite、JSONL rollout、浏览器状态和 writer lock 不是可编辑公共协议：
本地 adapter 只通过官方 app-server 的只读 `thread/list` / `thread/read`（按精确 cwd）
按需摘要，不写入或篡改 Codex 数据库。无法诚实承诺实时完整聊天同步，实际共享的是
结构化 handoff 和真实工作树。项目锁为 DeepSeek 硬锁 + Codex 指令/脚本协作，外部
文件变更通过 watcher/Git 状态提示；检测到外部变化时不静默覆盖。

## 9. 插件和 Skills

Skills manager 读取项目 `.agents/skills` 和允许访问的用户 `.agents/skills`，显示名称、
描述、scope、路径和打开目录；不复制或修改 Codex `.codex` 私有目录。插件市场的未知
仓库只显示公开 GitHub metadata。安装前必须同时满足：本地 verified allowlist、pinned
ref、允许许可证、合法 dsh manifest、归档路径无 traversal、无 symlink、文件/大小/深度
上限；安装目录限于 profile plugins。当前 allowlist 默认为空，因此默认是安全的“查看”模式，
不会因为搜索结果自报 `verified=true` 就执行远端代码。

## 10. 安全、隐私和第三方审计

- DeepSeek/Vision Key 只进 Electron safeStorage/Windows DPAPI，不进源码、Git、README、
  HANDOFF、Usage、Profile export、日志和报告；
- Logger、diagnostics、Browser/attachment 路径做 redaction；Browser 使用独立 profile；
- 动态 backend 绑定 `127.0.0.1`，不绑定公网；Workspace/路径有边界校验；
- 应用数据和项目共享数据分离：userData 下的 app-state 与项目 `.agents` 不混用；
- 生产依赖 license 已做本地聚合审计：MIT/Apache/BSD/ISC/LGPL 等保留上游 notices；
  Electron/Chromium/Node/V8/BoringSSL/FFmpeg 和 sharp/libvips 需随二进制保留通知；
- 上游 Harness 为 MIT Developer Preview；SiliconFlow/BigModel 是外部 API 服务，发布前
  仍须人工确认最新条款、商标和重新分发边界。

## 11. 自动化测试和质量门

已执行并通过：

```text
npm.cmd test                         26 passed, 0 failed
npm.cmd run lint                     PASS
npm.cmd run build                    PASS (verified 33 files; dsh rc.6)
npm.cmd audit --omit=dev --audit-level=high   found 0 vulnerabilities
npm.cmd run security:scan            PASS (no credential/personal-path patterns)
```

测试覆盖 Agent levels、真实 usage 解析/去重/估价/honest balance、Profile secret reject、
Permission preset、Browser smoke、插件安装边界、Codex adapter、Shared Handoff、Workspace
路径、RPC envelope 和 diff restore。DeepSeek 与 Vision connection test 也已真实调用并仅
输出状态/model。没有把测试结果静态写死在 UI。

另外运行 `npm.cmd run prove:tool`：`routable=true`、`toolVisible=true`、
`turnCompleted=true`，事件包含真实 `turn/end:completed`；证明官方 Agent/tool 路径仍可用。

## 12. 构建、安装和哈希

源码构建：

```text
npm ci
npm run dist
```

产物（本地 `dist/`，未上传）：

| 产物 | SHA-256 | 说明 |
| --- | --- | --- |
| `dist/DeepSeek-Harness-Desktop-0.4.0-x64.exe` | `703DF37B5A62B3495CDDCCD30F02070EFA0D10FE1F199DBF036B8E9272D2B93B` | NSIS x64 |
| `dist/DeepSeek-Harness-Desktop-0.4.0-portable.exe` | `B06FBA2072F468EE1B51F4B3546B7E3937AB35DF936D155926197991F448F377` | Portable x64 |

NSIS 和 Portable 均成功生成，runtime-stage 包含官方 dsh rc.6、Vision/Browser plugin。
本机实际运行目标使用 `%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop`，由最新
`dist/win-unpacked` 验证复制到用户安装目录；动态日志出现 `Harness ready at
http://127.0.0.1:<port>/`。桌面快捷方式为 `DeepSeek Harness.lnk`，目标使用动态用户
安装路径，不依赖固定用户名。

NSIS 在本机 unattended `/S` 的交互行为不稳定（返回非零/不总是覆盖已有目录），因此
报告不把它伪装成“静默安装器验收通过”；NSIS **构建**已通过，unpacked runtime 的
启动、Ready、核心 API 测试已通过。正式公开前应在干净 Windows 虚拟机完成一次 GUI
安装/卸载回归，并修复 installer exit-code/upgrade 流程后再宣称安装器全绿。

## 13. 已知限制和 v0.5 建议

1. DeepSeek Harness 仍是 RC/Developer Preview，source master 与 npm rc 可能短暂不同步；
   升级应固定版本并重新跑完整测试。
2. Windows ACL sandbox 是上游 partial；不得把 Agent 权限当作操作系统安全边界。
3. Browser 下载/上传审批目前是 Desktop policy；复杂登录、OAuth、长期持久 Profile
   和 Computer Control 留待独立安全设计。
4. Codex 原始聊天不会被复制进项目；继续强化结构化 handoff、冲突提示和用户选择式摘要。
5. 插件 allowlist 需要逐个审计后才可增加；默认空 allowlist 是有意的安全状态。
6. 公开 GitHub 前应在干净机器做安装/卸载/升级、license 人工复核、SBOM、CI secret scan、
   reproducible build 和截图脱敏；本轮不创建 remote、不 push、不发布 Release。

## 14. Git 本地状态

- 当前分支：本地工作分支（无 remote）；
- 实现 commit：`fba5358 feat: productize desktop workbench 0.4.0`；
- 报告 commit：本报告随后作为独立本地 commit 加入；
- 允许的操作：本地 commit；
- 禁止的操作：`git push`、创建公开仓库、上传安装包、上传 API Key；
- 最终实现 commit 和报告 commit 以 `git log -1 --oneline` 为准，报告自身不包含任何
  credential、DPAPI ciphertext、Cookie、私有 Workspace 或 Codex 原始聊天。
