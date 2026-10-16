import fs from 'node:fs'
import path from 'node:path'

export function* readJsonl(file) {
  const content = fs.readFileSync(file, 'utf8')
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try { yield JSON.parse(line) } catch {}
  }
}

export function walk(dir, filter) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

export const newPrompt = (fields) => ({
  kind: 'user',
  text: '',
  model: null,
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  model_calls: 0,
  tool_calls: 0,
  duration_ms: 0,
  ...fields,
})

export const durationBetween = (a, b) => Math.max(0, new Date(b) - new Date(a)) || 0
