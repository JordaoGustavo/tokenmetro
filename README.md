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
| **Subagentes** | Tarefas delegadas pelo Claude Code e Codex a subagentes (tokens contados na sessão-pai) |
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
| `npm run export -- [pasta] [--agent claude\|codex\|devin\|copilot\|none]` | Gera `<dev>.json` + `<dev>.html` com **suas** métricas (padrão: `<projeto>/docs/tokenmetro/`) |
| `npm run import -- a.json b.json` | Importa exports dos colegas para comparar |
| `npm run log -- --source chatgpt --prompt "..." --tokens 1200` | Registro manual (ferramentas sem log local) |

## Comparando entre devs

Cada pessoa roda tudo localmente. No fim (ou em checkpoints combinados), clique em **Exportar** no dashboard (ou rode `npm run export`). São gerados dois arquivos em `<projeto>/docs/tokenmetro/` (configurável via `"exportDir"` no `tokenmetro.config.json`):

- **`<dev>.html`**: cópia do dashboard com os dados embutidos. Abre com duplo clique, sem server e sem instalar nada. Tem um botão **JSON** que baixa os dados para importar.
- **`<dev>.json`**: para importar no tokenmetro de quem for comparar.

Commite os dois no repo do projeto e quem quiser comparar roda:

```bash
npm run import -- ../projeto/docs/tokenmetro/*.json
```

### Modo apresentação

O **Exportar** também monta uma linha do tempo do dev, com um slide por dia. Cada slide traz o que foi entregue, um taquímetro de tokens, o número de interações, tool calls e commits, e os prompts de destaque. Ao exportar, você escolhe qual agente escreve o resumo de cada dia: **Claude Code**, **Codex**, **Devin** ou **GitHub Copilot** (só aparecem habilitados os que estão instalados), ou **Sem IA**, que usa só as mensagens de commit. Na linha de comando: `npm run export -- --agent codex`; sem `--agent`, ele pergunta. O modelo pode ser fixado por agente com `"storyModel": { "codex": "gpt-5" }` (padrão do Claude: `haiku`). As chamadas rodam fora do projeto, então não entram nas métricas, e ficam em cache em `data/story-cache.json`.

Abra pelo botão **Apresentar** (no dashboard ou no `<dev>.html`) ou com `#present` na URL. Navegue com ← → ou espaço; Esc fecha.

A aba **Comparação** mostra uma coluna por dev. Reimportar um export mais novo da mesma pessoa **substitui** o anterior, sem duplicar.

> ⚠️ O export contém **o texto dos seus prompts e as respostas do modelo**. Revise antes de compartilhar se tiver colado segredos, tokens ou dados sensíveis.

## Suporte por ferramenta

| Ferramenta | Sessões | Prompts | Tokens | De onde vem |
|---|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ exato | `~/.claude/projects/` (ou `$CLAUDE_CONFIG_DIR`) |
| **Codex CLI / IDE** | ✅ | ✅ | ✅ conforme logs compatíveis | `~/.codex/sessions/` (ou `$CODEX_HOME`) |
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

## Integração com Codex

O coletor lê os rollouts locais de `$CODEX_HOME/sessions` (por padrão,
`~/.codex/sessions`). Não interpreta a saída de `codex exec --json` nem o
protocolo JSON-RPC do App Server como se fossem esses arquivos.

- Prompts: aceita `event_msg.user_message` e mensagens de usuário em
  `response_item`. Usa `content_item_kinds` quando disponível para excluir
  contexto do ambiente e instruções; em logs sem essa marcação, filtra os
  prefixos de contexto conhecidos. Correlaciona as duas representações de cada
  mensagem pelo texto e turno, antes da atividade do agente, e usa o evento
  explícito de usuário para evitar duplicação, inclusive sem IDs de turno.
- Tokens: prioriza `token_usage_record` por turno, deduplicado por `response_id`.
  Em turnos sem esses registros, usa `event_msg.token_count.last_token_usage`,
  deduplicando eventos com o mesmo total acumulado. Eventos contendo apenas
  limites de uso não são chamadas ao modelo.
- Cache: separa leitura e escrita do input; raciocínio é um subconjunto do output
  e não é somado novamente. Totais refletem tokens registrados, não preço monetário.
- Subagentes: segue `parent_thread_id`, inclusive em delegações aninhadas, e
  agrega o consumo na sessão raiz. Os registros preservam `thread_id`,
  `parent_thread_id`, `turn_id` e `root_turn_id`. A quantidade de subagentes usa
  threads distintas. Texto criptografado da tarefa recebe uma indicação de
  indisponibilidade, sem tentar reconstruí-lo.
- A contagem de prompts inclui registros de tarefas de subagentes. A duração
  acumulada soma os intervalos dos registros, podendo sobrepor trabalhos paralelos;
  não representa tempo de CPU nem tempo exclusivo da sessão.
- Cada sincronização relê os rollouts dos projetos configurados, incluindo filhos
  alterados sem mudança no arquivo principal e arquivos ignorados pelo coletor
  anterior. Logs fora desses projetos são descartados após os metadados iniciais.
- Históricos paginados resolvem `history_base` pelo arquivo de origem e pelo limite
  de eventos herdados. Páginas e ramificações da mesma thread são reunidas sem
  recontar consumo ou ferramentas herdados. Bases ausentes, incompletas, cíclicas
  ou de outra sessão interrompem a sincronização, preservando o banco anterior.
- Prompts legados com imagem, mesmo sem texto ou `content_item_kinds`, recebem
  uma indicação de entrada sem texto. Continuações `goal.internal_context` são
  vinculadas ao prompt anterior reconhecido, sem criar um novo prompt de usuário.
- Consumo sem prompt reconhecido, vínculo de pai ausente e formatos de consumo
  incompatíveis geram erro de sincronização. O dashboard informa o erro e mantém
  os dados anteriores; `npm run sync` retorna código de saída diferente de zero.

Validado com logs locais do Codex **0.163.0** e testes de compatibilidade do
formato legado. Os logs internos podem mudar: compatibilidade com versões futuras
precisa ser verificada. Rode `npm test` para os testes de regressão.
