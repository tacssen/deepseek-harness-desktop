# 架构

## 组件图

    Electron main process
      ├─ SecureStore (safeStorage / DPAPI)
      ├─ VisionBridge ──> SiliconFlow or BigModel HTTP API (optional)
      ├─ WorkbenchService
      │    ├─ SharedContextService ──> Workspace/.agents
      │    ├─ chokidar watcher ──> Workspace changes
      │    └─ CodexAppServerClient (read-only, optional)
      ├─ BrowserWindow + preload (sandboxed renderer)
      └─ dsh child process
           └─ official DeepSeek Harness Web/API
                └─ DeepSeek API / official tools / MCP / Skill

Desktop 和 dsh 通过本机动态 127.0.0.1 端口的 HTTP RPC 通信。Vision tool
属于 Agent preset 扩展，不是主机权限插件。用户 Workspace 是共享真实目录，
不是应用内部复制品。

## 启动序列

1. Electron 请求 single-instance lock；重复启动只聚焦已有窗口；
2. 创建 Logger、SecureStore、VisionBridge 和 WorkbenchService；
3. 读取并合并偏好，解密 key（若 DPAPI 可用）；
4. 准备 Workspace/.dsh，保留可解析的用户设置，写入不含 key 的
   settings.yaml、cordis.patch.yml 和桌面 Agent preset；
5. 选择动态端口，设置 DSH_HOME、DSH_DESKTOP、DSH_PERMISSION_MODE、
   DEEPSEEK_BASE_URL 等环境变量；
6. 启动官方 dsh web，等待回环 HTTP ready；
7. 创建 sandboxed BrowserWindow，并让 WebContentsView 加载回环 UI；
8. Workbench 通过官方 session/skill/history RPC 生成工作台 snapshot。

退出时 Workbench 关闭 watcher、释放 shared lock，dsh 先 SIGTERM；仅在约
5 秒超时后 Windows 才强制结束子进程树。

## 数据平面

### DeepSeek Agent

用户提示词由官方 dsh 管理 session、tool call、goal/plan、MCP 和 Skill。
Desktop 只提供 workspace cwd、UI 状态、Settings 和少量 RPC/command
桥接，不替换官方 Agent loop。

### Workspace

工作区根限制文件列表、引用、附件和差异回滚；ignored 目录包括 .git、
.dsh、node_modules、dist、runtime-stage。外部文件作为附件复制到
.harness-desktop/attachments；Workspace 内文件按相对路径引用。

### Vision

VisionBridge 在主进程做 key 访问、图片预检、包含图片/提示词/provider/model 的 SHA-256 cache key、60 秒
超时和响应提取。Agent tool 输入图片到 provider 的 JSON 请求；结果不会
写回 DeepSeek settings。图片原文不写入 Vision cache，但发送后由服务方
按其策略处理。

### Shared Project Context

SharedContextService 将 handoff、tasks、decisions、tests 和状态原子写入
Workspace/.agents，使用 advisory lock 保护双 Agent。CodexAppServerClient
只读精确 cwd 的官方线程，失败时降级为文件 handoff。

## 安全边界

- Renderer：contextIsolation=true、nodeIntegration=false、sandbox=true；
- 主机与后端：127.0.0.1 动态端口，不监听 0.0.0.0；
- 凭据：safeStorage/DPAPI 加密，渲染器只能收到掩码；
- Workspace：相对路径校验和有限附件大小；Shell 权限由用户开关；
- 官方 sandbox：Windows ACL 为 partial，不能当完整隔离；
- 外部服务：DeepSeek、SiliconFlow、BigModel、MCP 和 Web 工具各自有网络
  信任边界和条款；
- 项目文件：.agents/内容视为不可信提示上下文，不能覆盖 runtime 事实。

## 构建平面

npm run build 只做语法和必需文件校验。npm run prepare-runtime 使用
npm ci --omit=dev 生成 production-only dsh runtime，避免 Electron asar
裁剪 peer dependencies。electron-builder 把它放入 resources/dsh-runtime；
应用在打包时优先选择该树，开发时使用仓库 node_modules。

生产 bundle 还可能包含 Electron/Chromium 和 sharp/libvips 二进制；许可证
和 notices 见 THIRD_PARTY_NOTICES.md。构建不会注入 key，也不会自动上传
产物或创建远程仓库。
