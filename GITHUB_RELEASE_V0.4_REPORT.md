# DeepSeek Harness Desktop 0.4.0 — GitHub Release Report

发布日期：2026-08-15  
发布仓库：[tacssen/deepseek-harness-desktop](https://github.com/tacssen/deepseek-harness-desktop)  
版本：`0.4.0`  
Tag：[`v0.4.0`](https://github.com/tacssen/deepseek-harness-desktop/releases/tag/v0.4.0)  
身份：基于官方 DeepSeek Harness 的第三方 Windows Electron Agent Desktop，**不是 DeepSeek 官方桌面客户端**。

## 1. 发布结果

本次已经完成真实 GitHub Public Release，而不是仅完成本地准备：

- 公开仓库已创建；
- `origin` 已配置为本仓库；
- 清理后的完整本地 Git 历史已推送到 `master`；
- `v0.4.0` annotated tag 已创建并推送；
- GitHub Release 已创建为正式 Release（非 Draft、非 Pre-release）；
- NSIS、Portable、SHA-256 校验文件和 CycloneDX SBOM 已上传；
- GitHub Actions Windows CI 已通过；
- 已从 GitHub 重新 clean clone，并执行安装、测试、lint 和 build。

## 2. Git、Tag 与 CI 证据

| 项目 | 结果 |
| --- | --- |
| 发布仓库 | [https://github.com/tacssen/deepseek-harness-desktop](https://github.com/tacssen/deepseek-harness-desktop) |
| 默认发布分支 | `master` |
| Tag | `v0.4.0` |
| Tag 目标 commit | `f300454cefa28d50f1d3d19fca8eae4f9ad2d212` |
| Tag 类型 | Annotated tag |
| CI workflow | `Windows CI` |
| CI run | [31884921173](https://github.com/tacssen/deepseek-harness-desktop/actions/runs/31884921173) |
| CI 状态 | `success` |
| CI 覆盖 | `npm ci`、Electron runtime/license 检查、`npm audit`、secret scan、test、build |

CI 首轮暴露了两个真实问题并已修复后重新运行：

1. 历史测试夹具中的字符串被公共 CI 的断言识别为未脱敏；已改为短的安全 Bearer fixture，同时仍验证实际 redaction；
2. GitHub runner 的 Electron 安装阶段没有自动保留 `LICENSES.chromium.html`；workflow 增加显式 `node node_modules/electron/install.js`，随后 CI 全绿。

## 3. Release 资产

Release 页面：[v0.4.0 Release](https://github.com/tacssen/deepseek-harness-desktop/releases/tag/v0.4.0)

| 资产 | 大小 | SHA-256 | 下载 |
| --- | ---: | --- | --- |
| `DeepSeek-Harness-Desktop-0.4.0-x64.exe` | 194,348,670 bytes | `9ab54428ec93723d42a8f85fbbc607a51139cad5f7925dc019ca7ad26839b97b` | [下载](https://github.com/tacssen/deepseek-harness-desktop/releases/download/v0.4.0/DeepSeek-Harness-Desktop-0.4.0-x64.exe) |
| `DeepSeek-Harness-Desktop-0.4.0-portable.exe` | 194,097,818 bytes | `b222bd6aa984ae2fcff36d761209ff89e62388533f8e304fa3337dfaf721f372` | [下载](https://github.com/tacssen/deepseek-harness-desktop/releases/download/v0.4.0/DeepSeek-Harness-Desktop-0.4.0-portable.exe) |
| `SHA256SUMS.txt` | 215 bytes | — | [下载](https://github.com/tacssen/deepseek-harness-desktop/releases/download/v0.4.0/SHA256SUMS.txt) |
| `sbom.cdx.json` | 653,666 bytes | — | [下载](https://github.com/tacssen/deepseek-harness-desktop/releases/download/v0.4.0/sbom.cdx.json) |

本地生成的 SHA 文件与 Release 下载后重新计算的哈希完全一致。SBOM 解析成功，格式为 CycloneDX，包含 486 个组件。

## 4. Clean Clone 验收

使用 Release tag 从 GitHub 新建临时 clean clone（未使用本地工作树、未复制本地 `node_modules`）：

```text
git clone --branch v0.4.0 --depth 1 --single-branch https://github.com/tacssen/deepseek-harness-desktop.git
npm ci
node node_modules/electron/install.js
npm test
npm run lint
npm run build
```

结果：

- clean clone HEAD：`f300454cefa28d50f1d3d19fca8eae4f9ad2d212`；
- tag：`v0.4.0`；
- package version：`0.4.0`；
- `npm ci`：成功，`0 vulnerabilities`；
- `npm test`：26/26 通过；
- `npm run lint`：通过；
- `npm run build`：通过，验证 33 个构建前置文件和官方 dsh `0.1.0-rc.6`；
- clean clone 工作树：干净。

Release 资产也已使用 `gh release download` 下载到独立临时目录，并逐一重新计算哈希；两个 EXE 均与 `SHA256SUMS.txt` 匹配。

## 5. 发布前安全审计

### Git 历史和追踪文件

- 对全部可达 Git 历史执行内容扫描，并在发现旧机器路径和测试型 key-like fixture 后重写历史；
- 清理 `refs/original`、reflog 和不可达对象后再次扫描；
- 最终扫描结果：OpenAI/DeepSeek 风格 key、GitHub token、Slack token、Google key、长 Bearer token、个人绝对路径均为 0；
- 最终追踪文件数：78；
- 追踪文件中的 `.dsh`、`.codex`、Codex session、SQLite、DPAPI、secure settings、日志和运行时目录：0；
- `npm run security:scan`：通过；
- Release SBOM、Release notes、README 和报告也执行了敏感内容检查，没有完整 API key、Cookie、Credential 或私有 Workspace。

### 凭据和隐私

- DeepSeek API key 没有写入源码、Git、README、Actions、Release、日志或本报告；
- Vision API key 没有写入源码、Git、README、Actions、Release、日志或本报告；
- 本机 DPAPI 密文、Codex SQLite/JSONL、用户 Workspace、聊天记录和临时测试目录没有进入公开仓库；
- 项目默认要求用户首次启动后自行填写 API key，Windows 上由 Electron `safeStorage`/DPAPI 保存；
- 日志和诊断路径使用 secret redaction，不记录完整 Authorization、API key 或响应正文。

## 6. README、许可证与依赖审查

- README 已明确声明：本项目不是 DeepSeek 官方 Windows Desktop/EXE/MSI；
- README 使用公开仓库地址，并说明官方 dsh 是 Developer Preview/RC；
- 项目自身许可证：MIT，见 `LICENSE`；
- 官方 `@deepseek-ai/dsh@0.1.0-rc.6`：MIT，来源为官方 `deepseek-ai/deepseek-harness`；
- 依赖审计基线：当前 `package-lock.json`；生产依赖闭包包含 registry 记录和本地 Vision plugin，许可证聚合及通知见 `THIRD_PARTY_NOTICES.md`；
- 已特别审查 Electron/Chromium/Node/V8/BoringSSL/FFmpeg notices；安装包保留 Electron `LICENSES.chromium.html`；
- 已特别审查 sharp/libvips 的 Apache/LGPL 双重许可和发布通知义务；
- 当前生产闭包没有发现 GPL-only、MPL 或 AGPL 依赖，但发布者仍需随版本变化复核许可证；
- SiliconFlow 和 BigModel 是用户配置的外部 HTTP API 服务，不包含 SDK、模型权重或服务凭据；服务条款和隐私政策需用户自行确认。

## 7. 当前版本边界

- 官方 DeepSeek Harness 仍是 Developer Preview/RC，未来升级可能有 breaking changes；
- 本项目是社区 Electron wrapper，不代表 DeepSeek 官方签名、品牌背书或支持承诺；
- Windows ACL sandbox 是上游实现的 partial enforcement，不应当作完整操作系统安全边界；
- Computer Control 仍明确为 deferred/off；
- Browser plugin 默认关闭，下载/上传需要 Desktop policy 处理；
- 插件市场默认查看优先，未知仓库不能直接一键安装；只有经过本地 pinned allowlist、许可证、manifest 和归档边界校验的插件才可安装；
- Codex 原始聊天不会被复制或篡改；跨 Agent 协同使用项目内结构化 `.agents/` handoff，Codex app-server 仅按官方只读接口按需读取。

## 8. 发布后恢复方法

- 如果安装器被 SmartScreen 拦截，使用 GitHub Release 页面核对来源和 `SHA256SUMS.txt`；
- 如果上游 dsh RC 升级造成兼容问题，固定回滚到本 Release 的 `v0.4.0` 与安装包；
- 用户 Workspace、`.dsh`、`.agents` 不会因为卸载自动删除，升级前应自行备份；
- 安全问题请按 `SECURITY.md` 的私密报告流程处理，不要在公开 issue 中粘贴 key、日志或 Workspace 内容。

## 9. 结论

0.4.0 已完成真实公开仓库、CI、Tag、Release、安装包、校验文件、SBOM、clean clone 和下载哈希验收。公开发布的是本项目自己的 Electron Desktop 代码和构建产物；官方 DeepSeek Harness 仍按其上游 MIT/Developer Preview 条件使用，二者身份和责任边界保持明确分离。
