// Assistente interativo: cria tokenmetro.config.json
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline/promises'
import { CONFIG_PATH } from '../server/config.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = async (q, def) => (await rl.question(def ? `${q} (${def}): ` : `${q}: `)).trim() || def

const current = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
console.log('\n⚙  tokenmetro — configuração\n')
const developer = await ask('Seu nome/apelido (identifica você na comparação)', current.developer || os.userInfo().username)
let projectPath = await ask('Caminho ABSOLUTO do projeto do desafio', current.projectPaths?.[0])
while (!projectPath || !fs.existsSync(projectPath)) {
  console.log('  ✖ caminho não existe. Crie a pasta do projeto antes (mkdir) e tente de novo.')
  projectPath = await ask('Caminho ABSOLUTO do projeto do desafio')
}
rl.close()

const cfg = {
  developer,
  projectPaths: [path.resolve(projectPath)],
  sources: { claude: true, codex: true, cursor: true, devin: true, ...current.sources },
  syncIntervalSeconds: current.syncIntervalSeconds ?? 60,
  port: current.port ?? 4317,
}
fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n')
console.log(`\n✔ salvo em ${CONFIG_PATH}\n  Próximo passo: npm run dev  →  http://localhost:5173\n`)
