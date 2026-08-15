# Security Policy

## 项目身份和支持范围

DeepSeek Harness Desktop 是基于官方 DeepSeek Harness 的第三方 Windows
桌面封装，不代表 DeepSeek 官方产品或安全承诺。官方 Harness 处于
Developer Preview/RC；本项目的桌面壳、可选 Vision bridge、Workspace
工作台和共享上下文属于本项目维护范围，官方 dsh 本体仍由上游维护。

当前仓库没有承诺公开的安全响应 SLA，也没有在源代码中写死安全报告邮箱。
若仓库尚未公布私密报告渠道，请联系项目维护者并要求使用私密渠道；不要在
公开 issue 中粘贴 API key、token、cookie、完整日志、Workspace 内容或私有
截图。不要向 DeepSeek、SiliconFlow 或 BigModel 冒充本项目维护者提交报告。

## 报告内容

请提供最小可复现信息：

- Desktop/官方 dsh/package-lock 的版本；
- Windows 版本和 Node/Electron 版本（不要包含计算机名或用户名）；
- 复现步骤、预期与实际结果；
- 脱敏后的日志片段和文件名；用 [REDACTED] 替换 key、路径和个人数据；
- 是否可以在全新 Workspace 中复现。

如需附加文件，先在隔离的测试 Workspace 复制并清理敏感内容。不要上传
settings.secure.json、.dsh 会话、.agents/sessions、浏览器状态或安装包中
未公开的构建缓存。

## 受保护的边界

- API key 只能通过 Settings 或受控的 stdin 导入路径输入；应用应使用
  Electron safeStorage/Windows DPAPI 加密保存，并从日志、渲染器和 Harness
  settings.yaml 排除明文；
- dsh 后端只绑定 127.0.0.1 的动态端口。不要将该端口反向代理到公网；
- BrowserWindow 使用 contextIsolation、sandbox 和 nodeIntegration=false。
  不要把未知的远程 URL 加入本地 Harness allow-list；
- Workspace 工具应拒绝越过 Workspace 根的路径。Shell 权限是用户可配置的，
  Windows ACL enforcement 仅为官方实现的部分能力，不等同于沙箱；
- Vision bridge 只接受 PNG/JPEG、单张最多 5 MB、尺寸 28–6000 像素，并把
  结果缓存为文本；图片和提示词仍会发送至用户选定的外部服务；
- .agents/ 是项目本地的互操作层，不是秘密存储。禁止写入 API key、cookie、
  token、机器凭据或完整聊天记录。

发现绕过这些边界的方式时，请先私密报告，给维护者留出修复时间；不要先
公开利用或把真实用户数据作为 PoC。

## 泄露处理

如果 key 可能已经进入日志、git、截图或构建产物：

1. 立即在对应 API 服务撤销/轮换 key；
2. 保留最小证据，但不要继续传播原文；
3. 清理工作树、缓存和历史中的泄露副本；
4. 在私密报告中说明受影响的范围和轮换时间。

删除本地文件不等于从 Git 历史、云备份或 API 服务撤销；按服务方流程完成
轮换和审计。
