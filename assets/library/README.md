# Bundled example chimes — CC0-1.0

The six WAV files in this folder are the **bundled examples** shown under
"Bundled examples" in the control panel's sound library dropdown.

They are **synthesized from pure sine waves with ffmpeg** — no recordings, no
sample libraries, no third-party material of any kind. The author can therefore
dedicate them completely to the public domain:

> **The audio files in this folder are released under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)
> (Public Domain Dedication).** Use, modify and redistribute them freely, with no
> attribution required.
>
> The plugin code itself is released under the [MIT License](../../LICENSE).

## The files

| File | Character | Length |
|---|---|---|
| `01-soft-chime.wav` | C5 + E5 soft double tone (**default for the startup chime**) | 1.24 s |
| `02-bell.wav` | A5 + E6 bell with a long tail | 1.57 s |
| `03-marimba.wav` | C5–E5–G5 quick arpeggio | 1.09 s |
| `04-blip.wav` | Very short high blip | 0.22 s |
| `05-two-tone-up.wav` | G5 → C6 rising (**default for the completion chime**) | 0.91 s |
| `06-two-tone-down.wav` | C6 → G5 falling | 0.92 s |

All of them are PCM 16-bit / 44.1 kHz / stereo, with metadata stripped — which is
exactly what `Media.SoundPlayer` requires.

## Why no "real" sounds ship here

Sound material usually has no traceable provenance: it may come from a game, a
film, a piece of music, a commercial asset pack, or a file saved off the web.
Committing such a file to a public repository means **publicly redistributing
it** — which risks a DMCA takedown, and forks keep copies even after a deletion.

This plugin's value does not depend on any particular audio: it plays a WAV file
at the right moment. So the boundary is drawn deliberately:

> **Code open source, sounds bring-your-own.**

Your own sounds live **outside this repository**, in your user library
(`%USERPROFILE%\.dsh\chimes-library\` by default, or wherever `libraryDir`
points), so they can never be committed by accident.

Full discussion (Chinese): [`../../docs/音效与版权.md`](../../docs/音效与版权.md)

## How the effective sound is resolved

1. the `wavPath` selected in the panel (or set in the loader row's config);
2. `assets/chime.wav` for the startup chime, `assets/success.wav` for the
   completion chime — the locations the command-line installer writes to;
3. otherwise the bundled default from this folder
   (`01-soft-chime.wav` / `05-two-tone-up.wav`).

A path that no longer exists is skipped rather than played as silence.
