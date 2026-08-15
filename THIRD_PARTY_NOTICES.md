# Third-Party Notices

本文件是当前仓库发布前的依赖许可证审计摘要。它不改变任何上游许可证，
也不是法律意见。每次修改 package.json、package-lock.json、vision-plugin、
Electron 构建配置或 production runtime staging 后，都必须重新审计。

## 项目和官方 Harness

- 本桌面封装代码：MIT，见仓库 LICENSE；
- 官方 DeepSeek Harness 与当前固定 npm dsh 包：MIT。上游源码和许可证：
  https://github.com/deepseek-ai/deepseek-harness
- 本项目是第三方 Windows Electron 封装，不得把上游 MIT 或本文件理解为
  DeepSeek 官方桌面发行许可、商标授权或服务承诺。

## 审计范围和方法

审计基线是当前 package-lock.json（lockfileVersion 3）以及本仓库本地
vision-plugin/package.json 的 license 字段。生产集按 npm ci --omit=dev
语义读取 lockfile 中未标记 dev/devOptional 的记录；optional platform
包虽然可能不会在当前主机安装，但仍计入通知检查。当前快照包括：

- 587 个 registry package 记录；
- 1 个本地 link package：@deepseek-harness/vision-plugin，MIT；
- 245 个 dev/devOptional 记录未计入生产闭包；
- 生产闭包中没有发现 GPL-only、MPL 或 AGPL 包，但发现 LGPL-3.0-or-later
  与多个双重许可证表达式；发布人必须保留这些通知并遵循其条件。

按 lockfile license 字段聚合（同一包的不同嵌套/平台版本分别计数）：

| 声明 | 记录数 | 发布注意 |
| --- | ---: | --- |
| MIT | 465 | 保留版权和 MIT 条款；包括官方 dsh 包和本桌面依赖的大多数包；另有 1 个本地 MIT link 包 |
| Apache-2.0 | 76 | 保留 NOTICE（如包提供）及许可证文本 |
| BSD-3-Clause | 17 | 保留版权、条件和免责声明 |
| ISC | 11 | 保留 ISC 条款 |
| LGPL-3.0-or-later | 10 | 平台 libvips optional 包；保留 LGPL 文本和可替换/对应源码义务评估 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 | sharp Windows/macOS/其他平台包；两套条件同时适用 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 | sharp WASM optional 包；三套条件同时适用 |
| BSD-2-Clause | 2 | 保留 BSD-2 条款 |
| Python-2.0 | 1 | argparse；保留其许可文本 |
| 0BSD | 1 | tslib；保留 0BSD 文本 |

这些数字来自 lockfile 的元数据，不等于安装器中最终可执行代码的字节数。
Windows x64 重新安装通常只选择当前 CPU/OS 的 optional sharp 包，但跨平台
lockfile 记录仍不能被删除或忽略。

## 直接生产依赖

| 包 | 版本（来自 package.json） | 许可证 |
| --- | --- | --- |
| @deepseek-ai/cordis-plugin-group | 1.0.1 | MIT |
| @deepseek-ai/dsh 及其官方 dsh-* closure | 0.1.0-rc.6 | MIT（以上游包声明为准） |
| @deepseek-harness/vision-plugin | file:vision-plugin | MIT |
| chokidar | 4.0.3 | MIT |
| sharp | 0.35.3 | Apache-2.0 |
| yaml | 2.9.0 | ISC |
| zod | 4.4.3 | MIT |

官方 dsh closure 还会拉入 Cordis、Cosmokit、React、OpenAI/其他模型适配器、
OpenTelemetry、express 等运行时包；不能只看上表就认为其传递依赖全部是 MIT。
锁文件及每个已安装包目录中的 LICENSE/NOTICE 是具体版本的权威证据。

## 需要特别保留的通知

### Electron

electron 43.4.0 的 npm 包声明 MIT。Electron 发行物还包含 Chromium、Node.js、
V8、BoringSSL、FFmpeg 等组件，每个组件有自己的版权和许可证。发布安装包时
应保留 Electron/Chromium 生成的 LICENSES.chromium.html、chrome://credits
信息或官方提供的等价 notices，不要只复制本项目 LICENSE。

- Electron 许可证和分发文档：
  https://github.com/electron/electron/blob/main/LICENSE
- Electron 官方发布说明：
  https://www.electronjs.org/docs/latest/tutorial/application-distribution

### sharp / libvips

sharp 0.35.3 本身声明 Apache-2.0；平台 @img/sharp-libvips-* 记录声明
LGPL-3.0-or-later，Windows x64 的 @img/sharp-win32-x64 声明
Apache-2.0 AND LGPL-3.0-or-later。NSIS 和 portable 构建都可能携带这些
二进制，因此发布包必须附带 LGPL 文本、版权信息，并由发布人确认是否需要
提供对应源码/可重新链接方式。不要把“npm optional dependency”当作免除
义务的理由。

- sharp 项目及许可证：
  https://github.com/lovell/sharp
- libvips 项目及许可证说明：
  https://github.com/libvips/libvips

### 官方 dsh 和本地插件

官方 dsh npm 包从上游 DeepSeek Harness 发布；本地
@deepseek-harness/vision-plugin 是本仓库 MIT 代码，依赖官方 dsh peer
接口。Vision plugin 不复制或重新发布 SiliconFlow/BigModel 的 SDK。

## API 服务不是 bundled SDK

SiliconFlow 和 BigModel（智谱开放平台）在本项目中只是用户配置的 HTTP API
服务端点。仓库不捆绑它们的客户端 SDK、模型权重或服务条款。用户主动输入
的 key、prompt、图片和响应会按各服务协议传输；每次发布前由维护者人工
确认最新的服务条款、隐私政策、地域/数据保留和商用条件，并在变更时更新
PRIVACY.md 与 docs/vision.md。

## 发布者操作清单

1. 在干净工作树执行 npm ci --omit=dev 或 npm run prepare-runtime；
2. 读取 node_modules 中实际安装版本的 package.json、LICENSE、NOTICE；
3. 检查 Windows x64 optional sharp/libvips 和 Electron/Chromium notices；
4. 将本文件、上游许可证及适用 NOTICE 放入源代码和安装包可访问位置；
5. 重新运行测试、打包、敏感信息扫描和安装后启动验收；
6. 记录 lockfile 哈希、Node/npm/Electron 版本和审计日期。不要记录用户名、
   API key、Workspace 内容或绝对路径。

依赖许可证表达式可能比 npm license 字段更复杂；发布前如遇 “SEE LICENSE
IN …”、未知 SPDX、二进制只读包或许可证冲突，应暂停发布并进行人工/法律
审查。
