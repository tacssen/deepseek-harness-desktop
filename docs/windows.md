# Windows 运行说明

## 进程和端口

Desktop 主进程通过 Electron 启动官方 dsh 的 web 子进程。启动时：

1. requestSingleInstanceLock 确保只有一个桌面实例；
2. 在 127.0.0.1 上申请空闲动态端口；
3. 优先查找系统 Node.js，失败时使用 Electron 的 Node runner；
4. 以当前 Workspace 为 cwd，设置 DSH_HOME 和受限的环境变量；
5. 等待回环 URL 返回，再将窗口导航到该 URL；
6. 退出时先发送优雅终止，超时才结束 Windows 进程树。

端口不是固定值，也不应写入文档或防火墙白名单。后端参数等价于：

    dsh web --host 127.0.0.1 --port <dynamic-port>

不要把此端口转发到 LAN、公网或反向代理。第三方插件若需要网络，应直接
遵循官方 dsh 配置和其服务条款。

## Windows 路径

应用通过 Electron app.getPath 动态获取 userData/documents/resources。常见
逻辑位置（不是固定绝对路径）：

- app.getPath('userData')：设置、加密凭据、日志、Vision cache 和
  Workbench checkpoint；
- app.getPath('documents')/DeepSeekHarnessWorkspace：默认 Workspace；
- Workspace/.dsh：官方 dsh home；
- process.resourcesPath/dsh-runtime/node_modules：打包后生产 dsh runtime。

在脚本、issue 和文档中使用 <repo>、<workspace> 或环境变量表示路径。不要
提交 <user-profile>、计算机名、真实桌面快捷方式或 AppData 目录。

应用可能在 Workspace/.dsh/node_modules 创建指向安装包 runtime 的 junction。
如果用户已经有一个真实 node_modules 目录，应用不会覆盖它；出现 junction
错误时先检查安装目录权限和 Workspace 是否可写，不要手工删除真实目录。

## 凭据和 DPAPI

Windows Electron safeStorage 以 DPAPI 加密 DeepSeek/Vision key。普通设置只
保存 preferences 与 base64 密文，Harness 的 settings.yaml 不含 key。渲染器
只能取得 configured/masked 状态。企业策略禁用 DPAPI 时，应用会拒绝保存
凭据并显示错误；不要通过修改源码强制改成明文。

可选的受控导入参数从 stdin 读取 key 后立即退出，适合自动化但不适合复制到
命令行历史：

    <electron-or-node-entry> --import-deepseek-key-stdin
    <electron-or-node-entry> --import-vision-key-stdin

将 stdin 连接到安全管道，完成后清理管道和日志。普通用户优先使用 Settings。

## Workspace 和 Shell

Workspace 是官方 dsh 的 cwd，也是桌面文件面板和 shared context 的根。设置
DSH_PERMISSION_MODE=workspace-write 时 Agent 可以在该根中写入；关闭
Allow shell 时使用 read-only。PowerShell 命令通过官方 pwsh tool 排队，
不是 Desktop 直接执行任意字符串。

这些设置不能替代操作系统隔离。Windows ACL backend 在官方 Harness 中标记为
partial；不要把密码库、SSH key、云凭据或整个用户主目录作为 Workspace。
在生产环境使用独立、最小权限的目录和测试账户。

## 进程和日志排查

- 任务管理器中预期看到一个 Desktop 进程和一个 dsh Node 子进程；
- 反复双击只应聚焦已有窗口，不应创建第二个后端；
- 日志目录可从 Settings → Open logs 打开，日志会尝试脱敏；
- 端口被占用通常可通过退出后重新启动解决，因为每次都会重新分配；
- 关闭窗口后检查 dsh 子进程是否退出；若只在超时后残留，记录脱敏日志并
  按 docs/troubleshooting.md 处理。

## 安装器和 SmartScreen

NSIS 默认 per-user，可选安装目录；portable EXE 不写入传统安装注册表。
如果构建没有代码签名证书，Windows SmartScreen 可能显示未知发布者。这是
本项目发行状态，不表示 DeepSeek 官方签名，也不应通过关闭安全软件解决。
