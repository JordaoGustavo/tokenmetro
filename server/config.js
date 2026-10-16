import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CONFIG_PATH = process.env.TOKENMETRO_CONFIG || path.join(ROOT, 'tokenmetro.config.json')

const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config não encontrada em ${CONFIG_PATH}. Rode "npm run setup" primeiro.`)
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  if (!raw.developer) throw new Error('Config: campo "developer" é obrigatório.')
  if (!raw.projectPaths?.length) throw new Error('Config: "projectPaths" precisa de ao menos um caminho.')
  const projectPaths = raw.projectPaths.map((p) => {
    const abs = path.resolve(expand(p))
    try { return fs.realpathSync(abs) } catch { return abs }
  })
  return {
    port: 4317,
    syncIntervalSeconds: 60,
    ...raw,
    sources: { claude: true, codex: true, cursor: true, ...raw.sources },
    projectPaths,
  }
}

// Só aceita eventos cujo cwd é exatamente o projeto ou uma subpasta dele.
// É isso que impede outros projetos de contaminarem as métricas.
export function makeMatcher(projectPaths) {
  return (cwd) => {
    if (!cwd) return null
    let real = cwd
    try { real = fs.realpathSync(cwd) } catch {}
    return projectPaths.find((p) => real === p || real.startsWith(p + path.sep)) ?? null
  }
}
