import { Fragment, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent, Table, Th, Td, Tr, Badge } from '../components/ui'
import { api, fmt, fmtDate, fmtDuration } from '../lib/utils'
import { PromptRow } from './Prompts'

export default function Sessions({ filters, version }) {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)
  const [prompts, setPrompts] = useState([])

  useEffect(() => { api('sessions', filters).then(setRows) }, [filters, version])
  useEffect(() => { if (open) api('prompts', { session: open }).then(setPrompts) }, [open, version])

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <thead><tr className="border-b">
            <Th></Th><Th>Início</Th><Th>Dev</Th><Th>Ferramenta</Th><Th>Modelo</Th><Th>Branch</Th>
            <Th className="text-right">Prompts</Th><Th className="text-right">Tools</Th><Th className="text-right">Tempo</Th><Th className="text-right">Tokens</Th>
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <Fragment key={s.id}>
                <Tr className="cursor-pointer" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <Td><ChevronRight className={`size-4 transition ${open === s.id ? 'rotate-90' : ''}`} /></Td>
                  <Td>{fmtDate(s.started_at)}</Td>
                  <Td>{s.developer}</Td>
                  <Td><Badge>{s.source}</Badge></Td>
                  <Td className="font-mono text-xs">{s.model ?? '—'}</Td>
                  <Td className="text-xs text-muted-foreground">{s.git_branch ?? '—'}</Td>
                  <Td className="text-right">{s.prompts}</Td>
                  <Td className="text-right">{s.tool_calls}</Td>
                  <Td className="text-right">{fmtDuration(s.agent_ms)}</Td>
                  <Td className="text-right font-medium tabular-nums">{fmt(s.total_tokens)}</Td>
                </Tr>
                {open === s.id && (
                  <tr><td colSpan={10} className="bg-muted/30 p-4">
                    <div className="space-y-2">{prompts.map((p) => <PromptRow key={p.id} p={p} />)}</div>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={10} className="py-16 text-center text-sm text-muted-foreground">Nenhuma sessão encontrada.</td></tr>}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  )
}
