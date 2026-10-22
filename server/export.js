import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.js'

const BUILD_DIR = path.join(ROOT, 'data', '.static-build')

export const defaultExportDir = (cfg) => cfg.exportDir ?? path.join(cfg.projectPaths[0], 'docs', 'tokenmetro')

export function exportData(db, cfg) {
  const dev = cfg.developer
  return {
    format: 'tokenmetro/v1',
    exported_at: new Date().toISOString(),
    developer: dev,
    sessions: db.prepare('SELECT * FROM sessions WHERE developer = ?').all(dev),
    prompts: db.prepare('SELECT * FROM prompts WHERE developer = ?').all(dev),
    commits: db.prepare('SELECT * FROM commits WHERE developer = ?').all(dev),
  }
}

// Builda a UI num único bundle (JS + CSS) para embutir no HTML.
async function buildUi() {
  const { build } = await import('vite')
  await build({
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'warn',
    build: {
      outDir: BUILD_DIR,
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      modulePreload: false,
      chunkSizeWarningLimit: Number.MAX_SAFE_INTEGER,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  const assets = path.join(BUILD_DIR, 'assets')
  const files = fs.readdirSync(assets)
  const read = (ext) => files.filter((f) => f.endsWith(ext)).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
  return { js: read('.js'), css: read('.css') }
}

// "</script" dentro de um <script> inline encerraria a tag antes da hora.
const safeScript = (s) => s.replace(/<\/script/gi, '<\\/script')

export async function renderHtml(data, cfg) {
  const { js, css } = await buildUi()
  const payload = JSON.stringify({ ...data, projectPaths: cfg.projectPaths }).replace(/</g, '\\u003c')
  const title = `tokenmetro · ${data.developer} · ${cfg.projectPaths.map((p) => path.basename(p)).join(', ')}`
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title.replace(/</g, '&lt;')}</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.__TOKENMETRO_DATA__ = ${payload}</script>
<script type="module">${safeScript(js)}</script>
</body>
</html>
`
}

// Gera <dev>.json (para `import`) e <dev>.html (visualização standalone, sem server).
export async function exportReport(db, cfg, dir = defaultExportDir(cfg)) {
  const data = exportData(db, cfg)
  fs.mkdirSync(dir, { recursive: true })
  const json = path.join(dir, `${data.developer}.json`)
  const html = path.join(dir, `${data.developer}.html`)
  fs.writeFileSync(json, JSON.stringify(data, null, 2))
  fs.writeFileSync(html, await renderHtml(data, cfg))
  return { json, html, sessions: data.sessions.length, prompts: data.prompts.length }
}
