// Devin CLI (Cognition): ~/.local/share/devin/cli/sessions.db (SQLite)
// sessions(id, working_directory, model, created_at, last_activity_at, main_chain_id, hidden)
// message_nodes(session_id, node_id, parent_node_id, chat_message JSON, created_at, metadata JSON)
// As mensagens formam uma árvore (cada retry vira um galho); seguimos só o galho
// principal: main_chain_id → parent_node_id → ... até a raiz.
// Atenção: até a versão auditada, o Devin não grava contagem de tokens por mensagem
// (metadata.num_tokens vem null). Lemos se existir; senão ficam 0.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { newPrompt, durationBetween } from './util.js'

const DB = process.env.DEVIN_DATA_DIR
  ? path.join(process.env.DEVIN_DATA_DIR, 'sessions.db')
  : path.join(os.homedir(), '.local', 'share', 'devin', 'cli', 'sessions.db')

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
        const tokens = Number(parse(row.metadata)?.num_tokens) || 0
        if (msg.role === 'user') {
          const t = text(msg.content)
          if (!t.trim()) continue
          current = newPrompt({ seq: prompts.length, ts, text: t, model: s.model, input_tokens: tokens })
          prompts.push(current)
        } else if (current && msg.role === 'assistant') {
          current.model_calls++
          current.tool_calls += msg.tool_calls?.length || 0
          current.output_tokens += tokens
          current.duration_ms = durationBetween(current.ts, ts)
        } else if (current && msg.role === 'tool') {
          current.duration_ms = durationBetween(current.ts, ts)
        }
      }
      if (!prompts.length) continue
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
