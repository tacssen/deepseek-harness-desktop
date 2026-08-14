# DeepSeek Harness Desktop 安装与验收报告

验收日期：2026-08-15（Asia/Shanghai）

## 1. 结论与产品身份

- **Desktop Ready**：已安装可双击启动的 Windows 桌面应用，并创建桌面快捷方式。
- **DeepSeek Ready**：DeepSeek 凭据已通过 Windows DPAPI 加密保存；实际 API、官方 Harness 会话、文件工具与 PowerShell 工具均已通过测试。
- **Vision Awaiting API Key**：Vision Bridge、Settings、缓存、图片校验和 `vision_analyze` Agent 工具均已就绪；未配置 Vision Key 时不会影响 DeepSeek。
- 必须明确：DeepSeek 官方目前没有发布 DeepSeek Harness 的 Windows Desktop/EXE/MSI。当前应用是本项目制作的**独立 Electron 桌面封装**，内部启动并加载官方 DeepSeek Harness Web UI；它不是 DeepSeek 官方签名的“桌面版 DeepSeek”，也不是截图中无法核实来源的所谓 `Desktop 0.1.1`。
- 本封装没有把 Harness 改造成普通聊天软件。Workspace、文件读写、PowerShell/Shell、Tool Calling、多步骤 Agent、Skills/MCP 可扩展结构、上下文和官方 Web UI 均由官方 Harness 保留。

## 2. 官方项目核实

- 官方产品页：<https://www.deepseek.com/harness/en/>
- 官方源码：<https://github.com/deepseek-ai/deepseek-harness>
- 官方文档：<https://deepseek-harness.github.io/deepseek-harness/en/>
- 许可证：MIT。
- 官方状态：Developer Preview，可能发生不兼容变更。
- GitHub Releases/Tags：核实时没有正式 Release/Tag。
- 当前固定使用的官方 npm 包：`@deepseek-ai/dsh@0.1.0-rc.6`。
- 官方推荐 Web 启动方式：`npx @deepseek-ai/dsh web`，默认只监听回环地址。
- Windows 路径包含官方 PowerShell 工具及 Windows ACL sandbox 后端；官方文档将 Windows ACL enforcement 标为 `partial`，因此不能将其描述为完整的强隔离边界。

## 3. 环境与版本

- OS：Windows 11 家庭中文版，64 位，Build 26200。
- Git：`2.54.0.windows.1`。
- Node.js：`24.15.0`；符合官方 dsh 的 Node 版本要求。
- npm：`11.12.1`；pnpm：`11.19.0`。
- Python：`3.14.2`（本桌面封装主路径不依赖 Python）。
- WebView2：`151.0.4129.72` 已存在，未重复安装。
- Desktop shell：Electron `43.4.0`。
- Desktop wrapper 版本：`0.1.0`；官方 Harness 版本：`0.1.0-rc.6`。

## 4. 安装位置与启动方式

- 项目目录：`<user-home>\Documents\ChatGPT\学习\DeepSeekHarnessDesktop`
- 安装目录：`<user-home>\AppData\Local\Programs\DeepSeek Harness Desktop`
- 桌面快捷方式：`<user-home>\Desktop\DeepSeek Harness.lnk`
- 快捷方式目标：`<user-home>\AppData\Local\Programs\DeepSeek Harness Desktop\DeepSeek Harness Desktop.exe`
- 默认 Agent Workspace：`<user-home>\Documents\DeepSeekHarnessWorkspace`
- DSH Home：`<user-home>\Documents\DeepSeekHarnessWorkspace\.dsh`
- 用户配置：`<user-home>\AppData\Roaming\DeepSeek Harness Desktop\settings.secure.json`
- 日志：`<user-home>\AppData\Roaming\DeepSeek Harness Desktop\logs\desktop.log`
- Vision Cache：`<user-home>\AppData\Roaming\DeepSeek Harness Desktop\cache\vision`

双击桌面 `DeepSeek Harness` 图标即可启动。桌面壳会：

1. 获取单实例锁，避免重复 Desktop/后端。
2. 动态选择空闲的 `127.0.0.1` 端口，不绑定 `0.0.0.0`。
3. 在无长期 CMD/PowerShell 黑窗口的模式下启动官方 dsh Web 后端。
4. 等待 HTTP Ready 后加载官方 Web UI。
5. 正常退出时先终止子进程；只有超时才使用强制结束作为兜底。

实际双击验收时，进程统计为 1 个 Desktop 主进程和 1 个 dsh Node 后端；再次双击仍为 1/1。不同重启实际使用过 `58557`、`65418`、`63653` 等动态回环端口，证明没有写死默认端口。当前启动命令没有附加 `--no-sandbox`。

## 5. DeepSeek 配置状态

- Base URL：`https://api.deepseek.com`
- 默认模型：`deepseek-v4-flash`
- 可选模型：`deepseek-v4-pro`
- 当前官方 `/models` 实际返回并确认了以上两个模型 ID。
- 最小 Chat Completion 实际返回成功；官方 Harness 重启后会话路由实际为 `deepseek-official/deepseek-v4-flash`。
- API Key 通过 Electron `safeStorage` 在 Windows 上使用 DPAPI 加密保存。普通 JSON 中只有密文；Key 未写入源码、Git、README、本报告、Workspace 或日志。
- 精确明文扫描覆盖项目文本、应用配置/日志及 DSH Home，共扫描 7995 个文件，完整 Key 命中数为 0。

Settings 中提供：

- DeepSeek API Key（默认隐藏）
- Base URL
- 默认模型（Flash/Pro）
- Test Connection
- Workspace 路径与 Shell 权限
- Logs、Vision Cache、Debug

## 6. Vision Bridge 状态

当前默认配置：

- Enable：关闭（因此没有 Key 时不阻塞 DeepSeek）
- Provider：GLM / BigModel
- Base URL：`https://open.bigmodel.cn/api/paas/v4`
- Endpoint：`/chat/completions`
- Vision Model：`glm-4.6v-flash`
- Credential：未配置，状态为 `Awaiting API Key`

官方依据：<https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash>。Bridge 使用 Bearer 鉴权和官方多模态 `image_url` 消息结构；不会把图片发送给文本 DeepSeek 模型。

已实现：

- 独立 `vision_analyze` 官方 Harness 工具；DeepSeek 仍是主 Agent。
- 调用链：DeepSeek → 判断需要看图 → `vision_analyze` → GLM Vision → Vision Context → DeepSeek 继续推理/调用工具。
- 支持工作区图片、上传/粘贴后形成的 PNG/JPEG data URL，以及 Agent 主动调用。
- 图片预检：PNG/JPEG、20–6000 像素、每张不超过 5 MB。
- Cache Key 包含图片内容、prompt、provider、model 与 Base URL；缓存仅存视觉结果，不存原始图片。
- Vision Key 使用与 DeepSeek Key 相同的 DPAPI 加密机制。
- 没有 Vision Key 时，Agent 实际调用 `vision_analyze` 得到结构化 `Awaiting API Key`，随后 DeepSeek 仍完成当前回合。

明天启用 Vision 只需：

1. 双击桌面 `DeepSeek Harness`。
2. 菜单打开 `Settings`。
3. 在 `Vision Bridge` 中勾选 Enable。
4. 将 Vision API Key 粘贴到 API Key 字段。
5. 保持默认 BigModel Base URL 和 `glm-4.6v-flash`，点击 Save。
6. 如界面提示则重启应用，然后点击 Test Vision。

无需修改源码、JSON/YAML、环境变量或 PowerShell，也无需重新安装依赖。

## 7. 实际验收结果

### 构建与离线验证

- `npm test`：3/3 通过，0 failed。
- `npm run build`：语法检查与 9 个构建文件验证通过；固定 dsh 版本为 `0.1.0-rc.6`。
- `DSH_PROOF_RUNTIME=staged node scripts/prove-tool.cjs`：`routable=true`、`toolVisible=true`、`turnCompleted=true`。
- production runtime 使用 `npm ci --omit=dev` 独立 staging，并随包放入 `resources\dsh-runtime\node_modules`，避免 Electron 打包裁剪官方 dsh peer dependencies。

### Desktop / API / Agent

- 桌面快捷方式双击启动：通过。
- 后端自动启动并等待 Ready：通过；最新实测为 `http://127.0.0.1:63653/`。
- UI 连接官方 Harness Web：通过。
- 单实例/重复后端：通过；第二次双击仍只有 1 个主进程、1 个后端。
- 动态端口与回环绑定：通过。
- DeepSeek API Connection：通过；实际模型 `deepseek-v4-flash`。
- 重启后的凭据持久化：通过；重启后新建 Harness 会话，回合 `completed`，精确回复 `RESTART_PERSISTENCE_OK`。
- 普通对话：通过。
- 文件读取与创建：通过。
- 安全 PowerShell 命令：通过。
- 多步骤 Agent：通过；实际工具顺序 `read` → `write` → `pwsh` → `read`，输入文件保持不变，输出文件精确为：

  ```text
  step1=file-read-ok
  step2=shell-ok
  ```

- Vision 无 Key 不阻塞主体：通过；实际工具调用包含 `vision_analyze`，回合 `completed`，观察到 `Awaiting API Key`。
- 正常关闭：通过；关闭 UI 后 Desktop 和 dsh 子进程均退出，无残留。
- 日志泄密检查：通过；没有完整 API Key。

## 8. 安装包

- NSIS Installer：`dist\DeepSeek-Harness-Desktop-0.1.0-x64.exe`
  - 大小：193,246,042 bytes
  - SHA-256：`EBB12D4E88AE086B67978BE1B02D789C3F62D7166890BF3FE8209C0A6C24C743`
- Portable：`dist\DeepSeek-Harness-Desktop-0.1.0-portable.exe`
  - 大小：138,488,297 bytes
  - SHA-256：`4006EB12B5F249DE95EAB751A9D181CD9BE07F7B05D0CC2D7F2FF3E1C356078D`

安装包未使用 DeepSeek 官方代码签名证书；Windows SmartScreen 可能显示未知发布者。这不改变其内部固定加载官方 npm dsh 的事实，但必须与“DeepSeek 官方桌面发行版”区分。

## 9. 已知问题与恢复

- 官方 Harness 仍是 Developer Preview/RC；升级前应先备份 Workspace 与 AppData，并重新跑本报告中的验收。
- 官方 Windows ACL sandbox enforcement 为 `partial`；应只给受信任 Workspace，不要把个人主目录或敏感目录作为 Agent Workspace。
- Vision 尚未进行真实 Provider 推理测试，唯一原因是当前没有 Vision API Key；所有无 Key 的本地调用链已经验收。
- 日志中保留过一次早期打包缺少模块的历史失败记录；production runtime staging 修复后，后续多次启动均 Ready，当前实测没有再次出现该错误。
- 若后端启动失败：先退出应用，检查 `desktop.log`，确认 Node.js 仍可用，然后重启。
- 若端口被占用：直接重启，封装会重新选择空闲回环端口。
- 若配置损坏：先备份 `settings.secure.json` 和 `<workspace>\.dsh`，再通过 Settings 重置；不要把密文复制到公开报告。
- 卸载：Windows 设置 → 应用 → 已安装的应用 → DeepSeek Harness Desktop。卸载前可在 Settings 清除凭据；Workspace 不应在未备份时删除。

