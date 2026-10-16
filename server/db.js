import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ROOT } from './config.js'

const DB_PATH = process.env.TOKENMETRO_DB || path.join(ROOT, 'data', 'tokenmetro.db')

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,          -- developer:source:sessionId
      developer TEXT NOT NULL,
      source TEXT NOT NULL,         -- claude | codex | cursor | devin | ...
      session_id TEXT NOT NULL,
      project_path TEXT,
      cwd TEXT,
      git_branch TEXT,
      model TEXT,
      started_at TEXT,
      ended_at TEXT,
      source_file TEXT
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      session_pk TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      developer TEXT NOT NULL,
      source TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'user', -- user | subagent | manual
      ts TEXT NOT NULL,
      text TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,      -- input não cacheado
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,     -- inclui reasoning
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      model_calls INTEGER DEFAULT 0,
      tool_calls INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_ts ON prompts(ts);
    CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_pk);
    CREATE TABLE IF NOT EXISTS commits (
      developer TEXT NOT NULL,
      sha TEXT NOT NULL,
      ts TEXT NOT NULL,
      message TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      files_changed INTEGER DEFAULT 0,
      PRIMARY KEY (developer, sha)
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime_ms REAL,
      size INTEGER
    );
  `)
  return db
}

export function tx(db, fn) {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}

const SESSION_COLS = ['id', 'developer', 'source', 'session_id', 'project_path', 'cwd', 'git_branch', 'model', 'started_at', 'ended_at', 'source_file']
const PROMPT_COLS = ['id', 'session_pk', 'developer', 'source', 'seq', 'kind', 'ts', 'text', 'model', 'input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'reasoning_tokens', 'total_tokens', 'model_calls', 'tool_calls', 'duration_ms']

const upsertSql = (table, cols) =>
  `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`

// Substitui por completo uma sessão (idempotente: rodar o sync N vezes dá o mesmo resultado).
export function replaceSession(db, session, prompts) {
  db.prepare('DELETE FROM prompts WHERE session_pk = ?').run(session.id)
  db.prepare(upsertSql('sessions', SESSION_COLS)).run(...SESSION_COLS.map((c) => session[c] ?? null))
  const ins = db.prepare(upsertSql('prompts', PROMPT_COLS))
  for (const p of prompts) {
    p.total_tokens = p.input_tokens + p.cache_read_tokens + p.cache_write_tokens + p.output_tokens
    ins.run(...PROMPT_COLS.map((c) => p[c] ?? null))
  }
}

export function appendPrompts(db, prompts) {
  const ins = db.prepare(upsertSql('prompts', PROMPT_COLS))
  for (const p of prompts) ins.run(...PROMPT_COLS.map((c) => p[c] ?? null))
}

export function fileChanged(db, file) {
  const st = fs.statSync(file)
  const row = db.prepare('SELECT mtime_ms, size FROM files WHERE path = ?').get(file)
  return !row || row.mtime_ms !== st.mtimeMs || row.size !== st.size
}

export function markFile(db, file) {
  const st = fs.statSync(file)
  db.prepare('INSERT OR REPLACE INTO files (path, mtime_ms, size) VALUES (?, ?, ?)').run(file, st.mtimeMs, st.size)
}

export { SESSION_COLS, PROMPT_COLS }
