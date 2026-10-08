/**
 * Startup chime: play once, as the desktop window is about to paint.
 *
 * The trigger waits for the `webRuntime` service, which the web surface provides
 * once its HTTP server is bound — i.e. the window can render. It plays
 * `delayMs` after that, and falls back to `waitMs` so the feature can never fail
 * silently.
 *
 * Once-per-process is enforced with a `Symbol.for` global: it survives HMR
 * module reloads and profile recompositions, so plugin reloads stay silent.
 *
 * @module dsh-chimes/startup
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, playWav } from './player.js'
import { DSH_HOME, resolveSettings } from './state.js'
import { resolveWavPath } from './assets.js'

const PLAYED = Symbol.for('dsh.startup-chime.played')
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Arm the one-shot startup chime.
 * @param ctx - Cordis context of this loader row.
 * @param rowConfig - the row's `config` from cordis.patch.yml.
 * @returns the logger, for reuse by route handlers.
 */
export function armStartupChime(ctx, rowConfig = {}) {
  const log = createLogger('startup-chime', join(DSH_HOME, 'startup-chime.log'))

  if (globalThis[PLAYED]) {
    log('apply: already handled in this process, skipping')
    return log
  }

  let settings
  try {
    settings = resolveSettings('startup', rowConfig)
  } catch (error) {
    log(`apply: settings read failed (${error?.message ?? error}), using row config`)
    settings = { ...rowConfig }
  }

  if (settings.enabled === false || process.env.DSH_CHIME_MUTE) {
    globalThis[PLAYED] = true
    log('apply: disabled by config, panel state, or DSH_CHIME_MUTE')
    return log
  }

  let profileContext
  try {
    profileContext = ctx?.get?.('profileContext')
  } catch (error) {
    log(`apply: profile gate unavailable (${error?.message ?? error}), continuing`)
  }
  if (profileContext !== undefined && profileContext?.name !== 'desktop') {
    globalThis[PLAYED] = true
    log(`apply: skipped, profile is ${JSON.stringify(profileContext?.name)}`)
    return log
  }

  globalThis[PLAYED] = true
  log(`apply: armed (wav=${resolveWavPath('startup', settings, PLUGIN_DIR)})`)

  let fired = false
  const fire = (why) => {
    if (fired) return
    fired = true
    // Resolve at fire time so a panel change is picked up without a reload.
    const wav = resolveWavPath('startup', settings, PLUGIN_DIR)
    log(`fire: ${why} → ${wav}`)
    playWav(wav, log)
  }

  const startedAt = Date.now()
  const waitMs = Number(settings.waitMs) || 0
  const delayMs = Math.max(0, Number(settings.delayMs) || 0)
  const poll = () => {
    let ready = false
    try {
      ready = ctx?.get?.('webRuntime') != null
    } catch (error) {
      log(`poll: ctx.get('webRuntime') threw (${error?.message ?? error})`)
    }
    if (ready) {
      log(`poll: webRuntime ready after ${Date.now() - startedAt}ms`)
      setTimeout(() => fire('webRuntime ready'), delayMs).unref?.()
      return
    }
    if (Date.now() - startedAt >= waitMs) {
      fire('fallback timeout')
      return
    }
    setTimeout(poll, 120).unref?.()
  }
  poll()

  return log
}

/** Exported for the control panel's "preview" route. */
export function startupPreviewPath(rowConfig = {}) {
  return resolveWavPath('startup', resolveSettings('startup', rowConfig), PLUGIN_DIR)
}
