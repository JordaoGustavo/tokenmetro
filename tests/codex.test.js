import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFile, groupSessions } from '../server/collectors/codex.js'
import { openDb, tx } from '../server/db.js'
import { syncCodex } from '../server/sync.js'
import { readJsonl } from '../server/collectors/util.js'

const project = '/test/project'
const match = cwd => cwd === project || cwd?.startsWith(project + '/') ? project : null
const event = (type, payload, second = 0) => ({ timestamp: `2026-10-22T14:00:${String(second).padStart(2, '0')}.000Z`, type, payload })
const meta = (id = 'main', extra = {}) => event('session_meta', { id, session_id: 'main', cwd: project, timestamp: '2026-10-22T14:00:00.000Z', ...extra })
const start = (turn = 't1') => event('event_msg', { type: 'task_started', turn_id: turn, root_turn_id: 't1' })
const context = (turn = 't1') => event('turn_context', { turn_id: turn, model: 'test-model', cwd: project })
const user = (text = 'Pedido', kinds = ['user.text'], id = 'u1') => event('response_item', { type: 'message', role: 'user', id, content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } }, 1)
const usage = (input = 100, output = 10, cached = 30) => ({ input_tokens: input, cached_input_tokens: Math.min(input, cached), output_tokens: output, reasoning_output_tokens: 2, total_tokens: input + output })
const record = (id = 'r1', u = usage(), thread = 'main', turn = 't1') => event('token_usage_record', { response_id: id, thread_id: thread, turn_id: turn, root_turn_id: 't1', usage: u }, 3)
const token = (u = usage(), total = u.total_tokens) => event('event_msg', { type: 'token_count', info: { last_token_usage: u, total_token_usage: { total_tokens: total } } }, 4)
function fixture(t, events) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmetro-test-'))
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
 const file = path.join(dir, 'rollout.jsonl')
 fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n'))
 return file
}
const sum = prompts => prompts.reduce((n, p) => n + p.input_tokens + p.cache_read_tokens + p.cache_write_tokens + p.output_tokens, 0)

test('modern rollout: metadata filters context, records win over mirrored token events', t => {
 const file = fixture(t, [meta(), start(), context(), user('<environment_context>...', ['environments.environment_context'], 'env'), user(), record(), record(), token(), event('event_msg', { type: 'task_complete', turn_id: 't1' }, 8)])
 const r = parseFile(file, match)
 assert.equal(r.prompts.length, 1)
 assert.equal(r.prompts[0].text, 'Pedido')
 assert.equal(sum(r.prompts), 110)
 assert.equal(r.prompts[0].input_tokens, 70)
 assert.equal(r.prompts[0].model_calls, 1)
 assert.equal(r.prompts[0].reasoning_tokens, 2)
 assert.equal(r.prompts[0].duration_ms, 7000)
 assert.equal(r.prompts[0].model, 'test-model')
})

test('legacy prompt mirror and repeated token events are counted once', t => {
 const r = parseFile(fixture(t, [meta(), context(), user(), event('event_msg', { type: 'user_message', message: 'Pedido' }, 1), token(), token(), token(usage(200, 20), 330)]), match)
 assert.equal(r.prompts.length, 1)
 assert.equal(sum(r.prompts), 330)
 assert.equal(r.prompts[0].model_calls, 2)
})

test('mirrors are paired individually, with and without turn IDs, in either order', t => {
 const legacy = message => event('event_msg', { type: 'user_message', message }, 1)
 for (const withTurn of [false, true]) {
  for (const legacyFirst of [false, true]) {
   const ctx = withTurn ? context() : event('turn_context', { model: 'test-model', cwd: project })
   const pair = (text, id) => legacyFirst
    ? [legacy(text), ctx, user(text, ['user.text'], id)]
    : [user(text, ['user.text'], id), ctx, legacy(text)]
   const r = parseFile(fixture(t, [meta(), ctx,
    ...pair('Pedido', 'u1'), token(),
    user('Pedido', ['user.text'], 'u2'), token(usage(), 220),
    legacy('Terceiro'), token(usage(), 330),
    ...pair('Quarto', 'u4'), token(usage(), 440),
    user('Quinto', ['user.text'], 'u5'), token(usage(), 550),
   ]), match)
   assert.deepEqual(r.prompts.map(p => p.text), ['Pedido', 'Pedido', 'Terceiro', 'Quarto', 'Quinto'])
   assert.deepEqual(r.prompts.map(p => p.model_calls), [1, 1, 1, 1, 1])
   assert.deepEqual(r.prompts.map(p => sum([p])), [110, 110, 110, 110, 110])
  }
 }
})

test('a legacy mirror does not suppress another user message before activity', t => {
 const r = parseFile(fixture(t, [meta(), context(), user(),
  event('event_msg', { type: 'user_message', message: 'Pedido' }, 1),
  user('Complemento', ['user.text'], 'u2'), token(),
 ]), match)
 assert.deepEqual(r.prompts.map(p => p.text), ['Pedido', 'Complemento'])
 assert.deepEqual(r.prompts.map(p => p.model_calls), [0, 1])
})

test('empty legacy mirrors preserve image-only prompts and their usage', t => {
 for (const message of ['', '   ']) {
  const image = event('response_item', { type: 'message', role: 'user', id: 'image-1',
   content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }],
   internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.image'] } }, 1)
  const legacy = event('event_msg', { type: 'user_message', message, images: ['image.png'] }, 1)
  const file = fixture(t, [meta(), start(), context(), image, legacy, record(), token()])
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, [file]))
  const prompts = db.prepare('SELECT * FROM prompts').all()
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].text, '[Entrada sem texto]')
  assert.equal(prompts[0].total_tokens, 110)
  assert.equal(prompts[0].model_calls, 1)
 }
})

test('identical prompts in different turns remain separate; usage can arrive late', t => {
 const r = parseFile(fixture(t, [meta(), start(), context(), user(), start('t2'), context('t2'), user('Pedido', ['user.text'], 'u2'), record('r2', usage(200), 'main', 't2'), record()]), match)
 assert.equal(r.prompts.length, 2)
 assert.equal(sum([r.prompts[0]]), 110)
 assert.equal(sum([r.prompts[1]]), 210)
})

test('tool IDs are deduplicated and cache writes are separate', t => {
 const tool = event('response_item', { type: 'function_call', call_id: 'call-1' }, 2)
 const r = parseFile(fixture(t, [meta(), start(), context(), user(), tool, tool, record('r1', { ...usage(), cache_write_input_tokens: 5 })]), match)
 assert.equal(r.prompts[0].tool_calls, 1)
 assert.equal(r.prompts[0].input_tokens, 65)
 assert.equal(r.prompts[0].cache_write_tokens, 5)
 assert.equal(sum(r.prompts), 110)
})

test('nested subagents are grouped and encrypted task content is not fabricated', t => {
 const main = parseFile(fixture(t, [meta(), start(), context(), user(), record()]), match)
 const childEvents = [meta('child', { parent_thread_id: 'main', agent_path: '/root/child' }), start('tc'), context('tc'), event('response_item', { type: 'agent_message', id: 'a1', recipient: '/root/child', content: [{ type: 'input_text', text: 'Message Type: NEW_TASK' }, { type: 'encrypted_content', encrypted_content: 'opaque' }] }, 1), record('rc', usage(50), 'child', 'tc')]
 const child = parseFile(fixture(t, childEvents), match)
 const grandchild = parseFile(fixture(t, [meta('grandchild', { source: { subagent: { thread_spawn: { parent_thread_id: 'child' } } } }), start('tg'), context('tg'), user(), record('rg', usage(20), 'grandchild', 'tg')]), match)
 const [group] = groupSessions([child, grandchild, main])
 assert.equal(group.session.session_id, 'main')
 assert.equal(sum(group.prompts), 200)
 assert.equal(group.prompts.filter(p => p.kind === 'subagent').length, 2)
 assert.match(child.prompts[0].text, /criptografado/)
 assert.equal(child.prompts[0].parent_thread_id, 'main')
})

test('delegations before turn identification retain their text, usage, and tools', t => {
 for (const withStart of [true, false]) {
  const task = (id, text, second) => event('response_item', { type: 'agent_message', id,
   recipient: '/root/child', content: [{ type: 'input_text', text }] }, second)
  const begin = turn => withStart ? [start(turn), context(turn)] : [context(turn)]
  const tool = id => event('response_item', { type: 'function_call', call_id: id }, 2)
  const r = parseFile(fixture(t, [meta('child', { parent_thread_id: 'main', agent_path: '/root/child' }),
   task('task1', 'Revise os testes', 1), ...begin('tc1'), tool('call1'),
   record('rc1', usage(), 'child', 'tc1'),
   task('task2', 'Revise o coletor', 5), ...begin('tc2'), tool('call2'),
   record('rc2', usage(200), 'child', 'tc2'),
  ]), match)
  assert.deepEqual(r.prompts.map(p => p.text), ['Revise os testes', 'Revise o coletor'])
  assert.deepEqual(r.prompts.map(p => p.turn_id), ['tc1', 'tc2'])
  assert.deepEqual(r.prompts.map(p => sum([p])), [110, 210])
  assert.deepEqual(r.prompts.map(p => p.model_calls), [1, 1])
  assert.deepEqual(r.prompts.map(p => p.tool_calls), [1, 1])
  assert.ok(r.prompts.every(p => p.kind === 'subagent' && p.model === 'test-model'))
 }
})

test('outside project is ignored; unknown prompt format with usage raises diagnostic', t => {
 assert.equal(parseFile(fixture(t, [meta('other', { cwd: '/test/project-other' }), record()]), match), null)
 assert.throws(() => parseFile(fixture(t, [meta(), start(), context(), record()]), match), /sem prompt reconhecido/)
 assert.throws(() => groupSessions([{ thread_id: 'child', parent_thread_id: 'missing' }]), /não encontrada/)
})

test('sync reprocesses existing files, removes old child sessions, and stays idempotent', t => {
 const db = openDb(':memory:'); t.after(() => db.close())
 const main = fixture(t, [meta(), start(), context(), user(), record()])
 const child = fixture(t, [meta('child', { parent_thread_id: 'main' }), start('tc'), context('tc'), user(), record('rc', usage(50), 'child', 'tc')])
 db.prepare('INSERT INTO sessions(id,developer,source,session_id) VALUES(?,?,?,?)').run('dev:codex:child', 'dev', 'codex', 'child')
 const run = () => tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, [main, child]))
 run(); run()
 assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1)
 assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 170)
 assert.equal(db.prepare("SELECT parent_thread_id FROM prompts WHERE kind='subagent'").get().parent_thread_id, 'main')
 fs.appendFileSync(child, '\n' + JSON.stringify(record('rc2', usage(20), 'child', 'tc')))
 run()
 assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 200)
})

test('streaming reader preserves UTF-8 across chunks and accepts unterminated final line', t => {
 const rows = [event('test', { text: 'á😀'.repeat(30000) }), event('test', { text: 'fim' })]
 const file = fixture(t, rows)
 assert.deepEqual([...readJsonl(file)], rows)
})

test('streaming reader handles large lines, invalid lines, and chunk boundaries', t => {
 const large = { text: 'a'.repeat(8 * 1024 * 1024) }
 // The first byte of this multibyte character lands at the end of a chunk.
 const splitUtf8 = { text: 'a'.repeat(64 * 1024 - 10) + '😀á' }
 const rows = [splitUtf8, large, { text: 'fim' }]
 const file = fixture(t, [])
 fs.writeFileSync(file, rows.map(JSON.stringify).join('\n \n{invalid}\n'))
 assert.deepEqual([...readJsonl(file)], rows)
 fs.appendFileSync(file, '\n')
 assert.deepEqual([...readJsonl(file)], rows)
})

test('real test totals: three parent responses and one child response produce 64023 tokens', t => {
 const parentUsage = [usage(15466, 113, 12032), usage(15603, 21, 12032), usage(16386, 29, 15488)]
 const main = parseFile(fixture(t, [meta(), start(), context(), user(), ...parentUsage.flatMap((u, i) => [record('r' + i, u), token(u, parentUsage.slice(0, i + 1).reduce((n, v) => n + v.total_tokens, 0))])]), match)
 const child = parseFile(fixture(t, [meta('child', { parent_thread_id: 'main' }), start('tc'), context('tc'), user(), record('rc', { ...usage(15678, 727, 11904), reasoning_output_tokens: 24 }, 'child', 'tc')]), match)
 const [group] = groupSessions([main, child])
 assert.equal(sum(main.prompts), 47618)
 assert.equal(sum(child.prompts), 16405)
 assert.equal(sum(group.prompts), 64023)
 assert.equal(group.prompts.reduce((n, p) => n + p.model_calls, 0), 4)
})

test('continuation turns attribute usage to the originating prompt', t => {
 const r = parseFile(fixture(t, [meta(), start(), context(), user(), record(), start('continuation'), context('continuation'), record('r2', usage(), 'main', 'continuation')]), match)
 assert.equal(r.prompts.length, 1)
 assert.equal(sum(r.prompts), 220)
})

test('unrecognized usage cannot silently become zero', t => {
 assert.throws(() => parseFile(fixture(t, [meta(), start(), context(), user(), event('token_usage_record', { turn_id: 't1', response_id: 'r1' })]), match), /formato de consumo/)
})

test('user messages before turn context bind to the upcoming turn, including mirrors', t => {
 const legacy = text => event('event_msg', { type: 'user_message', message: text }, 1)
 const r = parseFile(fixture(t, [meta(), user(), legacy('Pedido'), context(), token(),
  user('Segundo', ['user.text'], 'u2'), legacy('Segundo'), context('t2'), token(usage(200), 320)]), match)
 assert.deepEqual(r.prompts.map(p => p.turn_id), ['t1', 't2'])
 assert.deepEqual(r.prompts.map(p => p.text), ['Pedido', 'Segundo'])
 assert.deepEqual(r.prompts.map(p => sum([p])), [110, 210])
})

test('context after a prompt updates its model in legacy logs without turn IDs', t => {
 const ctx = model => event('turn_context', { model, cwd: project })
 const r = parseFile(fixture(t, [meta(), user(), ctx('model-A'), token(),
  user('Segundo', ['user.text'], 'u2'), ctx('model-B'), token(usage(), 220)]), match)
 assert.deepEqual(r.prompts.map(p => p.model), ['model-A', 'model-B'])
 assert.equal(r.session.model, 'model-B')
})

test('user messages before task_started bind to each upcoming turn, including mirrors', t => {
 const legacy = message => event('event_msg', { type: 'user_message', message }, 1)
 const begin = turn_id => event('event_msg', { type: 'task_started', turn_id, root_turn_id: turn_id })
 const r = parseFile(fixture(t, [meta(), user(), legacy('Pedido'), begin('t1'), context(), token(),
  user('Segundo', ['user.text'], 'u2'), legacy('Segundo'), begin('t2'), context('t2'), token(usage(200), 320)]), match)
 assert.deepEqual(r.prompts.map(p => p.turn_id), ['t1', 't2'])
 assert.deepEqual(r.prompts.map(p => p.root_turn_id), ['t1', 't2'])
 assert.deepEqual(r.prompts.map(p => p.text), ['Pedido', 'Segundo'])
 assert.deepEqual(r.prompts.map(p => sum([p])), [110, 210])
 assert.deepEqual(r.prompts.map(p => p.model_calls), [1, 1])
})

test('foreign thread usage records do not suppress local legacy token counts', t => {
 const r = parseFile(fixture(t, [meta(), start(), context(), user(),
  record('foreign-response', usage(50), 'child'), token()]), match)
 assert.equal(r.prompts.length, 1)
 assert.equal(sum(r.prompts), 110)
 assert.equal(r.prompts[0].model_calls, 1)
})

test('late usage preserves the model belonging to its own turn', t => {
 const ctx = (turn_id, model) => event('turn_context', { turn_id, model, cwd: project })
 const r = parseFile(fixture(t, [meta(), user(), ctx('t1', 'model-A'),
  user('Segundo', ['user.text'], 'u2'), ctx('t2', 'model-B'),
  record('r2', usage(), 'main', 't2'), record()]), match)
 assert.deepEqual(r.prompts.map(p => p.model), ['model-A', 'model-B'])
 assert.deepEqual(r.prompts.map(p => sum([p])), [110, 110])
})

test('both usage formats reject missing, nonnumeric, and negative required counts', t => {
 for (const u of [{}, { input_tokens: 1 }, { output_tokens: 1 },
  { input_tokens: '10', output_tokens: 1 }, { input_tokens: 1, output_tokens: -1 },
  { input_tokens: null, output_tokens: 1 }]) {
  for (const entry of [record('r1', u), token(u, 1)]) {
   assert.throws(() => parseFile(fixture(t, [meta(), start(), context(), user(), entry]), match), /formato de consumo/)
  }
 }
 const r = parseFile(fixture(t, [meta(), start(), context(), user(),
  record('r1', { input_tokens: 0, output_tokens: 0 })]), match)
 assert.equal(sum(r.prompts), 0)
 assert.equal(r.prompts[0].model_calls, 1)
})

test('modern mirrors advance the legacy watermark across turns without dropping new usage', t => {
 for (const modernFirst of [true, false]) {
  const first = modernFirst ? [record(), token()] : [token(), record()]
  const r = parseFile(fixture(t, [meta(), context(), user(), ...first,
   context('t2'), user('Segundo', ['user.text'], 'u2'), token(),
   token(usage(200), 320), token(usage(200), 320),
  ]), match)
  assert.deepEqual(r.prompts.map(p => sum([p])), [110, 210])
  assert.deepEqual(r.prompts.map(p => p.model_calls), [1, 1])
 }
})

test('legacy image prompts work alone or mirrored, without counting empty/context messages', t => {
 const image = event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'image.png' }] }, 1)
 for (const field of ['images', 'local_images']) {
  for (const message of ['', '   ', undefined]) {
   const legacy = event('event_msg', { type: 'user_message', message, [field]: ['image.png'] }, 1)
   for (const prompts of [[image], [legacy], [image, legacy], [legacy, image]]) {
    const r = parseFile(fixture(t, [meta(), context(), ...prompts, token()]), match)
    assert.equal(r.prompts.length, 1)
    assert.equal(r.prompts[0].text, '[Entrada sem texto]')
    assert.equal(sum(r.prompts), 110)
   }
  }
 }
 assert.equal(parseFile(fixture(t, [meta(), context(),
  event('event_msg', { type: 'user_message', message: '', images: [] }),
  user('<environment_context>context', ['environments.environment_context']),
 ]), match), null)
})

const pageId = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
function pageFixture(t, n, events) {
 const old = fixture(t, events)
 const file = path.join(path.dirname(old), `rollout-${pageId(n)}.jsonl`)
 fs.renameSync(old, file)
 return file
}
const historyMeta = (parent, limit, extra = {}) => meta('main', {
 history_base: { thread_id: pageId(parent), end_ordinal_exclusive: limit }, ...extra,
})

test('paginated branches use the referenced prefix and merge consumption once in any file order', t => {
 const root = pageFixture(t, 1, [meta(), context(), user(), record(),
  context('later'), user('Outro ramo', ['user.text'], 'later'), record('later', usage(), 'main', 'later')])
 const child = pageFixture(t, 2, [historyMeta(1, 4), record('r2'), token(usage(), 220)])
 // The prefix length is cumulative: four inherited events plus three local events.
 const grandchild = pageFixture(t, 3, [historyMeta(2, 7), record('r3'), token(usage(), 330)])
 for (const files of [[root, child, grandchild], [grandchild, child, root]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  const run = () => tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  run(); run()
  const rows = db.prepare('SELECT text, total_tokens, model_calls FROM prompts ORDER BY text').all().map(r => ({ ...r }))
  assert.deepEqual(rows, [
   { text: 'Outro ramo', total_tokens: 110, model_calls: 1 },
   { text: 'Pedido', total_tokens: 330, model_calls: 3 },
  ])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1)
 }
})

test('goal continuations retain the originating prompt without accepting arbitrary missing prompts', t => {
 const continuation = user('Continue a meta', ['goal.internal_context'], 'internal')
 const file = fixture(t, [meta(), context(), user('Meta', ['user.goal']), record(),
  start('auto'), context('auto'), continuation, record('r2', usage(), 'main', 'auto')])
 const r = parseFile(file, match)
 assert.deepEqual(r.prompts.map(p => p.text), ['Meta'])
 assert.equal(sum(r.prompts), 220)
 assert.throws(() => parseFile(fixture(t, [meta(), context(), continuation, record()]), match), /sem prompt reconhecido/)
})

test('missing, cyclic, truncated and foreign history bases roll back without losing stored data', t => {
 const root = pageFixture(t, 1, [meta(), context(), user(), record()])
 const bad = [
  [historyMeta(99, 4)],
  [historyMeta(2, 4)],
  [historyMeta(1, 99)],
  [historyMeta(1, 4, { id: 'different' })],
  [historyMeta(1, -1)],
 ]
 for (const rows of bad) {
  const db = openDb(':memory:'); t.after(() => db.close())
  const sync = files => tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  sync([root])
  const child = pageFixture(t, 2, [...rows, record('r2')])
  assert.throws(() => sync([root, child]), /histórico/)
  assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 110)
 }
 const outside = pageFixture(t, 4, [historyMeta(99, 4, { cwd: '/other' }), record()])
 const db = openDb(':memory:'); t.after(() => db.close())
 tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, [root, outside]))
 assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 110)
})

test('modern records on another page replace legacy usage regardless of traversal order', t => {
 const root = pageFixture(t, 1, [meta(), context(), user(), token()])
 const child = pageFixture(t, 2, [historyMeta(1, 4), record()])
 for (const files of [[root, child], [child, root]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 110)
  assert.equal(db.prepare('SELECT SUM(model_calls) n FROM prompts').get().n, 1)
 }
})

test('legacy-only paginated history deduplicates inherited events and keeps new equal-sized calls', t => {
 const root = pageFixture(t, 1, [meta(), context(), user(), token()])
 const child = pageFixture(t, 2, [historyMeta(1, 4), token(), token(usage(), 220)])
 for (const files of [[root, child], [child, root]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 220)
  assert.equal(db.prepare('SELECT SUM(model_calls) n FROM prompts').get().n, 2)
 }
})

test('paginated subagents preserve tools, parent grouping, and newly appended usage', t => {
 const main = pageFixture(t, 1, [meta(), context(), user(), record()])
 const tool = id => event('response_item', { type: 'function_call', call_id: id }, 2)
 const child = pageFixture(t, 2, [meta('child', { parent_thread_id: 'main' }), context('tc'), user(), tool('one'), record('rc', usage(), 'child', 'tc')])
 const tail = pageFixture(t, 3, [meta('child', { parent_thread_id: 'main', history_base: { thread_id: pageId(2), end_ordinal_exclusive: 5 } }),
  tool('one'), tool('two'), record('rc2', usage(), 'child', 'tc')])
 const db = openDb(':memory:'); t.after(() => db.close())
 const run = () => tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, [tail, main, child]))
 run(); run()
 assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1)
 assert.equal(db.prepare("SELECT SUM(tool_calls) n FROM prompts WHERE kind='subagent'").get().n, 2)
 assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 330)
 fs.appendFileSync(tail, '\n' + JSON.stringify(record('rc3', usage(), 'child', 'tc')))
 run()
 assert.equal(db.prepare('SELECT SUM(total_tokens) n FROM prompts').get().n, 440)
})

test('replaying a subagent without task text recreates its attribution context', t => {
 const main = pageFixture(t, 1, [meta(), context(), user(), record()])
 const child = pageFixture(t, 2, [meta('child', { parent_thread_id: 'main' }), context('tc'), record('rc', usage(), 'child', 'tc')])
 const tail = pageFixture(t, 3, [meta('child', { parent_thread_id: 'main', history_base: { thread_id: pageId(2), end_ordinal_exclusive: 3 } }), record('rc2', usage(), 'child', 'tc')])
 for (const files of [[main, child, tail], [tail, child, main]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  const rows = db.prepare("SELECT total_tokens FROM prompts WHERE kind='subagent'").all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total_tokens, 220)
 }
})

test('late activity and rate limits preserve the next prompt awaiting its turn', t => {
 const legacy = message => event('event_msg', { type: 'user_message', message }, 1)
 const lateEvents = [record('late'),
  event('event_msg', { type: 'task_complete', turn_id: 't1' }, 5),
  event('event_msg', { type: 'token_count', info: null }),
 ]
 for (const late of lateEvents) {
  for (const withStart of [false, true]) {
   const r = parseFile(fixture(t, [meta(), context(), user(), record(),
    user('Segundo', ['user.text'], 'u2'), late, legacy('Segundo'),
    ...(withStart ? [event('event_msg', { type: 'task_started', turn_id: 't2', root_turn_id: 't2' })] : []),
    context('t2'), record('r2', usage(200), 'main', 't2'),
   ]), match)
   assert.deepEqual(r.prompts.map(p => p.text), ['Pedido', 'Segundo'])
   assert.deepEqual(r.prompts.map(p => p.turn_id), ['t1', 't2'])
   assert.deepEqual(r.prompts.map(p => sum([p])), [late.type === 'token_usage_record' ? 220 : 110, 210])
  }
 }
})

test('paginated modern usage inherits its turn from the referenced prefix', t => {
 const root = pageFixture(t, 1, [meta(), context(), user(), token(),
  context('other'), user('Outro', ['user.text'], 'u2'), token(usage(200), 320)])
 const inherited = record()
 delete inherited.payload.turn_id
 const tail = pageFixture(t, 2, [historyMeta(1, 4), inherited])
 for (const files of [[root, tail], [tail, root]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  assert.deepEqual(db.prepare('SELECT text, total_tokens, model_calls FROM prompts ORDER BY text').all().map(r => ({ ...r })), [
   { text: 'Outro', total_tokens: 210, model_calls: 1 },
   { text: 'Pedido', total_tokens: 110, model_calls: 1 },
  ])
 }
})

test('prompt mirrors split across pages retain one identity in either order', t => {
 for (const legacyFirst of [false, true]) {
  for (const withId of [false, true]) {
   const modern = user()
   if (!withId) delete modern.payload.id
   const legacy = event('event_msg', { type: 'user_message', message: 'Pedido' }, 1)
   const pair = legacyFirst ? [legacy, modern] : [modern, legacy]
   const root = pageFixture(t, 1, [meta(), context(), pair[0]])
   const tail = pageFixture(t, 2, [historyMeta(1, 3), pair[1], record(),
    context('t2'), user('Pedido', ['user.text'], 'u2'), record('r2', usage(200), 'main', 't2')])
   for (const files of [[root, tail], [tail, root]]) {
    const db = openDb(':memory:'); t.after(() => db.close())
    const run = () => tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
    run(); run()
    assert.deepEqual(db.prepare('SELECT turn_id, total_tokens, model_calls FROM prompts ORDER BY turn_id').all().map(r => ({ ...r })), [
     { turn_id: 't1', total_tokens: 110, model_calls: 1 },
     { turn_id: 't2', total_tokens: 210, model_calls: 1 },
    ])
   }
  }
 }
})

test('split prompt mirrors recover turn metadata and preserve start time before context', t => {
 const root = pageFixture(t, 1, [meta(), user()])
 const tail = pageFixture(t, 2, [historyMeta(1, 2), context(),
  event('event_msg', { type: 'user_message', message: 'Pedido' }, 2), record(),
  event('event_msg', { type: 'task_complete', turn_id: 't1' }, 8)])
 for (const files of [[root, tail], [tail, root]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  const rows = db.prepare('SELECT turn_id, ts, model, total_tokens, duration_ms FROM prompts').all().map(r => ({ ...r }))
  assert.deepEqual(rows, [{ turn_id: 't1', ts: user().timestamp, model: 'test-model', total_tokens: 110, duration_ms: 7000 }])
 }
})

test('explicit prompt turns remain authoritative across late activity and new contexts', t => {
 const first = user('Primeiro')
 first.payload.internal_chat_message_metadata_passthrough.turn_id = 't1'
 const second = user('Segundo', ['user.text'], 'u2')
 second.payload.internal_chat_message_metadata_passthrough.turn_id = 't2'
 const r = parseFile(fixture(t, [meta(), context(), first, record(), second,
  record('late'), context('t2'), record('r2', usage(200), 'main', 't2')]), match)
 assert.deepEqual(r.prompts.map(p => p.turn_id), ['t1', 't2'])
 assert.deepEqual(r.prompts.map(p => sum([p])), [220, 210])
})

test('rate-limit updates do not split mirrors or bind pending prompts', t => {
 for (const info of [undefined, null, {}, { last_token_usage: null, total_token_usage: null }]) {
  const r = parseFile(fixture(t, [meta(), user(),
   event('event_msg', { type: 'token_count', info, rate_limits: {} }),
   event('event_msg', { type: 'user_message', message: 'Pedido' }, 1), context(), record()]), match)
  assert.equal(r.prompts.length, 1)
  assert.equal(r.prompts[0].turn_id, 't1')
  assert.equal(sum(r.prompts), 110)
 }
})

test('a page ending before the next turn cannot override its resolved prompt metadata', t => {
 const root = pageFixture(t, 1, [meta(), context(), user(), record(), user('Segundo', ['user.text'], 'u2')])
 const tail = pageFixture(t, 2, [historyMeta(1, 5), record('late'),
  event('event_msg', { type: 'task_started', turn_id: 't2', root_turn_id: 't2' }),
  event('turn_context', { turn_id: 't2', model: 'model-B', cwd: project }),
  event('event_msg', { type: 'user_message', message: 'Segundo' }, 1),
  record('r2', usage(200), 'main', 't2')])
 for (const files of [[root, tail], [tail, root]]) {
  const db = openDb(':memory:'); t.after(() => db.close())
  tx(db, () => syncCodex(db, { developer: 'dev' }, match, { codex: 0 }, files))
  assert.deepEqual(db.prepare('SELECT text, turn_id, model, total_tokens FROM prompts ORDER BY text').all().map(r => ({ ...r })), [
   { text: 'Pedido', turn_id: 't1', model: 'test-model', total_tokens: 220 },
   { text: 'Segundo', turn_id: 't2', model: 'model-B', total_tokens: 210 },
  ])
 }
})
