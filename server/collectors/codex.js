// Codex CLI: ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl
// session_meta.cwd identifica o projeto; event_msg.user_message é o prompt;
// event_msg.token_count.last_token_usage é o consumo de cada chamada ao modelo.
import os from 'node:os'
import path from 'node:path'
import { readJsonl, walk, newPrompt, durationBetween } from './util.js'

const ROOT = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')

export function listFiles() {
  return walk(ROOT, (f) => f.endsWith('.jsonl'))
}

export function parseFile(file, match) {
  const prompts = []
  let session = null
  let current = null
  let model = null
  let lastTotal = -1

  for (const e of readJsonl(file)) {
    const p = e.payload || {}
    if (e.type === 'session_meta') {
      const projectPath = match(p.cwd)
      if (!projectPath) return null
      session = {
        source: 'codex',
        session_id: p.id,
        project_path: projectPath,
        cwd: p.cwd,
        git_branch: p.git?.branch ?? null,
        started_at: p.timestamp || e.timestamp,
        ended_at: e.timestamp,
        model: null,
        source_file: file,
      }
      continue
    }
    if (!session) continue
    session.ended_at = e.timestamp

    if (e.type === 'turn_context' && p.model) model = p.model
    if (e.type === 'event_msg' && p.type === 'user_message' && p.message?.trim()) {
      current = newPrompt({ seq: prompts.length, ts: e.timestamp, text: p.message, model })
      prompts.push(current)
    }
    if (!current) continue
    if (e.type === 'response_item' && ['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call'].includes(p.type)) {
      current.tool_calls++
    }
    if (e.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
      const total = p.info.total_token_usage?.total_tokens ?? -2
      if (total === lastTotal) continue // o Codex às vezes emite o mesmo evento duas vezes
      lastTotal = total
      const u = p.info.last_token_usage
      const cached = u.cached_input_tokens || 0
      current.input_tokens += Math.max(0, (u.input_tokens || 0) - cached)
      current.cache_read_tokens += cached
      current.output_tokens += u.output_tokens || 0
      current.reasoning_tokens += u.reasoning_output_tokens || 0
      current.model_calls++
      current.model = model
      current.duration_ms = durationBetween(current.ts, e.timestamp)
      session.model = model
    }
  }
  if (!session || !prompts.length) return null
  return { session, prompts }
}
