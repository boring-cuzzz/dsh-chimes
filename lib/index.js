/**
 * dsh-chimes — startup and turn-completion chimes for the DSH desktop app,
 * plus an in-app control panel.
 *
 * The package is mounted **twice** with the same module, once per chime, and
 * dispatches on `config.kind` (the same composition DSH's own base patch uses
 * for `tool-subagent` / `tool-subagent-fork`). Both mounts share this module
 * instance, which is how the panel knows both rows' configs.
 *
 * Deliberately dependency-free apart from Node builtins, with no declared
 * `peerDependencies`, so DSH's install-time compatibility gate has nothing to
 * reject.
 *
 * @module dsh-chimes
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { armStartupChime } from './startup.js'
import { armDoneChime } from './done.js'
import { mountPanelRoutes } from './routes.js'
import { createLogger } from './player.js'
import { DSH_HOME } from './state.js'

/** Cordis plugin name. The loader rows reference the package name instead. */
export const name = 'dsh-chimes'

/** The package root — the directory holding `package.json` and `assets/`. */
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Panel routes mount once per host process, not once per chime row. */
const PANEL_MOUNTED = Symbol.for('dsh.chimes.panel-mounted')

/** Row configs keyed by kind — shared by both mounts of this module. */
const ROW_CONFIGS = new Map()

/**
 * Apply one of the two chime rows.
 * @param ctx - Cordis context of this loader row.
 * @param config - the row's `config` (`{ kind: 'startup' | 'done', ... }`).
 */
export function apply(ctx, config = {}) {
  const kind = config?.kind === 'done' ? 'done' : 'startup'
  ROW_CONFIGS.set(kind, config)

  if (kind === 'startup') armStartupChime(ctx, config)
  else armDoneChime(ctx, config)

  // The panel routes mount once per host process, not once per chime row. The
  // guard tracks *liveness* rather than existence: disposing the plugin (a
  // disable/enable toggle in the Plugins page, or any recomposition) unregisters
  // the routes, and the next apply must be allowed to mount them again —
  // otherwise the panel would 405 forever until the whole app restarts.
  const existing = globalThis[PANEL_MOUNTED]
  if (existing !== undefined && existing.alive) return

  const registration = { alive: true, dispose: null }
  globalThis[PANEL_MOUNTED] = registration

  const log = createLogger('chimes-panel', join(DSH_HOME, 'chimes-panel.log'))
  const options = {
    pluginDir: PLUGIN_DIR,
    getRowConfig: (which) => ROW_CONFIGS.get(which) ?? {},
    log
  }

  const releasePanel = () => {
    registration.alive = false
    try {
      registration.dispose?.()
    } catch {
      /* the routes service may already be gone; nothing to do */
    }
  }

  try {
    if (typeof ctx?.inject !== 'function') {
      registration.alive = false
      log('ctx.inject unavailable: control panel routes not mounted')
      return
    }
    // Dynamic: the chimes themselves must keep working in profiles that have no
    // web server (headless), so `webServer` is not a hard dependency.
    ctx.inject(['webServer'], (webCtx) => {
      try {
        registration.dispose = mountPanelRoutes(webCtx.webServer, webCtx, options)
      } catch (error) {
        registration.alive = false
        log(`FAIL: could not mount the control panel routes: ${error?.message ?? error}`)
      }
      if (typeof webCtx.effect === 'function') {
        try {
          webCtx.effect(() => releasePanel, 'dsh-chimes: control panel lifetime')
        } catch {
          /* mountPanelRoutes already owns a disposer of its own */
        }
      }
    })
  } catch (error) {
    // The chimes must survive any panel failure.
    registration.alive = false
    log(`FAIL: panel setup failed: ${error?.message ?? error}`)
  }
}
