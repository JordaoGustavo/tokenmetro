import { useEffect, useMemo, useState, useCallback } from 'react'
import { Activity, Download, Moon, Presentation, RefreshCw, Share2, Sun } from 'lucide-react'
import { Button, Select, Input, Tabs } from './components/ui'
import { api, fmtDate, STATIC_DATA } from './lib/utils'
import Overview from './views/Overview'
import Compare from './views/Compare'
import Sessions from './views/Sessions'
import Prompts from './views/Prompts'
import Present from './views/Present'

export default function App() {
  const [meta, setMeta] = useState(null)
  const [tab, setTab] = useState('overview')
  const [filters, setFilters] = useState({ developer: '', source: '', from: '', to: '' })
  const [version, setVersion] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [error, setError] = useState(null)
  const [presenting, setPresenting] = useState(() => location.hash === '#present')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const loadMeta = useCallback(() => api('meta').then(setMeta).catch((e) => setError(e.message)), [])
  useEffect(() => { loadMeta() }, [loadMeta, version])
  // Atualiza sozinho a cada 30s
  useEffect(() => {
    if (STATIC_DATA) return
    const t = setInterval(() => setVersion((v) => v + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const sync = async () => {
    setSyncing(true)
    await fetch('/api/sync', { method: 'POST' })
    setSyncing(false)
    setVersion((v) => v + 1)
  }
  const [agents, setAgents] = useState(null)
  // Exportar pergunta qual CLI de agente resume os slides.
  const pickAgent = async () => setAgents(agents ? null : await api('agents'))
  const exportReport = async (agent) => {
    setAgents(null)
    setExporting(true)
    setError(null)
    try {
      const res = await fetch(`/api/export?agent=${agent}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setNotice(`Exportado: ${body.html} e ${body.json} (${body.prompts} prompts, ${body.days} slides)`)
      setVersion((v) => v + 1)
    } catch (e) {
      setError(`Falha no export: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }
  // No HTML exportado: baixa o JSON embutido para importar no tokenmetro.
  const downloadJson = () => {
    const { projectPaths, ...data } = STATIC_DATA
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${data.developer}.json` })
    a.click()
    URL.revokeObjectURL(url)
  }
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  const props = useMemo(() => ({ filters, version }), [filters, version])

  return (
    <div className="min-h-screen">
      {presenting && <Present onClose={() => setPresenting(false)} />}
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
            {STATIC_DATA ? (
              <>
                <span className="hidden text-xs text-muted-foreground md:inline">snapshot {fmtDate(STATIC_DATA.exported_at)}</span>
                <Button variant="outline" onClick={downloadJson}>
                  <Download className="size-4" /> JSON
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={sync} disabled={syncing}>
                  <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} /> Sync
                </Button>
                <div className="relative">
                  <Button variant="outline" onClick={pickAgent} disabled={exporting} title="Gera HTML + JSON + slides para o time">
                    <Share2 className={`size-4 ${exporting ? 'animate-pulse' : ''}`} /> {exporting ? 'Exportando…' : 'Exportar'}
                  </Button>
                  {agents && (
                    <div className="absolute right-0 top-11 z-20 w-64 rounded-lg border bg-card p-2 shadow-lg">
                      <div className="px-2 pb-2 text-xs text-muted-foreground">Qual agente resume os slides?</div>
                      {[...agents, { id: 'none', label: 'Sem IA (só commits)', available: true }].map((a) => (
                        <button key={a.id} disabled={!a.available} onClick={() => exportReport(a.id)}
                          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
                          {a.label}
                          {!a.available && <span className="text-xs text-muted-foreground">não instalado</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <Button variant="outline" onClick={() => setPresenting(true)} title="Linha do tempo em slides (gerada no Exportar)">
              <Presentation className="size-4" /> Apresentar
            </Button>
            <Button variant="ghost" onClick={() => setDark(!dark)} aria-label="tema">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {notice && (
          <div className="flex items-start gap-3 rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-sm">
            <span className="break-all">{notice}</span>
            <button className="ml-auto cursor-pointer text-muted-foreground" onClick={() => setNotice(null)} aria-label="fechar">✕</button>
          </div>
        )}
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

