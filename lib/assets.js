/**
 * Effective audio resolution, with a three-level fallback:
 *
 *   1. `wavPath` — explicit path from the loader row or the control panel;
 *   2. `assets/chime.wav` (startup) or `assets/success.wav` (done) — the user's
 *      own sound, placed there by the installer or by the panel's upload;
 *   3. `assets/sample-startup.wav` / `assets/sample-done.wav` — the CC0 tone
 *      shipped with the repository, so a fresh clone makes sound immediately.
 *
 * Levels 2 is gitignored and level 3 is CC0: that is what keeps third-party
 * audio out of the published repository while still letting every user keep a
 * personal sound in place.
 *
 * @module dsh-chimes/assets
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Per-kind file names inside `assets/`. */
export const USER_FILE = { startup: 'chime.wav', done: 'success.wav' }
/** Fallback when nothing is selected: one of the bundled CC0 library tones. */
export const SAMPLE_FILE = { startup: 'library/01-soft-chime.wav', done: 'library/05-two-tone-up.wav' }
export const PREV_FILE = { startup: 'chime.prev.wav', done: 'success.prev.wav' }

/**
 * @param kind - `startup` or `done`.
 * @param settings - effective settings for this instance.
 * @param pluginDir - the plugin package root.
 * @returns absolute path of the WAV that should be played.
 */
export function resolveWavPath(kind, settings, pluginDir) {
  // An explicit path only wins while it still exists. A stale path — the
  // library folder was moved to another drive, a renamed file — must fall back
  // to something playable instead of silently meaning "no sound at all".
  if (typeof settings?.wavPath === 'string' && settings.wavPath.trim() !== '' && existsSync(settings.wavPath)) {
    return settings.wavPath
  }
  const user = join(pluginDir, 'assets', USER_FILE[kind])
  if (existsSync(user)) return user
  return join(pluginDir, 'assets', SAMPLE_FILE[kind])
}

/**
 * Describe the effective WAV for the control panel.
 * @param wavPath - absolute path.
 * @param kind - used only to label which slot this is.
 * @returns a small JSON-safe descriptor.
 */
export function describeWav(wavPath, kind) {
  try {
    if (typeof wavPath !== 'string' || wavPath === '' || !existsSync(wavPath)) {
      return { kind, path: String(wavPath ?? ''), exists: false }
    }
    const stats = statSync(wavPath)
    return { kind, path: wavPath, exists: true, bytes: stats.size, modified: stats.mtimeMs, ...readWavHeader(wavPath) }
  } catch (error) {
    return { kind, path: String(wavPath ?? ''), exists: false, error: String(error?.message ?? error) }
  }
}

/**
 * Read a WAV header from disk.
 * @param wavPath - absolute path.
 * @returns the parse result (see {@link parseWavHeader}).
 */
export function readWavHeader(wavPath) {
  const fd = openSync(wavPath, 'r')
  try {
    const buffer = Buffer.alloc(65536)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return parseWavHeader(buffer.subarray(0, read))
  } finally {
    closeSync(fd)
  }
}

/**
 * Minimal RIFF/WAVE header parser: enough to report format and duration, and to
 * reject an mp3 renamed to `.wav` before it silently fails to play.
 * @param buffer - at least the beginning of the file.
 * @returns `{ valid, reason?, format?, channels?, sampleRate?, bitsPerSample?, durationSeconds? }`.
 */
export function parseWavHeader(buffer) {
  if (!buffer || buffer.length < 44) return { valid: false, reason: 'file too short for a WAV header' }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { valid: false, reason: 'not a RIFF/WAVE file — an mp3 renamed to .wav will not play' }
  }
  let offset = 12
  let fmt = null
  let dataBytes = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ' && offset + 24 <= buffer.length) {
      fmt = {
        format: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22)
      }
    } else if (id === 'data') {
      dataBytes = size
    }
    if (fmt !== null && dataBytes !== null) break
    offset += 8 + size + (size % 2)
  }
  if (fmt === null) return { valid: false, reason: 'no fmt chunk found' }
  const bytesPerSecond = (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8
  const durationSeconds = dataBytes !== null && bytesPerSecond > 0 ? dataBytes / bytesPerSecond : null
  const valid = fmt.format === 1 && fmt.bitsPerSample === 16
  return {
    valid,
    reason: valid ? undefined : `player needs PCM 16-bit (found format=${fmt.format}, bits=${fmt.bitsPerSample})`,
    format: fmt.format,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    durationSeconds
  }
}
