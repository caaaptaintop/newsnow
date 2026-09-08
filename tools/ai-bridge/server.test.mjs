import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { authorize, validateRequest, parseOutput, childConfiguration, bridgeServer } from './server.mjs'
const token = 'unit-test-only-token-12345678901234567890'
const lines = events => events.map(e => JSON.stringify(e)).join('\n')
test('gateway authentication rejects absent or wrong credentials', () => {
  assert.equal(authorize(`Bearer ${token}`, token), true)
  assert.equal(authorize(undefined, token), false)
  assert.equal(authorize('Bearer wrong', token), false)
})
test('only configured text-only non-streaming requests pass', () => {
  const valid = { model: 'model-a', messages: [{ role: 'user', content: '中文测试' }] }
  assert.equal(validateRequest(valid, ['model-a']).model, 'model-a')
  for (const patch of [{ model: 'other' }, { stream: true }, { tools: [] }, { messages: [{ role: 'tool', content: 'x' }] }])
    assert.throws(() => validateRequest({ ...valid, ...patch }, ['model-a']))
})
test('Codex requires a completed turn and ignores reasoning', () => {
  const events = [{ type: 'item.completed', item: { type: 'reasoning', text: 'private' } },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } }]
  assert.throws(() => parseOutput('codex', lines(events)), /incomplete/)
  assert.equal(parseOutput('codex', lines([...events, { type: 'turn.completed' }])), '{"ok":true}')
  assert.throws(() => parseOutput('codex', lines([...events, { type: 'error' }])))
})
test('OpenCode accepts final stop only, rejecting truncated and tool responses', () => {
  const events = [{ type: 'text', part: { text: '{"ok":true}' } }, { type: 'step_finish', part: { reason: 'stop' } }]
  assert.equal(parseOutput('grok', lines(events)), '{"ok":true}')
  assert.throws(() => parseOutput('grok', lines([events[0], { type: 'step_finish', part: { reason: 'length' } }])))
  assert.throws(() => parseOutput('grok', lines([...events, { type: 'tool_use' }])))
})
test('child execution excludes inherited API keys and denies tools', () => {
  process.env.OPENAI_API_KEY = 'must-not-inherit'
  process.env.XAI_API_KEY = 'must-not-inherit'
  const c = childConfiguration('codex', '/tmp/private-home', 'model-a')
  assert.equal(c.env.OPENAI_API_KEY, undefined)
  assert(c.args.includes('forced_login_method="chatgpt"'))
  assert(c.args.includes('features.shell_tool=false'))
  const g = childConfiguration('grok', '/tmp/private-home', 'model-a')
  assert.equal(g.env.XAI_API_KEY, undefined)
  assert.equal(JSON.parse(g.env.OPENCODE_CONFIG_CONTENT).permission['*'], 'deny')
  assert(g.args.includes('--pure'))
  delete process.env.OPENAI_API_KEY; delete process.env.XAI_API_KEY
})
test('HTTP bridge enforces authentication, bounded concurrency, and releases lock', async () => {
  let release, calls = 0
  const server = bridgeServer({ engine: 'codex', home: '/tmp/private-home', models: ['model-a'], token },
    async () => { calls++; return new Promise(resolve => { release = resolve }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  try {
    assert.equal((await fetch(`${base}/v1/models`)).status, 401)
    const catalog = await (await fetch(`${base}/v1/models`, { headers })).json()
    assert.equal(catalog.catalog, 'configured-models-not-verified-entitlements')
    const options = { method: 'POST', headers, body: JSON.stringify({ model: 'model-a', messages: [{ role: 'user', content: 'test' }] }) }
    const first = fetch(`${base}/v1/chat/completions`, options)
    while (!release) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal((await fetch(`${base}/v1/chat/completions`, options)).status, 429)
    release('{"ok":true}')
    assert.equal((await (await first).json()).choices[0].message.content, '{"ok":true}')
    assert.equal(calls, 1)
    assert.equal((await fetch(`${base}/v1/chat/completions`, { ...options, body: '{}' })).status, 400)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
