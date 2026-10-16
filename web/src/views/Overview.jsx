import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Terminal, MessageSquare, Coins, Wrench, GitCommit, Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Table, Th, Td, Tr, Badge } from '../components/ui'
import { api, fmt, fmtDuration, COLORS } from '../lib/utils'

function Kpi({ icon: Icon, label, value, hint }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

export default function Overview({ filters, version }) {
  const [summary, setSummary] = useState(null)
  const [series, setSeries] = useState([])
  const [metric, setMetric] = useState('total_tokens')

  useEffect(() => {
    api('summary', filters).then(setSummary)
    api('timeseries', filters).then(setSeries)
  }, [filters, version])

  if (!summary) return null
  const t = summary.byDev.reduce((a, r) => {
    for (const k of Object.keys(r)) if (typeof r[k] === 'number') a[k] = (a[k] || 0) + r[k]
    return a
  }, {})
  const commits = summary.commits.reduce((a, c) => a + c.commits, 0)
  const devs = [...new Set(series.map((r) => r.developer))]
  const chart = Object.values(series.reduce((acc, r) => {
    acc[r.day] ??= { day: r.day }
    acc[r.day][r.developer] = r[metric]
    return acc
  }, {}))
  const cacheHit = t.total_tokens ? (t.cache_read_tokens / t.total_tokens) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Terminal} label="Sessões" value={fmt(t.sessions)} hint={`${fmt(t.subagents)} subagentes`} />
        <Kpi icon={MessageSquare} label="Prompts" value={fmt(t.prompts)} hint={`${(t.prompts / (t.sessions || 1)).toFixed(1)} por sessão`} />
        <Kpi icon={Coins} label="Tokens" value={fmt(t.total_tokens)} hint={`${fmt(t.output_tokens)} output · ${cacheHit.toFixed(0)}% cache`} />
        <Kpi icon={Coins} label="Tokens / prompt" value={fmt(t.total_tokens / (t.prompts || 1))} hint={`${fmt(t.model_calls)} chamadas ao modelo`} />
        <Kpi icon={Wrench} label="Tool calls" value={fmt(t.tool_calls)} hint={`${(t.tool_calls / (t.prompts || 1)).toFixed(1)} por prompt`} />
        <Kpi icon={Timer} label="Tempo do agente" value={fmtDuration(t.agent_ms)} hint={`${commits} commits`} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-foreground">Ao longo do tempo</CardTitle>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
            <option value="total_tokens">Tokens totais</option>
            <option value="output_tokens">Tokens de output</option>
            <option value="prompts">Prompts</option>
            <option value="sessions">Sessões</option>
          </select>
        </CardHeader>
        <CardContent className="h-72">
          {chart.length ? (
            <ResponsiveContainer>
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" fontSize={12} tickLine={false} />
                <YAxis fontSize={12} tickFormatter={fmt} tickLine={false} width={50} />
                <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8 }} />
                <Legend />
                {devs.map((d, i) => (
                  <Area key={d} type="monotone" dataKey={d} stackId="1" stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.2} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="py-24 text-center text-sm text-muted-foreground">Sem dados ainda. Abra um agente na pasta do projeto e clique em Sync.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-foreground">Por ferramenta</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr className="border-b"><Th>Dev</Th><Th>Ferramenta</Th><Th>Sessões</Th><Th>Prompts</Th><Th className="text-right">Tokens</Th></tr></thead>
              <tbody>{summary.bySource.map((r) => (
                <Tr key={r.developer + r.source}><Td>{r.developer}</Td><Td><Badge>{r.source}</Badge></Td><Td>{r.sessions}</Td><Td>{r.prompts}</Td><Td className="text-right tabular-nums">{fmt(r.total_tokens)}</Td></Tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-foreground">Por modelo</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr className="border-b"><Th>Dev</Th><Th>Modelo</Th><Th>Prompts</Th><Th className="text-right">Tokens</Th></tr></thead>
              <tbody>{summary.byModel.map((r) => (
                <Tr key={r.developer + r.model}><Td>{r.developer}</Td><Td className="font-mono text-xs">{r.model}</Td><Td>{r.prompts}</Td><Td className="text-right tabular-nums">{fmt(r.total_tokens)}</Td></Tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
