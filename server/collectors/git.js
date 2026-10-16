// Resultado do trabalho: commits feitos no projeto (linhas adicionadas/removidas).
import { execFileSync } from 'node:child_process'

export function collect(projectPath) {
  let out
  try {
    out = execFileSync('git', ['-C', projectPath, 'log', '--all', '--no-merges', '--numstat', '--date=iso-strict', '--pretty=format:@@%H|%ad|%s'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return [] }
  const commits = []
  let c = null
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, ts, ...msg] = line.slice(2).split('|')
      c = { sha, ts: new Date(ts).toISOString(), message: msg.join('|'), additions: 0, deletions: 0, files_changed: 0 }
      commits.push(c)
    } else if (c && line.trim()) {
      const [a, d] = line.split('\t')
      c.additions += Number(a) || 0
      c.deletions += Number(d) || 0
      c.files_changed++
    }
  }
  return commits
}
