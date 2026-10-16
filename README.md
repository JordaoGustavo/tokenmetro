# tokenmetro

Métricas **locais** de como cada dev usa agentes de IA (Claude Code, Codex, Devin CLI, Cursor…) enquanto implementa **o mesmo projeto**, para depois compararmos os workflows.

O tokenmetro **não fica no meio** das suas ferramentas. Ele lê os logs que cada agente já grava no seu computador. Depois filtra só o que aconteceu **dentro da pasta do projeto do desafio**. Usar IA em outros projetos não afeta as métricas.

```
~/.claude/projects/*.jsonl ┐
~/.codex/sessions/**.jsonl ├─► filtro por cwd == pasta do projeto ─► SQLite local ─► dashboard (localhost)
Cursor state.vscdb         │
Devin CLI sessions.db      │                                              │
git log do projeto         ┘                                              └─► export JSON ─► comparação entre devs
```

## O que é medido

| Métrica | Descrição |
|---|---|
| **Sessões** | Cada vez que você abriu um agente (terminal do Claude Code/Codex, chat/composer do Cursor) |
| **Prompts** | Cada mensagem enviada por você, **com o texto salvo** |
| **Tokens por prompt** | input (sem cache), cache read, cache write, output e raciocínio, somados em todas as chamadas que o agente fez para responder aquele prompt |
| **Tokens por sessão/dia/dev** | Totais e série temporal |
| **Chamadas ao modelo / tool calls** | Quantas idas ao modelo e quantas ferramentas (editar arquivo, rodar comando…) cada prompt gerou |
| **Subagentes** | Tarefas delegadas pelo Claude Code a subagentes (tokens contados na sessão-pai) |
| **Tempo do agente** | Do envio do prompt até a última resposta |
| **Modelo e branch** | Qual modelo foi usado e em qual branch git |
| **Commits / linhas** | Resultado no repositório: commits, linhas +/−, **tokens por commit** |

## Requisitos

- **Node.js ≥ 22.5** (usa o SQLite embutido, `node:sqlite`, então não há dependência nativa para compilar). Confira com `node -v`.
- macOS, Linux ou Windows.

## Instalação (5 minutos)

```bash
git clone <este-repo> tokenmetro
cd tokenmetro
npm install
npm run setup     # pergunta seu nome e o caminho da pasta do projeto do desafio
npm run dev       # abre API + dashboard
```

Abra **http://localhost:5173**.

> O tokenmetro deve ficar **em uma pasta separada** do projeto do desafio. Não o coloque dentro dela.

### Configuração manual (opcional)

O `npm run setup` gera o `tokenmetro.config.json`. Ele não é versionado. Você também pode copiar o exemplo:

```bash
cp tokenmetro.config.example.json tokenmetro.config.json
```

```jsonc
{
  "developer": "maria",                                  // seu identificador na comparação
  "projectPaths": ["/Users/maria/dev/desafio-ia"],       // caminho(s) ABSOLUTO(s); subpastas também contam
  "sources": { "claude": true, "codex": true, "cursor": true, "devin": true },
  "syncIntervalSeconds": 60,                             // sync automático enquanto o servidor roda
  "port": 4317                                           // porta da API
}
```

Use mais de um caminho em `projectPaths` se você usa **git worktrees** ou clones extras do mesmo desafio.

## Como usar no dia a dia

1. **Sempre abra o agente dentro da pasta do projeto** (`cd ~/dev/desafio-ia && claude`, ou abra essa pasta no Cursor). O filtro é feito pelo diretório de trabalho do agente.
2. Deixe o `npm run dev` rodando. Se preferir, rode `npm run sync` quando quiser. Os logs ficam guardados pelas ferramentas, então dá para sincronizar depois.
3. Abra o dashboard: **Visão geral**, **Comparação**, **Sessões** (clique para ver os prompts da sessão) e **Prompts** (busca por texto).

### Comandos

| Comando | O que faz |
|---|---|
| `npm run setup` | Assistente de configuração |
| `npm run dev` | API (porta 4317) + UI com hot reload (porta 5173) |
| `npm start` | Builda a UI e serve tudo em http://localhost:4317 |
| `npm run sync` | Lê os logs e atualiza o banco (idempotente, pode rodar quantas vezes quiser) |
| `npm run export` | Gera `data/exports/<dev>-<data>.json` com **suas** métricas |
| `npm run import -- a.json b.json` | Importa exports dos colegas para comparar |
| `npm run log -- --source chatgpt --prompt "..." --tokens 1200` | Registro manual (ferramentas sem log local) |

## Comparando entre devs

Cada pessoa roda tudo localmente. No fim (ou em checkpoints combinados):

```bash
npm run export                        # cada dev gera seu arquivo
# compartilhem os .json (Slack, drive, PR em um repo de resultados…)
npm run import -- data/exports/*.json # alguém importa todos
```

A aba **Comparação** mostra uma coluna por dev. Reimportar um export mais novo da mesma pessoa **substitui** o anterior, sem duplicar.

> ⚠️ O export contém **o texto dos seus prompts**. Revise antes de compartilhar se tiver colado segredos, tokens ou dados sensíveis.

## Suporte por ferramenta

| Ferramenta | Sessões | Prompts | Tokens | De onde vem |
|---|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ exato | `~/.claude/projects/` (ou `$CLAUDE_CONFIG_DIR`) |
| **Codex CLI / IDE** | ✅ | ✅ | ✅ exato | `~/.codex/sessions/` (ou `$CODEX_HOME`) |
| **Cursor (IDE)** | ✅ | ✅ | ⚠️ parcial | `state.vscdb` do Cursor. Versões recentes muitas vezes gravam 0 tokens. Para números exatos, veja o dashboard de uso em cursor.com |
| **Devin CLI** | ✅ | ✅ | ⚠️ não gravado | `~/.local/share/devin/cli/sessions.db` (ou `$DEVIN_DATA_DIR`). Hoje o Devin CLI não salva tokens por mensagem. Sessões, prompts, tool calls e tempo são medidos; tokens só se uma versão futura passar a gravar `num_tokens` |
| **Outras (web)** | manual | manual | manual | `npm run log` |

Caminhos fora do padrão podem ser definidos por variáveis de ambiente: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CURSOR_USER_DIR`, `DEVIN_DATA_DIR`, `TOKENMETRO_CONFIG`, `TOKENMETRO_DB`.

## Garantias de isolamento

- Uma sessão só entra se o `cwd` do agente for **exatamente** um dos `projectPaths` ou uma subpasta dele. Symlinks são resolvidos, e `/dev/desafio2` **não** casa com `/dev/desafio`.
- Sessões abertas fora da pasta do projeto são ignoradas inteiras.
- Tudo fica em `data/tokenmetro.db` (SQLite), sem nenhuma chamada de rede. Para recomeçar do zero: `rm data/tokenmetro.db*`.

## Estrutura

```
server/
  collectors/   claude.js · codex.js · cursor.js · devin.js · git.js   ← um parser por ferramenta
  sync.js       orquestra coleta + grava no SQLite (só reprocessa arquivos alterados)
  db.js         schema (sessions, prompts, commits)
  index.js      API HTTP + serve a UI
  cli.js        sync / export / import / log
web/src/        React + Tailwind v4, componentes no estilo shadcn/ui
```

Para adicionar uma ferramenta nova, crie `server/collectors/<nome>.js` que retorne `{ session, prompts }` e registre-o em `sync.js`.

## Problemas comuns

- **"Config não encontrada"**: rode `npm run setup`.
- **Dashboard vazio**: confirme que abriu o agente *dentro* da pasta configurada e clique em **Sync**. Compare `cwd` com `projectPaths` (caminho absoluto).
- **`node:sqlite` não encontrado**: atualize para Node ≥ 22.5.
- **Porta ocupada**: troque `port` na config (e o proxy em `vite.config.js`).
