import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { ROOT } from './config.js'

// Modo apresentação: uma linha do tempo por dia com o que foi entregue,
// números do dia e prompts de destaque. O texto é resumido por uma CLI de agente
// (claude, codex, devin ou copilot), escolhida no Exportar.

const CACHE_PATH = path.join(ROOT, 'data', 'story-cache.json')
export const storyPath = (dev) => path.join(ROOT, 'data', `story-${dev}.json`)

const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
const localDay = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s ?? '')

function dayStats(prompts, commits) {
  return {
    prompts: prompts.filter((p) => p.kind !== 'subagent').length,
    subagents: prompts.filter((p) => p.kind === 'subagent').length,
    sessions: new Set(prompts.map((p) => p.session_pk)).size,
    total_tokens: sum(prompts, 'total_tokens'),
    output_tokens: sum(prompts, 'output_tokens'),
    cache_read_tokens: sum(prompts, 'cache_read_tokens'),
    tool_calls: sum(prompts, 'tool_calls'),
    agent_ms: sum(prompts, 'duration_ms'),
    commits: commits.length,
    additions: sum(commits, 'additions'),
    deletions: sum(commits, 'deletions'),
  }
}

// Ignora subagentes, comandos internos do agente (/model, /effort low…), avisos de
// subagente terminado e envios duplicados que não chegaram ao modelo. Skills como
// /implement ou /handoff com argumentos são trabalho de verdade e ficam.
const BUILTIN = 'model|effort|clear|compact|config|cost|help|login|logout|resume|exit|status|permissions|theme|fast|memory|init|doctor|mcp|agents|context|usage|rewind|add-dir|ide|vim|terminal-setup|output-style|statusline'
const NOISE = [new RegExp(`^\\/(${BUILTIN})\\b`), /^\/[\w:-]+\s*$/, /^Agent ".*" (finished|failed|completed)/]
const userPrompts = (rows) => rows.filter((p) =>
  p.kind === 'user' && p.text && p.total_tokens > 0 && !NOISE.some((re) => re.test(p.text.trim())))

// Sem IA (ou se ela falhar): cada commit vira uma feature, ligada ao último
// prompt enviado antes dele.
function fallbackSummary(prompts, commits) {
  const ps = userPrompts(prompts)
  const top = [...ps].sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 3)
  const before = (ts) => ps.filter((p) => p.ts <= ts).at(-1) ?? ps[0]
  return {
    title: commits[0]?.message?.split('\n')[0] ?? clip(top[0]?.text, 80) ?? 'Dia de trabalho',
    delivered: commits.length
      ? commits.slice(0, 5).map((c) => ({ text: c.message.split('\n')[0], prompt_ids: [before(c.ts)?.id] }))
      : top.map((p) => ({ text: clip(p.text, 120), prompt_ids: [p.id] })),
    highlights: top.map((p) => ({ id: p.id, why: 'Prompt mais caro do dia' })),
  }
}

function buildPrompt(day, prompts, commits) {
  const ps = userPrompts(prompts)
  return `Você está montando um slide de apresentação sobre o trabalho de um dev com agentes de IA no dia ${day}.
Abaixo estão os commits e os prompts que ele enviou ao agente (com tokens gastos e um trecho da resposta).

Responda APENAS com JSON válido, sem markdown, no formato:
{"title": "<título curto do que foi feito no dia, até 8 palavras>",
 "delivered": [{"text": "<feature entregue, objetiva, em português>", "prompt_ids": ["<ids dos prompts que definiram a feature>"]}],
 "highlights": [{"id": "<id do prompt>", "why": "<por que esse prompt é interessante, até 15 palavras>"}]}
Liste TODAS as features entregues no dia em delivered (de 2 a 8; agrupe mudanças pequenas relacionadas). Em prompt_ids coloque de 1 a 3 prompts, em ordem cronológica, que mostram
como a feature nasceu: comece pelo prompt que PEDIU ou DEFINIU a feature (mesmo que tenha sido em outro prompt
antes das respostas curtas), depois as decisões importantes e o prompt que IMPLEMENTOU (ex.: /implement de um
plano gerado por /handoff, normalmente o que gasta mais tokens). Respostas curtas a perguntas do agente
(ex.: "opt-in por tipo de job") só entram se forem uma decisão relevante, nunca sozinhas.
Escolha de 1 a 3 highlights: prompts bem escritos, decisivos para a entrega, ou caros demais pelo resultado.

COMMITS:
${commits.map((c) => `- ${c.message.split('\n')[0]} (+${c.additions}/−${c.deletions})`).join('\n') || '(nenhum)'}

PROMPTS:
${ps.slice(0, 60).map((p) => `[id=${p.id}] ${new Date(p.ts).toTimeString().slice(0, 5)} (${p.total_tokens} tokens)\nPROMPT: ${clip(p.text, 600)}\nRESPOSTA: ${clip(p.response, 300)}`).join('\n\n')}`
}

// CLIs que podem escrever o resumo. `args` recebe o prompt e o modelo (opcional).
// Todas rodam em modo não interativo e sem permissão para mexer em arquivos.
export const AGENTS = {
  claude: { label: 'Claude Code', bin: 'claude', stdin: true, args: (m) => ['-p', '--output-format', 'text', ...(m ? ['--model', m] : [])] },
  codex: { label: 'Codex', bin: 'codex', stdin: true, args: (m) => ['exec', '--skip-git-repo-check', '-s', 'read-only', ...(m ? ['-m', m] : []), '-'] },
  devin: { label: 'Devin', bin: 'devin', stdin: false, args: (m, prompt) => ['-p', prompt, ...(m ? ['--model', m] : [])] },
  copilot: { label: 'GitHub Copilot', bin: 'copilot', stdin: false, args: (m, prompt) => ['-p', prompt, '-s', ...(m ? ['--model', m] : [])] },
}
const DEFAULT_MODEL = { claude: 'haiku' }

// Procura o binário no PATH (com as extensões do Windows).
function onPath(bin) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';') : ['']
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => exts.some((e) => fs.existsSync(path.join(dir, bin + e.toLowerCase())) || fs.existsSync(path.join(dir, bin + e))))
}

export const availableAgents = () =>
  Object.entries(AGENTS).map(([id, a]) => ({ id, label: a.label, available: onPath(a.bin) }))

function askAgent(agent, prompt, model) {
  const a = AGENTS[agent]
  // No Windows as CLIs são shims .cmd e precisam de shell; o prompt (texto livre)
  // nunca pode passar por ele, então só aceita agentes que leem o prompt do stdin.
  const shell = process.platform === 'win32'
  if (shell && !a.stdin) return Promise.reject(new Error(`${a.label} ainda não é suportado no Windows`))
  return new Promise((resolve, reject) => {
    // Roda fora do projeto para essas chamadas não entrarem nas métricas.
    const child = execFile(a.bin, a.args(model, prompt),
      { cwd: os.tmpdir(), timeout: 180_000, maxBuffer: 10 * 1024 * 1024, shell },
      (err, stdout, stderr) => {
        // A saída de erro dessas CLIs ecoa o prompt inteiro; mostra só a última linha útil.
        if (err) return reject(new Error(`${a.bin} falhou: ${clip(`${stderr}\n${stdout}`.trim().split('\n').filter(Boolean).at(-1) ?? err.message, 300)}`))
        const json = stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)
        try { resolve(JSON.parse(json)) } catch { reject(new Error(`resposta inválida: ${clip(stdout, 200)}`)) }
      })
    child.stdin.end(a.stdin ? prompt : '')
  })
}

async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

// agent: chave de AGENTS, ou 'none' para montar os slides sem IA.
export async function buildStory(data, cfg, agent = 'claude', log = console.log) {
  if (agent !== 'none' && !AGENTS[agent]) throw new Error(`agente desconhecido: ${agent}`)
  const model = cfg.storyModel?.[agent] ?? DEFAULT_MODEL[agent]
  const useAi = agent !== 'none'
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) } catch {}

  // Um slide por dia com prompt real do dev. Commits e tokens de dias sem prompt
  // (ex.: commit na manhã seguinte, subagente terminando de madrugada) vão para o
  // último dia de trabalho antes deles.
  const days = [...new Set(userPrompts(data.prompts).map((p) => localDay(p.ts)))].sort()
  const bucket = (ts) => days.findLast((d) => d <= localDay(ts)) ?? days[0]
  const byId = new Map(data.prompts.map((p) => [p.id, p]))

  const slides = await pool(days, 4, async (day) => {
    const prompts = data.prompts.filter((p) => bucket(p.ts) === day).sort((a, b) => a.ts.localeCompare(b.ts))
    const commits = data.commits.filter((c) => bucket(c.ts) === day).sort((a, b) => a.ts.localeCompare(b.ts))
    const prompt = buildPrompt(day, prompts, commits)
    const key = crypto.createHash('sha1').update(`${agent}:${model}:${prompt}`).digest('hex')
    let summary = cache[key]
    if (!summary && useAi) {
      try {
        log(`  resumindo ${day} com ${agent}…`)
        summary = await askAgent(agent, prompt, model)
        cache[key] = summary
      } catch (e) {
        log(`  ⚠ ${day}: ${e.message} (usando resumo sem IA)`)
      }
    }
    summary ??= fallbackSummary(prompts, commits)
    return {
      day,
      title: summary.title,
      // Versões antigas do cache devolviam só strings.
      delivered: (summary.delivered ?? []).map((d) => {
        const { text, prompt_ids = [d.prompt_id] } = typeof d === 'string' ? { text: d } : d
        const ps = prompt_ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.ts.localeCompare(b.ts))
        return { text, prompts: ps.map(pick) }
      }).sort((a, b) => (a.prompts[0]?.ts ?? '~').localeCompare(b.prompts[0]?.ts ?? '~')),
      stats: dayStats(prompts, commits),
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: c.message.split('\n')[0], additions: c.additions, deletions: c.deletions })),
      highlights: (summary.highlights ?? []).map((h) => byId.get(h.id) && { why: h.why, ...pick(byId.get(h.id)) }).filter(Boolean),
    }
  })

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache))
  return {
    developer: data.developer,
    agent,
    generated_at: new Date().toISOString(),
    totals: dayStats(data.prompts, data.commits),
    first_prompt: (fp => fp && pick(fp))(userPrompts(data.prompts).sort((a, b) => a.ts.localeCompare(b.ts))[0]),
    top_prompts: userPrompts(data.prompts).sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 5).map(pick),
    days: slides,
  }
}

const pick = (p) => ({ id: p.id, session_pk: p.session_pk, ts: p.ts, source: p.source, model: p.model, text: clip(p.text, 1200), response: clip(p.response, 800), total_tokens: p.total_tokens, tool_calls: p.tool_calls })
