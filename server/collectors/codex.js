// Local Codex rollouts, not the codex exec --json or app-server wire protocol.
import os from 'node:os'
import path from 'node:path'
import { readJsonl, walk, newPrompt, durationBetween } from './util.js'

export function listFiles() {
  return walk(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'), (f) => f.endsWith('.jsonl'))
}

// A paginated rollout stores only its own suffix. Ordinals in history_base
// include the inherited prefix, while the filename identifies the physical page.
export function parseFiles(files, match) {
  const pages = new Map()
  for (const file of new Set(files)) {
    const reader = readJsonl(file)
    const first = reader.next().value
    reader.return()
    if (first?.type !== 'session_meta' || !match(first.payload?.cwd)) continue
    const meta = first.payload
    const pageId = path.basename(file).match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\.jsonl$/i)?.[1] || meta.id
    if (pages.has(pageId)) throw new Error(`Página de histórico do Codex ambígua: ${pageId}`)
    pages.set(pageId, { file, meta })
  }
  function* history(page, limit = Infinity, visiting = new Set()) {
    if (visiting.has(page)) throw new Error('Ciclo no histórico paginado do Codex')
    visiting.add(page)
    let count = 0
    try {
      const base = page.meta.history_base
      if (base) {
        const parent = pages.get(base.thread_id)
        if (!parent || parent.meta.id !== page.meta.id) throw new Error(`${page.file}: base de histórico ausente ou de outra sessão`)
        if (!Number.isSafeInteger(base.end_ordinal_exclusive) || base.end_ordinal_exclusive < 0) throw new Error(`${page.file}: limite de histórico inválido`)
        for (const e of history(parent, Math.min(limit, base.end_ordinal_exclusive), visiting)) {
          yield e
          count++
        }
      }
      if (count >= limit) return
      let ordinal = 0
      for (const e of readJsonl(page.file)) {
        yield { ...e, _origin: `${page.file}:${ordinal++}` }
        if (++count >= limit) return
      }
      if (count < limit && limit !== Infinity) throw new Error(`${page.file}: base de histórico incompleta`)
    } finally {
      visiting.delete(page)
    }
  }
  // Preference for modern usage applies to the whole logical thread, including
  // records written on another page of the same turn.
  const accounting = { recordTurns: new Set() }
  const pageCounts = new Map()
  for (const { meta } of pages.values()) pageCounts.set(meta.id, (pageCounts.get(meta.id) || 0) + 1)
  for (const page of pages.values()) {
    if (pageCounts.get(page.meta.id) === 1) continue
    let turn = ''
    for (const e of history(page)) {
      const p = e.payload || {}
      if (e.type === 'turn_context' || (e.type === 'event_msg' && p.type === 'task_started')) turn = turnOf(p) || turn
      if (e.type === 'token_usage_record' && (!p.thread_id || p.thread_id === page.meta.id)) {
        accounting.recordTurns.add(JSON.stringify([page.meta.id, turnOf(p) || turn]))
      }
    }
  }
  const threads = new Map()
  for (const page of pages.values()) {
    const r = parseFile(page.file, match, history(page), accounting)
    if (!r) continue
    let thread = threads.get(r.thread_id)
    if (!thread) {
      thread = { ...r, prompts: [], byOrigin: new Map() }
      threads.set(r.thread_id, thread)
    }
    if (r.session.started_at < thread.session.started_at) {
      thread.session.started_at = r.session.started_at
      thread.session.source_file = r.session.source_file
    }
    if (r.session.ended_at > thread.session.ended_at) thread.session.ended_at = r.session.ended_at
    for (const p of r.prompts) {
      const existing = thread.byOrigin.get(p._origin)
      if (!existing) {
        thread.byOrigin.set(p._origin, p)
        thread.prompts.push(p)
      } else {
        if (p._turnResolved && !existing._turnResolved) {
          existing.turn_id = p.turn_id
          existing.root_turn_id = p.root_turn_id
          existing.model = p.model
          existing._turnResolved = true
        }
        for (const key of ['input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'reasoning_tokens', 'model_calls', 'tool_calls']) existing[key] += p[key]
        existing.duration_ms = Math.max(existing.duration_ms, p.duration_ms)
        existing.model ||= p.model
        existing.turn_id ||= p.turn_id
        existing.root_turn_id ||= p.root_turn_id
      }
    }
  }
  return [...threads.values()].map(({ byOrigin, ...r }) => {
    r.prompts.sort((a, b) => a.ts.localeCompare(b.ts) || a._origin.localeCompare(b._origin))
    r.session.model = r.prompts.findLast(p => p.model)?.model || null
    return r
  })
}

const textOf = (content) => typeof content === 'string' ? content : (content || [])
  .filter((c) => ['input_text', 'text', 'Text'].includes(c.type)).map((c) => c.text || '').join('\n')
const turnOf = (p) => p.turn_id || p.internal_chat_message_metadata_passthrough?.turn_id
const NO_TEXT = '[Entrada sem texto]'
const hasImages = (content) => Array.isArray(content) && content.some((c) => c.type === 'input_image')
const amount = (v) => Number.isFinite(v) && v >= 0 ? v : 0

function userText(p) {
  const text = textOf(p.content)
  const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds
  if (kinds?.length) {
    const parts = (p.content || []).filter((_, i) => kinds[i]?.startsWith('user.'))
    return textOf(parts) || (kinds.some((k) => k.startsWith('user.')) ? '[Entrada sem texto]' : null)
  }
  if (/^\s*(<environment_context>|# AGENTS\.md instructions|<permissions instructions>|<turn_aborted>)/.test(text)) return null
  return text.trim() ? text : hasImages(p.content) ? NO_TEXT : null
}

export function parseFile(file, match, entries = readJsonl(file), accounting = {}) {
  let meta, initialMeta, sourceFile = file
  // Retain only relevant events; never load entire rollouts or encrypted reasoning.
  const events = []
  const recordTurns = new Set()
  let pendingPrompts = []
  let turn = ''
  let turnHasActivity = false
  let ordinal = 0
  for (const e of entries) {
    const origin = e._origin || `${file}:${ordinal++}`
    const p = e.payload || {}
    if (e.type === 'session_meta') {
      meta = { ...p, timestamp: p.timestamp || e.timestamp }
      if (!match(p.cwd)) return null
      if (!initialMeta) {
        initialMeta = meta
        if (e._origin) sourceFile = e._origin.slice(0, e._origin.lastIndexOf(':'))
      }
      continue
    }
    if (!meta) continue
    if (e.type === 'turn_context' || (e.type === 'event_msg' && p.type === 'task_started')) {
      const nextTurn = turnOf(p) || turn
      if (nextTurn !== turn) turnHasActivity = false
      turn = nextTurn
      // User messages and delegated tasks can precede their turn identification.
      for (const prompt of pendingPrompts) {
        if (!prompt.explicitTurn && (e.type === 'turn_context' || !prompt.turn || prompt.afterTurnActivity)) {
          prompt.turn = turn
          prompt.turnResolved = true
        }
      }
      pendingPrompts = []
    }
    const tid = turnOf(p) || turn
    let data
    if (e.type === 'turn_context') data = { type: 'context', model: p.model, cwd: p.cwd }
    if (e.type === 'token_usage_record') {
      if (p.thread_id && p.thread_id !== meta.id) continue
      data = { type: 'usage', usage: p.usage, response: p.response_id, thread: p.thread_id, root: p.root_turn_id }
      recordTurns.add(tid)
    }
    if (e.type === 'event_msg') {
      if (p.type === 'user_message') data = { type: 'legacy_user', text: p.message?.trim() ? p.message : (p.images?.length || p.local_images?.length) ? NO_TEXT : p.message }
      if (p.type === 'token_count' && (p.info?.last_token_usage || p.info?.total_token_usage)) data = { type: 'tokens', info: p.info }
      if (p.type === 'task_started') data = { type: 'start', root: p.root_turn_id }
      if (['task_complete', 'task_aborted', 'turn_aborted'].includes(p.type)) data = { type: 'end' }
    }
    if (e.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') {
        const text = userText(p)
        if (text) data = { type: 'user', text, id: p.id }
        if (!text && p.internal_chat_message_metadata_passthrough?.content_item_kinds?.includes('goal.internal_context')) data = { type: 'goal_continuation' }
      }
      if (p.type === 'agent_message') data = { type: 'delegation', text: textOf(p.content), recipient: p.recipient, id: p.id, encrypted: p.content?.some((c) => c.type === 'encrypted_content') }
      if (['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call'].includes(p.type)) data = { type: 'tool', id: p.call_id || p.id }
    }
    if (data) {
      const event = { ...data, origin, ts: e.timestamp, turn: tid, explicitTurn: !!turnOf(p) }
      events.push(event)
      if (['user', 'legacy_user', 'delegation'].includes(data.type)) {
        event.afterTurnActivity = turnHasActivity
        pendingPrompts.push(event)
      } else if (['usage', 'tokens', 'tool', 'end'].includes(data.type)) {
        if (tid === turn) turnHasActivity = true
        // An explicit event for the previous turn must not consume a new
        // message waiting for its context. Unlabelled activity still binds
        // messages in legacy logs, where no upcoming turn can be identified.
        pendingPrompts = pendingPrompts.filter(prompt => event.explicitTurn &&
          (prompt.turn !== tid || (!prompt.explicitTurn && prompt.afterTurnActivity)))
      }
    }
  }
  if (!meta) return null
  const rootsByTurn = new Map()
  const mirrors = new Map()
  for (const e of events) {
    if (['user', 'legacy_user'].includes(e.type)) {
      if (e.text?.trim()) {
        // Pair individual representations before activity, including logs without
        // turn IDs. A legacy message must not suppress other users in the turn.
        const key = JSON.stringify([e.turn, e.text.trim()])
        if (!mirrors.has(key)) mirrors.set(key, { user: [], legacy_user: [] })
        const candidates = mirrors.get(key)
        const opposite = e.type === 'user' ? 'legacy_user' : 'user'
        const mirror = candidates[opposite].pop()
        if (mirror) {
          const modern = e.type === 'user' ? e : mirror
          const legacy = e.type === 'legacy_user' ? e : mirror
          modern.mirrored = true
          // Keep the identity of the first representation: an earlier page
          // may end before its mirror, and must merge into this same prompt.
          legacy.promptOrigin = mirror.id ? `${meta.id}:message:${mirror.id}` : mirror.origin
          legacy.promptTs = mirror.ts
          legacy.turnResolved ||= modern.turnResolved || modern.explicitTurn
        }
        else candidates[e.type].push(e)
      }
    } else if (!['context', 'start'].includes(e.type)) {
      for (const key of mirrors.keys()) {
        if (!e.explicitTurn || JSON.parse(key)[0] === e.turn) mirrors.delete(key)
      }
    }
    // Prompts may precede task_started; resolve their root by turn, not arrival order.
    if (e.type === 'start' && e.turn && e.root) rootsByTurn.set(e.turn, e.root)
  }
  const parent = meta.parent_thread_id || meta.source?.subagent?.thread_spawn?.parent_thread_id || null
  const subagent = !!parent || meta.thread_source === 'subagent'
  const session = {
    source: 'codex', session_id: meta.id, project_path: match(meta.cwd), cwd: meta.cwd,
    git_branch: meta.git?.branch ?? null, model: null, started_at: initialMeta.timestamp,
    ended_at: meta.timestamp, source_file: sourceFile,
  }
  const prompts = []
  const byTurn = new Map()
  const seenMessages = new Set()
  const seenCalls = accounting.calls ||= new Set()
  const seenUsage = accounting.usage ||= new Set()
  const seenTokens = accounting.tokens ||= new Set()
  let current, latestPrompt, model = null, lastTotal
  const create = (e, text) => {
    const p = newPrompt({ seq: prompts.length, ts: e.promptTs || e.ts, text, model, kind: subagent ? 'subagent' : 'user',
      _origin: e.promptOrigin || (e.id ? `${meta.id}:message:${e.id}` : e.origin),
      _turnResolved: !!(e.turnResolved || e.explicitTurn),
      thread_id: meta.id, parent_thread_id: parent, turn_id: e.turn || null, root_turn_id: rootsByTurn.get(e.turn) || null,
      sub: subagent ? meta.id : undefined })
    prompts.push(p)
    if (e.turn) byTurn.set(e.turn, p)
    current = p
    latestPrompt = p
    return p
  }
  for (const e of events) {
    session.ended_at = e.ts || session.ended_at
    if (e.type === 'context') {
      if (e.cwd && !match(e.cwd)) throw new Error(`${file}: turno fora dos projetos configurados; sessão não importada`)
      model = e.model || model
      const target = e.turn ? byTurn.get(e.turn) : current
      if (target && e.model) target.model = e.model
      continue
    }
    if (e.type === 'goal_continuation') {
      if (latestPrompt && e.turn) byTurn.set(e.turn, latestPrompt)
      continue
    }
    if (e.type === 'start') {
      current = byTurn.get(e.turn) || byTurn.get(e.root)
      if (current && e.turn) byTurn.set(e.turn, current)
      continue
    }
    if (e.type === 'legacy_user' || (e.type === 'user' && !e.mirrored)) {
      if (e.id && seenMessages.has(e.id)) continue
      if (e.id) seenMessages.add(e.id)
      if (e.text?.trim()) create(e, e.text)
      continue
    }
    if (e.type === 'delegation' && subagent && (!meta.agent_path || e.recipient === meta.agent_path)) {
      if (e.id && seenMessages.has(e.id)) continue
      if (e.id) seenMessages.add(e.id)
      create(e, e.encrypted ? '[Tarefa delegada: conteúdo criptografado no log]' : e.text)
      continue
    }
    let target = e.turn ? byTurn.get(e.turn) : current
    if (e.type === 'usage' || e.type === 'tokens') {
      if (e.type === 'tokens') {
        const total = e.info?.total_token_usage?.total_tokens
        const repeated = total != null && total === lastTotal
        if (total != null) lastTotal = total
        if (recordTurns.has(e.turn) || accounting.recordTurns?.has(JSON.stringify([meta.id, e.turn])) || repeated) continue
      }
      if (e.type === 'usage' && e.thread && e.thread !== meta.id) continue
      const u = e.type === 'usage' ? e.usage : e.info?.last_token_usage
      if (!u) {
        if (e.type === 'usage' || e.info?.total_token_usage) throw new Error(`${file}: formato de consumo não reconhecido`)
        continue // rate-limit-only event, not a model call
      }
      if (!['input_tokens', 'output_tokens'].every((key) => Number.isFinite(u[key]) && u[key] >= 0)) {
        throw new Error(`${file}: formato de consumo não reconhecido`)
      }
      // Replaying a page must recreate attribution context even when its usage
      // was already accounted for while reading another page.
      if (!target && subagent) target = create(e, '[Tarefa de subagente sem texto disponível]')
      if (!target) throw new Error(`${file}: consumo encontrado sem prompt reconhecido (Codex ${meta.cli_version || '?'})`)
      if (e.type === 'usage') {
        if (!e.response) throw new Error(`${file}: token_usage_record sem response_id`)
        const key = `${meta.id}:${e.response}`
        if (seenUsage.has(key)) continue
        seenUsage.add(key)
      } else {
        if (seenTokens.has(e.origin)) continue
        seenTokens.add(e.origin)
      }
      const cached = amount(u.cached_input_tokens), write = amount(u.cache_write_input_tokens)
      target.input_tokens += Math.max(0, amount(u.input_tokens) - cached - write)
      target.cache_read_tokens += cached
      target.cache_write_tokens += write
      target.output_tokens += amount(u.output_tokens)
      target.reasoning_tokens += amount(u.reasoning_output_tokens)
      target.model_calls++
      target.model ||= model
      target.root_turn_id ||= e.root || null
      session.model = target.model || session.model
    }
    if (target && e.type === 'tool') {
      const key = e.id ? `${meta.id}:${e.id}` : e.origin
      if (!seenCalls.has(key)) target.tool_calls++
      seenCalls.add(key)
    }
    if (target && ['usage', 'tokens', 'end', 'tool'].includes(e.type)) target.duration_ms = Math.max(target.duration_ms, durationBetween(target.ts, e.ts))
  }
  if (!prompts.length) return null
  return { session, prompts, parent_thread_id: parent, root_session_id: meta.session_id, thread_id: meta.id }
}

export function groupSessions(records) {
  const byId = new Map(records.map((r) => [r.thread_id, r]))
  const groups = new Map()
  for (const r of records) {
    let root = r
    const seen = new Set()
    while (root.parent_thread_id) {
      if (seen.has(root.thread_id)) throw new Error('Ciclo nos vínculos de subagentes do Codex')
      seen.add(root.thread_id)
      const parent = byId.get(root.parent_thread_id)
      if (!parent) throw new Error(`Subagente ${r.thread_id}: sessão-pai ${root.parent_thread_id} não encontrada no projeto`)
      root = parent
    }
    if (!groups.has(root.thread_id)) groups.set(root.thread_id, { session: { ...root.session }, prompts: [], members: [] })
    const group = groups.get(root.thread_id)
    group.prompts.push(...r.prompts)
    group.members.push(r.thread_id)
    if (r.session.ended_at > group.session.ended_at) group.session.ended_at = r.session.ended_at
  }
  for (const group of groups.values()) group.prompts.sort((a, b) => a.ts.localeCompare(b.ts))
  return [...groups.values()]
}
