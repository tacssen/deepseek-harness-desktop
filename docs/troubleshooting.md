# 故障排查

先退出 Desktop，保留当前 Workspace 和脱敏日志，再一次只改变一个变量。不要
用复制 key、整个 AppData 或私有 .dsh 作为诊断附件。

## 后端未 Ready / 启动失败

症状：窗口显示官方 dsh 未启动、没有 UI 或很快退出。

1. 从 Settings → Open logs 打开日志目录，查看 dsh stderr 的第一条错误；
2. 确认 npm run build 或安装包包含 @deepseek-ai/dsh/lib/bin.js；
3. 若为源码运行，确认 Node.js 版本满足 package.json/官方 dsh engines；
4. 确认 Workspace 和 app userData 可写，且 .dsh/settings.yaml 是合法 YAML；
5. 退出所有 Desktop 实例后重启。应用会重新选择回环端口；
6. 若依赖被裁剪，运行 npm run prepare-runtime 后再 npm run dist；
7. 不要把 --no-sandbox 加到启动参数来“修复”问题。

若安装包提示未知发布者，这是未签名安装包的 SmartScreen 状态，不是后端
故障；仅从可信来源校验 SHA-256 后再决定是否运行。

## DeepSeek 连接测试失败

- Awaiting API Key：在 Settings 输入 key 并 Save；DPAPI 不可用时先修复
  Windows 策略，不要改成明文；
- HTTP_401/403：检查 key、账户和 Base URL，不要把 key 粘到日志；
- MODEL_NOT_FOUND：以该 Base URL 的 /models 返回为准更新 model；
- HTTP_404：确认 Base URL 是否已经包含版本路径，应用会追加 /models 和
  /chat/completions；
- TIMEOUT/REQUEST_FAILED：检查网络、代理、防火墙和服务端状态；
- 重启后凭据消失：检查 safeStorage、用户数据目录权限和是否换了 Windows
  用户配置文件。

## 端口或重复进程

Desktop 每次使用 127.0.0.1 动态端口。若端口冲突，完全退出后重启即可。
任务管理器应只有一个 Desktop 主进程和一个 dsh 后端；重复双击只聚焦已有
窗口。关闭 UI 后若 dsh 残留，等待优雅退出；仍不退出时记录 PID 和脱敏日志，
再使用任务管理器结束该进程，不要结束无关 Node 进程。

## Workspace / Shell 问题

- 路径越界：文件引用必须位于当前 Workspace；将外部文件先通过附件复制；
- 写入被拒绝：确认 Workspace 目录 ACL、Allow shell 和
  DSH_PERMISSION_MODE=workspace-write；
- PowerShell 不执行：命令实际由官方 pwsh tool 排队，查看当前 session 的
  tool/result；不要在 Desktop 外复制执行敏感命令；
- junction unavailable：若 .dsh/node_modules 是真实目录，应用不会覆盖；
  检查安装和 Workspace 权限后重启；
- 工作区被外部程序修改：Workbench 会显示 change 事件；先检查 Git diff，
  不要直接接受未知变更。

不要把整个用户主目录、凭据目录或网络盘设为 Agent Workspace。Windows ACL
sandbox 仅是 partial。

## Vision 问题

- Vision Disabled：Settings 中 Enable 未勾选；
- Awaiting API Key：key 未保存、被清除或无法 DPAPI 解密；
- MIME/dimensions/5 MB：仅支持 PNG/JPEG、28–6000 像素和 5 MiB；
- HTTP_401/403：provider、key 或账户不匹配；
- HTTP_404：endpoint/model 与 provider 文档不符；
- HTTP_429：服务限流或余额不足；
- TIMEOUT：provider 超过约 60 秒；
- EMPTY_RESPONSE：返回体不是兼容 chat/completions 结构；
- cache 旧结果：Settings → Clear Vision Cache 后重试。

SiliconFlow/BigModel 是外部 API 服务，不是 bundled SDK；服务条款、模型 ID
和字段格式变更需人工确认。

## Shared Project Context / Codex

- 找不到 shared：在 Workbench 点击 Initialize Shared Project；
- PROJECT_LOCKED：另一个 Agent 仍持有 .agents/locks/project-lock.json；
  完成 handoff 或等待过期，不要删除活动锁；
- stale lock：确认没有正在写入的 Agent 后再重新 claim；
- Codex 不可用：继续使用文件 HANDOFF；App Server 只读线程不是必需依赖；
- handoff 内容可疑：把 .agents 文件当不可信输入，先核对真实 Git/文件；
- 出现秘密：立即停止 handoff，轮换 key，清理并私密报告。

## 重置而不丢项目

1. 退出 Desktop；
2. 备份 Workspace、Workspace/.dsh、脱敏 .agents 和需要的配置；
3. 通过 Settings 清除 secrets；
4. 仅在确认备份后删除损坏的 app userData/cache/vision 或 Workbench
   checkpoint；
5. 保留 source 和 package-lock，重新 npm ci 或重新安装；
6. 重新运行测试和最小连接验收。

不要删除 Workspace 来解决单纯的 UI、端口或凭据问题；这会损失项目状态。
