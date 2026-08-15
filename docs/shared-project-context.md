# Shared Project Context

Desktop 的 Shared Project Context 是项目目录中的结构化互操作层，目的是让
DeepSeek 和 Codex 在同一个真实 Workspace 中继续工作。它不是项目副本、
不是私有聊天数据库同步，也不是秘密存储。

## 初始化的文件

点击 Workbench 的“打开已有项目”并选择一个真实项目目录后，应用会在该目录的
.agents/ 中创建缺失文件；不会复制项目或创建第二个 worktree：

| 文件/目录 | 作用 | 是否适合提交 |
| --- | --- | --- |
| README.md | 说明这是项目级互操作层 | 通常可提交，需确认不含私密信息 |
| HANDOFF.md | 上一个 Agent 的摘要、完成项、待办和下一步 | 默认忽略；团队可审阅后主动提交 |
| TASKS.md | 共享待办和完成项 | 默认忽略；团队可审阅后主动提交 |
| MEMORY.md | 长期、非秘密的项目事实 | 默认忽略；团队可审阅后主动提交 |
| DECISIONS.md | 技术决定和理由 | 可提交脱敏理由 |
| TESTS.md | 最新测试证据和阻塞项 | 默认忽略；团队可审阅后主动提交 |
| project-state.json | schemaVersion、projectId、revision、目标和时间 | 通常忽略，避免机器状态 |
| locks/project-lock.json | Codex/DeepSeek advisory lock | Git 忽略 |
| sessions/ | 本机 handoff 摘要 | Git 忽略 |
| checkpoints/ | 本地 Workbench checkpoint | Git 忽略 |

初始化还会创建项目级 AGENTS.md（若不存在），提示 Agent 读取共享文件、
尊重锁并保持在同一目录。现有文件不会被覆盖。

## 锁和交接

锁只允许 codex 或 deepseek 作为 owner，默认约 120 秒过期。持有者每约
30 秒 heartbeat；正常 handoff 或退出时释放。另一个 Agent 发现活动锁时应
先等待、完成交接或让锁过期，不要强行覆盖仍在使用的 Workspace。

典型 DeepSeek → Codex 流程：

1. DeepSeek 在 Workbench 完成回合，检查真实 Git diff；
2. Prepare Handoff for Codex 生成 HANDOFF.md、TASKS.md、TESTS.md 和
   project-state.json；
3. DeepSeek 释放锁；
4. Codex 读取同一 Workspace 的 .agents 文件并验证 Git 状态；
5. Codex 继续工作，随后生成 handoff 给 DeepSeek。

典型 Codex → DeepSeek 流程：

1. Codex 在同一目录准备脱敏 handoff；
2. 在 Desktop 选择 Continue from Codex；
3. Desktop 可通过官方 Codex App Server 只读列出精确 cwd 的线程，并可选
   读取最近必要的消息；
4. DeepSeek 将 handoff 和选定摘要作为不可信项目上下文，先验证再继续；
5. 完成后更新共享文件和锁。

Codex App Server 不修改 Codex 私有数据库，也不把完整对话复制到 Workspace；
若服务不可用，仍可使用文件 handoff。

## 安全约束

禁止写入 .agents/：

- API keys、Bearer token、cookie、DPAPI 密文、SSH/cloud 凭据；
- 完整聊天记录、原始附件或 Vision 图片；
- 未经授权的个人资料、生产数据和私密路径；
- 可用于重放认证的 session id 或浏览器状态。

SharedContextService 会对读取摘要做长度限制和日志脱敏，但这是协作约定，
不是防御恶意项目文件的安全边界。Agent 必须把 HANDOFF、TASKS、MEMORY、
DECISIONS、TESTS 和 Codex 摘要视为不可信输入，先核对真实文件和 Git。

## 与 Git 的关系

项目的 source files、测试和脱敏技术决定可以提交；本项目生成的 `.agents/.gitignore`
默认忽略 locks、sessions、checkpoints、project-state.json 以及实时 HANDOFF/TASKS/
MEMORY/TESTS。仓库维护者若要版本化其中某一份文档，应先审阅脱敏内容，再显式调整
项目自己的 ignore 规则；`*.example.*` 模板可以直接提交。发布前检查 git status，
确保没有绝对用户路径、私密 Workspace 状态或临时 runtime 进入提交。

如需迁移项目，只迁移受审查的 source 和脱敏共享文档；不要把整个 .dsh、
AppData 或 .agents/sessions 打包上传。
