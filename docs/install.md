# 安装与开发

本页面向从源码 clone、验证和生成 Windows 安装包的用户。项目是官方
DeepSeek Harness 的第三方 Electron 封装；源码安装不会获得 DeepSeek 官方
桌面签名或支持。

## 前置条件

- Windows 10/11 x64；
- Node.js 22.19+（或 Node.js 24+）和 npm；
- Git、PowerShell；
- 首次安装时可访问 npm registry；
- DeepSeek API 账户。API key 由用户提供，不在仓库和安装包中。

以 <repo> 代表你选择的 clone 目录。不要把真实用户目录写入文档或 issue：

    git clone <repository-url> <repo>
    cd <repo>
    node --version
    npm --version

若 Node 版本不满足 package.json 或官方 dsh 的 engines，先切换到兼容版本，
再继续安装。

## 安装依赖和验证

    npm ci
    npm test
    npm run build

npm ci 使用 package-lock.json 的精确版本。npm run build 会执行 JavaScript
语法检查和构建前置文件验证，并确认官方 dsh 版本仍固定为
0.1.0-rc.6。不要用 npm install 后不提交 lockfile 的方式生成发布环境。

## 开发启动

    npm start

应用会获得单实例锁，创建或打开用户选择的 Workspace，在该 Workspace 的
.dsh 下写入不含凭据的 dsh 配置，然后选择一个空闲的 127.0.0.1 端口启动
官方 dsh Web。窗口只加载该回环地址；若端口或后端失败，先阅读动态日志
目录（Settings → Open logs）。

第一次使用：

1. 打开 Settings，输入 DeepSeek Base URL、模型和 key；
2. Test Connection；
3. 选择专用 Workspace，确认是否允许 Workspace-write shell；
4. 保存并等待后端重新 Ready；
5. 可选：启用 Vision bridge 并单独输入视觉服务 key。

key 不应通过 shell history、Git、普通环境变量或明文 JSON 保存。Settings
通过 Electron safeStorage/Windows DPAPI 加密；DPAPI 不可用时保存会失败。

## 生产依赖 staging

Electron 打包可能裁剪官方 dsh 的 peer dependencies。npm run dist 之前，
npm run prepare-runtime 会在 runtime-stage/ 中复制 package.json、锁文件和
vision-plugin，再执行：

    npm ci --omit=dev --no-audit --no-fund

生成的生产依赖树会在安装包 resources/dsh-runtime/node_modules 中作为官方
dsh 子进程运行时。runtime-stage 不包含 key；它是可重建产物，不要手工编辑
后发布。

## 生成 Windows 安装包

    npm run dist

该命令先运行 prepare-runtime，再调用 electron-builder 生成 x64 NSIS
安装器和 portable EXE。产物在仓库 dist/ 下，文件名含 package.json 版本、
x64 架构和目标类型。发布前：

- 在全新用户或测试账户中安装/运行一次 NSIS 和 portable；
- 通过 Settings 做最小 DeepSeek Connection，确认重启后凭据仍存在；
- 不把真实 key、Workspace、.dsh、.agents、日志或用户绝对路径打入 asar、
  runtime-stage 或安装包；
- 计算产物 SHA-256，并与发布记录一起保存；
- 阅读 THIRD_PARTY_NOTICES.md，确保 Electron/Chromium 和 sharp/libvips
  通知随包可访问；
- 说明安装包没有 DeepSeek 官方代码签名时 SmartScreen 可能显示未知发布者。

## 升级与回滚

升级官方 dsh、Electron 或生产依赖前：

1. 退出 Desktop，备份用户 Workspace、Workspace/.dsh 和重要 .agents 摘要；
2. 在干净工作树更新 package.json/package-lock.json；
3. 重新运行 npm ci、npm test、npm run build、npm run prepare-runtime；
4. 重新进行安装后验收、许可证审计和条款人工确认；
5. 若失败，恢复上一版本安装包和备份，不覆盖用户 Workspace。

不要将 RC/Developer Preview 升级描述为官方稳定版。应用不会自动迁移或
删除你的 Workspace。

## 卸载

Windows 设置 → 应用 → 已安装的应用中卸载 DeepSeek Harness Desktop，或在
安装目录使用卸载器。卸载前清除凭据并备份需要保留的 Workspace。安装器不应
替用户删除项目目录、.dsh 或 .agents；这些数据由用户按 PRIVACY.md 的清理
建议处理。
