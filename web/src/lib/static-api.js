// Implementação em memória da API, usada pelo HTML exportado (sem server).
// Espelha as rotas de server/index.js sobre os arrays do export tokenmetro/v1.

const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)

function tokenSums(rows) {
  const ts = rows.map((p) => p.ts).sort()
  return {
    prompts: rows.length,
    sessions: new Set(rows.map((p) => p.session_pk)).size,
    subagents: rows.filter((p) => p.kind === 'subagent').length,
    input_tokens: sum(rows, 'input_tokens'),
    cache_read_tokens: sum(rows, 'cache_read_tokens'),
    cache_write_tokens: sum(rows, 'cache_write_tokens'),
    output_tokens: sum(rows, 'output_tokens'),
    reasoning_tokens: sum(rows, 'reasoning_tokens'),
    total_tokens: sum(rows, 'total_tokens'),
    model_calls: sum(rows, 'model_calls'),
    tool_calls: sum(rows, 'tool_calls'),
    agent_ms: sum(rows, 'duration_ms'),
    first_at: ts[0] ?? null,
    last_at: ts.at(-1) ?? null,
  }
}

function groupBy(rows, keyFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

const localDay = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const nextDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function filterRows(rows, q, { source = true } = {}) {
  return rows.filter((r) =>
    (!q.developer || r.developer === q.developer) &&
    (!source || !q.source || r.source === q.source) &&
    (!q.from || r.ts >= q.from) &&
    (!q.to || r.ts < nextDay(q.to)))
}

export function createStaticApi(data) {
  const { sessions, prompts, commits } = data
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const routes = {
    meta: () => ({
      developer: data.developer,
      projectPaths: data.projectPaths ?? [],
      developers: [...new Set(sessions.map((s) => s.developer))].sort(),
      sources: [...new Set(sessions.map((s) => s.source))].sort(),
      lastSync: null,
      snapshot: { exported_at: data.exported_at },
    }),

    summary: (q) => {
      const rows = filterRows(prompts, q)
      const byDesc = (a, b) => b.total_tokens - a.total_tokens
      return {
        byDev: [...groupBy(rows, (p) => p.developer)].map(([developer, g]) => ({ developer, ...tokenSums(g) }))
          .sort((a, b) => a.developer.localeCompare(b.developer)),
        bySource: [...groupBy(rows, (p) => `${p.developer}\0${p.source}`)]
          .map(([, g]) => ({ developer: g[0].developer, source: g[0].source, ...tokenSums(g) })).sort(byDesc),
        byModel: [...groupBy(rows, (p) => `${p.developer}\0${p.model ?? '?'}`)]
          .map(([, g]) => ({ developer: g[0].developer, model: g[0].model ?? '?', ...tokenSums(g) })).sort(byDesc),
        commits: [...groupBy(filterRows(commits, q, { source: false }), (c) => c.developer)]
          .map(([developer, g]) => ({ developer, commits: g.length, additions: sum(g, 'additions'), deletions: sum(g, 'deletions') })),
      }
    },

    timeseries: (q) =>
      [...groupBy(filterRows(prompts, q), (p) => `${localDay(p.ts)}\0${p.developer}`)]
        .map(([, g]) => ({
          day: localDay(g[0].ts),
          developer: g[0].developer,
          prompts: g.length,
          sessions: new Set(g.map((p) => p.session_pk)).size,
          total_tokens: sum(g, 'total_tokens'),
          output_tokens: sum(g, 'output_tokens'),
        }))
        .sort((a, b) => a.day.localeCompare(b.day)),

    sessions: (q) =>
      [...groupBy(filterRows(prompts, q), (p) => p.session_pk)]
        .filter(([id]) => sessionById.has(id))
        .map(([id, g]) => ({ ...sessionById.get(id), ...tokenSums(g) }))
        .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
        .slice(0, 500),

    story: () => data.story ?? null,
    ignored: () => [],

    prompts: (q) => {
      const needle = q.q?.toLowerCase()
      return filterRows(prompts, q)
        .filter((p) => (!q.session || p.session_pk === q.session) && (!needle || p.text?.toLowerCase().includes(needle)))
        .filter((p) => !q.ref || p.text?.includes(q.ref) || p.response?.includes(q.ref))
        .sort((a, b) => (q.session ? a.ts.localeCompare(b.ts) : b.ts.localeCompare(a.ts)))
        .slice(0, Number(q.limit || 500))
    },
  }
  return (path, params) => {
    const route = routes[path]
    if (!route) throw new Error(`rota indisponível no modo estático: ${path}`)
    return route(params)
  }
}
