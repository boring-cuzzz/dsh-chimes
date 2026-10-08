/**
 * Control-panel HTTP API, mounted on the host's `webServer` service.
 *
 * Registered exactly once per host process (the package is mounted twice — one
 * row per chime), because `webServer.register` rejects a duplicate path.
 *
 * Threat model: the only realistic attacker is a **malicious web page** in the
 * user's browser. Every mutating route therefore (a) rejects cross-origin
 * `Origin` headers and cross-site fetches, (b) caps the request body, and
 * (c) validates that uploaded bytes are really a PCM WAV before touching disk.
 * Deletion is confined to the user library directory. A local process that can
 * already write files is outside this boundary.
 *
 * @module dsh-chimes/routes
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PREV_FILE, USER_FILE, describeWav, resolveWavPath } from './assets.js'
import { readState, resolveSettings, writeKindState } from './state.js'
import { deleteFromUserLibrary, listLibrary, renameInUserLibrary, saveToUserLibrary } from './library.js'
import { playWav } from './player.js'

const MAX_JSON_BYTES = 64 * 1024
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const PREVIEW_COOLDOWN_MS = 1500

const KINDS = new Set(['startup', 'done'])

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

/** Reject cross-site callers. A same-origin fetch from the DSH page passes. */
function sameOrigin(req) {
  const site = req.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      const { hostname } = new URL(origin)
      return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
    } catch {
      return false
    }
  }
  return true
}

/** Collect a request body with a hard cap. Resolves `null` when the cap trips. */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

/** Read and parse a JSON body, answering 413/400 itself on failure. */
async function readJsonBody(req, res) {
  const raw = await readBody(req, MAX_JSON_BYTES)
  if (raw === null) {
    sendJson(res, 413, { ok: false, error: 'body too large' })
    return undefined
  }
  try {
    const parsed = JSON.parse(raw.toString('utf8') || '{}')
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid JSON' })
    return undefined
  }
}

/**
 * Mount the panel API.
 * @param webServer - the `webServer` service.
 * @param ctx - context used to own the registration lifetime.
 * @param options - `{ pluginDir, getRowConfig, log }`.
 * @returns a disposer that unregisters every route.
 */
export function mountPanelRoutes(webServer, ctx, options) {
  const { pluginDir, getRowConfig, log } = options
  let lastPreviewAt = 0

  const assetsDir = () => join(pluginDir, 'assets')

  const kindSnapshot = (kind) => {
    const settings = resolveSettings(kind, getRowConfig(kind) ?? {})
    const stored = readState()[kind]
    const overrides = stored !== null && typeof stored === 'object' ? stored : {}
    const wav = resolveWavPath(kind, settings, pluginDir)
    const previous = typeof overrides.prevWavPath === 'string' ? overrides.prevWavPath : null
    return {
      kind,
      settings: {
        enabled: settings.enabled !== false,
        wavPath: typeof settings.wavPath === 'string' ? settings.wavPath : null,
        prevWavPath: previous,
        delayMs: settings.delayMs ?? null,
        waitMs: settings.waitMs ?? null,
        cooldownMs: settings.cooldownMs ?? null,
        minTurnMs: settings.minTurnMs ?? null
      },
      audio: describeWav(wav, kind),
      // '' is a real undo target: it means "the bundled default".
      hasUndo: typeof overrides.prevWavPath === 'string'
    }
  }

  const fullState = () => ({
    startup: kindSnapshot('startup'),
    done: kindSnapshot('done'),
    library: listLibrary(pluginDir)
  })

  /** Selecting a different sound remembers the previous one, for undo. */
  const selectSound = (kind, nextPath) => {
    const stored = readState()[kind]
    const current = stored !== null && typeof stored === 'object' && typeof stored.wavPath === 'string' ? stored.wavPath : null
    const patch = { wavPath: nextPath === '' ? null : nextPath }
    // '' records "there was no explicit selection" so undo can return to the default.
    if (current !== (nextPath === '' ? null : nextPath)) patch.prevWavPath = current === null ? '' : current
    writeKindState(kind, patch)
  }

  /** After a rename, keep any selection pointing at the renamed file. */
  const repointStatePaths = (fromPath, toPath) => {
    for (const kind of KINDS) {
      const stored = readState()[kind]
      if (stored === null || typeof stored !== 'object') continue
      const patch = {}
      if (stored.wavPath === fromPath) patch.wavPath = toPath
      if (stored.prevWavPath === fromPath) patch.prevWavPath = toPath
      if (Object.keys(patch).length === 0) continue
      try {
        writeKindState(kind, patch)
      } catch (error) {
        log(`repointing the ${kind} selection after rename failed: ${error?.message ?? error}`)
      }
    }
  }

  const routes = [
    {
      kind: 'exact',
      path: '/dsh-chimes/state',
      handler: (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        sendJson(res, 200, { ok: true, state: fullState() })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/config',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const payload = await readJsonBody(req, res)
        if (payload === undefined) return
        const kind = String(payload.kind ?? '')
        if (!KINDS.has(kind)) return sendJson(res, 400, { ok: false, error: 'invalid kind' })
        const incoming = payload.patch
        if (incoming === null || typeof incoming !== 'object') return sendJson(res, 400, { ok: false, error: 'invalid patch' })

        // A selection change is a different operation from a settings tweak: it
        // must record the previous sound so "undo" can return to it.
        if (typeof incoming.wavPath === 'string' || incoming.wavPath === null) {
          const candidate = typeof incoming.wavPath === 'string' ? incoming.wavPath : ''
          const next = candidate !== '' && candidate.length <= 4096 ? candidate : null
          if (next !== null && !existsSync(next)) return sendJson(res, 400, { ok: false, error: 'that audio file does not exist' })
          try {
            selectSound(kind, next ?? '')
          } catch (error) {
            log(`selection write failed: ${error?.message ?? error}`)
            return sendJson(res, 500, { ok: false, error: 'could not persist the selection' })
          }
          log(`panel: ${kind} sound selected → ${next ?? '(bundled default)'}`)
        }

        const patch = {}
        if (typeof incoming.enabled === 'boolean') patch.enabled = incoming.enabled
        for (const key of ['delayMs', 'waitMs', 'cooldownMs', 'minTurnMs']) {
          if (incoming[key] === null) patch[key] = null
          else if (typeof incoming[key] === 'number' && Number.isFinite(incoming[key])) patch[key] = Math.max(0, Math.trunc(incoming[key]))
        }
        if (Object.keys(patch).length > 0) {
          try {
            writeKindState(kind, patch)
          } catch (error) {
            log(`config write failed: ${error?.message ?? error}`)
            return sendJson(res, 500, { ok: false, error: 'could not persist settings' })
          }
          log(`panel: config updated for ${kind}: ${JSON.stringify(patch)}`)
        }
        sendJson(res, 200, { ok: true, state: fullState() })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/preview',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const payload = await readJsonBody(req, res)
        if (payload === undefined) return
        const kind = String(payload.kind ?? '')
        if (!KINDS.has(kind)) return sendJson(res, 400, { ok: false, error: 'invalid kind' })
        const since = Date.now() - lastPreviewAt
        if (lastPreviewAt !== 0 && since < PREVIEW_COOLDOWN_MS) {
          return sendJson(res, 429, { ok: false, error: `slow down (${since}ms)` })
        }
        lastPreviewAt = Date.now()
        // An explicit path lets the panel audition a library entry before selecting it.
        const requested = typeof payload.path === 'string' && payload.path !== '' ? payload.path : null
        const settings = resolveSettings(kind, getRowConfig(kind) ?? {})
        const wav = requested !== null && existsSync(requested) ? requested : resolveWavPath(kind, settings, pluginDir)
        const started = playWav(wav, log)
        sendJson(res, started ? 200 : 400, {
          ok: started,
          audio: describeWav(wav, kind),
          error: started ? void 0 : 'could not start the player (see the chime log)'
        })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/audio',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const kind = String(url.searchParams.get('kind') ?? '')
        if (!KINDS.has(kind)) return sendJson(res, 400, { ok: false, error: 'invalid kind' })
        const raw = await readBody(req, MAX_AUDIO_BYTES)
        if (raw === null) return sendJson(res, 413, { ok: false, error: 'audio too large (limit 10 MB)' })
        const saved = saveToUserLibrary(raw, url.searchParams.get('name') ?? 'sound')
        if (!saved.ok) return sendJson(res, 400, { ok: false, error: saved.error })
        try {
          selectSound(kind, saved.entry.path)
        } catch (error) {
          log(`selecting the uploaded sound failed: ${error?.message ?? error}`)
          return sendJson(res, 500, { ok: false, error: 'saved to the library but could not select it' })
        }
        log(`panel: ${kind} sound added to the library as ${saved.entry.name}`)
        sendJson(res, 200, { ok: true, entry: saved.entry, state: fullState() })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/library/delete',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const payload = await readJsonBody(req, res)
        if (payload === undefined) return
        const target = String(payload.path ?? '')
        const removed = deleteFromUserLibrary(target)
        if (!removed.ok) return sendJson(res, 400, { ok: false, error: removed.error })
        // If either chime was using it, fall back to the bundled default.
        for (const kind of KINDS) {
          const stored = readState()[kind]
          if (stored !== null && typeof stored === 'object' && stored.wavPath === target) {
            try {
              // Undo must not point at the file we just deleted.
              writeKindState(kind, { wavPath: null, prevWavPath: null })
            } catch (error) {
              log(`clearing the ${kind} selection after delete failed: ${error?.message ?? error}`)
            }
          }
        }
        log(`panel: removed ${target} from the user library`)
        sendJson(res, 200, { ok: true, state: fullState() })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/library/rename',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const payload = await readJsonBody(req, res)
        if (payload === undefined) return
        const from = String(payload.path ?? '')
        const wanted = String(payload.name ?? '').trim()
        if (wanted === '') return sendJson(res, 400, { ok: false, error: 'a new name is required' })
        const renamed = renameInUserLibrary(from, wanted)
        if (!renamed.ok) return sendJson(res, 400, { ok: false, error: renamed.error })
        if (renamed.entry.path !== from) repointStatePaths(from, renamed.entry.path)
        log(`panel: renamed ${from} → ${renamed.entry.name}`)
        sendJson(res, 200, { ok: true, entry: renamed.entry, state: fullState() })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/reset',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const payload = await readJsonBody(req, res)
        if (payload === undefined) return
        const kind = String(payload.kind ?? '')
        if (!KINDS.has(kind)) return sendJson(res, 400, { ok: false, error: 'invalid kind' })
        try {
          writeKindState(kind, { wavPath: null, prevWavPath: null })
          // legacy/manual override locations, harmless when absent
          rmSync(join(assetsDir(), USER_FILE[kind]), { force: true })
          rmSync(join(assetsDir(), PREV_FILE[kind]), { force: true })
        } catch (error) {
          log(`reset failed: ${error?.message ?? error}`)
          return sendJson(res, 500, { ok: false, error: 'could not reset' })
        }
        log(`panel: ${kind} sound reset to the bundled default`)
        sendJson(res, 200, { ok: true, state: fullState() })
      }
    },
    {
      kind: 'exact',
      path: '/dsh-chimes/undo',
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const payload = await readJsonBody(req, res)
        if (payload === undefined) return
        const kind = String(payload.kind ?? '')
        if (!KINDS.has(kind)) return sendJson(res, 400, { ok: false, error: 'invalid kind' })
        const stored = readState()[kind]
        const overrides = stored !== null && typeof stored === 'object' ? stored : {}
        // '' is a legitimate target: it means "go back to the bundled default".
        if (typeof overrides.prevWavPath !== 'string') return sendJson(res, 400, { ok: false, error: 'nothing to undo' })
        const previous = overrides.prevWavPath
        if (previous !== '' && !existsSync(previous)) {
          try {
            writeKindState(kind, { prevWavPath: null })
          } catch {
            /* best effort */
          }
          return sendJson(res, 400, { ok: false, error: 'the previous sound no longer exists' })
        }
        try {
          // Swap, so undo itself can be undone.
          const current = typeof overrides.wavPath === 'string' ? overrides.wavPath : null
          writeKindState(kind, {
            wavPath: previous === '' ? null : previous,
            prevWavPath: current === null ? '' : current
          })
        } catch (error) {
          log(`undo failed: ${error?.message ?? error}`)
          return sendJson(res, 500, { ok: false, error: 'could not undo' })
        }
        log(`panel: ${kind} sound restored to the previous selection`)
        sendJson(res, 200, { ok: true, state: fullState() })
      }
    }
  ]

  const disposers = routes.map((route) => webServer.register(route))

  const dispose = () => {
    for (const unregister of disposers) {
      try {
        unregister()
      } catch {
        /* best effort */
      }
    }
  }

  if (typeof ctx?.effect === 'function') {
    try {
      ctx.effect(() => dispose, 'dsh-chimes: control panel routes')
    } catch {
      /* the explicit disposer below still covers us */
    }
  }

  log(`panel: ${routes.length} routes mounted`)
  return dispose
}
