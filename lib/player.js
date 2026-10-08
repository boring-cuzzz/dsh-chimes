/**
 * Shared playback + diagnostics for both chimes.
 *
 * The player is a PowerShell child that must NOT be detached: a detached child
 * gets `DETACHED_PROCESS` (no console) and PowerShell exits in ~90 ms without
 * playing a note, silently. Measured on the reference machine: detached 89 ms /
 * exit 0 vs non-detached 3517 ms for a 3.21 s file.
 *
 * The path travels as an environment variable because with
 * `powershell.exe -Command "<script>" <arg>` the trailing argument is
 * concatenated into the script text instead of populating `$args`, which is a
 * parse error for non-ASCII paths.
 *
 * The child gets a minimal environment (4 variables) rather than the host's, so
 * no harness credential can reach the player process.
 *
 * @module dsh-chimes/player
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

const LOG_LIMIT_BYTES = 65536

/**
 * Build a logger that writes to stderr and appends to a size-capped file.
 * @param label - prefix used in both sinks.
 * @param logPath - absolute log file path.
 * @returns the logging function.
 */
export function createLogger(label, logPath) {
  return function log(message) {
    try {
      process.stderr.write(`[${label}] ${message}\n`)
    } catch {
      /* diagnostics are best-effort */
    }
    try {
      const stats = statSync(logPath, { throwIfNoEntry: false })
      if (stats !== undefined && stats.size > LOG_LIMIT_BYTES) writeFileSync(logPath, '')
      appendFileSync(logPath, `${new Date().toISOString()} pid=${process.pid} ${message}\n`)
    } catch {
      /* a missing or unwritable log file must never affect playback */
    }
  }
}

/**
 * Play one WAV file through a non-detached PowerShell child.
 * @param wavPath - absolute path to a PCM WAV file.
 * @param log - logger from {@link createLogger}.
 * @returns whether a player process was started.
 */
export function playWav(wavPath, log) {
  if (typeof wavPath !== 'string' || wavPath === '') {
    log('SKIP: no wavPath configured')
    return false
  }
  if (!existsSync(wavPath)) {
    log(`SKIP wav not found: ${wavPath}`)
    return false
  }
  try {
    const child = spawn(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        '(New-Object Media.SoundPlayer $env:DSH_CHIME_WAV).PlaySync()'
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: {
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          windir: process.env.windir ?? process.env.SystemRoot ?? 'C:\\Windows',
          PATH: process.env.PATH ?? '',
          DSH_CHIME_WAV: wavPath
        }
      }
    )
    const startedAt = Date.now()
    child.on('error', (error) => log(`FAIL spawn: ${error?.message ?? error}`))
    child.on('exit', (code) => log(`player exited code=${code} after ${Date.now() - startedAt}ms`))
    child.unref()
    log(`PLAYING ${wavPath} (pid=${child.pid})`)
    return true
  } catch (error) {
    log(`FAIL play: ${error?.message ?? error}`)
    return false
  }
}
