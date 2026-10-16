import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './db.js'
import { loadConfig, ROOT } from './config.js'
import { runSync } from './sync.js'

const cfg = loadConfig()
const db = openDb()
let lastSync = null

function doSync() {
  const stats = runSync(db)
  lastSync = { at: new Date().toISOString(), ...stats }
  if (stats.errors.length) console.warn('⚠ sync:', stats.errors.join('; '))
  return lastSync
}
doSync()
setInterval(doSync, cfg.syncIntervalSeconds * 1000)

// Filtros comuns: developer, source, from, to (ISO date)
function where(q, alias = 'p') {
  const c = []
  const args = []
  if (q.get('developer')) { c.push(`${alias}.developer = ?`); args.push(q.get('developer')) }
  if (q.get('source')) { c.push(`${alias}.source = ?`); args.push(q.get('source')) }
  if (q.get('from')) { c.push(`${alias}.ts >= ?`); args.push(q.get('from')) }
  if (q.get('to')) { c.push(`${alias}.ts < date(?, '+1 day')`); args.push(q.get('to')) }
  return { sql: c.length ? `WHERE ${c.join(' AND ')}` : '', args }
}

const TOKEN_SUMS = `
  COUNT(*) AS prompts,
  COUNT(DISTINCT p.session_pk) AS sessions,
  SUM(p.kind = 'subagent') AS subagents,
  COALESCE(SUM(p.input_tokens),0) AS input_tokens,
  COALESCE(SUM(p.cache_read_tokens),0) AS cache_read_tokens,
  COALESCE(SUM(p.cache_write_tokens),0) AS cache_write_tokens,
  COALESCE(SUM(p.output_tokens),0) AS output_tokens,
  COALESCE(SUM(p.reasoning_tokens),0) AS reasoning_tokens,
  COALESCE(SUM(p.total_tokens),0) AS total_tokens,
  COALESCE(SUM(p.model_calls),0) AS model_calls,
  COALESCE(SUM(p.tool_calls),0) AS tool_calls,
  COALESCE(SUM(p.duration_ms),0) AS agent_ms,
  MIN(p.ts) AS first_at, MAX(p.ts) AS last_at`

const routes = {
  'GET /api/meta': () => ({
    developer: cfg.developer,
    projectPaths: cfg.projectPaths,
    developers: db.prepare('SELECT DISTINCT developer FROM sessions ORDER BY 1').all().map((r) => r.developer),
    sources: db.prepare('SELECT DISTINCT source FROM sessions ORDER BY 1').all().map((r) => r.source),
    lastSync,
  }),
  'POST /api/sync': () => doSync(),

  'GET /api/summary': (q) => {
    const w = where(q)
    const byDev = db.prepare(`SELECT p.developer, ${TOKEN_SUMS} FROM prompts p ${w.sql} GROUP BY p.developer ORDER BY p.developer`).all(...w.args)
    const bySource = db.prepare(`SELECT p.developer, p.source, ${TOKEN_SUMS} FROM prompts p ${w.sql} GROUP BY 1,2 ORDER BY total_tokens DESC`).all(...w.args)
    const byModel = db.prepare(`SELECT p.developer, COALESCE(p.model,'?') AS model, ${TOKEN_SUMS} FROM prompts p ${w.sql} GROUP BY 1,2 ORDER BY total_tokens DESC`).all(...w.args)
    const cw = where(q, 'c')
    const commitWhere = cw.sql.replace(/c\.source = \?/, '1=1')
    const commitArgs = q.get('source') ? cw.args.filter((a) => a !== q.get('source')) : cw.args
    const commits = db.prepare(`SELECT c.developer, COUNT(*) AS commits, SUM(additions) AS additions, SUM(deletions) AS deletions FROM commits c ${commitWhere} GROUP BY 1`).all(...commitArgs)
    return { byDev, bySource, byModel, commits }
  },

  'GET /api/timeseries': (q) => {
    const w = where(q)
    return db.prepare(`
      SELECT date(p.ts, 'localtime') AS day, p.developer,
        COUNT(*) AS prompts, COUNT(DISTINCT p.session_pk) AS sessions,
        SUM(p.total_tokens) AS total_tokens, SUM(p.output_tokens) AS output_tokens
      FROM prompts p ${w.sql} GROUP BY 1,2 ORDER BY 1`).all(...w.args)
  },

  'GET /api/sessions': (q) => {
    const w = where(q)
    return db.prepare(`
      SELECT s.*, ${TOKEN_SUMS}
      FROM prompts p JOIN sessions s ON s.id = p.session_pk
      ${w.sql} GROUP BY s.id ORDER BY s.started_at DESC LIMIT 500`).all(...w.args)
  },

  'GET /api/prompts': (q) => {
    const w = where(q)
    const conds = [w.sql.replace(/^WHERE /, '')].filter(Boolean)
    const args = [...w.args]
    if (q.get('session')) { conds.push('p.session_pk = ?'); args.push(q.get('session')) }
    if (q.get('q')) { conds.push('p.text LIKE ?'); args.push(`%${q.get('q')}%`) }
    const order = q.get('session') ? 'p.ts ASC' : 'p.ts DESC'
    return db.prepare(`SELECT p.* FROM prompts p ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`)
      .all(...args, Number(q.get('limit') || 500))
  },
}

const DIST = path.join(ROOT, 'dist')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const route = routes[`${req.method} ${url.pathname}`]
  if (route) {
    try {
      const body = JSON.stringify(route(url.searchParams))
      res.writeHead(200, { 'content-type': 'application/json' }).end(body)
    } catch (e) {
      console.error(e)
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }))
    }
    return
  }
  // Serve o build da UI (npm start)
  let file = path.join(DIST, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file)) return res.writeHead(404).end('UI não buildada. Use "npm run dev" ou "npm start".')
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(cfg.port, '127.0.0.1', () => {
  console.log(`tokenmetro API em http://localhost:${cfg.port}  (dev: ${cfg.developer}, projeto: ${cfg.projectPaths.join(', ')})`)
})
