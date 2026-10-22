import { useEffect, useState } from 'react'
import { Card, CardContent, Input, Badge } from '../components/ui'
import { api, fmt, fmtDate, fmtDuration } from '../lib/utils'

export function PromptRow({ p }) {
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
  useEffect(() => {
    const t = setTimeout(() => api('prompts', { ...filters, q, limit: 300 }).then(setRows), 250)
    return () => clearTimeout(t)
  }, [filters, q, version])

  return (
    <div className="space-y-4">
      <Input placeholder="Buscar nos prompts…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card><CardContent className="space-y-2 p-4">
        {rows.map((p) => <PromptRow key={p.id} p={p} />)}
        {!rows.length && <p className="py-16 text-center text-sm text-muted-foreground">Nenhum prompt.</p>}
      </CardContent></Card>
    </div>
  )
}
