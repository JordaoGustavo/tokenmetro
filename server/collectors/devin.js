// Devin CLI (Cognition): ~/.local/share/devin/cli/sessions.db (SQLite)
// sessions(id, working_directory, model, created_at, last_activity_at, main_chain_id, hidden)
// message_nodes(session_id, node_id, parent_node_id, chat_message JSON, created_at, metadata JSON)
// As mensagens formam uma árvore (cada retry vira um galho); seguimos só o galho
// principal: main_chain_id → parent_node_id → ... até a raiz.
// As métricas de tokens ficam em chat_message.metadata.metrics.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { newPrompt, durationBetween } from './util.js'

const DEFAULT_DB_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Devin', 'cli')
  : path.join(os.homedir(), '.local', 'share', 'devin', 'cli')
const DB = path.join(process.env.DEVIN_DATA_DIR || DEFAULT_DB_DIR, 'sessions.db')

const iso = (sec) => new Date(Number(sec) * 1000).toISOString()
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

function text(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n')
  return ''
}

export function collect(match) {
  if (!fs.existsSync(DB)) return []
  const db = new DatabaseSync(DB, { readOnly: true })
  const results = []
  try {
    const sessions = db.prepare('SELECT id, working_directory, model, created_at, last_activity_at, main_chain_id FROM sessions WHERE hidden = 0 AND main_chain_id IS NOT NULL').all()
    const chain = db.prepare(`
      WITH RECURSIVE chain(node_id, parent_node_id, chat_message, metadata, created_at, depth) AS (
        SELECT node_id, parent_node_id, chat_message, metadata, created_at, 0 FROM message_nodes WHERE session_id = ?1 AND node_id = ?2
        UNION ALL
        SELECT m.node_id, m.parent_node_id, m.chat_message, m.metadata, m.created_at, c.depth + 1
        FROM chain c JOIN message_nodes m ON m.session_id = ?1 AND m.node_id = c.parent_node_id
        WHERE c.depth < 100000
      )
      SELECT chat_message, metadata, created_at FROM chain ORDER BY depth DESC`)

    for (const s of sessions) {
      const projectPath = match(s.working_directory)
      if (!projectPath) continue
      const prompts = []
      let current = null
      for (const row of chain.all(s.id, s.main_chain_id)) {
        const msg = parse(row.chat_message)
        if (!msg) continue
        const ts = iso(row.created_at)
        if (msg.role === 'user') {
          const t = text(msg.content)
          if (!t.trim()) continue
          current = newPrompt({ seq: prompts.length, ts, text: t })
          prompts.push(current)
        } else if (current && msg.role === 'assistant') {
          const metrics = msg.metadata?.metrics ?? {}
          current.model ||= msg.metadata?.generation_model ?? null
          current.model_calls++
          current.tool_calls += msg.tool_calls?.length || 0
          current.input_tokens += Number(metrics.input_tokens) || 0
          current.cache_read_tokens += Number(metrics.cache_read_tokens) || 0
          current.cache_write_tokens += Number(metrics.cache_creation_tokens) || 0
          current.output_tokens += Number(metrics.output_tokens ?? msg.metadata?.num_tokens) || 0
          current.duration_ms = durationBetween(current.ts, ts)
        } else if (current && msg.role === 'tool') {
          current.duration_ms = durationBetween(current.ts, ts)
        }
      }
      if (!prompts.length) continue
      prompts.forEach((prompt) => { prompt.model ||= s.model })
      results.push({
        session: {
          source: 'devin',
          session_id: s.id,
          project_path: projectPath,
          cwd: s.working_directory,
          git_branch: null,
          model: s.model,
          started_at: iso(s.created_at),
          ended_at: iso(s.last_activity_at),
          source_file: DB,
        },
        prompts,
      })
    }
  } finally { db.close() }
  return results
}
