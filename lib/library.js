/**
 * Sound library: switchable chimes, from two places.
 *
 *   - **examples** — `<plugin>/assets/library/*.wav`, committed to the
 *     repository and released as CC0 (synthesized from sine waves with ffmpeg,
 *     reproducible). They give a fresh clone something to choose from.
 *   - **user** — `$DSH_HOME/chimes-library/*.wav`, added through the control
 *     panel or dropped in by hand. This directory lives outside the repository,
 *     so a personal sound can never be committed by accident.
 *
 * Selecting an entry stores its absolute path in the panel state as `wavPath`,
 * which is exactly what `assets.js` resolves first.
 *
 * @module dsh-chimes/library
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { DSH_HOME, readState } from './state.js'
import { describeWav, parseWavHeader } from './assets.js'

/**
 * Absolute path of the user's own library.
 *
 * Precedence (later entries are only tried when the earlier ones are unset):
 *   1. the `DSH_CHIMES_LIBRARY` environment variable;
 *   2. the `libraryDir` key in the panel state — this is how a user moves the
 *      library to another drive without touching code or env vars, which
 *      matters on machines where the system drive is nearly full;
 *   3. `$DSH_HOME/chimes-library`, the portable default for everyone else.
 *
 * @returns the absolute directory path (not guaranteed to exist yet).
 */
export function userLibraryDir() {
  const fromEnv = process.env.DSH_CHIMES_LIBRARY
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  try {
    const configured = readState().libraryDir
    if (typeof configured === 'string' && configured.trim() !== '') return configured
  } catch {
    /* an unreadable state file must not break playback: fall through */
  }
  return join(DSH_HOME, 'chimes-library')
}

/** Absolute path of the shipped example library. */
export function exampleLibraryDir(pluginDir) {
  return join(pluginDir, 'assets', 'library')
}

/** List one directory of WAVs, sorted by name; missing directories list empty. */
function listDir(dir, source) {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => extname(name).toLowerCase() === '.wav')
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const path = join(dir, name)
        const described = describeWav(path, source)
        return { source, name, label: basename(name, extname(name)), ...described }
      })
      .filter((entry) => entry.exists !== false)
  } catch {
    return []
  }
}

/**
 * List both libraries.
 * @param pluginDir - the package root.
 * @returns `{ examples, user, userDir }`.
 */
export function listLibrary(pluginDir) {
  return {
    examples: listDir(exampleLibraryDir(pluginDir), 'example'),
    user: listDir(userLibraryDir(), 'user'),
    userDir: userLibraryDir()
  }
}

/**
 * Turn arbitrary user input into a safe WAV file name (keeps CJK and spaces).
 * @param rawName - the user's label, possibly a file name.
 * @returns a name ending in `.wav`.
 */
export function sanitizeLibraryName(rawName) {
  const base = basename(String(rawName ?? 'sound').replace(/[\\/]+/g, '-'))
  // Drop any audio extension the user's file had: the stored file is always WAV.
  const withoutExt = base.replace(/\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|wma|aiff?|webm)$/i, '')
  const cleaned = withoutExt
    // strip control characters and characters Windows forbids in file names
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 60)
  return `${cleaned === '' ? 'sound' : cleaned}.wav`
}

/** Append `-2`, `-3`, … until the name is free. */
function uniquePath(dir, name) {
  const ext = '.wav'
  const stem = name.slice(0, -ext.length)
  let candidate = join(dir, name)
  let counter = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${counter}${ext}`)
    counter += 1
    if (counter > 999) break
  }
  return candidate
}

/**
 * Validate and store an uploaded sound in the user library.
 * @param buffer - the request body.
 * @param rawName - the client-provided label.
 * @returns `{ ok: true, entry }` or `{ ok: false, error }`.
 */
export function saveToUserLibrary(buffer, rawName) {
  const parsed = parseWavHeader(buffer)
  if (!parsed.valid) return { ok: false, error: parsed.reason ?? 'invalid WAV' }
  const dir = userLibraryDir()
  mkdirSync(dir, { recursive: true })
  const target = uniquePath(dir, sanitizeLibraryName(rawName))
  const temp = `${target}.tmp`
  writeFileSync(temp, buffer)
  try {
    rmSync(target, { force: true })
    copyFileSync(temp, target)
  } finally {
    rmSync(temp, { force: true })
  }
  return { ok: true, entry: { source: 'user', name: basename(target), label: basename(target, extname(target)), ...describeWav(target, 'user') } }
}

/**
 * Rename one entry in the user library. Same confinement rule as deletion:
 * anything outside the user library (notably the bundled examples, which are
 * tracked repository files) is refused.
 *
 * The panel's display name IS the file name, so renaming the file is what
 * renames the dropdown entry.
 *
 * @param path - absolute path of the entry to rename.
 * @param rawName - the new label, with or without an audio extension.
 * @returns `{ ok: true, entry }` or `{ ok: false, error }`.
 */
export function renameInUserLibrary(path, rawName) {
  if (typeof path !== 'string' || path === '') return { ok: false, error: 'missing path' }
  const dir = resolve(userLibraryDir())
  const source = resolve(path)
  if (source !== dir && !source.startsWith(dir + sep)) return { ok: false, error: 'not in the user library' }
  if (extname(source).toLowerCase() !== '.wav') return { ok: false, error: 'not a wav' }
  if (!existsSync(source)) return { ok: false, error: 'file not found' }
  const renameEntry = (file) => ({
    source: 'user',
    name: basename(file),
    label: basename(file, extname(file)),
    ...describeWav(file, 'user')
  })
  const requested = sanitizeLibraryName(rawName)
  if (requested.toLowerCase() === basename(source).toLowerCase()) return { ok: true, entry: renameEntry(source) }
  try {
    mkdirSync(dir, { recursive: true })
    const target = uniquePath(dir, requested)
    renameSync(source, target)
    return { ok: true, entry: renameEntry(target) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * Delete one file from the user library. Refuses anything outside that
 * directory, so a crafted path can never reach the repository or the system.
 * @param path - absolute path claimed by the client.
 * @returns `{ ok, error? }`.
 */
export function deleteFromUserLibrary(path) {
  if (typeof path !== 'string' || path === '') return { ok: false, error: 'missing path' }
  const dir = resolve(userLibraryDir())
  const target = resolve(path)
  if (target !== dir && !target.startsWith(dir + sep)) return { ok: false, error: 'not in the user library' }
  if (extname(target).toLowerCase() !== '.wav') return { ok: false, error: 'not a wav' }
  if (!existsSync(target)) return { ok: false, error: 'file not found' }
  try {
    const size = statSync(target).size
    rmSync(target, { force: true })
    return { ok: true, bytes: size }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}
