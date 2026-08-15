# Release Checklist

这是发布前与发布后的人工清单；它本身不会自动创建远程仓库、推送分支或上传安装包。
所有路径使用 <repo>、<workspace> 或运行时环境变量表示，禁止把维护者绝对路径、
用户状态或 key 写入发布材料。

## 身份、版本和范围

- [ ] README、安装器元数据和启动窗口明确“第三方 Windows Agent Desktop，
      非 DeepSeek 官方桌面版”；
- [ ] package.json 版本、CHANGELOG 和安装包 artifactName 一致；
- [ ] 官方 dsh 版本、上游 commit/tag、Developer Preview/RC 状态有记录；
- [ ] 未暗示 DeepSeek 官方签名、品牌背书或稳定性承诺；
- [ ] 公开文档链接官方 Harness、Electron 和各 API 服务的当前页面。

## 干净构建

    npm ci
    npm test
    npm run build
    npm run prepare-runtime
    npm run dist

- [ ] 在干净 clone 和全新 Windows 用户/测试账户中重复；
- [ ] production runtime 使用 npm ci --omit=dev，runtime-stage 不含 key；
- [ ] NSIS 与 portable x64 均可启动，后端只绑定 127.0.0.1 动态端口；
- [ ] Settings 保存、重启持久化、清除 secrets、日志打开和正常退出通过；
- [ ] Workspace 文件读写、PowerShell、checkpoint、Skill/MCP 状态和 shared
      handoff 在最小测试项目中通过；
- [ ] Vision 无 key 的 Awaiting API Key 不阻断 DeepSeek；有测试 key 时在
      provider 条款允许的测试图片上验证成功后立即撤销 key。

## 依赖和许可证

- [ ] 重新读取 package-lock 生产闭包，并更新 THIRD_PARTY_NOTICES.md 的统计；
- [ ] 检查所有直接和 transitive package 的 LICENSE/NOTICE/“SEE LICENSE IN”；
- [ ] 检查 Electron MIT 以外的 Chromium、Node、V8、BoringSSL、FFmpeg
      notices，并让安装包用户可访问；
- [ ] 检查 sharp/libvips platform 包的 LGPL-3.0-or-later 条款、版权、
      对应源码/可重新链接义务；
- [ ] 对未知 SPDX、二进制只读包或许可证冲突进行人工/法律复核；
- [ ] SiliconFlow 和 BigModel 确认是 HTTP API 服务、没有 bundled SDK，
      但仍人工确认最新服务条款、隐私、商用和地域限制；
- [ ] API 服务不存在于安装包 secrets、源码、日志或默认配置中。

## 安全、隐私和敏感扫描

- [ ] 扫描 source、dist、runtime-stage、installer 解包目录和文档中的
      Authorization、Bearer、sk-、api key、DPAPI 密文和 cookie；
- [ ] 扫描 <repo>、<workspace> 等模板以外的用户绝对路径、计算机名、
      桌面快捷方式和 AppData 路径；
- [ ] 不包含真实 .dsh/session、.agents/sessions、锁 token、Vision 图片、
      私有日志或个人截图；
- [ ] SECURITY.md、PRIVACY.md 与真实数据流一致；
- [ ] 日志脱敏仍可诊断，且没有在 error 详情中回显完整请求/响应；
- [ ] 没有因为排障而加入 --no-sandbox、公网监听或绕过 DPAPI 的代码。

## Windows 发行说明

- [ ] 记录 Node/npm/Electron/electron-builder、OS 构建和 package-lock 哈希；
- [ ] 记录 NSIS/portable 文件名、大小、SHA-256 和构建时间；
- [ ] 说明未签名产物可能触发 SmartScreen，提供来源和校验方式；
- [ ] 明确卸载不会自动删除 Workspace、.dsh 或 .agents；
- [ ] 提供升级前备份、回滚和官方 dsh RC 不兼容提醒；
- [ ] 仅在人工批准后发布；本清单完成不等于 DeepSeek 官方支持。

## 发布后

- [ ] 保存可复现构建日志和依赖审计，但移除用户路径、key、session 和私有
      API 响应；
- [ ] 监控安装启动、端口绑定、凭据持久化、Vision 错误和 shared lock；
- [ ] 服务条款、模型 ID、上游 dsh 版本发生变化时重新验收；
- [ ] 收到安全报告时按 SECURITY.md 私密处理并轮换可能泄露的 key。
