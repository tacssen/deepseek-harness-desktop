# Privacy Notes

## 适用范围

本文档描述当前第三方 Windows Desktop 封装的本地数据流，不替代
DeepSeek、SiliconFlow、BigModel 或任何 MCP/Skill 服务的隐私政策。服务
条款和数据保留规则可能变更，发布或部署前必须由使用者自行确认。

## 本地保存的数据

路径由 Electron 运行时动态决定；文档不依赖某个用户的绝对路径：

- 应用用户数据目录：由 app.getPath('userData') 返回。保存偏好、加密凭据、
  日志、Vision 结果缓存和 Workbench checkpoint；
- 默认 Workspace：由 app.getPath('documents') 加上
  DeepSeekHarnessWorkspace 组成；用户可在 Settings 选择其他真实目录；
- Workspace/.dsh：官方 dsh 配置、会话及项目级运行状态；
- Workspace/.agents：共享 handoff、任务、决策、测试摘要和机器本地锁/会话
  摘要。locks、sessions、checkpoints 等运行时文件应保持 Git 忽略。

API key 不写入源码、仓库、.dsh/settings.yaml 或普通日志。safeStorage 在
Windows 上使用 DPAPI 加密；public settings 只返回 apiKeyConfigured 和掩码。
如果平台无法提供加密，保存请求会失败。日志会对常见 key 形态进行脱敏，但
不要把日志当作绝对的秘密边界。

## 网络数据流

1. 官方 dsh 通过用户配置的 DeepSeek Base URL 发送用户提示词、会话上下文、
   工具调用所需的内容和可能的 Workspace 片段；
2. 可选 Vision bridge 通过用户配置的 SiliconFlow 或 BigModel 兼容
   chat/completions endpoint 发送图片 data URL、prompt、model 和 Bearer
   key。SiliconFlow/BigModel 是外部 API 服务，并非本仓库 bundled SDK；
3. MCP、Skill、Web 工具可能建立额外网络连接，取决于官方 dsh 配置和用户
   主动安装/调用的插件；
4. Desktop 与 dsh 后端仅通过本机动态 127.0.0.1 端口通信。默认设置
   DSH_TELEMETRY_DISABLED=1；这不是对第三方 API 自身日志、计费或保留策略
   的控制。

图片在发送前会做 MIME、大小和尺寸校验。Vision cache 只保存结果文本及
模型/provider 元数据，不保存原始图片；缓存 key 包含图片 SHA-256、prompt、
provider、model 和 Base URL。清理 Vision cache 不会撤销已经发送到服务端的
数据。

## 用户责任

- 不要把个人资料、生产凭据、未授权源代码或受监管数据放入 Workspace；
- 为 DeepSeek、SiliconFlow、BigModel 分别阅读最新条款、隐私政策和数据
  处理选项；发布前由维护者人工确认服务条款，不要把“未 bundled SDK”理解为
  “没有服务条款”；
- 在组织环境中设置合适的 Workspace、Shell、MCP 和日志保留策略；
- 卸载前备份并按需删除 Workspace、.dsh、.agents 和 AppData 中的本地数据。

## 清理建议

退出 Desktop 后，在 Settings 中清除 DeepSeek/Vision 凭据，再按需删除
用户数据目录中的 settings.secure.json、logs、cache/vision 和
workbench/checkpoints。删除前应备份需要保留的项目；不要把加密文件复制到
公开报告。Workspace 的删除由用户自行确认，卸载器不会替用户判断项目是否
仍有价值。
