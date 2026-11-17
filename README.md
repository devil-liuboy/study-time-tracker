# 学习时长统计系统

面向 Windows 10/11 x64 的个人学习时间记录工具。统计 Codex 等 AI 应用、Zotero、Obsidian、VS Code 等软件，以及明确允许的学习网站的**前台使用时间**。数据保存在本机，不提供账号、云同步或遥测。

它记录的是符合规则的电脑使用时间，不能判断学习效果，也不统计 Agent 在后台推理或执行任务的耗时。

## 安装和开始使用

1. 从 [GitHub Releases](https://github.com/devil-liuboy/study-time-tracker/releases) 下载 Windows x64 ZIP，完整解压到一个文件夹。不要直接在压缩包内运行。
2. 双击 `Install.cmd`。安装到当前用户的 `%LOCALAPPDATA%\Programs\StudyTimeTracker`，创建桌面快捷方式，并设置登录后自动启动。无需管理员权限。
3. 安装完成后会打开程序。首次启动会扫描已安装应用的快捷方式、卸载注册表和有限的常见安装目录，自动启用已找到的核心学习应用。到“学习软件”页检查名单；其他候选软件默认不启用，可扫描后自行勾选，也可手动选择 `.exe`。
4. 在“学习网站”页检查学习网站白名单，按需要增删；按下面步骤安装浏览器扩展，网页时间才会参与统计。
5. 关闭主窗口会收起到系统托盘，继续统计。托盘菜单提供打开面板、暂停/恢复和退出。

界面使用 Microsoft Edge WebView2。若系统缺少运行环境，请先安装微软提供的 [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。ZIP 内没有捆绑 WebView2 安装器。

`Install.cmd` 仅以当前用户运行随包的 PowerShell 安装脚本，执行策略选项仅对这一次进程有效。安装脚本不会强制结束运行中的程序；更新前请先从托盘退出。重复安装覆盖本版本文件，不递归删除安装目录，也不删除学习记录。发布包目前未做代码签名，Windows 可能显示来源确认提示。

也可以不安装，直接运行解压后的 `StudyTimeTracker.exe`。首次启动仍会按默认设置启用登录自启；若使用此方式，请保留该目录，或在设置中关闭自启。

## Chrome / Edge 浏览器配对

要求 Chrome 或 Microsoft Edge 120 及以上版本。两个浏览器需要分别安装、配对。

1. 打开 `chrome://extensions` 或 `edge://extensions`，自行开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择安装目录中的 `_internal\extension`。默认完整路径为 `%LOCALAPPDATA%\Programs\StudyTimeTracker\_internal\extension`。
3. 在桌面程序的设置中找到浏览器配对码，复制到扩展弹窗，点击“保存并连接”。
4. 扩展显示“已连接本机”后，将一个白名单网页切到前台，在桌面面板查看当前状态。无需刷新现有标签页。

扩展只向 `127.0.0.1:47831` 报告当前活动标签页的域名与窗口状态。配对码保存在浏览器本地，不通过浏览器账号同步；不要公开配对码。扩展不向网页注入脚本，不读取网页正文。Windows 端还会核对当前前台浏览器进程，防止把后台标签页计为学习时间。

浏览器会根据自身策略提示开发者扩展；若扩展被禁用、移除或断开，网页统计会停止。程序不会替你开启浏览器开发者模式。详细协议和权限说明见 [扩展说明](extension/README.md)。

## 统计规则

| 情况 | 处理方式 |
|---|---|
| 当前获得系统焦点的学习软件 | 计入该应用；其他可见窗口和后台进程不叠加 |
| Chrome / Edge 当前前台标签页属于启用的网站白名单 | 计入该网站；还需扩展已配对且最近报告未超时 |
| 最近一次键盘或鼠标输入后不足 180 秒 | 暂计这段时长，等待后续输入确认 |
| 连续 180 秒没有键盘或鼠标输入 | 丢弃这段未确认时间，相当于回扣此前三分钟；继续空闲不累计 |
| 不足三分钟内恢复输入 | 确认之前符合应用/网站规则的暂计时间 |
| 锁屏、手动暂停或不可读取前台窗口 | 暂停统计 |
| 休眠、程序暂停或两次采样相隔超过 5 秒 | 不补记中间空档，并丢弃未确认尾段 |
| 退出程序或异常结束 | 已确认记录保留；最后一次输入后的未确认尾段不保留 |
| Bilibili、YouTube 等明确排除的视频站点 | 不计时，不能加入学习白名单 |

“最顶层”以 Windows 当前获得焦点的窗口为准。在多显示器上，看得见但未获得焦点的窗口不计入。窗口置顶、后台运行或模型仍在生成内容，都不改变这条规则。

例如：最后一次操作在 10:00，随后静止阅读。10:02 时这两分钟仍是“待确认”；若 10:02:30 再次操作，会确认之前的合规时间。若一直没有操作直到 10:03，则此前这三分钟被回扣，之后继续不累计。只用键盘编码同样属于有操作。

所有日期、日界线、周/月报表和 CSV 使用北京时间（UTC+8）。跨午夜的区间会按自然日拆分。界面区分已确认与待确认时间；CSV 只导出已确认记录，不含尚可能回扣的待确认部分。

## 应用、网站和报表

### 图表概览（1.1.1）

- **今日**：圆环饼图展示自动记录的时间组成，可按应用／网站来源或学习分类查看；图例同时显示时长与占比，较小来源合并为“其他”。
- **本周／本月**：按北京时间自然日显示柱状图，突出今天，未到来的日期保留空位；同时显示日均时长、最高一天和有记录天数。日均以已经过的自然日（含今天及零记录日）计算。
- **统计口径**：圆环只展示自动记录，手动补记和扣减单独列出；柱状图和总计包含手动修正。待确认部分会明确标注，仍遵循三分钟空闲回扣规则。

布局参考 [Toggl Summary Report](https://support.toggl.com/en-us/article/summary-report-1emjk2m/) 和 [Clockify Summary Report](https://clockify.me/help/reports/summary-report) 的时间趋势与组成分布展示方式；图表、代码和视觉样式由本项目独立实现，不加载第三方图表服务。

- 核心应用候选包括 Codex、Claude、Cursor、Antigravity、OpenCode、WorkBuddy、Cherry Studio、VS Code、PyCharm、IntelliJ IDEA、Eclipse、Dev-C++、Zotero、Obsidian。只有实际找到的可执行文件会加入，不代表每台电脑都装有这些应用。
- 从 1.1.2 起，自动发现推荐 WPS PDF、文字、表格、演示，以及 Readest、Adobe Acrobat/Reader、Foxit/福昕、SumatraPDF、PDF-XChange、PDFgear、UPDF、Xodo、Okular、CAJViewer 等阅读软件。WPS 按整个模块的前台时间计入，包括文字编辑、表格和演示；不读取文档内容，也不判断是否正在看 PDF。
- WPS 数字版本目录升级后可继续匹配同一安装根目录内的同一模块，重新扫描时优先显示最新路径。Microsoft Office、终端、虚拟机等仍是可选候选，默认不启用。
- 自动发现只列出实际存在且识别成功的可执行文件；便携版或未识别的 PDF 工具可以手动添加。老用户在“学习软件 → 自动发现”中添加新推荐项，已有停用选择会保留。浏览器仍按网站白名单统计，不因能够打开 PDF 而整机启用。
- 默认提供 19 个学习网站规则，涵盖 arXiv、GitHub、Hugging Face、学术检索、技术文档和 AI 对话。白名单可以修改；一个域名规则同时包含其子域名，并汇总到该规则。例如 `github.com` 不会匹配 `github.com.example.org`。
- 今日、本周、本月与自定义日期报表展示总量、应用/网站分类和趋势，并支持 CSV 导出。
- 手动修正以独立的增减记录保留，可撤销。它不会改写自动记录；修正后的单日已确认总量须在 0～24 小时之间。补记日期不能晚于北京时间今天，自定义报表也只查询已经到来的日期。

## 本机数据与隐私

| 位置 | 用途 |
|---|---|
| `%LOCALAPPDATA%\Programs\StudyTimeTracker` | 程序及浏览器扩展 |
| `%LOCALAPPDATA%\StudyTimeTracker\activity.sqlite3` | 已确认区间、来源名称、分类和手动修正 |
| `%LOCALAPPDATA%\StudyTimeTracker\settings.json` | 本机应用路径、启用状态、网站白名单 |
| `%LOCALAPPDATA%\StudyTimeTracker\browser-token.txt` | 本机浏览器配对码 |
| `%LOCALAPPDATA%\StudyTimeTracker\webview` | 桌面界面的本地运行文件 |

程序读取前台进程路径和系统最后输入时间，不记录键盘输入内容、鼠标轨迹、窗口标题、文档内容、网页正文或完整 URL。扩展把当前域名发送到本机；非白名单域名仅参与当前状态判断，不作为浏览历史持久化。白名单统计会保存对应网站规则名称。

GitHub 同步范围是源代码、通用配置和发布文件。个人应用清单、SQLite 数据、配对码、导出 CSV 和浏览器运行数据不应提交到仓库，相关路径已列入 `.gitignore`。项目不提供遥测、广告或远程数据上传功能。

备份时先从托盘退出程序，再复制整个 `%LOCALAPPDATA%\StudyTimeTracker` 数据文件夹；SQLite 运行时可能存在 WAL 辅助文件，直接复制单个正在写入的数据库不适合作为可靠备份。更新程序与学习数据目录相互独立。

卸载时先在设置中关闭登录自启，再从托盘退出，移除 Chrome/Edge 扩展并删除桌面快捷方式、程序目录。学习数据不会自动删除；如需清除记录，可自行删除上述独立数据目录。

## 已知边界

- 白名单只能确认网站，不能判断用途。AI 网站闲聊、GitHub 非学习内容也会计入；可用托盘暂停排除。域名判断无法识别允许网页内嵌的视频。
- 静止阅读超过三分钟会被回扣。这是所选统计规则，不代表这段时间没有实际学习。
- 仅支持当前 Windows 用户的桌面会话、Windows 10/11 x64 和 Chrome/Edge 扩展协议。未识别的软件或浏览器、无痕窗口、内部设置页、`file://` 本地文件页不计入网页时间。
- 在线 PDF 的标签页地址仍为 HTTP(S) 时，可通过域名参与统计；无法取得有效地址时不计时。
- 桌面约每秒采样、浏览器正常约每两秒上报，因此切换边界不是毫秒级测量。前台浏览器窗口改变后，需要收到新报告才恢复网页统计。
- 浏览器心跳超过 5 秒即停止认定网页。浏览器/扩展恢复后可能等待下一次 30 秒恢复检查，浏览器自身进一步延迟检查时可能更长；不补记空窗期。
- 自动扫描范围有限，便携软件、非标准安装位置或软件升级后的路径变化可能需要手动添加。无法读取的受保护前台进程会保守不计时。
- 系统最后输入时间能判断“有输入”，不能可靠判断输入来自真人还是自动化工具。本程序不尝试识别或拦截模拟输入。

## 从源码运行

要求 Windows 10/11 x64、Python 3.10 或以上、WebView2 Runtime。Node.js 仅用于扩展和图表自动测试，不是最终桌面程序的运行依赖。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe main.py
```

隔离测试数据且不修改登录自启：

```powershell
.\.venv\Scripts\python.exe main.py --data-dir .\local-data\smoke
```

`--background` 用于启动时完全隐藏主窗口，只保留系统托盘图标并继续统计；托盘菜单中的“打开统计面板”才会显示窗口。正式运行与隔离测试使用不同单实例锁，但共用本机浏览器端口；进行浏览器集成测试前应退出另一个实例。

## 测试与构建

```powershell
.\.venv\Scripts\python.exe -m pytest -q
node --test extension/tests/protocol.test.mjs extension/tests/background.test.mjs
node --test tests/*.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -Python .\.venv\Scripts\python.exe -SkipInstall
```

`build.ps1` 生成 PyInstaller onedir 程序 `dist\StudyTimeTracker` 和 `dist\StudyTimeTracker-<版本>-windows-x64.zip`。使用显式的网页/扩展文件清单打包，不包含源码测试、个人设置或学习数据库。未传 `-SkipInstall` 时，会先向指定 Python 环境安装 `requirements-dev.txt` 中的依赖。

构建会覆盖本项目 `dist\StudyTimeTracker` 中的旧构建产物。安装脚本可用 `-ValidateOnly` 检查目标路径和包结构而不执行安装，或用 `-NoLaunch` 安装后暂不启动。

GitHub Actions 在 Windows 上运行 Python、扩展与图表自动测试；手动触发或推送 `v*` 标签时额外构建 ZIP，并作为 workflow artifact 保存。工作流不会自动启用浏览器开发者模式或在用户电脑上安装程序。

自动测试覆盖空闲回扣、采样中断、日期拆分、统计修正、域名校验、浏览器认证及扩展状态处理等逻辑。通过这些测试不等同于完成真实 Windows 应用切换、锁屏/恢复、浏览器安装和登录自启的端到端验证；请以具体发布说明中的实测记录为准。

## 许可证

项目代码采用 [MIT License](LICENSE)。第三方依赖保留各自许可证；构建包保留主要运行依赖的包元数据与许可文件。
