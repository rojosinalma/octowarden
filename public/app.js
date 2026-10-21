/* octowarden UI — progressive enhancement, vanilla, no build step.
   Every action calls /ui/actions/* with fetch, toasts the {ok, message} outcome and never reloads the page.
   Edits are optimistic where the result is known up front (reorder, assign, values, settings); create, delete,
   plan and apply wait for the server. One EventSource on /ui/stream drives live blocks and bulk progress. */
(() => {
  'use strict'

  const T = window.Tailor
  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const icon = (id) => `<svg class="t-icon" aria-hidden="true"><use href="/tailor/icons.svg#${id}"/></svg>`
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`
  const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)

  /* ── API ─────────────────────────────────────────────────────────────────── */
  async function api(method, path, body, type) {
    const init = { method, headers: { accept: 'application/json' } }
    if (body !== undefined) {
      init.headers['content-type'] = type || 'application/json'
      init.body = type ? body : JSON.stringify(body)
    }
    try {
      const res = await fetch(path, init)
      const text = await res.text()
      let data
      try { data = text ? JSON.parse(text) : {} } catch { data = { ok: false, message: `Unexpected answer (${res.status})` } }
      if (typeof data.ok !== 'boolean') data.ok = res.ok
      if (!data.message) data.message = res.ok ? 'Done' : `Request failed (${res.status})`
      data.status = res.status
      return data
    } catch (err) {
      return { ok: false, message: `Network error: ${err.message}` }
    }
  }
  const toast = (res) => { T.toast(res.ok ? 'success' : 'danger', res.message); return res }
  function busy(btn, on) {
    if (!btn) return
    if (on) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true } else { btn.removeAttribute('aria-busy'); btn.disabled = false }
  }
  const pageHtml = async (url) => {
    const r = await fetch(url, { headers: { accept: 'text/html' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  }
  /** Re-renders the main column from the server without a reload (after a change the server shapes). */
  async function swapMain() {
    try {
      const doc = new DOMParser().parseFromString(await pageHtml(location.pathname + location.search), 'text/html')
      const fresh = $('main.t-shell-main', doc), main = $('main.t-shell-main')
      if (!fresh || !main) return
      const scroll = main.scrollTop
      main.innerHTML = fresh.innerHTML
      T.upgrade(main)
      initPage(main)
      main.scrollTop = scroll
    } catch (err) {
      T.toast('warning', `Could not refresh: ${err.message}`)
    }
  }

  /* ── Typed confirm: the exact name must be typed ─────────────────────────── */
  function typedConfirm({ title, body, expect, label }) {
    const d = $('#typed-confirm')
    const input = $('#typed-confirm-input', d), ok = $('[data-role=ok]', d)
    $('[data-role=title]', d).textContent = title
    $('[data-role=body]', d).innerHTML = body
    $('[data-role=expect]', d).textContent = expect
    ok.textContent = label || 'Delete'
    input.value = ''
    ok.disabled = true
    input.oninput = () => { ok.disabled = input.value !== expect }
    return new Promise((resolve) => {
      let done = false
      $('form', d).onsubmit = (e) => { e.preventDefault(); if (input.value !== expect) return; done = true; d.close('ok') }
      d.addEventListener('close', () => resolve(done ? input.value : null), { once: true })
      d.showModal()
      input.focus()
    })
  }

  /* ── Live updates ────────────────────────────────────────────────────────── */
  const runWatchers = new Map()
  function liveDot(status, tip) { const d = $('#live-dot'); if (d) { d.dataset.status = status; d.dataset.tip = `Live updates: ${tip}` } }
  const pendingLive = {}
  function scheduleLive(topic) {
    $$('[data-live]').forEach((block) => {
      if (!block.dataset.live.split(/\s+/).includes(topic)) return
      clearTimeout(pendingLive[block.id])
      pendingLive[block.id] = setTimeout(() => refreshBlock(block.id), 400)
    })
  }
  async function refreshBlock(id) {
    const block = document.getElementById(id)
    if (!block) return
    const q = new URLSearchParams(location.search)
    q.set('partial', id === 'runs-block' ? 'runs' : 'events')
    try {
      const html = await pageHtml(`${location.pathname}?${q}`)
      const tpl = document.createElement('template')
      tpl.innerHTML = html.trim()
      const fresh = tpl.content.firstElementChild
      if (!fresh) return
      if (id === 'runs-block') { block.innerHTML = ''; block.append(fresh) } else block.replaceWith(fresh)
      T.upgrade(id === 'runs-block' ? block : fresh)
    } catch { /* the next event retries */ }
  }
  function connect() {
    if (!window.EventSource) return
    const es = new EventSource('/ui/stream?topics=run,event,drift')
    es.onopen = () => liveDot('running', 'connected')
    es.onerror = () => liveDot('degraded', 'reconnecting')
    es.addEventListener('run', (e) => {
      let p
      try { p = JSON.parse(e.data) } catch { return }
      const id = p.run_id || p.id
      const w = runWatchers.get(id)
      if (w) w(p)
      scheduleLive('run')
    })
    es.addEventListener('event', () => scheduleLive('event'))
    es.addEventListener('drift', (e) => {
      let p
      try { p = JSON.parse(e.data) } catch { return }
      paintDrift(p.repo, p.state)
    })
  }
  const DRIFT = { clean: ['success', 'in sync'], drift: ['warning', 'drift'], error: ['danger', 'error'], unknown: ['neutral', 'not audited'] }
  function paintDrift(repo, state) {
    const [tone, label] = DRIFT[state] || ['neutral', state]
    $$(`tr[data-repo="${CSS.escape(repo)}"]`).forEach((tr) => {
      tr.dataset.drift = state
      const b = $('[data-cell=drift] .t-badge', tr)
      if (b) { b.dataset.tone = tone; b.textContent = label }
    })
    const page = $('#repo-page')
    if (page && page.dataset.repo === repo) {
      const b = $('#repo-drift .t-badge')
      if (b) { b.dataset.tone = tone; b.textContent = label }
    }
  }
  /** Waits for a run's `finished` message (SSE), with a polling fallback when the stream misses it. */
  function watchRun(runId, onRepo) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (p) => { if (settled) return; settled = true; runWatchers.delete(runId); clearInterval(poll); resolve(p) }
      runWatchers.set(runId, (p) => {
        if (p.status === 'finished') finish(p)
        else if (p.repo && onRepo) onRepo(p)
      })
      const poll = setInterval(async () => {
        const r = await api('GET', `/ui/actions/runs/${encodeURIComponent(runId)}`)
        if (r.ok && r.run && r.run.status !== 'running') {
          for (const x of (r.run.summary && r.run.summary.results) || []) if (onRepo) onRepo({ ...x, run_id: runId })
          finish({ run_id: runId, status: 'finished', totals: r.run.summary && r.run.summary.totals })
        }
      }, 5000)
    })
  }

  /* ── Keyboard and small controls (delegated) ────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    // Enter submits, Shift+Enter is a new line, in every text box inside a form that submits. Code editors opt out.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const t = e.target
      if (t.matches && t.matches('textarea') && !t.matches('[data-enter=newline]')) {
        const form = t.closest('form')
        if (form && !form.matches('#template-form, #set-form')) { e.preventDefault(); form.requestSubmit() }
      }
    }
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) {
      const s = $('input[type=search]')
      if (s) { e.preventDefault(); s.focus(); s.select() }
    }
  })
  document.addEventListener('change', (e) => {
    const sel = e.target
    if (!sel.matches) return
    // "Other…" reveals a free-text field; data-feeds copies a picked value into the field that carries the setting.
    if (sel.matches('select[data-other]')) {
      const other = document.getElementById(sel.dataset.other)
      if (other) { other.hidden = sel.value !== '__other'; if (!other.hidden) other.focus() }
    }
    if (sel.matches('select[data-feeds]')) {
      const target = document.getElementById(sel.dataset.feeds)
      if (!target) return
      if (sel.value === '__other') { target.hidden = false; target.focus(); return }
      target.hidden = true
      target.value = sel.value
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (sel.matches('.t-check[data-variant=switch] input')) {
      const label = $('.t-check-label', sel.closest('.t-check'))
      if (label && /^(on|off)$/i.test(label.textContent.trim())) label.textContent = sel.checked ? (label.textContent.trim()[0] === 'O' ? 'On' : 'on') : (label.textContent.trim()[0] === 'O' ? 'Off' : 'off')
    }
  })
  document.addEventListener('input', (e) => {
    const t = e.target
    if (t.matches && t.matches('[data-slug-target]')) {
      const out = document.getElementById(t.dataset.slugTarget)
      if (out) { const s = slugify(t.value); out.dataset.slug = s; out.textContent = s || '…' }
    }
  })

  /* ── Actions (delegated clicks) ──────────────────────────────────────────── */
  const actions = {}
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn || btn.disabled) return
    const fn = actions[btn.dataset.action]
    if (!fn) return
    e.preventDefault()
    fn(btn, e)
  })

  actions['secret-reveal'] = (btn) => {
    const input = document.getElementById(btn.dataset.for)
    if (!input) return
    input.type = input.type === 'password' ? 'text' : 'password'
    btn.setAttribute('aria-pressed', String(input.type === 'text'))
  }
  actions['secret-clear'] = async (btn) => {
    const ok = await T.confirm(`Clear ${btn.dataset.label}?`, '<p>The stored value is removed from the database.</p>', { label: 'Clear', danger: true })
    if (!ok) return
    busy(btn, true)
    const res = toast(await saveSetting(btn.dataset.key, ''))
    busy(btn, false)
    if (res.ok) paintSecret(btn.dataset.key, false)
  }

  /* ── Settings: auto-save rows, theme as settings ─────────────────────────── */
  const saveSetting = (key, value) => api('PUT', '/ui/actions/settings', { key, value: String(value) })
  function paintSecret(key, stored) {
    const badge = $(`[data-secret-state="${key}"]`)
    if (badge) { badge.dataset.tone = stored ? 'success' : 'neutral'; badge.textContent = stored ? 'stored' : 'not set' }
    const clear = $(`[data-action=secret-clear][data-key="${key}"]`)
    if (clear) clear.hidden = !stored
    const input = $(`[data-setting="${key}"]`)
    if (input) { input.value = ''; input.dataset.last = ''; input.placeholder = stored ? 'Stored — type a new value to replace it' : 'Not set' }
  }
  function initSettings(root) {
    const box = $('#settings', root)
    if (!box) return
    T.settingsAutoSave(box, async (key, value) => {
      const el = box.querySelector(`[data-setting="${key}"]`)
      const scale = el && el.dataset.scale ? Number(el.dataset.scale) : 1
      if (el && el.dataset.secret !== undefined && value === '') return { ok: true, message: 'Nothing typed: the stored value stays' }
      const res = await saveSetting(key, scale > 1 ? Math.round(Number(value) / scale) : value)
      if (res.ok && el && el.dataset.secret !== undefined) setTimeout(() => paintSecret(key, true))
      if (res.ok && (key === 'github_app_id' || key === 'github_app_private_key')) setTimeout(() => loadInstallations(box, true))
      if (res.ok && key === 'github_app_installation_id') { const w = $('[data-installations]', box); if (w) w.dataset.value = String(value) }
      return res
    })
    $$('.t-duration select', box).forEach((s) => T.sync(s))
    loadInstallations(box)
  }
  /** Installation ID picker: options from GET /app/installations; the stored value stays selectable on failure. */
  async function loadInstallations(root, force) {
    const wrap = $('[data-installations]', root)
    if (!wrap || (!force && wrap.dataset.appReady !== 'true')) return
    const sel = $('select', wrap), state = $('[data-role=installations-state]', wrap)
    const stored = wrap.dataset.value || ''
    state.dataset.tone = ''
    state.className = 't-small t-muted'
    state.textContent = 'Loading the App\'s installations…'
    const res = await api('GET', '/ui/actions/github/installations')
    const list = res.ok ? res.installations : []
    const opts = ['<option value="">Auto: look up per repo owner</option>']
    for (const i of list) opts.push(`<option value="${esc(i.id)}">${esc(`${i.account} (${i.type}) — ${i.id}`)}</option>`)
    if (stored && !list.some((i) => String(i.id) === stored)) opts.push(`<option value="${esc(stored)}">${esc(`#${stored} (stored${res.ok ? ', not among the installations' : ''})`)}</option>`)
    sel.innerHTML = opts.join('')
    sel.value = stored
    T.sync(sel)
    if (res.ok) state.textContent = list.length ? `${plural(list.length, 'installation')} of this App` : 'The App has no installations yet: install it on an account first.'
    else if (res.status === 503) state.textContent = res.message
    else { state.className = 't-small t-feedback'; state.dataset.tone = 'danger'; state.textContent = `Installations could not be listed: ${res.message}` }
  }
  function initTheme() {
    const h = document.documentElement.dataset
    const last = { ui_skin: h.skin, ui_palette: h.palette, ui_mode: h.modeChoice || h.mode }
    document.documentElement.addEventListener('t:theme', (e) => {
      const th = e.detail || {}
      const next = { ui_skin: th.skin, ui_palette: th.palette, ui_mode: th.choice || th.mode }
      for (const k of Object.keys(next)) {
        if (!next[k] || last[k] === next[k]) continue
        const prev = last[k]
        last[k] = next[k]
        saveSetting(k, next[k]).then((res) => { if (!res.ok) { last[k] = prev; T.toast('warning', `Theme not saved: ${res.message}`) } })
      }
    })
  }

  /* ── Repos list: filters, selection, bulk plan/apply/audit ──────────────── */
  const repoFilter = { q: '', owner: '', visibility: '', drift: '', set: '' }
  function applyRepoFilter() {
    const rows = $$('#repo-rows tr')
    let shown = 0
    for (const tr of rows) {
      const d = tr.dataset
      const sets = d.sets ? d.sets.split(' ') : []
      const ok = (!repoFilter.q || d.name.includes(repoFilter.q.toLowerCase())) &&
        (!repoFilter.owner || d.owner === repoFilter.owner) &&
        (!repoFilter.visibility || d.visibility === repoFilter.visibility) &&
        (!repoFilter.drift || d.drift === repoFilter.drift) &&
        (!repoFilter.set || (repoFilter.set === '-' ? sets.length === 0 : sets.includes(repoFilter.set)))
      tr.hidden = !ok
      if (ok) shown++
    }
    const none = $('#repo-no-match')
    if (none) none.hidden = shown > 0 || rows.length === 0
    paintSelection()
  }
  const selectedRepos = () => $$('#repo-rows input[data-select-repo]:checked').map((b) => b.value)
  function paintSelection() {
    const n = selectedRepos().length
    const bar = $('#selection-bar')
    if (!bar) return
    bar.hidden = n === 0
    $('#selection-count').textContent = `${n} selected`
    const all = $('[data-select-all]')
    const visible = $$('#repo-rows tr:not([hidden]) input[data-select-repo]')
    if (all) { all.checked = visible.length > 0 && visible.every((b) => b.checked); all.indeterminate = !all.checked && visible.some((b) => b.checked) }
  }
  function initRepos(root) {
    const box = $('#repos', root)
    if (!box) return
    $$('[data-repo-filter]', box).forEach((el) => {
      const key = el.dataset.repoFilter
      if (el.matches('.t-btn-group')) el.addEventListener('t:change', (e) => { repoFilter[key] = e.detail.button.dataset.value; applyRepoFilter() })
      else el.addEventListener(el.type === 'search' ? 'input' : 'change', () => { repoFilter[key] = el.value; applyRepoFilter() })
    })
    box.addEventListener('change', (e) => {
      if (e.target.matches('[data-select-all]')) $$('#repo-rows tr:not([hidden]) input[data-select-repo]').forEach((b) => { b.checked = e.target.checked })
      if (e.target.matches('[data-select-repo], [data-select-all]')) paintSelection()
    })
    const sw = $('[name=bulk-assigned]', root)
    if (sw) sw.addEventListener('change', () => { $('#bulk-dlg [data-role=set-picker]').hidden = sw.checked })
    const form = $('#create-repo-form', root)
    if (form) {
      const full = $('[data-role=full-name]', form)
      const paint = () => {
        const ownerSel = $('#cr-owner', form)
        const owner = ownerSel.value === '__other' ? $('#cr-owner-other', form).value : ownerSel.value
        full.textContent = `${owner || 'you'}/${$('#cr-name', form).value || 'name'}`
      }
      form.addEventListener('input', paint)
      form.addEventListener('change', paint)
      paint()
    }
    applyRepoFilter()
  }
  actions['selection-clear'] = () => { $$('#repo-rows input[data-select-repo]').forEach((b) => { b.checked = false }); paintSelection() }
  actions['repos-refresh'] = async (btn) => {
    busy(btn, true)
    const res = toast(await api('POST', '/ui/actions/repos/refresh'))
    busy(btn, false)
    if (res.ok) swapMain()
  }
  document.addEventListener('submit', async (e) => {
    const form = e.target
    if (form.id === 'create-repo-form') {
      e.preventDefault()
      const btn = $('[type=submit]', form)
      const ownerSel = $('#cr-owner', form)
      const owner = ownerSel.value === '__other' ? $('#cr-owner-other', form).value.trim() : ownerSel.value
      const body = {
        owner: owner || undefined,
        name: $('#cr-name', form).value.trim(),
        private: $('[name=visibility]:checked', form).value !== 'public',
        description: $('#cr-desc', form).value.trim() || undefined,
        sets: $$('[name=sets]:checked', form).map((b) => b.value),
      }
      busy(btn, true)
      const res = toast(await api('POST', '/ui/actions/repos', body))
      busy(btn, false)
      if (res.ok) location.assign(`/repos/${res.repo.full_name}`)
    } else if (form.id === 'import-form') {
      e.preventDefault()
      const btn = $('[type=submit]', form)
      const file = $('#import-file', form).files[0]
      const text = file ? await file.text() : $('#import-text', form).value
      if (!text.trim()) { T.toast('warning', 'Choose a file or paste YAML first'); return }
      busy(btn, true)
      const res = toast(await api('POST', '/ui/actions/import', text, 'text/yaml'))
      busy(btn, false)
      if (res.ok) { form.closest('dialog').close(); swapMain() }
    } else if (form.id === 'assign-form') {
      e.preventDefault()
      const dlg = form.closest('dialog'), btn = $('[type=submit]', form)
      const boxes = $$('.assign-list input', form)
      const add = boxes.filter((b) => b.checked && b.dataset.was !== 'true').map((b) => b.value)
      const remove = boxes.filter((b) => !b.checked && b.dataset.was === 'true').map((b) => b.value)
      if (!add.length && !remove.length) { dlg.close(); return }
      // Optimistic: the dialog closes and the boxes keep their new state; a failure restores them.
      dlg.close()
      const res = toast(await api('POST', '/ui/actions/sets/assign', { set: dlg.dataset.set, add, remove }))
      if (res.ok) boxes.forEach((b) => { b.dataset.was = String(b.checked) })
      else boxes.forEach((b) => { b.checked = b.dataset.was === 'true' })
      busy(btn, false)
    } else if (form.id === 'template-form' || form.id === 'set-form') {
      e.preventDefault()
      const save = form.id === 'template-form' ? saveTemplate : saveSet
      save($(`[data-action=${form.id === 'template-form' ? 'template-save' : 'set-save'}]`))
    } else if (form.id === 'audit-filter') {
      e.preventDefault()
    }
  })

  // Bulk: plan each selected repo (diffs per repo), then apply in bulk with live per-repo progress.
  const bulk = { repos: [], sets: [], plans: {} }
  const resultRow = (repo) => $(`#bulk-dlg tr[data-repo="${CSS.escape(repo)}"]`)
  function paintResult(repo, status, summary, diff) {
    const tr = resultRow(repo)
    if (!tr) return
    const tone = { running: 'info', done: 'success', failed: 'danger', changes: 'warning', clean: 'success', waiting: 'neutral' }[status] || 'neutral'
    tr.querySelector('[data-cell=status]').innerHTML = status === 'running' ? '<span class="t-spinner" data-size="sm" role="status" aria-label="Running"></span>' : `<span class="t-badge" data-tone="${tone}">${esc(status)}</span>`
    if (summary !== undefined) tr.querySelector('[data-cell=summary]').textContent = summary
    if (diff !== undefined) tr.querySelector('[data-cell=diff]').innerHTML = diff ? `<button class="t-btn" data-size="xs" data-action="bulk-diff" data-repo="${esc(repo)}">${icon('bi-eye')} Diff</button>` : ''
  }
  function progress(done, total) {
    const p = $('#bulk-dlg .t-progress'), pct = total ? Math.round((done / total) * 100) : 0
    p.setAttribute('aria-valuenow', String(pct))
    $('.t-progress-bar', p).style.setProperty('--t-value', `${pct}%`)
  }
  actions['bulk-open'] = () => {
    const dlg = $('#bulk-dlg')
    bulk.repos = selectedRepos()
    bulk.plans = {}
    $('[data-role=count]', dlg).textContent = plural(bulk.repos.length, 'repo')
    $('[data-step=pick]', dlg).hidden = false
    $('[data-step=results]', dlg).hidden = true
    $('[data-action=bulk-plan]', dlg).hidden = false
    $('[data-action=bulk-apply]', dlg).hidden = true
    dlg.showModal()
  }
  actions['bulk-plan'] = async (btn) => {
    const dlg = $('#bulk-dlg')
    const useAssigned = $('[name=bulk-assigned]', dlg).checked
    bulk.sets = useAssigned ? [] : $$('[name=bulk-set]:checked', dlg).map((b) => b.value)
    if (!useAssigned && !bulk.sets.length) { T.toast('warning', 'Tick at least one set, or use each repo\'s assigned sets'); return }
    $('[data-step=pick]', dlg).hidden = true
    $('[data-step=results]', dlg).hidden = false
    $('[data-role=results]', dlg).innerHTML = bulk.repos.map((r) => `<tr data-repo="${esc(r)}"><td>${esc(r)}</td><td class="t-col-shrink" data-cell="status"></td><td data-cell="summary" class="t-small"></td><td class="t-col-actions" data-cell="diff"></td></tr>`).join('')
    bulk.repos.forEach((r) => paintResult(r, 'waiting', ''))
    busy(btn, true)
    let done = 0, withChanges = 0
    progress(0, bulk.repos.length)
    const queue = bulk.repos.slice()
    const worker = async () => {
      while (queue.length) {
        const repo = queue.shift()
        paintResult(repo, 'running')
        const res = await api('POST', '/ui/actions/plan', { repo, sets: bulk.sets.length ? bulk.sets : undefined })
        if (res.ok) {
          bulk.plans[repo] = res
          if (res.plan.changes) withChanges++
          const extra = res.plan.destructive ? ` (${res.plan.destructive} destructive, skipped in bulk)` : ''
          paintResult(repo, res.plan.changes ? 'changes' : 'clean', res.message + extra, true)
        } else paintResult(repo, 'failed', res.message, false)
        progress(++done, bulk.repos.length)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    busy(btn, false)
    btn.hidden = true
    const apply = $('[data-action=bulk-apply]', dlg)
    apply.hidden = withChanges === 0
    $('[data-role=apply-label]', apply).textContent = `Apply to ${plural(withChanges, 'repo')}`
    T.toast(withChanges ? 'info' : 'success', withChanges ? `${plural(withChanges, 'repo')} with pending changes` : 'Every selected repo is in sync')
  }
  actions['bulk-diff'] = (btn) => {
    const p = bulk.plans[btn.dataset.repo]
    if (!p) return
    const dlg = $('#diff-dlg')
    $('#diff-dlg-title').textContent = `Plan for ${btn.dataset.repo}`
    $('[data-role=body]', dlg).innerHTML = p.html
    T.upgrade(dlg)
    dlg.showModal()
  }
  actions['bulk-apply'] = async (btn) => {
    const repos = Object.keys(bulk.plans).filter((r) => bulk.plans[r].plan.changes > 0)
    const ok = await T.confirm(`Apply to ${plural(repos.length, 'repo')}?`, `<p>The planned changes are written to GitHub. Destructive changes are skipped; apply those on the repo page.</p><p class="t-small t-muted">${repos.map(esc).join(', ')}</p>`, { label: 'Apply', danger: false })
    if (!ok) return
    busy(btn, true)
    repos.forEach((r) => paintResult(r, 'waiting', 'queued', false))
    const res = await api('POST', '/ui/actions/bulk', { repos, sets: bulk.sets, mode: 'apply' })
    if (!res.ok) { toast(res); busy(btn, false); return }
    let done = 0
    progress(0, repos.length)
    const fin = await watchRun(res.run_id, (p) => {
      if (p.status === 'running') paintResult(p.repo, 'running')
      else { paintResult(p.repo, p.status, p.summary || p.message || ''); progress(++done, repos.length) }
    })
    busy(btn, false)
    btn.hidden = true
    const t = fin.totals || {}
    T.toast(t.failed ? 'warning' : 'success', `Applied on ${plural(t.done ?? done, 'repo')}${t.failed ? `, ${t.failed} failed` : ''}`)
  }
  actions['bulk-audit'] = async (btn) => {
    const repos = selectedRepos()
    busy(btn, true)
    const res = await api('POST', '/ui/actions/audit', { repos })
    if (!res.ok) { toast(res); busy(btn, false); return }
    T.toast('info', res.message)
    repos.forEach((r) => {
      const b = $(`tr[data-repo="${CSS.escape(r)}"] [data-cell=drift]`)
      if (b) b.innerHTML = '<span class="t-spinner" data-size="sm" role="status" aria-label="Auditing"></span>'
    })
    const fin = await watchRun(res.run_id, (p) => { if (p.status !== 'running' && p.drift) paintDrift(p.repo, p.drift) })
    busy(btn, false)
    const t = fin.totals || {}
    T.toast(t.drift || t.failed ? 'warning' : 'success', `Audit done: ${t.clean ?? 0} in sync, ${t.drift ?? 0} drifting, ${t.failed ?? 0} failed`)
    swapMain()
  }

  /* ── Repo page: assigned sets, values, plan/apply, audit, delete ────────── */
  const repoName = () => { const p = $('#repo-page'); return p && p.dataset.repo }
  function valueOf(el) {
    if (el.matches('fieldset[data-value-multi]')) return $$('input:checked', el).map((b) => b.value).join(',')
    if (el.type === 'checkbox') return el.checked
    if (el.tagName === 'SELECT' && el.value === '__other') { const o = document.getElementById(el.dataset.other); return o ? o.value.trim() : '' }
    if (el.dataset.valueKind === 'number') return el.value === '' ? '' : Number(el.value)
    return el.value
  }
  function collectAssigned() {
    return $$('#assigned-sets .assigned-set').map((card) => {
      const values = {}
      $$('[data-value-key]', card).forEach((el) => {
        const v = valueOf(el)
        if (el.type === 'checkbox' ? el.dataset.present === '1' : v !== '') values[el.dataset.valueKey] = v
      })
      return { set: card.dataset.set, values }
    })
  }
  async function saveAssigned(row) {
    if (row) row.dataset.state = 'saving'
    const res = await api('PUT', '/ui/actions/repos/sets', { repo: repoName(), sets: collectAssigned() })
    if (row) row.dataset.state = res.ok ? 'saved' : 'failed'
    toast(res)
    if (!res.ok) swapMain() // revert to what the server holds
    return res
  }
  function paintOrder() {
    const cards = $$('#assigned-sets .assigned-set')
    cards.forEach((c, i) => {
      $('[data-action=set-up]', c).disabled = i === 0
      $('[data-action=set-down]', c).disabled = i === cards.length - 1
    })
  }
  actions['set-up'] = (btn) => { const c = btn.closest('.assigned-set'); if (c.previousElementSibling) { c.parentNode.insertBefore(c, c.previousElementSibling); paintOrder(); saveAssigned() } }
  actions['set-down'] = (btn) => { const c = btn.closest('.assigned-set'); if (c.nextElementSibling) { c.parentNode.insertBefore(c.nextElementSibling, c); paintOrder(); saveAssigned() } }
  actions['set-remove'] = (btn) => {
    const c = btn.closest('.assigned-set')
    c.hidden = true
    const sets = collectAssigned().filter((s) => s.set !== c.dataset.set)
    api('PUT', '/ui/actions/repos/sets', { repo: repoName(), sets }).then((res) => { toast(res); swapMain() })
  }
  actions['set-add'] = async (btn) => {
    const sel = $('#add-set')
    if (!sel || !sel.value) return
    const sets = [...collectAssigned(), { set: sel.value, values: {} }]
    busy(btn, true)
    const res = toast(await api('PUT', '/ui/actions/repos/sets', { repo: repoName(), sets }))
    busy(btn, false)
    if (res.ok) swapMain()
  }
  function initRepo(root) {
    const box = $('#assigned-sets', root)
    if (!box) return
    box.addEventListener('change', (e) => {
      const el = e.target.closest('[data-value-key]') || (e.target.id && $(`[data-other="${CSS.escape(e.target.id)}"]`))
      if (!el) return
      if (el.tagName === 'SELECT' && el.value === '__other' && e.target === el) return
      el.dataset.present = '1'
      saveAssigned(e.target.closest('.t-setting'))
    })
  }
  actions['repo-plan'] = async (btn) => {
    busy(btn, true)
    const res = await api('POST', '/ui/actions/plan', { repo: repoName() })
    busy(btn, false)
    toast(res)
    const body = $('#plan-body'), acts = $('#plan-actions')
    $('#apply-report').innerHTML = ''
    if (!res.ok) { body.innerHTML = `<div class="t-alert" data-tone="danger" role="alert">${icon('bi-x-circle')}<div class="t-alert-body">${esc(res.message)}</div></div>`; acts.hidden = true; return }
    body.innerHTML = res.html
    T.upgrade(body)
    body.dataset.plan = res.plan.id
    body.dataset.destructive = String(res.plan.destructive)
    acts.hidden = res.plan.changes === 0
    $('#plan').scrollIntoView({ block: 'start' })
  }
  actions['repo-apply'] = async (btn) => {
    const body = $('#plan-body'), repo = repoName()
    const destructive = Number(body.dataset.destructive || 0)
    let confirm
    if (destructive) {
      confirm = await typedConfirm({ title: `Apply ${plural(destructive, 'destructive change')}?`, body: `<p>Rows marked <b>destructive</b> delete or overwrite something on <b>${esc(repo)}</b> that cannot be restored from the template.</p>`, expect: repo, label: 'Apply' })
      if (confirm === null) return
    } else if (!(await T.confirm(`Apply to ${repo}?`, '<p>The changes in the plan are written to GitHub.</p>', { label: 'Apply', danger: false }))) return
    busy(btn, true)
    const res = toast(await api('POST', '/ui/actions/apply', { plan_id: body.dataset.plan, confirm }))
    busy(btn, false)
    if (res.ok) { $('#apply-report').innerHTML = res.html; $('#plan-actions').hidden = true; body.innerHTML = '<p class="t-muted">Applied. Plan again to compare the repo with its sets.</p>' }
  }
  actions['repo-audit'] = async (btn) => {
    busy(btn, true)
    const res = await api('POST', '/ui/actions/audit', { repos: [repoName()] })
    if (!res.ok) { toast(res); busy(btn, false); return }
    const fin = await watchRun(res.run_id, (p) => { if (p.drift) paintDrift(p.repo, p.drift) })
    busy(btn, false)
    const t = fin.totals || {}
    T.toast(t.failed ? 'danger' : t.drift ? 'warning' : 'success', t.failed ? 'Audit failed; see the events below' : t.drift ? `${repoName()} drifts from its sets` : `${repoName()} is in sync`)
    swapMain()
  }
  actions['repo-delete'] = async (btn) => {
    const repo = repoName()
    const typed = await typedConfirm({ title: `Delete ${repo}?`, body: `<p>The repository is deleted <b>on GitHub</b> with its issues, pull requests and wiki. This cannot be undone.</p>`, expect: repo, label: 'Delete repository' })
    if (typed === null) return
    busy(btn, true)
    const res = toast(await api('POST', '/ui/actions/repos/delete', { repo, confirm: typed }))
    busy(btn, false)
    if (res.ok) location.assign('/')
  }

  /* ── Audit: event diffs, filters ─────────────────────────────────────────── */
  function openEvent(row) {
    const tpl = $('template[data-role=diff]', row), dlg = $('#event-dlg')
    if (!tpl || !dlg) return
    const body = $('[data-role=body]', dlg)
    body.innerHTML = ''
    body.append(tpl.content.cloneNode(true))
    T.upgrade(body)
    dlg.showModal()
  }
  actions['event-open'] = (btn) => openEvent(btn.closest('tr'))
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('tr.event-row')) openEvent(e.target) })
  function initAudit(root) {
    const form = $('#audit-filter', root)
    if (!form) return
    form.addEventListener('change', async () => {
      const q = new URLSearchParams()
      for (const [k, v] of new FormData(form)) if (v) q.set(k, String(v))
      history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`)
      refreshBlock('events-block')
    })
  }
  actions['audit-all'] = async (btn) => {
    busy(btn, true)
    const res = await api('POST', '/ui/actions/audit', {})
    busy(btn, false)
    if (!res.ok) { toast(res); return }
    T.toast('info', res.message)
    watchRun(res.run_id).then((fin) => {
      const t = fin.totals || {}
      T.toast(t.drift || t.failed ? 'warning' : 'success', `Audit done: ${t.clean ?? 0} in sync, ${t.drift ?? 0} drifting, ${t.failed ?? 0} failed`)
    })
  }

  /* ── Templates and sets: delete with typed confirm ──────────────────────── */
  async function deleteNamed(btn, kind) {
    const name = btn.dataset.name
    const typed = await typedConfirm({ title: `Delete ${kind} ${name}?`, body: `<p>The ${kind} is removed from this instance. Repos keep their current GitHub settings.</p>`, expect: name, label: `Delete ${kind}` })
    if (typed === null) return
    busy(btn, true)
    const res = toast(await api('POST', `/ui/actions/${kind}s/delete`, { name, confirm: typed }))
    busy(btn, false)
    if (res.ok) { const tr = btn.closest('tr'); if (tr) tr.remove(); else location.assign(`/${kind}s`) }
  }
  actions['template-delete'] = (btn) => deleteNamed(btn, 'template')
  actions['set-delete'] = (btn) => deleteNamed(btn, 'set')

  /* ── Template editor: one form per section from its JSON Schema ─────────── */
  const WHOLE = /^\$\{\{\s*values\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/
  const humanise = (k) => String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  let editor = null
  function deref(node, root) {
    let n = node
    for (let i = 0; n && n.$ref && i < 10; i++) n = n.$ref.replace(/^#\//, '').split('/').reduce((o, p) => (o ? o[p] : undefined), root)
    return n || {}
  }
  /** One concrete schema for a node: refs resolved, `''`/null alternatives of a union dropped. */
  function concrete(node, root) {
    const n = deref(node, root)
    const alts = n.anyOf || n.oneOf
    if (!alts) return n
    const real = alts.map((a) => deref(a, root)).filter((a) => a.type !== 'null' && a.const !== '' && !(a.enum && a.enum.length === 1 && a.enum[0] === ''))
    if (real.length === 1) return { ...real[0], description: n.description || real[0].description, allowEmpty: real.length < alts.length }
    if (real.every((a) => a.const !== undefined || a.enum)) return { type: 'string', enum: real.flatMap((a) => (a.enum ? a.enum : [a.const])), description: n.description }
    return { ...n, unionOf: real }
  }
  const isColor = (key, s) => /colou?r$/.test(key) && s.type === 'string'
  const isCode = (key, s) => s.type === 'string' && (/^(content|body|script|text)$/.test(key) || (s.maxLength && s.maxLength > 2000))
  function defaultFor(s, root) {
    s = concrete(s, root)
    if (s.default !== undefined) return s.default
    if (s.enum) return s.enum[0]
    switch (s.type) {
      case 'boolean': return true
      case 'integer': case 'number': return s.minimum ?? 0
      case 'array': return []
      case 'object': {
        const o = {}
        for (const k of s.required || []) o[k] = defaultFor((s.properties || {})[k] || {}, root)
        return o
      }
      default: return ''
    }
  }
  const el = (tag, attrs, html) => {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v))
    if (html !== undefined) e.innerHTML = html
    return e
  }
  let uid = 0
  /**
   * Renders the control for one value. `get()` reads the current value, `set(v)` stores it and re-renders the preview.
   * Scalars can be bound to a `${{ values.key }}` placeholder (the key is a genuinely new name, typed once).
   */
  function control(schema, key, value, set, root) {
    let s = concrete(schema, root)
    if (s.unionOf) {
      // A union (list or comma string, …): the branch that fits the current value, else the first.
      const fits = (b) => (Array.isArray(value) ? b.type === 'array' : value === undefined ? true : typeof value === 'string' ? b.type === 'string' : typeof value === 'boolean' ? b.type === 'boolean' : typeof value === 'number' ? b.type === 'number' || b.type === 'integer' : b.type === 'object')
      s = { ...(s.unionOf.find(fits) || s.unionOf[0]), description: s.description }
    }
    const id = `f-${++uid}`
    const wrap = el('div', { class: 'schema-control' })
    const scalar = ['boolean', 'string', 'integer', 'number'].includes(s.type) || s.enum
    if (scalar && typeof value === 'string' && WHOLE.test(value)) {
      const name = WHOLE.exec(value)[1]
      wrap.innerHTML = `<div class="t-input-group" data-size="sm"><span class="t-input-addon">${icon('bi-code-slash')} value</span><input class="t-input t-mono" data-size="sm" id="${id}" value="${esc(name)}" aria-label="Value key for ${esc(humanise(key))}" pattern="[A-Za-z_][A-Za-z0-9_]*"><button class="t-btn" type="button" data-size="sm" data-icon="only" aria-label="Use a fixed value" data-tip="Use a fixed value">${icon('bi-x-lg')}</button></div>`
      const input = $('input', wrap)
      input.addEventListener('change', () => { if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.value)) set(`\${{ values.${input.value} }}`) })
      $('button', wrap).addEventListener('click', () => { set(defaultFor(s, root)); rerender() })
      return wrap
    }
    let inner
    if (s.enum) {
      inner = el('select', { class: 't-select', 'data-size': 'sm', id, 'aria-label': humanise(key) }, s.enum.map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join(''))
      inner.addEventListener('change', () => set(inner.value))
    } else if (s.type === 'boolean') {
      inner = el('label', { class: 't-check', 'data-variant': 'switch' }, `<input class="t-check-input" type="checkbox" role="switch" id="${id}"${value ? ' checked' : ''}><span class="t-check-label">${value ? 'on' : 'off'}</span>`)
      $('input', inner).addEventListener('change', (e) => set(e.target.checked))
    } else if (s.type === 'integer' || s.type === 'number') {
      inner = el('input', { class: 't-input', 'data-size': 'sm', type: 'number', id, value: value ?? '', min: s.minimum, max: s.maximum, step: s.type === 'integer' ? 1 : 'any', 'aria-label': humanise(key) })
      inner.addEventListener('change', () => set(inner.value === '' ? undefined : Number(inner.value)))
    } else if (s.type === 'string' && isColor(key, s)) {
      // Label colours: GitHub stores hex without '#'; the picker offers the palette swatches.
      inner = el('input', { class: 't-input', type: 'color', id, value: `#${String(value || 'ededed').replace(/^#/, '')}`, 'data-size': 'sm', 'data-width': 'auto', 'aria-label': humanise(key) })
      inner.addEventListener('change', () => set(inner.value.replace(/^#/, '').toLowerCase()))
    } else if (s.type === 'string' && isCode(key, s)) {
      inner = el('textarea', { class: 't-textarea t-mono', rows: 8, id, spellcheck: 'false', 'data-enter': 'newline', 'aria-label': humanise(key) })
      inner.value = value ?? ''
      inner.addEventListener('input', () => set(inner.value))
    } else if (s.type === 'string') {
      inner = el('input', { class: 't-input', 'data-size': 'sm', id, value: value ?? '', maxlength: s.maxLength, type: s.format === 'uri' ? 'url' : 'text', 'aria-label': humanise(key), autocomplete: 'off' })
      inner.addEventListener('change', () => set(inner.value))
    } else if (s.type === 'array') {
      return arrayControl(s, key, Array.isArray(value) ? value : [], set, root)
    } else if (s.type === 'object') {
      return objectControl(s, value && typeof value === 'object' ? value : {}, set, root)
    } else {
      inner = el('textarea', { class: 't-textarea t-mono', rows: 4, id, spellcheck: 'false', 'data-enter': 'newline', 'aria-label': `${humanise(key)} (JSON)` })
      inner.value = value === undefined ? '' : JSON.stringify(value, null, 2)
      inner.addEventListener('change', () => { try { set(inner.value.trim() ? JSON.parse(inner.value) : undefined); inner.removeAttribute('aria-invalid') } catch { inner.setAttribute('aria-invalid', 'true') } })
    }
    wrap.append(inner)
    if (scalar) {
      const bind = el('button', { class: 't-btn', type: 'button', 'data-size': 'xs', 'data-variant': 'ghost', 'data-icon': 'only', 'aria-label': `Fill ${humanise(key)} from a value`, 'data-tip': 'Fill from a per-repo value' }, icon('bi-code-slash'))
      bind.addEventListener('click', () => { set(`\${{ values.${String(key).replace(/[^A-Za-z0-9_]/g, '_')} }}`); rerender() })
      wrap.append(bind)
    }
    return wrap
  }
  function arrayControl(s, key, list, set, root) {
    const items = concrete(s.items || {}, root)
    const wrap = el('div', { class: 'schema-array t-stack', 'data-gap': '2' })
    if (items.enum) {
      // Enumerable values: one checkbox each.
      wrap.innerHTML = `<fieldset class="t-check-group schema-checks"><legend class="t-visually-hidden">${esc(humanise(key))}</legend>${items.enum.map((o) => `<label class="t-check"><input class="t-check-input" type="checkbox" value="${esc(o)}"${list.includes(o) ? ' checked' : ''}><span class="t-check-label">${esc(o)}</span></label>`).join('')}</fieldset>`
      wrap.addEventListener('change', () => set($$('input:checked', wrap).map((b) => b.value)))
      return wrap
    }
    if (items.type === 'string' || items.type === 'number' || items.type === 'integer') {
      // A list of new names (topics, patterns): chips plus one entry field, Enter adds.
      const paint = () => {
        wrap.innerHTML = `<div class="t-cluster" data-gap="1">${list.map((v, i) => `<span class="t-chip" data-tone="accent">${esc(v)} <button type="button" class="t-chip-remove" data-i="${i}" aria-label="Remove ${esc(v)}">×</button></span>`).join('')}</div><input class="t-input" data-size="sm" aria-label="Add to ${esc(humanise(key))}" placeholder="Type and press Enter to add">`
        const input = $('input', wrap)
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const v = input.value.trim()
          if (!v || list.includes(v)) return
          list = [...list, items.type === 'string' ? v : Number(v)]
          set(list); paint(); $('input', wrap).focus()
        })
        $$('.t-chip-remove', wrap).forEach((b) => b.addEventListener('click', () => { list = list.filter((_, i) => i !== Number(b.dataset.i)); set(list); paint() }))
      }
      paint()
      return wrap
    }
    // Objects: one row editor per item, add/remove/reorder.
    const paint = () => {
      wrap.innerHTML = ''
      list.forEach((item, i) => {
        const card = el('div', { class: 't-card schema-item', 'data-size': 'sm' })
        const title = item && typeof item === 'object' ? item.name || item.path || item.url || item.pattern || `#${i + 1}` : `#${i + 1}`
        card.innerHTML = `<div class="t-card-header"><h4 class="t-card-title">${esc(title)}</h4><div class="t-card-tools t-cluster" data-gap="1"><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-op="up" aria-label="Move up" data-tip="Move up"${i === 0 ? ' disabled' : ''}>${icon('bi-arrow-up')}</button><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-op="down" aria-label="Move down" data-tip="Move down"${i === list.length - 1 ? ' disabled' : ''}>${icon('bi-arrow-down')}</button><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger" data-icon="only" data-op="remove" aria-label="Remove" data-tip="Remove">${icon('bi-x-lg')}</button></div></div><div class="t-card-body"></div>`
        $('.t-card-body', card).append(control(items, key, item, (v) => { list = list.map((x, j) => (j === i ? v : x)); set(list) }, root))
        card.addEventListener('click', (e) => {
          const b = e.target.closest('[data-op]')
          if (!b || b.closest('.schema-item') !== card) return
          const op = b.dataset.op, next = list.slice()
          if (op === 'remove') next.splice(i, 1)
          if (op === 'up') [next[i - 1], next[i]] = [next[i], next[i - 1]]
          if (op === 'down') [next[i + 1], next[i]] = [next[i], next[i + 1]]
          list = next; set(list); paint()
        })
        wrap.append(card)
      })
      const add = el('button', { class: 't-btn', type: 'button', 'data-size': 'sm' }, `${icon('bi-plus-lg')} Add ${esc(humanise(key).replace(/s$/, ''))}`)
      add.addEventListener('click', () => { list = [...list, defaultFor(items, root)]; set(list); paint() })
      wrap.append(add)
      T.upgrade(wrap)
    }
    paint()
    return wrap
  }
  /** Object: one row per property; optional properties carry a "manage" box (unticked = left out of the template). */
  function objectControl(s, obj, set, root) {
    const props = s.properties || {}
    const required = new Set(s.required || [])
    const wrap = el('div', { class: 'schema-object' })
    if (!Object.keys(props).length && s.additionalProperties && typeof s.additionalProperties === 'object') return recordControl(s, obj, set, root)
    for (const [k, ps] of Object.entries(props)) {
      const pc = concrete(ps, root)
      const present = Object.hasOwn(obj, k)
      const complex = pc.type === 'object' || pc.type === 'array' || Boolean(pc.unionOf)
      const row = el('div', { class: 'schema-row', 'data-key': k, 'data-present': present ? 'true' : 'false', 'data-complex': complex ? 'true' : 'false' })
      const help = pc.description ? `<span class="t-help" data-tone="info"><button class="t-help-btn" type="button" aria-expanded="false" aria-label="About ${esc(humanise(k))}">i</button><div class="t-help-box" hidden><p>${esc(pc.description)}</p></div></span>` : ''
      row.innerHTML = `<div class="schema-label">${required.has(k) ? `<span class="t-label">${esc(humanise(k))}</span>` : `<label class="t-check"><input class="t-check-input" type="checkbox" data-manage aria-label="Manage ${esc(humanise(k))}"${present ? ' checked' : ''}><span class="t-check-label">${esc(humanise(k))}</span></label>`}${help}</div><div class="schema-slot"></div>`
      const slot = $('.schema-slot', row)
      const paintCtl = () => {
        slot.innerHTML = ''
        if (!Object.hasOwn(obj, k) && !required.has(k)) { slot.innerHTML = '<span class="t-small t-muted">not managed</span>'; return }
        slot.append(control(ps, k, obj[k], (v) => { obj = { ...obj, [k]: v }; if (v === undefined) delete obj[k]; set(obj) }, root))
        T.upgrade(slot)
      }
      const box = $('[data-manage]', row)
      if (box) box.addEventListener('change', (e) => {
        if (e.target !== box) return
        if (box.checked) obj = { ...obj, [k]: defaultFor(ps, root) }
        else { obj = { ...obj }; delete obj[k] }
        row.dataset.present = String(box.checked)
        set(obj); paintCtl()
      })
      paintCtl()
      wrap.append(row)
    }
    return wrap
  }
  /** Map with free keys (record): key = new name, value by the value schema. */
  function recordControl(s, obj, set, root) {
    const wrap = el('div', { class: 't-stack', 'data-gap': '2' })
    const paint = () => {
      wrap.innerHTML = ''
      for (const [k, v] of Object.entries(obj)) {
        const row = el('div', { class: 't-cluster', 'data-gap': '2', 'data-align': 'start' })
        row.append(el('code', {}, esc(k)))
        row.append(control(s.additionalProperties, k, v, (nv) => { obj = { ...obj, [k]: nv }; set(obj) }, root))
        const rm = el('button', { class: 't-btn', type: 'button', 'data-size': 'xs', 'data-variant': 'ghost', 'data-tone': 'danger', 'data-icon': 'only', 'aria-label': `Remove ${k}`, 'data-tip': 'Remove' }, icon('bi-x-lg'))
        rm.addEventListener('click', () => { obj = { ...obj }; delete obj[k]; set(obj); paint() })
        row.append(rm)
        wrap.append(row)
      }
      const add = el('div', { class: 't-input-group', 'data-size': 'sm' }, `<input class="t-input" data-size="sm" placeholder="New key, Enter adds" aria-label="New key">`)
      $('input', add).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const k = e.target.value.trim()
        if (!k || Object.hasOwn(obj, k)) return
        obj = { ...obj, [k]: defaultFor(s.additionalProperties, root) }
        set(obj); paint()
      })
      wrap.append(add)
      T.upgrade(wrap)
    }
    paint()
    return wrap
  }
  function rerender() { if (editor && editor.render) editor.render() }
  function sectionOrder(name) { const i = editor.infos.findIndex((s) => s.name === name); return i < 0 ? 999 : i }
  function initTemplateEditor(root) {
    const form = $('#template-form', root)
    if (!form) return
    const infos = JSON.parse($('#sections-data').textContent)
    const doc = JSON.parse($('#template-data').textContent)
    editor = { infos, doc, render: null }
    const cards = $('#section-cards', form)
    const render = () => {
      cards.innerHTML = ''
      const names = Object.keys(editor.doc.sections).sort((a, b) => sectionOrder(a) - sectionOrder(b))
      if (!names.length) cards.innerHTML = '<div class="t-empty" data-size="sm"><p>No sections yet: pick one below and press Add section.</p></div>'
      for (const name of names) {
        const info = infos.find((s) => s.name === name) || { name, title: name, description: 'Unknown section', jsonSchema: {} }
        const card = el('div', { class: 't-card section-card', 'data-section': name })
        card.innerHTML = `<div class="t-card-header"><h3 class="t-card-title">${esc(info.title)}</h3><div class="t-card-tools"><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger" data-icon="only" aria-label="Remove section ${esc(info.title)}" data-tip="Remove section">${icon('bi-x-lg')}</button></div></div><div class="t-card-body t-stack" data-gap="2"><p class="t-small t-muted">${esc(info.description)}</p></div>`
        $('.t-card-tools button', card).addEventListener('click', () => { delete editor.doc.sections[name]; render(); changed() })
        $('.t-card-body', card).append(control(info.jsonSchema, name, editor.doc.sections[name], (v) => { editor.doc.sections[name] = v ?? {}; changed() }, info.jsonSchema))
        cards.append(card)
      }
      const add = $('#add-section')
      $$('option', add).forEach((o) => { o.disabled = Object.hasOwn(editor.doc.sections, o.value) })
      const free = $$('option', add).find((o) => !o.disabled)
      if (free) { add.value = free.value; T.sync(add) }
      T.upgrade(cards)
    }
    editor.render = render
    actions['section-add'] = () => {
      const add = $('#add-section')
      if (!add.value || Object.hasOwn(editor.doc.sections, add.value)) return
      const info = infos.find((s) => s.name === add.value)
      editor.doc.sections[add.value] = info ? defaultFor(info.jsonSchema, info.jsonSchema) : {}
      render(); changed()
      const card = $(`[data-section="${CSS.escape(add.value)}"]`)
      if (card) card.scrollIntoView({ block: 'nearest' })
    }
    form.addEventListener('change', (e) => { if (e.target.closest('#section-cards')) return; changed() })
    form.addEventListener('input', (e) => { if (e.target.matches('#tpl-title, #tpl-desc')) changed() })
    render()
    changed()
  }
  function templateDoc() {
    const form = $('#template-form')
    const name = $('#tpl-name').dataset.slug
    const description = $('#tpl-desc', form).value.trim()
    const vis = $('[name=visibility]:checked', form).value
    return {
      apiVersion: 'octowarden/v1',
      kind: 'Template',
      metadata: { name, ...(description ? { description } : {}) },
      spec: { sections: editor.doc.sections, ...(vis !== 'any' ? { requires: { visibility: vis } } : {}) },
    }
  }
  let previewTimer
  function changed() {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(async () => {
      const isSet = Boolean($('#set-form'))
      const doc = isSet ? setDoc() : templateDoc()
      const res = await api('POST', `/ui/actions/${isSet ? 'sets' : 'templates'}/preview`, { doc })
      if (!res.ok) return
      $('#yaml-preview').textContent = res.yaml
      const state = $('#yaml-state'), err = $('#yaml-error')
      state.dataset.tone = res.valid ? 'success' : 'danger'
      state.textContent = res.valid ? 'valid' : 'invalid'
      err.hidden = res.valid
      err.textContent = res.valid ? '' : res.message
    }, 250)
  }
  async function saveTemplate(btn) {
    const doc = templateDoc()
    if (!doc.metadata.name) { T.toast('warning', 'Give the template a name first'); $('#tpl-title').focus(); return }
    busy(btn, true)
    const res = toast(await api('PUT', '/ui/actions/templates', { doc }))
    busy(btn, false)
    if (res.ok && res.created) location.assign(`/templates/${doc.metadata.name}`)
  }
  actions['template-save'] = (btn) => saveTemplate(btn)

  /* ── Set editor: ordered templates, values, assignment ──────────────────── */
  let setEd = null
  function initSetEditor(root) {
    const form = $('#set-form', root)
    if (!form) return
    const data = JSON.parse($('#set-data').textContent)
    setEd = { doc: data.doc, fields: data.fields, templates: data.templates, assigned: data.assigned, lookups: null, lookupInfo: null }
    if (data.name && data.assigned > 0) {
      api('GET', `/ui/actions/sets/lookups?set=${encodeURIComponent(data.name)}`).then((res) => {
        setEd.lookups = res.ok ? res.lookups : { branches: [], checks: [], teams: [], environments: [] }
        setEd.lookupInfo = res.ok ? res : { error: res.message }
        paintValues()
      })
    }
    const list = $('#set-templates', form)
    let dragFrom = -1
    const paintList = () => {
      const t = setEd.doc.templates
      $('#set-templates-empty').hidden = t.length > 0
      list.innerHTML = t.map((name, i) => {
        const info = setEd.templates.find((x) => x.name === name)
        return `<li class="set-order-item" draggable="true" data-i="${i}"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="t-counter">${i + 1}</span><span class="set-order-name"><b>${esc(name)}</b>${info && info.builtin ? ' <span class="t-badge" data-size="xs" data-tone="info">built-in</span>' : ''}${info ? '' : ' <span class="t-badge" data-size="xs" data-tone="danger">missing</span>'}${info && info.description ? `<span class="t-small t-muted"> · ${esc(info.description)}</span>` : ''}</span><span class="t-cluster" data-gap="1"><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-op="up" aria-label="Move ${esc(name)} up" data-tip="Move up"${i === 0 ? ' disabled' : ''}>${icon('bi-arrow-up')}</button><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-op="down" aria-label="Move ${esc(name)} down" data-tip="Move down"${i === t.length - 1 ? ' disabled' : ''}>${icon('bi-arrow-down')}</button><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger" data-icon="only" data-op="remove" aria-label="Remove ${esc(name)}" data-tip="Remove">${icon('bi-x-lg')}</button></span></li>`
      }).join('')
      const add = $('#add-template')
      $$('option', add).forEach((o) => { o.disabled = t.includes(o.value) })
      const free = $$('option', add).find((o) => !o.disabled)
      if (free) { add.value = free.value; T.sync(add) }
      paintValues()
      changed()
    }
    const move = (from, to) => {
      const t = setEd.doc.templates.slice()
      const [x] = t.splice(from, 1)
      t.splice(to, 0, x)
      setEd.doc.templates = t
      paintList()
    }
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-op]')
      if (!b) return
      const i = Number(b.closest('li').dataset.i)
      if (b.dataset.op === 'up' && i > 0) move(i, i - 1)
      if (b.dataset.op === 'down') move(i, i + 1)
      if (b.dataset.op === 'remove') { setEd.doc.templates = setEd.doc.templates.filter((_, j) => j !== i); paintList() }
    })
    list.addEventListener('dragstart', (e) => { const li = e.target.closest('li'); if (li) { dragFrom = Number(li.dataset.i); e.dataTransfer.effectAllowed = 'move' } })
    list.addEventListener('dragover', (e) => { if (dragFrom >= 0) e.preventDefault() })
    list.addEventListener('drop', (e) => { e.preventDefault(); const li = e.target.closest('li'); if (li && dragFrom >= 0) move(dragFrom, Number(li.dataset.i)); dragFrom = -1 })
    actions['template-add'] = () => {
      const add = $('#add-template')
      if (!add.value || setEd.doc.templates.includes(add.value)) return
      setEd.doc.templates = [...setEd.doc.templates, add.value]
      paintList()
    }
    form.addEventListener('input', (e) => { if (e.target.matches('#set-title, #set-desc')) changed() })
    paintList()
  }
  function mergedFields() {
    const out = new Map()
    for (const t of setEd.doc.templates) for (const f of setEd.fields[t] || []) if (!out.has(f.key)) out.set(f.key, f)
    return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
  }
  function paintValues() {
    const box = $('#set-values')
    const fields = mergedFields()
    const keys = new Set(fields.map((f) => f.key))
    const extra = Object.keys(setEd.doc.values).filter((k) => !keys.has(k))
    $('#set-values-empty').hidden = fields.length + extra.length > 0
    box.innerHTML = ''
    const row = (key, inner, note) => {
      const r = el('div', { class: 't-setting', 'data-key': key })
      r.innerHTML = `<div class="t-setting-label"><label class="t-mono" for="sv-${esc(key)}">${esc(key)}</label><span class="t-help" data-tone="info"><button class="t-help-btn" type="button" aria-expanded="false" aria-label="About ${esc(key)}">i</button><div class="t-help-box" hidden><p>${esc(note)}</p></div></span></div><div class="t-setting-control"></div>`
      $('.t-setting-control', r).append(inner)
      box.append(r)
    }
    for (const f of fields) {
      const v = setEd.doc.values[f.key]
      let inner
      if (f.kind === 'boolean') {
        inner = el('div', { class: 't-cluster', 'data-gap': '2' }, `<select class="t-select" data-size="sm" data-width="auto" id="sv-${esc(f.key)}"><option value="">No default</option><option value="true"${v === true ? ' selected' : ''}>On</option><option value="false"${v === false ? ' selected' : ''}>Off</option></select>`)
        $('select', inner).addEventListener('change', (e) => setValue(f.key, e.target.value === '' ? undefined : e.target.value === 'true'))
      } else if (f.kind === 'enum' && f.options) {
        inner = el('select', { class: 't-select', 'data-size': 'sm', id: `sv-${f.key}` }, `<option value="">No default</option>${f.options.map((o) => `<option value="${esc(o)}"${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}`)
        inner.addEventListener('change', () => setValue(f.key, inner.value || undefined))
      } else if (f.kind === 'number') {
        inner = el('input', { class: 't-input', 'data-size': 'sm', type: 'number', id: `sv-${f.key}`, value: v ?? '' })
        inner.addEventListener('change', () => setValue(f.key, inner.value === '' ? undefined : Number(inner.value)))
      } else if (f.kind === 'text') {
        inner = el('textarea', { class: 't-textarea t-mono', rows: 4, id: `sv-${f.key}`, 'data-enter': 'newline' })
        inner.value = v ?? ''
        inner.addEventListener('input', () => setValue(f.key, inner.value || undefined))
      } else if (f.lookup) {
        inner = lookupValue(f, v)
      } else {
        inner = el('input', { class: 't-input', 'data-size': 'sm', id: `sv-${f.key}`, value: v ?? '' })
        inner.addEventListener('change', () => setValue(f.key, inner.value === '' ? undefined : inner.value))
      }
      row(f.key, inner, `Used in ${f.used_in.join(', ')}. Empty: every repo must set it.`)
    }
    for (const k of extra) {
      const inner = el('div', { class: 't-cluster', 'data-gap': '2' }, `<code>${esc(String(setEd.doc.values[k]))}</code><button type="button" class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger">Remove</button>`)
      $('button', inner).addEventListener('click', () => setValue(k, undefined, true))
      row(k, inner, 'No template of this set uses this value any more.')
    }
    T.upgrade(box)
  }
  /**
   * Default for a placeholder that names branches, checks, teams or environments: picked from the union of the
   * lookups of the repos the set is assigned to; "Other…" reveals a text field. Without repos: text plus a note.
   */
  function lookupValue(f, v) {
    const wrap = el('div', { class: 't-stack', 'data-gap': '1' })
    const current = String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    const hint = (text, danger) => el('p', { class: danger ? 't-small t-feedback' : 't-small t-muted', 'data-tone': danger ? 'danger' : undefined }, esc(text))
    const textField = (note, danger) => {
      const input = el('input', { class: 't-input', 'data-size': 'sm', id: `sv-${f.key}`, value: v ?? '', placeholder: f.multi ? 'Comma-separated' : '' })
      input.addEventListener('change', () => setValue(f.key, input.value.trim() === '' ? undefined : input.value.trim()))
      wrap.append(input, hint(note, danger))
      return wrap
    }
    if (!setEd.assigned) return textField(`Assign this set to a repo to pick from its ${f.lookup}.`)
    if (!setEd.lookups) return textField(`Loading ${f.lookup} from the assigned repos…`)
    const info = setEd.lookupInfo || {}
    if (info.error) return textField(`Could not read ${f.lookup} from the assigned repos: ${info.error}`, true)
    const known = setEd.lookups[f.lookup] || []
    const from = `from ${plural(info.repos.length, 'assigned repo')}${info.total > info.repos.length ? ` (first ${info.repos.length} of ${info.total})` : ''}${info.failed && info.failed.length ? `, ${info.failed.length} unreadable` : ''}`
    if (!known.length) return textField(`No ${f.lookup} found on the assigned repos (${from}).`)
    const other = el('input', { class: 't-input', 'data-size': 'sm', 'aria-label': `Other ${f.key}`, placeholder: f.multi ? 'Other values, comma-separated' : 'Other value' })
    const extra = current.filter((x) => !known.includes(x))
    if (f.multi) {
      const box = el('fieldset', { class: 't-check-group value-multi' }, `<legend class="t-visually-hidden">${esc(f.key)}</legend>${known.map((o) => `<label class="t-check"><input class="t-check-input" type="checkbox" value="${esc(o)}"${current.includes(o) ? ' checked' : ''}><span class="t-check-label">${esc(o)}</span></label>`).join('')}<label class="t-check"><input class="t-check-input" type="checkbox" data-other${extra.length ? ' checked' : ''}><span class="t-check-label">Other…</span></label>`)
      other.value = extra.join(',')
      other.hidden = !extra.length
      const save = () => {
        const otherOn = $('[data-other]', box).checked
        other.hidden = !otherOn
        const picked = $$('input:checked:not([data-other])', box).map((b) => b.value)
        const more = otherOn ? other.value.split(',').map((x) => x.trim()).filter(Boolean) : []
        const all = [...new Set([...picked, ...more])]
        setValue(f.key, all.length ? all.join(',') : undefined)
      }
      box.addEventListener('change', (e) => { save(); if (e.target.matches('[data-other]') && e.target.checked) other.focus() })
      other.addEventListener('change', save)
      wrap.append(box, other, hint(`Choices ${from}.`))
      return wrap
    }
    const isOther = current.length > 0 && !known.includes(current[0])
    const sel = el('select', { class: 't-select', 'data-size': 'sm', id: `sv-${f.key}` }, `<option value="">No default</option>${known.map((o) => `<option value="${esc(o)}"${current[0] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}<option value="__other"${isOther ? ' selected' : ''}>Other…</option>`)
    other.value = isOther ? String(v) : ''
    other.hidden = !isOther
    sel.addEventListener('change', () => {
      other.hidden = sel.value !== '__other'
      if (sel.value === '__other') { other.focus(); return }
      setValue(f.key, sel.value || undefined)
    })
    other.addEventListener('change', () => setValue(f.key, other.value.trim() || undefined))
    wrap.append(sel, other, hint(`Choices ${from}.`))
    return wrap
  }
  function setValue(key, v, repaint) {
    const values = { ...setEd.doc.values }
    if (v === undefined) delete values[key]
    else values[key] = v
    setEd.doc.values = values
    if (repaint) paintValues()
    changed()
  }
  function setDoc() {
    const form = $('#set-form')
    const name = $('#set-name').dataset.slug
    const description = $('#set-desc', form).value.trim()
    return {
      apiVersion: 'octowarden/v1',
      kind: 'Set',
      metadata: { name, ...(description ? { description } : {}) },
      spec: { templates: setEd.doc.templates, ...(Object.keys(setEd.doc.values).length ? { values: setEd.doc.values } : {}) },
    }
  }
  async function saveSet(btn) {
    const doc = setDoc()
    if (!doc.metadata.name) { T.toast('warning', 'Give the set a name first'); $('#set-title').focus(); return }
    if (!doc.spec.templates.length) { T.toast('warning', 'Add at least one template'); return }
    busy(btn, true)
    const res = toast(await api('PUT', '/ui/actions/sets', { doc }))
    busy(btn, false)
    if (res.ok && res.created) location.assign(`/sets/${doc.metadata.name}`)
  }
  actions['set-save'] = (btn) => saveSet(btn)
  actions['set-assign-open'] = () => { const d = $('#assign-dlg'); if (d) d.showModal() }
  document.addEventListener('input', (e) => {
    if (!e.target.matches || !e.target.matches('[data-assign-filter]')) return
    const q = e.target.value.toLowerCase()
    $$('.assign-list .t-check').forEach((l) => { l.hidden = !l.dataset.name.includes(q) })
  })

  /* ── Boot ────────────────────────────────────────────────────────────────── */
  function initPage(root) {
    initSettings(root)
    initRepos(root)
    initRepo(root)
    initAudit(root)
    initTemplateEditor(root)
    initSetEditor(root)
  }
  function boot() {
    initTheme()
    initPage(document)
    connect()
  }
  // After tailor's own DOMContentLoaded upgrade (its script is deferred before this one).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot)); else setTimeout(boot)
})()
