import { useEffect, useMemo, useState, useCallback } from 'react'
import { Activity, Moon, RefreshCw, Sun } from 'lucide-react'
import { Button, Select, Input, Tabs } from './components/ui'
import { api, fmtDate } from './lib/utils'
import Overview from './views/Overview'
import Compare from './views/Compare'
import Sessions from './views/Sessions'
import Prompts from './views/Prompts'

export default function App() {
  const [meta, setMeta] = useState(null)
  const [tab, setTab] = useState('overview')
  const [filters, setFilters] = useState({ developer: '', source: '', from: '', to: '' })
  const [version, setVersion] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [error, setError] = useState(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const loadMeta = useCallback(() => api('meta').then(setMeta).catch((e) => setError(e.message)), [])
  useEffect(() => { loadMeta() }, [loadMeta, version])
  // Atualiza sozinho a cada 30s
  useEffect(() => { const t = setInterval(() => setVersion((v) => v + 1), 30000); return () => clearInterval(t) }, [])

  const sync = async () => {
    setSyncing(true)
    await fetch('/api/sync', { method: 'POST' })
    setSyncing(false)
    setVersion((v) => v + 1)
  }
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  const props = useMemo(() => ({ filters, version }), [filters, version])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Activity className="size-5" /> tokenmetro
          </div>
          {meta && (
            <span className="truncate text-xs text-muted-foreground" title={meta.projectPaths.join('\n')}>
              {meta.developer} · {meta.projectPaths.map((p) => p.split('/').pop()).join(', ')}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {meta?.lastSync && <span className="hidden text-xs text-muted-foreground md:inline">sync {fmtDate(meta.lastSync.at)}</span>}
            <Button variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} /> Sync
            </Button>
            <Button variant="ghost" onClick={() => setDark(!dark)} aria-label="tema">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">{error}</div>}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onChange={setTab} items={[['overview', 'Visão geral'], ['compare', 'Comparação'], ['sessions', 'Sessões'], ['prompts', 'Prompts']]} />
          <div className="ml-auto flex flex-wrap gap-2">
            <Select value={filters.developer} onChange={set('developer')} options={meta?.developers ?? []} placeholder="Todos os devs" />
            <Select value={filters.source} onChange={set('source')} options={meta?.sources ?? []} placeholder="Todas as ferramentas" />
            <Input type="date" value={filters.from} onChange={set('from')} className="w-auto" />
            <Input type="date" value={filters.to} onChange={set('to')} className="w-auto" />
          </div>
        </div>
        {tab === 'overview' && <Overview {...props} />}
        {tab === 'compare' && <Compare {...props} />}
        {tab === 'sessions' && <Sessions {...props} />}
        {tab === 'prompts' && <Prompts {...props} />}
      </main>
    </div>
  )
}

