import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export function* readJsonl(file) {
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(64 * 1024)
  const decoder = new StringDecoder('utf8')
  let fragments = []
  try {
    let bytes
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const chunk = decoder.write(buffer.subarray(0, bytes))
      let start = 0
      let end
      while ((end = chunk.indexOf('\n', start)) !== -1) {
        fragments.push(chunk.slice(start, end))
        const line = fragments.join('')
        fragments = []
        start = end + 1
        if (!line.trim()) continue
        try { yield JSON.parse(line) } catch {}
      }
      if (start < chunk.length) fragments.push(chunk.slice(start))
    }
    fragments.push(decoder.end())
    const pending = fragments.join('')
    if (pending.trim()) {
      try { yield JSON.parse(pending) } catch {}
    }
  } finally {
    fs.closeSync(fd)
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
