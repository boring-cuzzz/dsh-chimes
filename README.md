# dsh-chimes

English | [中文](README.zh.md)

Two chimes for the **DeepSeek Harness desktop app**: one when the app **opens**, one when a **turn finishes**.

![platform](https://img.shields.io/badge/platform-Windows-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![assets](https://img.shields.io/badge/assets-CC0-lightgrey)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

> The repository **ships nine example chimes** — six CC0 tones synthesized with ffmpeg plus three
> the author picked and confirmed free of third-party copyright claims (**those two are the
> out-of-the-box defaults**) — and it supports **your own audio**, switchable from a dropdown in the
> control panel. It deliberately contains no sound material of unknown provenance; see
> [docs/音效与版权.md](docs/音效与版权.md) (Chinese) for the reasoning.

---

## What it does

| Chime | Fires when | Notes |
|---|---|---|
| **Startup** | The desktop app opens, just as the window is about to render | Once per launch; plugin reloads and page refreshes stay silent |
| **Done** | A conversation turn completes successfully | **User sessions only** — delegated/subagent sessions are skipped; errors and aborts are silent |

Both play **host-side** through the Windows `System.Media.SoundPlayer`, so:

- the window does **not** need to be focused — walk away and you'll still hear it;
- browser autoplay policies do not apply (which is why this is not a Web Audio plugin).

## Requirements

- **Windows** (uses .NET `Media.SoundPlayer`)
- **DSH desktop app** (`desktop` profile), launched at least once
- PowerShell 5.1+
- `ffmpeg` — only if your audio needs converting (non-PCM-WAV input)

## Install

```powershell
# recommended, one command (replace boring-cuzzz with your GitHub username)
dsh plugin --profile desktop add github:boring-cuzzz/dsh-chimes

# or from a local clone
git clone https://github.com/boring-cuzzz/dsh-chimes.git
dsh plugin --profile desktop add .\dsh-chimes
```

Then **fully quit and reopen DSH** — the startup chime should play. Send any message and wait for
the reply to end — the done chime should play.

## Control panel & sound library

After installing, open the **Plugins page in the sidebar → Chimes** (on some cores:
**Settings → Plugins**). No command line needed:

| Control | What it does |
|---|---|
| **Startup / Completion switches** | Enable each chime independently — takes effect **immediately**, no restart |
| **Sound library dropdown** | Switch between the nine bundled examples and **your own sounds** |
| **Preview** | Plays through the **real playback path**, not a browser simulation |
| **Choose audio…** | Any mp3 / m4a / wav / ogg / flac — **converted to WAV in the browser**, so ffmpeg is not required |
| **Delete** | Removes entries from "my sounds" only; bundled examples are protected |
| **Rename** | Name your own sounds — **the file name is the label the dropdown shows**; bundled examples cannot be renamed |
| **Undo / Restore default** | Go back to the previous pick, or to the bundled example |

**Sounds you add stay in the dropdown**, so switching later is one click.

They live in `%USERPROFILE%\.dsh\chimes-library\` — **outside the repository**, so they can never be
committed by accident.

**Want them on another drive** (say the system drive is nearly full)? Add one line to
`%USERPROFILE%\.dsh\chimes-state.json` — no code change needed:

```json
{ "version": 1, "libraryDir": "D:\\MySounds" }
```

Precedence: the `DSH_CHIMES_LIBRARY` environment variable → that `libraryDir` key → the default path.
Copy your audio over and hit **Refresh** in the panel. If a stored selection ever points at a file
that no longer exists, the plugin falls back to another playable sound instead of going silent.

## Bring your own sound (command line, optional)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-chime.ps1 `
    -Startup "D:\sounds\open.mp3" `
    -Done    "D:\sounds\done.mp3"
```

Only one chime to change? Pass only that argument. `-Volume 0.8` bakes in a gain.

**Two hard requirements** (the panel handles both automatically):

- the audio must be **PCM WAV** (`pcm_s16le`) — renaming an mp3 to `.wav` will **not** play;
- volume must be baked in at conversion time (`ffmpeg -af "volume=1.5"`), because `SoundPlayer`
  has no volume API.

More detail: [docs/音效与版权.md](docs/音效与版权.md)

## Configuration

Both chimes are independent loader rows. Edit `cordis.patch.yml` in your profile:

```yaml
- insert:
    - id: startup-chime
      name: dsh-chimes
      config:
        kind: startup
        enabled: true
        delayMs: 350        # extra wait after the UI is ready before playing
        waitMs: 6000        # give up waiting and play anyway
    - id: done-chime
      name: dsh-chimes
      config:
        kind: done
        enabled: true
        cooldownMs: 1500    # minimum gap between two chimes
        minTurnMs: 0        # set e.g. 5000 to chime only for longer turns
```

**Mute everything:** set `DSH_CHIME_MUTE=1`.

## Troubleshooting

Read the log first — every trigger appends a line to
`%USERPROFILE%\.dsh\startup-chime.log` or `%USERPROFILE%\.dsh\done-chime.log`.

| Symptom | Cause | Fix |
|---|---|---|
| No sound, and the log has no `module imported` | plugin never loaded | enable it on the Plugins page; check `dsh.profile.bundles` |
| `PLAYING` logged, but `player exited` after ~90 ms | audio is not a valid PCM WAV | re-encode it |
| `SKIP wav not found` | wrong `wavPath` | use an absolute path that exists |
| `profile "desktop" is managed exclusively…` | you used a standalone `dsh` from npm | use the launcher bundled with the desktop app |

## Security

Zero network calls, zero telemetry, zero credential access. No runtime dependencies and no
`postinstall`. The player process receives only 4 environment variables, so the harness's API keys
never reach it; PowerShell is invoked by absolute path (no `PATH` lookup) and the audio path is
passed via an environment variable (no command-injection surface). Details — including the general
privilege boundary of DSH plugins — are in [SECURITY.md](SECURITY.md).

## Compatibility

Tested with DSH desktop **0.2.0-rc.2** on Windows 11. The plugin intentionally declares **no
`peerDependencies`**, so it never trips DSH's install-time peer gate. It activates only in the
`desktop` profile. Subagent exclusion relies on session header fields the runtime itself validates
(`origin === 'subagent'`, `delegationDepth`, `parentSession`) rather than guessing id prefixes.

## License

- **Code:** [MIT](LICENSE)
- **Placeholder audio in `assets/`:** [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)
  (synthesized from sine waves with ffmpeg, reproducible)

## Contributing

PRs welcome. Three rules:

1. **Do not submit third-party audio** (game rips, movie/music clips, stock libraries) — it creates
   DMCA exposure for the whole repository.
2. Self-made sounds are fine: state in the PR that you created it and license it as CC0.
3. Keep `scripts/*.ps1` as **UTF-8 with BOM** (Windows PowerShell 5.1 misreads BOM-less UTF-8
   containing non-ASCII text and fails to parse the script — see [.gitattributes](.gitattributes)).

## Related

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the everything-is-a-plugin agent harness
- GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin) — community plugin ecosystem
