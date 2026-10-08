# Bundled example chimes

These are the sounds listed under "Bundled examples" in the control panel's sound
library dropdown. Nine files, from two sources.

## Synthesized tones — CC0-1.0

Six tones generated from pure sine waves with ffmpeg: no recordings, no sample
libraries, no third-party material of any kind. The author can therefore dedicate
them completely to the public domain:

> **`01-` … `06-` are released under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)
> (Public Domain Dedication).** Use, modify and redistribute them freely, no
> attribution required.

| File | Character | Length |
|---|---|---|
| `01-soft-chime.wav` | C5 + E5 soft double tone | 1.24 s |
| `02-bell.wav` | A5 + E6 bell with a long tail | 1.57 s |
| `03-marimba.wav` | C5–E5–G5 quick arpeggio | 1.09 s |
| `04-blip.wav` | Very short high blip | 0.22 s |
| `05-two-tone-up.wav` | G5 → C6 rising | 0.91 s |
| `06-two-tone-down.wav` | C6 → G5 falling | 0.92 s |

## Curated sounds — provided by the repository author

These three are **not synthesized**. They are personal favourites of the author,
bundled here so that a fresh install sounds good out of the box. The author
provides them together with the explicit confirmation that **they carry no
third-party copyright claims**.

| File | Character | Length | Role |
|---|---|---|---|
| `奥德赛chime.wav` | Bold opening sting | 9.00 s | **default startup chime** |
| `小号success.wav` | Short trumpet flourish | 1.77 s | **default completion chime** |
| `雨姐susses.wav` | Bright success cue | 4.20 s | extra choice |

The plugin code is released under the [MIT License](../../LICENSE).

> **Rights holders:** if you believe one of these three files infringes your
> rights, please open an issue and it will be removed promptly. Keeping the two
> groups clearly separated is what makes that possible.

All nine files are PCM 16-bit / 44.1 kHz / stereo with metadata stripped — exactly
what `Media.SoundPlayer` requires.

## Why a user's own sounds stay out of the repository

Sound material usually has no traceable provenance: it may come from a game, a
film, a piece of music, a commercial asset pack, or a file saved off the web.
Committing such a file to a public repository means **publicly redistributing
it** — which risks a DMCA takedown, and forks keep copies even after a deletion.

So every sound *you* add stays **outside this repository**, in your own library
(`%USERPROFILE%\.dsh\chimes-library\` by default, or wherever `libraryDir`
points). Only the files above — deliberately chosen and cleared by the author —
are committed here.

Full discussion (Chinese): [`../../docs/音效与版权.md`](../../docs/音效与版权.md)

## How the effective sound is resolved

1. the `wavPath` selected in the panel (or set in the loader row's config);
2. `assets/chime.wav` for the startup chime, `assets/success.wav` for the
   completion chime — the locations the command-line installer writes to;
3. otherwise the bundled default from this folder
   (`奥德赛chime.wav` / `小号success.wav`).

A path that no longer exists is skipped rather than played as silence.
