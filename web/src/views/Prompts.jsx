import { useEffect, useState } from 'react'
import { EyeOff, Undo2 } from 'lucide-react'
import { Card, CardContent, Input, Badge } from '../components/ui'
import { api, fmt, fmtDate, fmtDuration, STATIC_DATA } from '../lib/utils'

export function PromptRow({ p, onIgnore }) {
  const [expanded, setExpanded] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const long = p.text?.length > 400
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{fmtDate(p.ts)}</span>
        <Badge>{p.source}</Badge>
        {p.kind !== 'user' && <Badge>{p.kind}</Badge>}
        <span>{p.developer}</span>
        {p.model && <span className="font-mono">{p.model}</span>}
        <span className="ml-auto tabular-nums" title={`input ${p.input_tokens} · cache read ${p.cache_read_tokens} · cache write ${p.cache_write_tokens} · output ${p.output_tokens}`}>
          <b className="text-foreground">{fmt(p.total_tokens)}</b> tokens · {fmt(p.output_tokens)} out · {p.tool_calls} tools · {fmtDuration(p.duration_ms)}
        </span>
        {onIgnore && (
          <button className="cursor-pointer hover:text-foreground" onClick={() => onIgnore(p.id)} title="Não faz parte do projeto: remove das métricas, do export e dos slides">
            <EyeOff className="size-3.5" />
          </button>
        )}
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">{long && !expanded ? p.text.slice(0, 400) + '…' : p.text}</pre>
      {long && <button className="mt-1 text-xs text-muted-foreground underline cursor-pointer" onClick={() => setExpanded(!expanded)}>{expanded ? 'menos' : 'ver tudo'}</button>}
      {p.response && (
        <div className="mt-2 border-t pt-2">
          <button className="text-xs text-muted-foreground underline cursor-pointer" onClick={() => setShowReply(!showReply)}>
            {showReply ? 'ocultar resposta' : 'ver resposta'}
          </button>
          {showReply && <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{p.response}</pre>}
        </div>
      )}
    </div>
  )
}

export default function Prompts({ filters, version }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [ignored, setIgnored] = useState([])
  const [showIgnored, setShowIgnored] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => api('prompts', { ...filters, q, limit: 300 }).then(setRows), 250)
    return () => clearTimeout(t)
  }, [filters, q, version, tick])
  useEffect(() => { Promise.resolve(api('ignored')).then(setIgnored) }, [version, tick])

  const post = (route, id) => fetch(`/api/prompts/${route}?id=${encodeURIComponent(id)}`, { method: 'POST' }).then(() => setTick((t) => t + 1))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input placeholder="Buscar nos prompts…" value={q} onChange={(e) => setQ(e.target.value)} />
        {ignored.length > 0 && (
          <button className="shrink-0 cursor-pointer text-xs text-muted-foreground underline" onClick={() => setShowIgnored(!showIgnored)}>
            {showIgnored ? 'esconder ocultos' : `${ignored.length} oculto${ignored.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      {showIgnored && (
        <Card><CardContent className="space-y-2 p-4">
          <p className="text-xs text-muted-foreground">Fora do projeto: não entram nas métricas, no export nem nos slides.</p>
          {ignored.map((p) => (
            <div key={p.id} className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              <span className="shrink-0 text-xs">{fmtDate(p.ts)}</span>
              <span className="line-clamp-2 flex-1">{p.text}</span>
              <button className="flex shrink-0 cursor-pointer items-center gap-1 text-xs hover:text-foreground" onClick={() => post('restore', p.id)}>
                <Undo2 className="size-3.5" /> restaurar
              </button>
            </div>
          ))}
        </CardContent></Card>
      )}
      <Card><CardContent className="space-y-2 p-4">
        {rows.map((p) => <PromptRow key={p.id} p={p} onIgnore={!STATIC_DATA && ((id) => post('ignore', id))} />)}
        {!rows.length && <p className="py-16 text-center text-sm text-muted-foreground">Nenhum prompt.</p>}
      </CardContent></Card>
    </div>
  )
}
