import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, Table, Th, Td, Tr } from '../components/ui'
import { api, fmt, fmtDuration } from '../lib/utils'

// Cada linha = uma métrica; cada coluna = um dev. O melhor valor fica destacado.
const ROWS = [
  ['Sessões (terminais abertos)', (d) => d.sessions, fmt],
  ['Prompts', (d) => d.prompts, fmt],
  ['Prompts por sessão', (d) => d.prompts / (d.sessions || 1), (v) => v.toFixed(1)],
  ['Subagentes disparados', (d) => d.subagents, fmt],
  ['Tokens totais', (d) => d.total_tokens, fmt, 'min'],
  ['Tokens de input (sem cache)', (d) => d.input_tokens, fmt, 'min'],
  ['Tokens de output', (d) => d.output_tokens, fmt, 'min'],
  ['Tokens de raciocínio', (d) => d.reasoning_tokens, fmt],
  ['Cache hit (% do total)', (d) => (d.cache_read_tokens / (d.total_tokens || 1)) * 100, (v) => v.toFixed(0) + '%', 'max'],
  ['Tokens por prompt', (d) => d.total_tokens / (d.prompts || 1), fmt, 'min'],
  ['Chamadas ao modelo', (d) => d.model_calls, fmt],
  ['Tool calls', (d) => d.tool_calls, fmt],
  ['Tempo do agente trabalhando', (d) => d.agent_ms, fmtDuration],
  ['Período (1º → último prompt)', (d) => new Date(d.last_at) - new Date(d.first_at), fmtDuration],
  ['Commits', (d) => d.commits, fmt],
  ['Linhas + / −', (d) => d.additions, (v, d) => `+${fmt(d.additions)} / −${fmt(d.deletions)}`],
  ['Tokens por commit', (d) => (d.commits ? d.total_tokens / d.commits : NaN), (v) => (isNaN(v) ? '—' : fmt(v)), 'min'],
]

export default function Compare({ filters, version }) {
  const [devs, setDevs] = useState([])
  useEffect(() => {
    api('summary', { ...filters, developer: '' }).then((s) => {
      const commits = Object.fromEntries(s.commits.map((c) => [c.developer, c]))
      setDevs(s.byDev.map((d) => ({ commits: 0, additions: 0, deletions: 0, ...d, ...commits[d.developer] })))
    })
  }, [filters.source, filters.from, filters.to, version])

  if (!devs.length) return <p className="py-24 text-center text-sm text-muted-foreground">Sem dados. Importe os exports dos colegas com <code>npm run import -- arquivo.json</code>.</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Comparação entre devs</CardTitle>
        <p className="text-xs text-muted-foreground">Destaque = melhor valor onde “menos é melhor” (tokens) ou “mais é melhor” (cache). Demais métricas são descritivas.</p>
      </CardHeader>
      <CardContent>
        <Table>
          <thead><tr className="border-b"><Th>Métrica</Th>{devs.map((d) => <Th key={d.developer} className="text-right">{d.developer}</Th>)}</tr></thead>
          <tbody>
            {ROWS.map(([label, get, format, best]) => {
              const vals = devs.map(get)
              const valid = vals.filter((v) => !isNaN(v))
              const target = best === 'min' ? Math.min(...valid) : best === 'max' ? Math.max(...valid) : null
              return (
                <Tr key={label}>
                  <Td className="text-muted-foreground">{label}</Td>
                  {devs.map((d, i) => (
                    <Td key={d.developer} className={`text-right tabular-nums ${devs.length > 1 && vals[i] === target ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}`}>
                      {format(vals[i], d)}
                    </Td>
                  ))}
                </Tr>
              )
            })}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  )
}
