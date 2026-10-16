import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseArgs } from 'node:util'
import { openDb, tx, replaceSession, SESSION_COLS, PROMPT_COLS } from './db.js'
import { loadConfig, ROOT } from './config.js'
import { runSync } from './sync.js'
import { newPrompt } from './collectors/util.js'

const [cmd, ...rest] = process.argv.slice(2)
const db = openDb()

if (cmd === 'sync') {
  const s = runSync(db)
  console.log(`✔ sync: ${s.claude} sessões Claude, ${s.codex} Codex, ${s.cursor} Cursor, ${s.commits} commits`)
  s.errors.forEach((e) => console.warn('⚠', e))
} else if (cmd === 'export') {
  const cfg = loadConfig()
  runSync(db)
  const dev = cfg.developer
  const data = {
    format: 'tokenmetro/v1',
    exported_at: new Date().toISOString(),
    developer: dev,
    sessions: db.prepare('SELECT * FROM sessions WHERE developer = ?').all(dev),
    prompts: db.prepare('SELECT * FROM prompts WHERE developer = ?').all(dev),
    commits: db.prepare('SELECT * FROM commits WHERE developer = ?').all(dev),
  }
  const dir = path.join(ROOT, 'data', 'exports')
  fs.mkdirSync(dir, { recursive: true })
  const out = rest[0] || path.join(dir, `${dev}-${data.exported_at.slice(0, 10)}.json`)
  fs.writeFileSync(out, JSON.stringify(data, null, 2))
  console.log(`✔ exportado: ${out} (${data.sessions.length} sessões, ${data.prompts.length} prompts)`)
} else if (cmd === 'import') {
  if (!rest.length) { console.error('uso: npm run import -- <arquivo.json> [...]'); process.exit(1) }
  for (const file of rest) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data.format !== 'tokenmetro/v1') { console.error(`✖ ${file}: formato desconhecido`); continue }
    tx(db, () => {
      // Substitui tudo daquele dev (reimportar um export mais novo não duplica).
      db.prepare('DELETE FROM prompts WHERE developer = ?').run(data.developer)
      db.prepare('DELETE FROM sessions WHERE developer = ?').run(data.developer)
      db.prepare('DELETE FROM commits WHERE developer = ?').run(data.developer)
      const insS = db.prepare(`INSERT INTO sessions (${SESSION_COLS}) VALUES (${SESSION_COLS.map(() => '?')})`)
      const insP = db.prepare(`INSERT INTO prompts (${PROMPT_COLS}) VALUES (${PROMPT_COLS.map(() => '?')})`)
      const insC = db.prepare('INSERT INTO commits (developer, sha, ts, message, additions, deletions, files_changed) VALUES (?,?,?,?,?,?,?)')
      data.sessions.forEach((s) => insS.run(...SESSION_COLS.map((c) => s[c] ?? null)))
      data.prompts.forEach((p) => insP.run(...PROMPT_COLS.map((c) => p[c] ?? null)))
      data.commits.forEach((c) => insC.run(c.developer, c.sha, c.ts, c.message, c.additions, c.deletions, c.files_changed))
    })
    console.log(`✔ importado ${data.developer}: ${data.sessions.length} sessões, ${data.prompts.length} prompts`)
  }
} else if (cmd === 'log') {
  // Registro manual para ferramentas sem log local (ex.: Devin, ChatGPT web).
  const { values } = parseArgs({
    args: rest,
    options: {
      source: { type: 'string' }, prompt: { type: 'string' }, session: { type: 'string' },
      input: { type: 'string' }, output: { type: 'string' }, tokens: { type: 'string' }, model: { type: 'string' },
    },
  })
  if (!values.source || !values.prompt) {
    console.error('uso: npm run log -- --source devin --prompt "texto" [--session id] [--tokens N | --input N --output N] [--model x]')
    process.exit(1)
  }
  const cfg = loadConfig()
  const sessionId = values.session || `manual-${new Date().toISOString().slice(0, 10)}`
  const pk = `${cfg.developer}:${values.source}:${sessionId}`
  const now = new Date().toISOString()
  tx(db, () => {
    const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(pk)
    const prompts = db.prepare('SELECT * FROM prompts WHERE session_pk = ? ORDER BY seq').all(pk)
    const p = newPrompt({
      id: `${pk}:${crypto.randomUUID()}`, session_pk: pk, developer: cfg.developer, source: values.source,
      seq: prompts.length, kind: 'manual', ts: now, text: values.prompt, model: values.model ?? null,
      input_tokens: Number(values.input || values.tokens || 0), output_tokens: Number(values.output || 0), model_calls: 1,
    })
    replaceSession(db, existing ? { ...existing, ended_at: now } : {
      id: pk, developer: cfg.developer, source: values.source, session_id: sessionId,
      project_path: cfg.projectPaths[0], cwd: cfg.projectPaths[0], model: values.model ?? null, started_at: now, ended_at: now,
    }, [...prompts, p])
  })
  console.log(`✔ prompt registrado em ${pk}`)
} else {
  console.log('comandos: sync | export [arquivo] | import <arquivos...> | log --source X --prompt "..."')
}
