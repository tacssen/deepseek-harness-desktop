# Vision Bridge

Vision 是一个可选、独立的 Agent tool。DeepSeek 仍是主 Agent；它在需要
视觉信息时调用 vision_analyze，将结果作为上下文继续推理。

## Provider 和模型

当前代码支持两个 provider 值：

- siliconflow：默认 Base URL
  https://api.siliconflow.cn/v1/chat/completions，默认模型
  zai-org/GLM-4.5V；
- bigmodel：兼容 BigModel/智谱 chat/completions 的 URL 和模型，由用户在
  Settings 输入。

SiliconFlow 和 BigModel 是 API 服务，不是本仓库 bundled SDK；本项目不包含
模型权重、官方客户端、价格或条款。Base URL、model 和 key 均由用户配置，
发布前必须人工确认最新服务条款、隐私政策、商用/地域限制和图像保留策略。

## 调用流

    DeepSeek Agent
        -> vision_analyze (官方 dsh Agent tool seam)
        -> Desktop VisionBridge
        -> provider chat/completions (Bearer key)
        -> text result
        -> DeepSeek Agent 继续当前回合

Desktop 的 Host plane 不直接执行 vision tool；插件位于 Agent preset。默认
Vision 关闭，不配置 key 时 status 为 Awaiting API Key，普通 DeepSeek 会话
仍可工作。

## 输入限制和请求形状

- MIME 只允许 image/png、image/jpeg（image/jpg 会规范化为 image/jpeg）；
- 原始图片 1 byte 至 5 MiB；
- 宽高均须为 28 至 6000 像素；
- 请求最多使用用户提供的 prompt、所选 model 和图片 data URL；
- provider 请求为 POST JSON，messages 中包含 text 与 image_url，max_tokens
  为 256、stream=false；
- 请求超时约 60 秒；HTTP 非 2xx、空响应或非法 endpoint 会返回脱敏错误。

只把需要分析的图片放入专用 Workspace。校验尺寸不会阻止服务方看到已发送
的数据，也不代表图片内容安全。

## 缓存和凭据

缓存目录由 app.getPath('userData') 动态确定，逻辑子目录为 cache/vision。
缓存 key 哈希图片内容、prompt、provider、model 和 Base URL；文件只保存结果
文本、状态、时间和模型元数据，不保存原始图片。Settings → Clear Vision
Cache 会清除本地内存与磁盘缓存，但不会删除服务端日志或撤回已发送请求。

Vision key 与 DeepSeek key 一样由 Electron safeStorage/Windows DPAPI 加密。
渲染器只看到 configured/masked 状态；不要把 key 写入环境变量、.dsh、
cordis.patch.yml、issue 或截图。

## 启用和测试

1. 打开 Settings → Vision Bridge；
2. 勾选 Enable；
3. 选择 SiliconFlow 或 BigModel，核对 Base URL 和 model；
4. 输入对应 Vision API key，Save；
5. 点击 Test Vision，确认返回 Vision Ready；
6. 在专用 Workspace 引用 PNG/JPEG 并请求视觉分析。

Test Vision 使用应用生成的小 PNG 和“Reply with the single word OK.”提示，
不会读取用户文件。若无 key，测试只返回 Awaiting API Key；若 provider 返回
403/404/429/5xx，先检查服务条款、model ID、余额/限流和 endpoint。

## 隐私和故障边界

图片、prompt、model 和响应会离开本机发送给用户选择的服务。不要上传秘密、
个人资料或未授权数据；组织部署应有数据分类、同意和留存策略。Vision 服务
条款须在每次发布前人工确认。

常见错误：

- Vision Disabled：Settings 未启用；
- Awaiting API Key：未保存或 DPAPI 无法解密 key；
- Vision MIME / dimensions / 5 MB：本地预检拒绝；
- INVALID_ENDPOINT：URL 不是 http/https；
- HTTP_401/403：key、账户或 provider 不匹配；
- HTTP_404：endpoint/model 不存在；
- TIMEOUT：服务响应超过约 60 秒；
- EMPTY_RESPONSE：服务返回结构与兼容 chat/completions 不符。

完整排查见 docs/troubleshooting.md。
