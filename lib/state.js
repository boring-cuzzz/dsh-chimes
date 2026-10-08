/**
 * Layered configuration and persisted panel state.
 *
 * Effective settings resolve in this order (later wins):
 *   1. built-in defaults
 *   2. the loader row's `config` (declarative, from cordis.patch.yml)
 *   3. `$DSH_HOME/chimes-state.json` overrides written by the control panel
 *
 * The state file holds only what the panel manages. It is deliberately outside
 * the profile patch: the panel must be able to flip a switch without rewriting
 * the user's YAML, and "Restore default" is then just deleting keys.
 *
 * @module dsh-chimes/state
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** Absolute path of the persisted panel state. */
export const STATE_PATH = process.env.DSH_CHIMES_STATE ?? join(DSH_HOME, 'chimes-state.json')

/** Per-kind built-in defaults. */
export const DEFAULTS = {
  startup: { enabled: true, delayMs: 350, waitMs: 6000 },
  done: { enabled: true, cooldownMs: 1500, minTurnMs: 0, excludeSessionPrefixes: [] }
}

/**
 * Read the whole state document. Never throws; a corrupt file reads as empty.
 * @returns the parsed state, or an empty object.
 */
export function readState() {
  try {
    if (!existsSync(STATE_PATH)) return {}
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Merge a patch into one kind's stored overrides and persist atomically.
 * @param kind - `startup` or `done`.
 * @param patch - override values; a `null` value deletes that override.
 * @returns the updated state document.
 */
export function writeKindState(kind, patch) {
  const state = readState()
  const section = state[kind] !== null && typeof state[kind] === 'object' ? state[kind] : {}
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null || value === undefined) delete section[key]
    else section[key] = value
  }
  state.version = 1
  state[kind] = section
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  const temp = `${STATE_PATH}.tmp`
  writeFileSync(temp, `${JSON.stringify(state, void 0, 2)}\n`)
  renameSync(temp, STATE_PATH)
  return state
}

/**
 * Resolve effective settings for one instance.
 * @param kind - `startup` or `done`.
 * @param rowConfig - the loader row's config (declarative layer).
 * @returns the merged settings, including `kind`.
 */
export function resolveSettings(kind, rowConfig = {}) {
  const stored = readState()[kind]
  const overrides = stored !== null && typeof stored === 'object' ? stored : {}
  return { ...DEFAULTS[kind], ...rowConfig, ...overrides, kind }
}
