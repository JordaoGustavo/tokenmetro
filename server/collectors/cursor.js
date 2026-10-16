// Cursor (IDE): workspaceStorage/<hash>/workspace.json diz a pasta aberta e a lista
// de composers (chats/agents). As mensagens ("bubbles") ficam no state.vscdb global.
// Atenção: versões recentes do Cursor nem sempre gravam tokenCount (vem 0).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { newPrompt, durationBetween } from './util.js'

const USER_DIR = process.env.CURSOR_USER_DIR || (
  process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Cursor/User')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Cursor/User')
  : path.join(os.homedir(), '.config/Cursor/User'))

const openRO = (file) => new DatabaseSync(file, { readOnly: true })

function workspacesFor(match) {
  const dir = path.join(USER_DIR, 'workspaceStorage')
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const h of fs.readdirSync(dir)) {
    try {
      const ws = JSON.parse(fs.readFileSync(path.join(dir, h, 'workspace.json'), 'utf8'))
      if (!ws.folder?.startsWith('file://')) continue
      const folder = fileURLToPath(ws.folder)
      const projectPath = match(folder)
      if (projectPath) out.push({ folder, projectPath, db: path.join(dir, h, 'state.vscdb') })
    } catch {}
  }
  return out
}

export function collect(match) {
  const globalDb = path.join(USER_DIR, 'globalStorage', 'state.vscdb')
  if (!fs.existsSync(globalDb)) return []
  const results = []
  const g = openRO(globalDb)
  try {
    for (const ws of workspacesFor(match)) {
      let ids = []
      try {
        const db = openRO(ws.db)
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get()
        db.close()
        ids = JSON.parse(row?.value || '{}').allComposers?.map((c) => c.composerId) ?? []
      } catch { continue }

      for (const id of ids) {
        const cd = g.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(`composerData:${id}`)
        if (!cd) continue
        const data = JSON.parse(cd.value)
        const bubbles = g.prepare('SELECT value FROM cursorDiskKV WHERE key LIKE ?').all(`bubbleId:${id}:%`)
          .map((r) => { try { return JSON.parse(r.value) } catch { return null } })
          .filter((b) => b?.createdAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const prompts = []
        let current = null
        for (const b of bubbles) {
          if (b.type === 1 && b.text?.trim()) {
            current = newPrompt({ seq: prompts.length, ts: b.createdAt, text: b.text, model: data.modelConfig?.modelName ?? null })
            prompts.push(current)
          } else if (b.type === 2 && current) {
            current.input_tokens += b.tokenCount?.inputTokens || 0
            current.output_tokens += b.tokenCount?.outputTokens || 0
            current.model_calls++
            if (b.toolFormerData) current.tool_calls++
            current.duration_ms = durationBetween(current.ts, b.createdAt)
          }
        }
        if (!prompts.length) continue
        results.push({
          session: {
            source: 'cursor',
            session_id: id,
            project_path: ws.projectPath,
            cwd: ws.folder,
            git_branch: null,
            model: prompts.at(-1).model,
            started_at: prompts[0].ts,
            ended_at: bubbles.at(-1).createdAt,
            source_file: globalDb,
          },
          prompts,
        })
      }
    }
  } finally { g.close() }
  return results
}
