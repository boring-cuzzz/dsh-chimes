/**
 * Turn-completion chime: play when a **user** conversation turn finishes
 * successfully.
 *
 * Subagent/delegated sessions are skipped explicitly, using the session header
 * the runtime itself validates (`@deepseek-ai/dsh-session`'s
 * `validateSessionHeader`): `@deepseek-ai/dsh-subagent` stamps
 * `origin: 'subagent'` together with `delegationDepth` and `parentSession`. So
 * delegating to N subagents does not produce N chimes mid-task.
 *
 * Settings are re-read on every event, so a panel switch takes effect
 * immediately without reloading the plugin.
 *
 * @module dsh-chimes/done
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, playWav } from './player.js'
import { DSH_HOME, resolveSettings } from './state.js'
import { resolveWavPath } from './assets.js'

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Subscribe to the session event stream and chime on completed user turns.
 * @param ctx - Cordis context of this loader row.
 * @param rowConfig - the row's `config` from cordis.patch.yml.
 * @returns the logger, for reuse by route handlers.
 */
export function armDoneChime(ctx, rowConfig = {}) {
  const log = createLogger('done-chime', join(DSH_HOME, 'done-chime.log'))

  /** session id -> turn start time, for the optional minTurnMs filter. */
  const turnStarts = new Map()
  let lastPlayedAt = 0
  let disabledLogged = false

  const settingsNow = () => {
    try {
      return resolveSettings('done', rowConfig)
    } catch (error) {
      log(`settings read failed (${error?.message ?? error}), using row config`)
      return { ...rowConfig }
    }
  }

  const handle = (session, event) => {
    try {
      const type = event?.type
      const sessionId = String(session?.id ?? '')

      if (type === 'turn/start') {
        if (turnStarts.size > 200) turnStarts.clear()
        turnStarts.set(sessionId, Date.now())
        return
      }
      if (type !== 'turn/end') return

      const settings = settingsNow()
      if (settings.enabled === false || process.env.DSH_CHIME_MUTE) {
        // Logged once per process: repeating it on every turn would flood the
        // log, but silence here is what makes "nothing happens" undebuggable.
        if (!disabledLogged) {
          disabledLogged = true
          log(`note: completion chime is disabled (${settings.enabled === false ? 'panel/config' : 'DSH_CHIME_MUTE'}); further skips are not logged`)
        }
        return
      }

      const header = session?.header

      // --- user sessions only: never chime for a delegated child -------------
      if (header?.origin === 'subagent') {
        log(`skip ${sessionId}: subagent session`)
        return
      }
      if ((header?.delegationDepth ?? 0) > 0) {
        log(`skip ${sessionId}: delegation depth ${header.delegationDepth}`)
        return
      }
      if (header?.parentSession !== undefined) {
        log(`skip ${sessionId}: child session (parent ${header.parentSession})`)
        return
      }

      // --- success only -----------------------------------------------------
      const kind = event?.data?.reason?.kind
      if (kind !== 'completed') {
        log(`skip ${sessionId}: reason=${String(kind)}`)
        return
      }

      for (const prefix of settings.excludeSessionPrefixes ?? []) {
        if (prefix && sessionId.startsWith(String(prefix))) {
          log(`skip ${sessionId}: excluded prefix`)
          return
        }
      }

      const startedAt = turnStarts.get(sessionId)
      turnStarts.delete(sessionId)
      const durationMs = startedAt === undefined ? undefined : Date.now() - startedAt
      const minTurnMs = Number(settings.minTurnMs) || 0
      if (minTurnMs > 0 && durationMs !== undefined && durationMs < minTurnMs) {
        log(`skip ${sessionId}: turn ${durationMs}ms < minTurnMs ${minTurnMs}`)
        return
      }

      const cooldownMs = Number(settings.cooldownMs) || 0
      const sinceLast = Date.now() - lastPlayedAt
      if (cooldownMs > 0 && lastPlayedAt !== 0 && sinceLast < cooldownMs) {
        log(`skip ${sessionId}: cooldown (${sinceLast}ms since last chime)`)
        return
      }

      lastPlayedAt = Date.now()
      const wav = resolveWavPath('done', settings, PLUGIN_DIR)
      log(`fire: turn completed in ${durationMs === undefined ? 'unknown' : durationMs}ms (session ${sessionId}) → ${wav}`)
      playWav(wav, log)
    } catch (error) {
      // A throwing listener must never break the agent loop.
      log(`FAIL handler: ${error?.message ?? error}`)
    }
  }

  ctx.on('session/event', handle)
  log('armed: listening on session/event for completed user turns')
  return log
}

/** Exported for the control panel's "preview" route. */
export function donePreviewPath(rowConfig = {}) {
  return resolveWavPath('done', resolveSettings('done', rowConfig), PLUGIN_DIR)
}
