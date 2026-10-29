import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ArrowDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Badge } from '../components/ui'
import { api, fmt, fmtDuration } from '../lib/utils'

// Anima um número de 0 até `value` (ease-out).
function useCountUp(value, ms = 1200) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(value)
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const k = Math.min((t - t0) / ms, 1)
      setV(value * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return v
}

// Texto aparecendo letra a letra.
function useTypewriter(text, cps = 60) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setN(text.length)
    setN(0)
    const t = setInterval(() => setN((k) => (k >= text.length ? (clearInterval(t), k) : k + 2)), 2000 / cps)
    return () => clearInterval(t)
  }, [text, cps])
  return text.slice(0, n)
}

// Elemento que sobe e aparece, com atraso escalonado por `i`.
const Rise = ({ i = 0, as: Tag = 'div', className, children }) => (
  <Tag className={`anim-rise ${className ?? ''}`} style={{ '--d': `${i * 120}ms` }}>{children}</Tag>
)

const Count = ({ value, format = fmt }) => format(useCountUp(value))

// Taquímetro: o ponteiro varre de 0 até value/max.
function Gauge({ value, max, label, sub }) {
  const v = useCountUp(value, 1600)
  const r = 80
  const ratio = Math.min(v / (max || 1), 1)
  const angle = Math.PI * (1 - ratio)
  const [nx, ny] = [100 + (r - 14) * Math.cos(angle), 100 - (r - 14) * Math.sin(angle)]
  const color = ratio > 0.8 ? '#dc2626' : ratio > 0.5 ? '#ea580c' : '#16a34a'
  const arc = `M 20 100 A ${r} ${r} 0 0 1 180 100`
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 115" className="w-64">
        <path d={arc} fill="none" strokeWidth="16" strokeLinecap="round" className="stroke-muted" />
        <path d={arc} fill="none" strokeWidth="16" strokeLinecap="round" stroke={color} pathLength="100" strokeDasharray={`${ratio * 100} 100`} />
        <line x1="100" y1="100" x2={nx} y2={ny} strokeWidth="4" strokeLinecap="round" className="stroke-foreground" />
        <circle cx="100" cy="100" r="7" className="fill-foreground" />
      </svg>
      <div className="-mt-2 text-4xl font-bold tabular-nums">{fmt(v)}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

const Stat = ({ i, value, label, format }) => (
  <Rise i={i}>
    <div className="text-3xl font-semibold tabular-nums">{typeof value === 'number' ? <Count value={value} format={format} /> : value}</div>
    <div className="text-sm text-muted-foreground">{label}</div>
  </Rise>
)

const Kicker = ({ children }) => <Rise className="text-lg text-muted-foreground first-letter:uppercase">{children}</Rise>
const Title = ({ children }) => <Rise i={1} as="h2" className="text-5xl font-bold">{children}</Rise>

const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
const when = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })

// Clicar num prompt abre ele inteiro com a conversa da sessão (ver PromptChain).
const OpenPrompt = createContext(() => {})
const Clickable = ({ p, className, children }) => {
  const open = useContext(OpenPrompt)
  return <button type="button" onClick={() => open(p)} className={`block w-full cursor-pointer text-left transition hover:border-foreground/40 hover:shadow-md ${className ?? ''}`}>{children}</button>
}

const PromptCard = ({ p, i, clamp = 'line-clamp-4', children }) => (
  <Rise i={i}><Clickable p={p} className="rounded-lg border bg-card p-4">
    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Badge>{p.source}</Badge> {fmt(p.total_tokens)} tokens · {new Date(p.ts).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}
    </div>
    <div className={`${clamp} text-sm`}>“{p.text}”</div>
    {children}
  </Clickable></Rise>
)

function Cover({ story }) {
  const t = story.totals
  const days = story.days
  return (
    <div className="flex h-full flex-col justify-center gap-12">
      <div>
        <Kicker>tokenmetro · linha do tempo</Kicker>
        <Rise i={1} as="h1" className="text-7xl font-bold">{story.developer}</Rise>
        <Rise i={2} className="mt-2 text-xl text-muted-foreground">
          {days.length} dias · {dayLabel(days[0].day)} → {dayLabel(days.at(-1).day)}
        </Rise>
      </div>
      <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
        <Stat i={3} value={t.total_tokens} label="tokens" />
        <Stat i={4} value={t.prompts} label="interações" />
        <Stat i={5} value={t.sessions} label="sessões" />
        <Stat i={6} value={t.commits} label="commits" />
        <Stat i={7} value={t.additions} format={(v) => `+${fmt(v)}`} label="linhas adicionadas" />
      </div>
    </div>
  )
}

function FirstPrompt({ p }) {
  const typed = useTypewriter(p.text)
  return (
    <div className="flex h-full flex-col justify-center gap-8">
      <div>
        <Kicker>onde tudo começou · {when(p.ts)}</Kicker>
        <Title>O primeiro prompt</Title>
      </div>
      <Rise i={2}><Clickable p={p} className="rounded-xl border bg-card p-8 font-mono text-2xl leading-relaxed">
        <span className="text-muted-foreground">› </span>{typed}<span className="caret">▌</span>
      </Clickable></Rise>
      <Rise i={3} className="flex gap-3 text-sm text-muted-foreground">
        <Badge>{p.source}</Badge> {p.model} · {fmt(p.total_tokens)} tokens · {p.tool_calls} tool calls
      </Rise>
    </div>
  )
}

function Day({ d, maxTokens }) {
  const s = d.stats
  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-8">
      <div>
        <Kicker>{dayLabel(d.day)}</Kicker>
        <Title>{d.title}</Title>
      </div>
      <div className="grid gap-10 md:grid-cols-[1fr_auto]">
        <div className="space-y-6">
          <Rise i={2} className="text-sm font-medium uppercase tracking-wide text-muted-foreground">O que foi entregue</Rise>
          <ul className={`space-y-3 ${d.delivered.length > 4 ? 'text-lg' : 'text-2xl'}`}>
            {d.delivered.map((b, k) => <Rise key={k} i={3 + k} as="li" className="flex gap-3"><span className="text-emerald-500">✓</span>{b.text}</Rise>)}
          </ul>
          {d.commits.length > 0 && (
            <Rise i={4 + d.delivered.length} className="space-y-1 font-mono text-sm text-muted-foreground">
              {d.commits.slice(0, 6).map((c) => (
                <div key={c.sha} className="truncate">{c.sha} {c.message} <span className="text-emerald-600">+{c.additions}</span> <span className="text-red-600">−{c.deletions}</span></div>
              ))}
              {d.commits.length > 6 && <div>+{d.commits.length - 6} commits</div>}
            </Rise>
          )}
        </div>
        <div className="flex flex-col items-center gap-6">
          <Rise i={2}><Gauge value={s.total_tokens} max={maxTokens} label="tokens no dia" sub={`${Math.round((s.cache_read_tokens / (s.total_tokens || 1)) * 100)}% cache`} /></Rise>
          <div className="grid grid-cols-2 gap-x-10 gap-y-4 text-center">
            <Stat i={3} value={s.prompts} label="interações" />
            <Stat i={4} value={s.tool_calls} label="tool calls" />
            <Stat i={5} value={s.commits} label="commits" />
            <Stat i={6} value={s.agent_ms} format={fmtDuration} label="agente trabalhando" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Cada feature com a cadeia de prompts que a originou.
function Features({ d }) {
  const linked = d.delivered.filter((f) => f.prompts?.length)
  const many = linked.reduce((n, f) => n + f.prompts.length, 0) > 5
  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <Kicker>{dayLabel(d.day)}</Kicker>
        <Title>De onde veio cada feature</Title>
      </div>
      <div className="space-y-5">
        {linked.map((f, k) => (
          <div key={k} className="grid items-center gap-4 md:grid-cols-[1fr_auto_1.4fr]">
            <div className="space-y-2">
              {f.prompts.map((p, j) => <PromptCard key={p.id} p={p} i={2 + k * 2} clamp={many || f.prompts.length > 1 ? 'line-clamp-2' : 'line-clamp-4'} />)}
            </div>
            <Rise i={3 + k * 2} className="hidden text-muted-foreground md:block"><ChevronRight className="size-8" /></Rise>
            <Rise i={3 + k * 2} className="flex gap-3 text-2xl font-medium md:hidden"><ArrowDown /></Rise>
            <Rise i={3 + k * 2} className="flex gap-3 text-2xl font-medium"><span className="text-emerald-500">✓</span>{f.text}</Rise>
          </div>
        ))}
      </div>
    </div>
  )
}

function Highlights({ d }) {
  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <Kicker>{dayLabel(d.day)}</Kicker>
        <Title>Destaques do dia</Title>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {d.highlights.map((h, k) => (
          <PromptCard key={h.id} p={h} i={2 + k} clamp="line-clamp-[10]">
            <div className="mt-3 text-sm font-medium text-amber-600 dark:text-amber-400">★ {h.why}</div>
          </PromptCard>
        ))}
      </div>
    </div>
  )
}

// Ranking dos prompts que mais consumiram tokens, com barras que crescem.
function TopPrompts({ prompts }) {
  const max = prompts[0]?.total_tokens || 1
  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <Kicker>o projeto inteiro</Kicker>
        <Title>Top prompts em tokens</Title>
      </div>
      <div className="space-y-5">
        {prompts.map((p, k) => (
          <Rise key={p.id} i={2 + k}><Clickable p={p} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 rounded-lg p-2">
            <div className="text-3xl font-bold text-muted-foreground">{k + 1}</div>
            <div className="min-w-0 space-y-2">
              <div className="truncate text-lg">“{p.text}”</div>
              <div className="flex items-center gap-3">
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="anim-grow h-full rounded-full bg-orange-500" style={{ width: `${(p.total_tokens / max) * 100}%`, '--d': `${(2 + k) * 120}ms` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-sm tabular-nums"><Count value={p.total_tokens} /></span>
              </div>
            </div>
          </Clickable></Rise>
        ))}
      </div>
    </div>
  )
}

// Encerramento: tokens por dia em barras verticais.
function Closing({ story, maxTokens }) {
  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <Kicker>resumo</Kicker>
        <Title>Tokens ao longo do projeto</Title>
      </div>
      <div className="flex h-72 items-end gap-2">
        {story.days.map((d, k) => (
          <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${d.title} · ${fmt(d.stats.total_tokens)}`}>
            <span className="text-xs tabular-nums text-muted-foreground">{fmt(d.stats.total_tokens)}</span>
            <div className="anim-grow-y w-full rounded-t-md bg-foreground/80" style={{ height: `${(d.stats.total_tokens / (maxTokens || 1)) * 100}%`, '--d': `${k * 80}ms` }} />
            <span className="text-xs text-muted-foreground">{d.day.slice(5).split('-').reverse().join('/')}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat i={3} value={story.totals.total_tokens} label="tokens no total" />
        <Stat i={4} value={story.totals.total_tokens / (story.totals.commits || 1)} label="tokens por commit" />
        <Stat i={5} value={story.totals.total_tokens / (story.totals.prompts || 1)} label="tokens por interação" />
        <Stat i={6} value={story.totals.agent_ms} format={fmtDuration} label="agente trabalhando" />
      </div>
    </div>
  )
}

// Arquivos citados (ex.: /tmp/handoff-x.md) que costumam ligar uma sessão à próxima.
const FILE_REF = /(?:\/|~\/|\.\/)[\w./-]+\.(?:md|txt|json|yaml|yml)\b/g

// Junta a sessão do prompt com as sessões ligadas a ela por um arquivo em comum:
// um /handoff escreve o plano e outra sessão faz /implement dele. Segue até 5 sessões.
async function linkedSessions(start) {
  const seen = new Set([start])
  const queue = [start]
  const rows = []
  while (queue.length && seen.size <= 5) {
    const session = queue.shift()
    const own = await api('prompts', { session, limit: 1000 })
    rows.push(...own)
    const refs = new Set(own.flatMap((r) => [...`${r.text ?? ''}\n${r.response ?? ''}`.matchAll(FILE_REF)].map((m) => m[0])))
    for (const ref of refs) {
      for (const r of await api('prompts', { ref, limit: 50 })) {
        if (!seen.has(r.session_pk) && r.kind === 'user') { seen.add(r.session_pk); queue.push(r.session_pk) }
      }
    }
  }
  return rows.sort((a, b) => a.ts.localeCompare(b.ts))
}

// Prompt inteiro + a conversa da sessão em que ele foi enviado: o que veio antes
// (contexto, ex.: o que um "sim" respondeu) e o que veio depois.
function PromptChain({ p, onClose }) {
  const [chain, setChain] = useState(null)
  const [openReplies, setOpenReplies] = useState(() => new Set([p.id]))
  const current = useRef(null)
  useEffect(() => {
    linkedSessions(p.session_pk)
      // Sem os comandos que não chegam ao modelo (/model, /clear: 0 tokens).
      .then((rows) => setChain(rows.filter((r) => (r.kind === 'user' && r.total_tokens > 0) || r.id === p.id)))
      .catch(() => setChain([]))
  }, [p.id, p.session_pk])
  useEffect(() => { current.current?.scrollIntoView({ block: 'center' }) }, [chain])
  const toggle = (id) => setOpenReplies((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const list = chain?.length ? chain : [p]
  const k = list.findIndex((r) => r.id === p.id)
  const tokens = list.reduce((a, r) => a + r.total_tokens, 0)
  const sessions = new Set(list.map((r) => r.session_pk)).size

  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/40 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl anim-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div>
            <div className="font-semibold">Cadeia do prompt</div>
            <div className="text-xs text-muted-foreground">
              {chain ? `${k + 1}º de ${list.length} prompts · ${sessions} sess${sessions > 1 ? 'ões ligadas' : 'ão'} · ${fmt(tokens)} tokens` : 'carregando sessão…'}
            </div>
          </div>
          <button className="ml-auto cursor-pointer text-muted-foreground" onClick={onClose} aria-label="fechar"><X className="size-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-auto px-6 py-5">
          {list.map((r, j) => {
            const isCurrent = r.id === p.id
            return (
              <div key={r.id} ref={isCurrent ? current : null} className={`relative pl-6 ${isCurrent ? '' : 'opacity-70'}`}>
                {j > 0 && r.session_pk !== list[j - 1].session_pk && (
                  <div className="mb-3 text-xs font-medium uppercase tracking-wide text-orange-600 dark:text-orange-400">↪ continua em outra sessão</div>
                )}
                <div className={`absolute left-0 top-2 size-2.5 rounded-full ${isCurrent ? 'bg-orange-500' : 'bg-muted-foreground/40'}`} />
                {j < list.length - 1 && <div className="absolute left-[4px] top-5 bottom-[-12px] w-px bg-border" />}
                <div className={`rounded-lg border p-4 ${isCurrent ? 'border-orange-500/60 bg-orange-500/5' : 'bg-card'}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(r.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    <Badge>{r.source}</Badge>
                    {r.model && <span className="font-mono">{r.model}</span>}
                    <span className="ml-auto tabular-nums"><b className="text-foreground">{fmt(r.total_tokens)}</b> tokens · {r.tool_calls} tools · {fmtDuration(r.duration_ms)}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm">{r.text}</pre>
                  {r.response && (
                    <div className="mt-3 border-t pt-2">
                      <button className="cursor-pointer text-xs text-muted-foreground underline" onClick={() => toggle(r.id)}>
                        {openReplies.has(r.id) ? 'ocultar resposta' : 'ver resposta do agente'}
                      </button>
                      {openReplies.has(r.id) && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{r.response}</pre>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Última página: todas as features do projeto, agrupadas por dia.
function AllFeatures({ story }) {
  let n = 0
  const count = story.days.reduce((a, d) => a + d.delivered.length, 0)
  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <Kicker>o projeto inteiro · {count} features</Kicker>
        <Title>Tudo que foi entregue</Title>
      </div>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        {story.days.map((d) => (
          <div key={d.day} className="space-y-2">
            <Rise i={n++} className="text-sm font-medium uppercase tracking-wide text-muted-foreground first-letter:uppercase">{dayLabel(d.day)}</Rise>
            {d.delivered.map((f, k) => (
              <Rise key={k} i={n++}>
                {f.prompts?.[0]
                  ? <Clickable p={f.prompts[0]} className="flex gap-3 rounded-md p-1.5 hover:bg-accent"><span className="text-emerald-500">✓</span>{f.text}</Clickable>
                  : <div className="flex gap-3 p-1.5"><span className="text-emerald-500">✓</span>{f.text}</div>}
              </Rise>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Sequência de slides a partir da story gerada no Exportar.
function buildSlides(story) {
  const maxTokens = Math.max(...story.days.map((d) => d.stats.total_tokens))
  return [
    <Cover story={story} />,
    story.first_prompt && <FirstPrompt p={story.first_prompt} />,
    ...story.days.flatMap((d) => [
      <Day d={d} maxTokens={maxTokens} />,
      d.delivered.some((f) => f.prompts?.length) && <Features d={d} />,
      d.highlights.length > 0 && <Highlights d={d} />,
    ]),
    story.top_prompts?.length > 0 && <TopPrompts prompts={story.top_prompts} />,
    <Closing story={story} maxTokens={maxTokens} />,
    <AllFeatures story={story} />,
  ].filter(Boolean)
}

export default function Present({ onClose }) {
  const [story, setStory] = useState(undefined)
  const [i, setI] = useState(0)
  const [opened, setOpened] = useState(null)

  useEffect(() => { Promise.resolve(api('story')).then(setStory).catch(() => setStory(null)) }, [])
  const slides = story?.days.length ? buildSlides(story) : []
  const total = slides.length
  const go = (n) => setI((v) => Math.max(0, Math.min(total - 1, v + n)))

  useEffect(() => {
    const key = (e) => {
      if (opened) { if (e.key === 'Escape') setOpened(null); return }
      if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) go(1)
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) go(-1)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <OpenPrompt.Provider value={setOpened}>
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {opened && <PromptChain p={opened} onClose={() => setOpened(null)} />}
      <button className="absolute right-4 top-4 cursor-pointer text-muted-foreground" onClick={onClose} aria-label="fechar"><X className="size-6" /></button>
      <div className="mx-auto w-full max-w-6xl flex-1 overflow-auto px-10 py-12">
        {story === undefined && <p className="text-muted-foreground">Carregando…</p>}
        {story !== undefined && !total && <p className="text-muted-foreground">Nenhuma apresentação gerada ainda. Clique em <b>Exportar</b> para gerar.</p>}
        {/* key força remontar o slide, reiniciando as animações */}
        {total > 0 && <div key={i} className="h-full">{slides[i]}</div>}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-4 border-t px-6 py-3">
          <button className="cursor-pointer disabled:opacity-30" onClick={() => go(-1)} disabled={i === 0}><ChevronLeft /></button>
          <div className="flex flex-1 gap-1">
            {slides.map((_, k) => (
              <button key={k} onClick={() => setI(k)} className={`h-1.5 flex-1 cursor-pointer rounded-full transition-colors ${k <= i ? 'bg-foreground' : 'bg-muted'}`} />
            ))}
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">{i + 1}/{total}</span>
          <button className="cursor-pointer disabled:opacity-30" onClick={() => go(1)} disabled={i === total - 1}><ChevronRight /></button>
        </div>
      )}
    </div>
    </OpenPrompt.Provider>
  )
}
