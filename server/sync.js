import path from 'node:path'
import { loadConfig, makeMatcher } from './config.js'
import { tx, replaceSession, fileChanged, markFile } from './db.js'
import * as claude from './collectors/claude.js'
import * as codex from './collectors/codex.js'
import * as cursor from './collectors/cursor.js'
import * as devin from './collectors/devin.js'
import * as git from './collectors/git.js'

function save(db, developer, { session, prompts }) {
  const pk = `${developer}:${session.source}:${session.session_id}`
  replaceSession(db, { ...session, id: pk, developer }, prompts.map((p, i) => ({
    ...p,
    id: `${pk}:${p.sub ? `sub:${p.sub}:` : ''}${i}`,
    seq: i,
    session_pk: pk,
    developer,
    source: session.source,
  })))
}

function syncClaude(db, cfg, match, stats) {
  // Agrupa transcript principal + subagentes da mesma sessão.
  const groups = new Map()
  for (const f of claude.listFiles(cfg.projectPaths)) {
    const key = f.includes(`${path.sep}subagents${path.sep}`)
      ? path.basename(path.dirname(path.dirname(f)))
      : path.basename(f, '.jsonl')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  for (const files of groups.values()) {
    if (!files.some((f) => fileChanged(db, f))) continue
    let main = null
    const extra = []
    for (const f of files) {
      const r = claude.parseFile(f, match)
      if (!r) continue
      if (r.session.subagent_id) extra.push(...r.prompts.map((p) => ({ ...p, sub: r.session.subagent_id, _session: r.session })))
      else main = r
    }
    if (!main && extra.length) {
      const s = extra[0]._session
      main = { session: { ...s, subagent_id: undefined, source_file: null }, prompts: [] }
    }
    if (main) {
      delete main.session.subagent_id
      const all = [...main.prompts, ...extra.map(({ _session, ...p }) => p)].sort((a, b) => a.ts.localeCompare(b.ts))
      save(db, cfg.developer, { session: main.session, prompts: all })
      stats.claude++
    }
    files.forEach((f) => markFile(db, f))
  }
}

export function syncCodex(db, cfg, match, stats, files = codex.listFiles()) {
  // Re-read matching rollouts: children can change without the parent changing,
  // and old parser cache entries must not hide sessions after an upgrade.
  const records = codex.parseFiles(files, match)
  for (const group of codex.groupSessions(records)) {
    // Remove older imports where a child was incorrectly saved as a session.
    for (const id of group.members) {
      if (id === group.session.session_id) continue
      const pk = `${cfg.developer}:codex:${id}`
      db.prepare('DELETE FROM prompts WHERE session_pk = ?').run(pk)
      db.prepare('DELETE FROM sessions WHERE id = ?').run(pk)
    }
    save(db, cfg.developer, group)
    stats.codex++
  }
}

function syncCursor(db, cfg, match, stats) {
  for (const r of cursor.collect(match)) { save(db, cfg.developer, r); stats.cursor++ }
}

function syncDevin(db, cfg, match, stats) {
  for (const r of devin.collect(match)) { save(db, cfg.developer, r); stats.devin++ }
}

function syncGit(db, cfg, stats) {
  const ins = db.prepare('INSERT OR REPLACE INTO commits (developer, sha, ts, message, additions, deletions, files_changed) VALUES (?,?,?,?,?,?,?)')
  for (const p of cfg.projectPaths) {
    for (const c of git.collect(p)) {
      ins.run(cfg.developer, c.sha, c.ts, c.message, c.additions, c.deletions, c.files_changed)
      stats.commits++
    }
  }
}

export function runSync(db) {
  const cfg = loadConfig()
  const match = makeMatcher(cfg.projectPaths)
  const stats = { claude: 0, codex: 0, cursor: 0, devin: 0, commits: 0, errors: [] }
  const step = (name, fn) => {
    try { tx(db, fn) } catch (e) { stats.errors.push(`${name}: ${e.message}`) }
  }
  if (cfg.sources.claude) step('claude', () => syncClaude(db, cfg, match, stats))
  if (cfg.sources.codex) step('codex', () => syncCodex(db, cfg, match, stats))
  if (cfg.sources.cursor) step('cursor', () => syncCursor(db, cfg, match, stats))
  if (cfg.sources.devin) step('devin', () => syncDevin(db, cfg, match, stats))
  step('git', () => syncGit(db, cfg, stats))
  return stats
}
