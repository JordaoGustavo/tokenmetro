// Claude Code: ~/.claude/projects/<cwd-codificado>/<sessionId>.jsonl
// Cada linha "assistant" traz message.usage; a mesma mensagem (message.id) pode
// aparecer em várias linhas (uma por bloco de conteúdo), então deduplicamos por id.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonl, walk, newPrompt, durationBetween } from './util.js'

const ROOT = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')
  : path.join(os.homedir(), '.claude', 'projects')

const encode = (p) => p.replace(/[^a-zA-Z0-9]/g, '-')

const NOISE = ['<local-command-stdout>', '<local-command-stderr>', '<local-command-caveat>', '[Request interrupted', '<system-reminder>']

function promptText(entry) {
  if (entry.isMeta || entry.isCompactSummary || entry.isSidechain) return null
  const c = entry.message?.content
  let text = null
  if (typeof c === 'string') text = c
  else if (Array.isArray(c)) {
    if (c.some((b) => b.type === 'tool_result')) return null
    text = c.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  }
  if (!text?.trim()) return null
  if (NOISE.some((n) => text.trimStart().startsWith(n))) return null
  return text
}

export function listFiles(projectPaths) {
  if (!fs.existsSync(ROOT)) return []
  const prefixes = projectPaths.map(encode)
  return fs.readdirSync(ROOT)
    .filter((d) => prefixes.some((p) => d.startsWith(p)))
    .flatMap((d) => walk(path.join(ROOT, d), (f) => f.endsWith('.jsonl')))
}

export function parseFile(file, match) {
  const isSubagent = file.includes(`${path.sep}subagents${path.sep}`)
  const prompts = []
  const seenMsg = new Map()
  let session = null
  let current = null

  const ensureSession = (e) => {
    if (session) return session
    const projectPath = match(e.cwd)
    if (!projectPath) return null
    session = {
      source: 'claude',
      session_id: e.sessionId,
      project_path: projectPath,
      cwd: e.cwd,
      git_branch: e.gitBranch ?? null,
      started_at: e.timestamp,
      ended_at: e.timestamp,
      model: null,
      source_file: file,
    }
    return session
  }

  for (const e of readJsonl(file)) {
    if (e.type !== 'user' && e.type !== 'assistant') continue
    if (!e.cwd || !e.timestamp) continue
    if (!ensureSession(e)) return null // cwd fora do projeto -> ignora o arquivo inteiro
    session.ended_at = e.timestamp

    if (e.type === 'user') {
      // Em transcripts de subagente, a 1ª mensagem é a tarefa delegada (sidechain).
      const text = isSubagent
        ? (current ? null : (typeof e.message?.content === 'string' ? e.message.content : e.message?.content?.find?.((b) => b.type === 'text')?.text))
        : promptText(e)
      if (text) {
        current = newPrompt({ seq: prompts.length, ts: e.timestamp, text, kind: isSubagent ? 'subagent' : 'user' })
        prompts.push(current)
      }
      continue
    }

    const m = e.message
    if (!current || !m?.usage) continue
    const u = m.usage
    const prev = seenMsg.get(m.id)
    const target = prev?.prompt ?? current
    if (prev) {
      // Mesma mensagem repetida: remove a contagem anterior e usa a mais recente.
      target.input_tokens -= prev.u.input_tokens || 0
      target.cache_read_tokens -= prev.u.cache_read_input_tokens || 0
      target.cache_write_tokens -= prev.u.cache_creation_input_tokens || 0
      target.output_tokens -= prev.u.output_tokens || 0
      target.reasoning_tokens -= prev.u.output_tokens_details?.thinking_tokens || 0
    } else {
      target.model_calls++
    }
    target.input_tokens += u.input_tokens || 0
    target.cache_read_tokens += u.cache_read_input_tokens || 0
    target.cache_write_tokens += u.cache_creation_input_tokens || 0
    target.output_tokens += u.output_tokens || 0
    target.reasoning_tokens += u.output_tokens_details?.thinking_tokens || 0
    target.tool_calls += (m.content || []).filter((b) => b.type === 'tool_use').length
    target.model = m.model && m.model !== '<synthetic>' ? m.model : target.model
    target.duration_ms = durationBetween(target.ts, e.timestamp)
    session.model = target.model ?? session.model
    seenMsg.set(m.id, { prompt: target, u })
  }

  if (!session || !prompts.length) return null
  if (isSubagent) {
    // Junta os tokens do subagente na sessão-pai, como uma linha "subagent".
    session.session_id = path.basename(path.dirname(path.dirname(file)))
    session.subagent_id = path.basename(file, '.jsonl')
  }
  return { session, prompts }
}
