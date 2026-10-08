# dsh-chimes

[English](README.md) | 中文

给 **DeepSeek Harness 桌面版**加两个音效：**打开软件时**播一次开场音，**每轮任务完成时**播一次提示音。

![platform](https://img.shields.io/badge/platform-Windows-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![assets](https://img.shields.io/badge/assets-CC0-lightgrey)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

> 仓库**自带 6 个用 ffmpeg 合成的示例音效**（CC0，可自由使用与再分发），并且支持**你自己的音频** ——
> 面板里有下拉菜单可以随时切换。仓库刻意不收录任何来源不明的第三方素材，原因见
> [音效与版权](docs/音效与版权.md)。

---

## 它做什么

| 音效 | 触发时机 | 说明 |
|---|---|---|
| **开场音** | 打开桌面版、窗口即将渲染时 | 只在 `desktop` profile；每次启动一次，插件热重载/刷新界面**不会**重播 |
| **完成音** | 每轮对话正常结束时 | 只在**用户会话**；**子代理/委派会话结束不会响**；报错或中断不响 |

两者都是**宿主侧**播放（通过 Windows 的 `System.Media.SoundPlayer`），所以：

- **不需要窗口在前台** —— 你可以去干别的事，任务跑完照样能听到；
- 不受浏览器自动播放策略影响（这也是不用 Web Audio 方案的原因）。

## 环境要求

- **Windows**（依赖 .NET 的 `Media.SoundPlayer`）
- **DSH 桌面版**（profile 名 `desktop`），已至少启动过一次
- PowerShell 5.1+（系统自带）
- `ffmpeg` —— **仅当你需要转码时**（音效本来不是 PCM WAV 才需要）；也可以用脚本外自己转好

## 安装

### 方式一：一条命令（推荐）

```powershell
# 把 boring-cuzzz 换成你的 GitHub 用户名
dsh plugin --profile desktop add github:boring-cuzzz/dsh-chimes
```

> 若 Git 地址安装失败（网络/代理原因），改用方式二，效果一样。

### 方式二：本地路径

```powershell
git clone https://github.com/boring-cuzzz/dsh-chimes.git
dsh plugin --profile desktop add .\dsh-chimes
```

### 装完之后

1. **彻底退出 DSH，再重新打开** → 应该听到开场音；
2. 随手问一句话，等回复结束 → 应该听到完成音。

两个音效默认用的是仓库里的占位音（`assets/sample-*.wav`）。**换成你自己的**见下一节。

## 控制面板与音效库

装好后在 **侧栏「插件」页 → Chimes**（部分核心在 **设置 → 插件**）里操作，完全不用碰命令行：

| 控件 | 作用 |
|---|---|
| **开场音 / 完成音 开关** | 独立启停，**实时生效**，不用重启 |
| **音效库下拉菜单** | 在「自带示例」（6 个 CC0 音效）与「我的音效」之间切换 |
| **试听** | 走**真实播放链路**放一遍（不是浏览器里模拟） |
| **选择音频…** | 选任意 mp3 / m4a / wav / ogg / flac —— **在浏览器里直接转成 WAV**，不需要你装 ffmpeg |
| **删除** | 只允许删「我的音效」里的条目；自带示例受保护 |
| **重命名** | 给你自己的音效起名 —— **名字就是下拉里显示的文字**（如"奥德赛开场""小号成功"）；自带示例不可改名 |
| **撤销 / 恢复默认** | 回到上一次选择 / 回到自带示例音 |

**你添加过的音效会一直留在下拉菜单里**，以后点一下就能切换，不用重新导入。

它们默认存放在 `%USERPROFILE%\.dsh\chimes-library\` —— **在仓库之外**，所以不可能被你误提交。

**想放到别的盘**（例如 C 盘空间紧张）？在 `%USERPROFILE%\.dsh\chimes-state.json` 里加一行即可，不用改代码：

```json
{ "version": 1, "libraryDir": "D:\\AA素材" }
```

优先级是：环境变量 `DSH_CHIMES_LIBRARY` → 这个 `libraryDir` → 默认的 `%USERPROFILE%\.dsh\chimes-library\`。
搬家后请把旧目录里的音频拷过去，面板里点一下「刷新」。**某个选择指向的文件如果不存在了，插件会回退到别的可用音效而不是变成静音。**

## 换音效（命令行方式，可选）

不想开 GUI 时，一条命令搞定（自动转码 + 掐头静音 + 安装）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-chime.ps1 `
    -Startup "D:\我的音效\开场.mp3" `
    -Done    "D:\我的音效\完成.mp3"
```

只想换一个就只传那一个参数；`-Volume 0.8` 可在转码时调音量。

**两条硬限制**（面板方式会自动满足，手动方式要注意）：

- 必须是 **PCM WAV**（`pcm_s16le`）。**mp3 改名成 `.wav` 不会响**；
- **音量只能转码时烘焙**（`ffmpeg -af "volume=1.5"`），因为 `SoundPlayer` 没有音量 API。

细节见 👉 **[docs/音效与版权.md](docs/音效与版权.md)**

## 配置

两个音效是两个独立的 loader 行，可以分别开关。改 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: startup-chime
      name: dsh-chimes
      config:
        kind: startup
        enabled: true
        delayMs: 350        # 界面就绪后再等多久播（调大 = 更晚，可与窗口出现对齐）
        waitMs: 6000        # 等不到界面就绪时的兜底时限
        # wavPath: 'D:\我的音效\开场.wav'

    - id: done-chime
      name: dsh-chimes
      config:
        kind: done
        enabled: true
        cooldownMs: 1500    # 两次响之间的最小间隔，防连击
        minTurnMs: 0        # 只对耗时超过 N 毫秒的回合响（觉得快问快答太吵就设 5000）
        # excludeSessionPrefixes: ['session-test']
        # wavPath: 'D:\我的音效\完成.wav'
```

**临时静音全部音效**：设环境变量 `DSH_CHIME_MUTE=1`。

## 排障

每次触发都会写一行日志，先看它：

```
%USERPROFILE%\.dsh\startup-chime.log     ← 开场音
%USERPROFILE%\.dsh\done-chime.log        ← 完成音
```

一次正常的开场应该是：

```
module imported (entry=...)
apply: armed (profile="desktop", wav=...\assets\chime.wav)
poll: webRuntime ready after 472ms
fire: webRuntime ready
PLAYING ...\assets\chime.wav (pid=...)
player exited code=0 after 3497ms        ← 活了整段音频的时长 = 真的播完了
```

| 症状 | 原因 | 处理 |
|---|---|---|
| 完全没声音，日志里连 `module imported` 都没有 | 插件没被加载 | 侧栏「插件」页看是否启用；查 `dsh.profile.bundles` |
| 有 `PLAYING` 但 `player exited` 只有几十毫秒 | 音频不是合法 PCM WAV | 重新转码；见 [音效与版权](docs/音效与版权.md) |
| `SKIP wav not found` | `wavPath` 不对 | 用绝对路径，确认文件存在 |
| 开场音不响，但日志显示走了 `fire: fallback timeout` | 没检测到 `webRuntime`，走了兜底 | 能响只是偏晚；把 `delayMs` 调小 |
| 完成音在子代理结束时也响 | 不该发生 | 开 issue 并附上会话类型（用户会话/子代理） |
| 装不上、报 `profile "desktop" is managed exclusively…` | 用了从 npm 另装的独立 `dsh` | 必须用桌面版自带的启动器：`<安装目录>\resources\runtime\cli\bin\dsh.cmd` |

## 安全

- **零网络、零遥测**：代码不发起任何网络请求，不读取任何凭据；
- **零依赖、无 `postinstall`**：安装时不会执行任意代码；
- 播放进程只拿到 4 个环境变量，DSH 主进程的 API key 不会传过去；
- 播放器用绝对路径启动，不查 `PATH`；音频路径经环境变量传入，无命令注入面；
- 详细清单（含 DSH 插件的权限边界说明）见 [SECURITY.md](SECURITY.md)。

## 兼容性

- 实测环境：DSH 桌面版 **0.2.0-rc.2** + Windows 11；
- 插件**故意不声明任何 `peerDependencies`**，因此不会撞上 DSH 安装期的 peer 版本校验；
- 判断当前 profile 用 `ctx.get('profileContext')?.name`，只在 `desktop` 生效；
- 完成音的"非子代理"判断用的是运行时校验过的会话头字段（`origin === 'subagent'` /
  `delegationDepth` / `parentSession`），不是猜 id 前缀。

## 许可

- **代码**：[MIT](LICENSE)
- **`assets/` 下的示例音频**：[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)（公有领域，由 ffmpeg 从正弦波合成，可复现，见 [音效与版权](docs/音效与版权.md)）

## 贡献

欢迎 PR。三条约定（详见 [docs/音效与版权.md](docs/音效与版权.md)）：

1. **不要提交第三方音频**（游戏/影视/音乐/素材库）—— 会造成 DMCA 风险；
2. 提交自制音效请在 PR 里声明"本人创作，同意以 CC0 授权"；
3. 改 `scripts/*.ps1` 时**保持 UTF-8 带 BOM**（否则 PowerShell 5.1 读不了中文，见 [.gitattributes](.gitattributes)）。

## 相关

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 一切皆插件的 agent harness
- GitHub 话题 [`dsh-plugin`](https://github.com/topics/dsh-plugin) —— 社区插件生态
