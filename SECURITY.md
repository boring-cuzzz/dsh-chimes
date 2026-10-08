# 安全说明

## 报告安全问题

如果你发现安全漏洞，请**不要**开公开 issue。

优先用 GitHub 的 [Private vulnerability reporting](../../security/advisories/new)
（仓库 Settings → Security → Advisories 里开启）；如果不可用，就在 issue 里只写一句
"requesting a private channel"，不要附 PoC。

我会在确认后于修复版本中致谢（除非你希望匿名）。

## 本插件的攻击面（经审查，非声明）

以下结论来自对源码的**穷举模式扫描**，而不是"看起来没问题"：

| 检查项 | 结论 |
|---|---|
| 网络行为 | **零**。无 `fetch` / `http(s)://` / `node:http` / `WebSocket` / `Invoke-WebRequest` / `curl` |
| 凭据访问 | **零**。不读 API key、token、cookie、凭据文件；不做任何遥测或上报 |
| 子进程环境 | 播放进程只拿到 **4 个变量**（`SystemRoot`、`windir`、`PATH`、`DSH_CHIME_WAV`），DSH 主进程里的模型 API key **不会**被传递过去 |
| 可执行文件来源 | 播放器用**绝对路径** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`，不查 `PATH`（天然免疫 PATH 劫持） |
| 命令注入 | 音频路径通过**环境变量**传入，脚本内只做变量展开，无字符串拼接求值、无 `iex`/`eval`/`cmd /c` 拼接 |
| 依赖 | **零运行时依赖**（无 `dependencies`、无 `node_modules`） |
| 构建脚本 | **无** `preinstall`/`install`/`postinstall`/`prepare`，因此安装时不会执行任意代码 |
| 注册表/系统 | **不写注册表、不装服务、不加自启、不改系统策略** |
| 文件系统 | 只**读**音频文件；只**追加写** `$DSH_HOME\{startup,done}-chime.log`（超 64 KB 自动清空） |
| 子进程生命周期 | 播放进程**不加 `detached`**（既是功能要求，也避免脱离父进程监管后继续存活） |

## ⚠️ 使用者必须知道的一件事：DSH 插件的权限边界

**DSH 插件的宿主代码运行在 DSH 进程内部，不受工作区沙箱限制。** 也就是说，任何插件
（包括本插件）理论上都能读写你的任意文件、发起网络请求。

- 这是 **DSH 插件体系的通用性质**，不是本插件特有的风险；
- 本插件的行为边界如上一节所列，你可以在几秒内读完 `lib/` 下全部代码自行验证；
- 由此推导出的实用建议：**安装任何第三方插件前，先看一眼它的代码**，并优先选择
  零依赖、无 `postinstall` 的包。

## 支持范围

- **仅 Windows**（依赖 .NET 的 `System.Media.SoundPlayer`）；
- 失败时**不会**影响 DSH 本身：播放失败只写日志，agent 循环不受影响（事件处理器整体
  包裹在 try/catch 中）。
