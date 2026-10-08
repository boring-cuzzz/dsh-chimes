/**
 * dsh-chimes control panel (browser half).
 *
 * Served at `/plugins/dsh-chimes/client.js` and loaded through the host's
 * module-loader envelope — this file is NOT a plain ES module, mirroring the
 * working convention of other DSH plugins:
 *
 *   window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => { ... } })
 *
 * Inside the factory `require('react')` is available and the plugin exports
 * CommonJS-style (`module.exports = { apply, inject }`).
 *
 * The panel talks to the host through this package's own same-origin routes
 * (`/dsh-chimes/*`) rather than through config forms, so it does not depend on
 * how a given core keys its settings scopes.
 *
 * Audio replacement converts in the browser: the picked file is decoded with
 * Web Audio (so mp3/m4a/ogg/flac all work), optionally trimmed of leading
 * silence, and re-encoded as 16-bit PCM WAV before upload — which removes any
 * need for ffmpeg on the user's machine.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chimes',
  factory: (require) => {
    var module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-chimes'
    const ROW_STARTUP = 'startup-chime'
    const ROW_DONE = 'done-chime'

    const en = {
      title: 'Chimes',
      subtitle: 'Startup and turn-completion sounds',
      startup: 'Startup chime',
      startupHint: 'Plays once when the desktop app opens.',
      done: 'Completion chime',
      doneHint: 'Plays when a turn finishes. Subagent sessions stay silent.',
      enabled: 'Enabled',
      current: 'Current file',
      missing: 'file not found',
      invalid: 'not a playable WAV',
      seconds: 's',
      preview: 'Preview',
      replace: 'Choose audio…',
      replaceHint: 'mp3 / m4a / wav / ogg / flac — converted in the browser',
      save: 'Save',
      cancel: 'Cancel',
      reset: 'Use the bundled sample',
      undo: 'Undo last change',
      converted: 'Ready to save',
      saving: 'Saving…',
      loading: 'Loading…',
      decodeFailed: 'Could not decode that file as audio.',
      tooLong: 'Longer than 10 s — consider shortening it.',
      openFolder: 'Effective path',
      library: 'Sound library',
      groupExamples: 'Bundled examples',
      groupMine: 'My sounds',
      defaultSound: 'Bundled example',
      missingSound: 'No audio file found',
      currentCustom: 'Current file',
      deleteMine: 'Delete from my sounds',
      rename: 'Rename',
      renameSave: 'Save name',
      renameCancel: 'Cancel',
      renameHint: 'The name is the file name in your library',
      refresh: 'Refresh',
      added: 'Added to my sounds'
    }
    const zh = {
      title: '音效',
      subtitle: '开场音与任务完成音',
      startup: '开场音效',
      startupHint: '打开桌面版时播放一次。',
      done: '完成音效',
      doneHint: '每轮任务完成时播放；子代理会话不会响。',
      enabled: '启用',
      current: '当前文件',
      missing: '文件不存在',
      invalid: '不是可播放的 WAV',
      seconds: '秒',
      preview: '试听',
      replace: '选择音频…',
      replaceHint: 'mp3 / m4a / wav / ogg / flac —— 在浏览器里转换',
      save: '保存',
      cancel: '取消',
      reset: '恢复自带示例音',
      undo: '撤销上次更换',
      converted: '待保存',
      saving: '保存中…',
      loading: '读取中…',
      decodeFailed: '这个文件无法作为音频解码。',
      tooLong: '超过 10 秒 —— 建议裁短。',
      openFolder: '生效路径',
      library: '音效库',
      groupExamples: '自带示例',
      groupMine: '我的音效',
      defaultSound: '自带示例音',
      missingSound: '未找到音频文件',
      currentCustom: '当前文件',
      deleteMine: '从我的音效中删除',
      rename: '重命名',
      renameSave: '保存名称',
      renameCancel: '取消',
      renameHint: '名称就是文件库里那份文件的名字',
      refresh: '刷新',
      added: '已加入我的音效'
    }

    const S = {
      box: { border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35))', borderRadius: 8, padding: '12px 14px', marginBottom: 12 },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      title: { fontWeight: 600, marginBottom: 2 },
      hint: { opacity: 0.7, fontSize: 12, marginBottom: 8 },
      mono: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, opacity: 0.75, wordBreak: 'break-all' },
      btn: { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.4))', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      warn: { color: 'var(--dsw-alias-state-warning-primary, #d68b00)', fontSize: 12 },
      err: { color: 'var(--dsw-alias-state-error-primary, #d33)', fontSize: 12 },
      ok: { color: 'var(--dsw-alias-state-success-primary, #2a2)', fontSize: 12 }
    }

    async function api(path, init) {
      const response = await fetch(path, init)
      let body = null
      try {
        body = await response.json()
      } catch {
        /* non-JSON error page */
      }
      if (!response.ok || !body || body.ok === false) {
        throw new Error((body && body.error) || `HTTP ${response.status}`)
      }
      return body
    }

    const postJson = (path, payload) =>
      api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

    /** Encode a decoded AudioBuffer as 16-bit PCM WAV. */
    function encodeWav(audioBuffer, startFrame) {
      const channels = Math.min(2, audioBuffer.numberOfChannels)
      const sampleRate = audioBuffer.sampleRate
      const from = Math.max(0, Math.min(startFrame || 0, audioBuffer.length - 1))
      const frames = audioBuffer.length - from
      const blockAlign = channels * 2
      const dataBytes = frames * blockAlign
      const buffer = new ArrayBuffer(44 + dataBytes)
      const view = new DataView(buffer)
      const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
      }
      ascii(0, 'RIFF')
      view.setUint32(4, 36 + dataBytes, true)
      ascii(8, 'WAVE')
      ascii(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, channels, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * blockAlign, true)
      view.setUint16(32, blockAlign, true)
      view.setUint16(34, 16, true)
      ascii(36, 'data')
      view.setUint32(40, dataBytes, true)
      const data = []
      for (let c = 0; c < channels; c++) data.push(audioBuffer.getChannelData(c))
      let offset = 44
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          const sample = Math.max(-1, Math.min(1, data[c][from + i] || 0))
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
          offset += 2
        }
      }
      return new Blob([buffer], { type: 'audio/wav' })
    }

    /** First frame whose amplitude exceeds a -50 dBFS-ish threshold. */
    function findAudioStart(audioBuffer) {
      const threshold = 0.003
      const data = audioBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > threshold) return Math.max(0, i - 64)
      }
      return 0
    }

    function ChimesCard(props) {
      const ctx = props && props.ctx
      const t = React.useMemo(() => {
        try {
          return ctx && ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : (key) => key
        } catch {
          return (key) => key
        }
      }, [ctx])

      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [drafts, setDrafts] = React.useState({})
      const [renaming, setRenaming] = React.useState(null)
      const audioCtxRef = React.useRef(null)

      const refresh = React.useCallback(async () => {
        try {
          const body = await api('/dsh-chimes/state')
          setState(body.state)
          setError('')
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }, [])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      const run = async (label, fn) => {
        setBusy(label)
        setError('')
        try {
          await fn()
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy('')
        }
      }

      const audioCtx = () => {
        if (!audioCtxRef.current) {
          const Ctor = window.AudioContext || window.webkitAudioContext
          audioCtxRef.current = new Ctor()
        }
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(() => {})
        return audioCtxRef.current
      }

      const playBuffer = (audioBuffer) => {
        const c = audioCtx()
        const source = c.createBufferSource()
        source.buffer = audioBuffer
        source.connect(c.destination)
        source.start()
      }

      const toggle = (kind, next) => run(`toggle-${kind}`, async () => {
        const body = await postJson('/dsh-chimes/config', { kind, patch: { enabled: next } })
        setState(body.state)
      })

      const preview = (kind) => run(`preview-${kind}`, async () => {
        await postJson('/dsh-chimes/preview', { kind })
      })

      const onPick = (kind, file) => run(`decode-${kind}`, async () => {
        if (!file) return
        const raw = await file.arrayBuffer()
        let decoded
        try {
          decoded = await audioCtx().decodeAudioData(raw)
        } catch {
          throw new Error(t('decodeFailed'))
        }
        const start = findAudioStart(decoded)
        const blob = encodeWav(decoded, start)
        const duration = (decoded.length - start) / decoded.sampleRate
        setDrafts((prev) => ({ ...prev, [kind]: { blob, name: file.name, duration, trimmedMs: Math.round((start / decoded.sampleRate) * 1000) } }))
        playBuffer(decoded)
      })

      const saveDraft = (kind) => run(`save-${kind}`, async () => {
        const draft = drafts[kind]
        if (!draft) return
        const response = await fetch(
          `/dsh-chimes/audio?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(draft.name || 'sound')}`,
          {
            method: 'POST',
            headers: { 'content-type': 'audio/wav' },
            body: draft.blob
          }
        )
        const body = await response.json().catch(() => null)
        if (!response.ok || !body || body.ok === false) throw new Error((body && body.error) || `HTTP ${response.status}`)
        setState(body.state)
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[kind]
          return next
        })
      })

      const resetKind = (kind) => run(`reset-${kind}`, async () => {
        const body = await postJson('/dsh-chimes/reset', { kind })
        setState(body.state)
      })

      const undoKind = (kind) => run(`undo-${kind}`, async () => {
        const body = await postJson('/dsh-chimes/undo', { kind })
        setState(body.state)
      })

      /** Pick an entry from the sound library ('' = the bundled default). */
      const selectSound = (kind, path) => run(`select-${kind}`, async () => {
        const body = await postJson('/dsh-chimes/config', { kind, patch: { wavPath: path === '' ? null : path } })
        setState(body.state)
      })

      const deleteEntry = (path) => run('delete-entry', async () => {
        const body = await postJson('/dsh-chimes/library/delete', { path })
        setState(body.state)
      })

      /** Rename a sound in the user library; the file name is the display name. */
      const renameEntry = (path, name) => run('rename-entry', async () => {
        const body = await postJson('/dsh-chimes/library/rename', { path, name })
        setState(body.state)
        setRenaming(null)
      })

      const section = (kind, labelKey, hintKey) => {
        const info = state && state[kind]
        const draft = drafts[kind]
        const settings = (info && info.settings) || {}
        const audio = (info && info.audio) || {}
        const children = [
          h('div', { key: 'head', style: S.row },
            h('input', {
              key: 'cb',
              type: 'checkbox',
              id: `dsh-chimes-${kind}`,
              checked: settings.enabled !== false,
              disabled: busy !== '',
              onChange: (event) => toggle(kind, event.target.checked)
            }),
            h('label', { key: 'lb', htmlFor: `dsh-chimes-${kind}`, style: { fontWeight: 600, cursor: 'pointer' } }, t(labelKey)),
            h('span', { key: 'sp', style: { flex: 1 } }),
            h('button', { key: 'pv', style: S.btn, disabled: busy !== '', onClick: () => preview(kind) }, t('preview'))
          ),
          h('div', { key: 'hint', style: S.hint }, t(hintKey))
        ]

        // --- sound library picker: bundled examples + the user's own sounds ---
        const library = (state && state.library) || { examples: [], user: [] }
        // When nothing has been picked yet the host has already resolved a real
        // file (a bundled example), so the dropdown simply shows that entry as
        // selected. There is deliberately no "default" pseudo-entry: it told
        // users nothing about which sound they would actually hear.
        const selectedPath = settings.wavPath || (audio.exists ? audio.path : '')
        const knownPaths = {}
        for (const entry of [].concat(library.examples || [], library.user || [])) knownPaths[entry.path] = true
        const renderOption = (entry) =>
          h('option', { key: entry.path, value: entry.path },
            `${entry.label}${entry.durationSeconds ? ` · ${entry.durationSeconds.toFixed(2)}s` : ''}`)
        const optionNodes = []
        if (selectedPath === '') optionNodes.push(h('option', { key: '__none', value: '' }, t('missingSound')))
        if ((library.examples || []).length > 0) {
          optionNodes.push(h('optgroup', { key: '__examples', label: t('groupExamples') }, library.examples.map(renderOption)))
        }
        if ((library.user || []).length > 0) {
          optionNodes.push(h('optgroup', { key: '__mine', label: t('groupMine') }, library.user.map(renderOption)))
        }
        if (selectedPath !== '' && !knownPaths[selectedPath]) {
          optionNodes.push(h('option', { key: '__current', value: selectedPath },
            `${t('currentCustom')}: ${String(selectedPath).split(/[\\/]/).pop()}`))
        }
        const selectedUserEntry = (library.user || []).find((entry) => entry.path === selectedPath)
        const editing = renaming !== null && renaming.kind === kind
        children.push(h('div', { key: 'library', style: { ...S.row, marginTop: 8 } },
          h('span', { style: { fontSize: 12, opacity: 0.85 } }, `${t('library')}:`),
          editing
            ? h('input', {
                style: { ...S.btn, minWidth: 200, maxWidth: '100%' },
                value: renaming.value,
                autoFocus: true,
                disabled: busy !== '',
                onChange: (event) => setRenaming({ kind, value: event.target.value }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') renameEntry(selectedPath, renaming.value)
                  else if (event.key === 'Escape') setRenaming(null)
                }
              })
            : h('select', {
                style: { ...S.btn, minWidth: 200, maxWidth: '100%' },
                value: selectedPath,
                disabled: busy !== '',
                onChange: (event) => selectSound(kind, event.target.value)
              }, optionNodes),
          editing
            ? h('button', { style: S.btn, disabled: busy !== '', onClick: () => renameEntry(selectedPath, renaming.value) }, t('renameSave'))
            : null,
          editing
            ? h('button', { style: S.btn, disabled: busy !== '', onClick: () => setRenaming(null) }, t('renameCancel'))
            : null,
          selectedUserEntry && !editing
            ? h('button', {
                style: S.btn,
                disabled: busy !== '',
                onClick: () => setRenaming({ kind, value: selectedUserEntry.label })
              }, t('rename'))
            : null,
          selectedUserEntry && !editing
            ? h('button', { style: S.btn, disabled: busy !== '', onClick: () => deleteEntry(selectedPath) }, t('deleteMine'))
            : null
        ))
        if (selectedUserEntry) children.push(h('div', { key: 'renamehint', style: S.hint }, t('renameHint')))

        if (audio.exists) {
          const parts = []
          parts.push(`${Math.round(audio.bytes / 1024)} KB`)
          if (audio.durationSeconds) parts.push(`${audio.durationSeconds.toFixed(2)}${t('seconds')}`)
          if (audio.sampleRate) parts.push(`${audio.sampleRate} Hz`)
          if (audio.channels) parts.push(audio.channels === 1 ? 'mono' : 'stereo')
          children.push(h('div', { key: 'info', style: S.row },
            h('span', { style: { fontSize: 12, opacity: 0.85 } }, `${t('current')}: ${parts.join(' · ')}`),
            audio.valid === false ? h('span', { style: S.err }, `⚠ ${t('invalid')}: ${audio.reason || ''}`) : null
          ))
          children.push(h('div', { key: 'path', style: S.mono }, `${t('openFolder')}: ${audio.path}`))
        } else {
          children.push(h('div', { key: 'missing', style: S.warn }, `${t('current')}: ${t('missing')}`))
        }

        if (draft) {
          children.push(h('div', { key: 'draft', style: { ...S.ok, marginTop: 6 } },
            `${t('converted')}: ${draft.name} · ${draft.duration.toFixed(2)}${t('seconds')}` +
            (draft.trimmedMs > 40 ? ` · 已裁掉开头 ${draft.trimmedMs} ms` : '') +
            (draft.duration > 10 ? ` ⚠ ${t('tooLong')}` : '')
          ))
          children.push(h('div', { key: 'draftbtns', style: { ...S.row, marginTop: 6 } },
            h('button', { style: S.btn, disabled: busy !== '', onClick: () => saveDraft(kind) }, busy === `save-${kind}` ? t('saving') : t('save')),
            h('button', {
              style: S.btn,
              disabled: busy !== '',
              onClick: () => setDrafts((prev) => {
                const next = { ...prev }
                delete next[kind]
                return next
              })
            }, t('cancel'))
          ))
        }

        children.push(h('div', { key: 'actions', style: { ...S.row, marginTop: 8 } },
          h('label', { style: { ...S.btn, display: 'inline-block' } },
            t('replace'),
            h('input', {
              type: 'file',
              accept: 'audio/*',
              style: { display: 'none' },
              disabled: busy !== '',
              onChange: (event) => {
                const file = event.target.files && event.target.files[0]
                event.target.value = ''
                onPick(kind, file)
              }
            })
          ),
          h('button', { style: S.btn, disabled: busy !== '' || !info || !info.hasUndo, onClick: () => undoKind(kind) }, t('undo')),
          h('button', { style: S.btn, disabled: busy !== '', onClick: () => resetKind(kind) }, t('reset'))
        ))
        children.push(h('div', { key: 'rh', style: S.hint }, t('replaceHint')))

        return h('div', { key: kind, style: S.box }, children)
      }

      const body = [
        h('div', { key: 'head', style: S.row },
          h('div', { key: 'titles', style: { flex: 1 } },
            h('div', { style: S.title }, t('title')),
            h('div', { style: S.hint }, t('subtitle'))
          ),
          h('button', {
            key: 'refresh',
            style: S.btn,
            disabled: busy !== '',
            title: t('library'),
            onClick: () => refresh()
          }, t('refresh'))
        )
      ]
      if (!state && !error) body.push(h('div', { key: 'loading', style: S.hint }, t('loading')))
      if (error) body.push(h('div', { key: 'err', style: S.err }, error))
      if (state) {
        body.push(section('startup', 'startup', 'startupHint'))
        body.push(section('done', 'done', 'doneHint'))
      }
      return h('div', null, body)
    }

    function apply(ctx) {
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          if (typeof ctx.effect === 'function') ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-chimes: dictionaries')
          else ctx.locale.register(NS, { en, zh })
        }
      } catch (error) {
        console.warn('[dsh-chimes] locale registration failed', error)
      }

      // Three seats, mirroring the convention of working plugins: the current
      // core renders `plugins.item` as the plugin's own page; the other two are
      // fallbacks for older cores. The label must stay a static string: it is
      // resolved during page render, and a locale lookup there would take the
      // whole client batch down with it.
      const render = (props) => React.createElement(ChimesCard, { ...props, ctx })
      try {
        if (ctx.slots && typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('plugins.item', () => {
            ctx.slots.register(
              { name: 'plugins.item', id: ROW_STARTUP, order: 41, label: () => 'Chimes', locale: NS, inject: () => ({ ctx }) },
              render
            )
          })
          ctx.slots.inject('plugins.row.config', () => {
            ctx.slots.register(
              { name: 'plugins.row.config', key: `${'dsh-chimes'}#${ROW_STARTUP}`, locale: NS, order: 41, inject: () => ({ ctx }) },
              render
            )
          })
          ctx.slots.inject('settings.plugin.item', () => {
            ctx.slots.register({ name: 'settings.plugin.item', key: NS, locale: NS, order: 41, inject: () => ({ ctx }) }, render)
          })
        }
      } catch (error) {
        console.warn('[dsh-chimes] settings seats failed', error)
      }
    }

    module.exports = { apply, inject: ['slots', 'locale'] }
    return module.exports
  }
})
