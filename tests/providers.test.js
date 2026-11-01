// AI provider chain against a local mock server that speaks the OpenAI chat format (no real keys needed).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const Module = require('module');

const load = Module._load;
Module._load = function (req, ...rest) {
  return req === 'electron' ? {} : load.call(this, req, ...rest);
};

const seen = []; // every chat request the mock got: {key, model, hasTools}
let lastAssistantToolCall = null;
let server;
let assistant;

function reply(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

test.before(async () => {
  server = http.createServer((req, res) => {
    const key = (req.headers.authorization || '').replace('Bearer ', '');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (key.startsWith('bad')) return reply(res, 401, { error: { message: 'invalid api key' } });
      if (req.url.endsWith('/models')) return reply(res, 200, { data: [{ id: 'embed-model' }, { id: 'small-model' }, { id: 'big-model' }] });
      const j = JSON.parse(body || '{}');
      seen.push({ key, model: j.model, hasTools: !!(j.tools && j.tools.length) });
      if (key.startsWith('limited')) return reply(res, 429, { error: { message: 'rate limit' } });
      const last = j.messages[j.messages.length - 1];
      const prevAssistant = j.messages.find((m) => m.role === 'assistant' && m.tool_calls);
      if (prevAssistant) lastAssistantToolCall = prevAssistant.tool_calls[0];
      // first call: ask for a tool, second call (after the tool result): answer
      if (last.role === 'tool') return reply(res, 200, { choices: [{ message: { role: 'assistant', content: 'Du hast eine Instanz: ' + last.content.slice(0, 30) } }] });
      return reply(res, 200, { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_instances', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig-123' } } }] } }] });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.CL_AI_TEST_URL = `http://127.0.0.1:${server.address().port}`;
  require('../src/core/store').init(path.join(os.tmpdir(), 'cl-prov-test'));
  assistant = require('../src/core/assistant');
});
test.after(() => server.close());

const env = () => ({
  instance: { id: 'a', name: 'A', mcVersion: '26.1.2', loader: 'fabric' }, listMods: () => [], listInstances: () => [{ id: 'a', name: 'Alpha', mcVersion: '26.1.2', loader: 'fabric' }],
  worlds: () => [], readFile: () => '', listContent: () => '', ping: async () => '', memory: { add() {}, remove: () => true, list: () => [] }, apply: async () => {}, listCustom: () => [],
  labs: { healthCheck: () => ({ issues: [] }), securityCheck: async () => ({}), javaAdvice: () => ({}), diskUsage: () => ({}), overview: async () => [] },
});
const ask = (chain, extra = {}) => assistant.ask({ chain, history: [{ role: 'user', content: 'Welche Instanzen habe ich?' }], ctx: { instances: 'Alpha', selected: 'Alpha' }, env: env(), auto: false, prefs: { think: 'fast' }, ...extra });

test('the strongest listed model is chosen and tools reach the provider', async () => {
  seen.length = 0;
  const r = await ask([{ id: 'mock', key: 'good-key-12345678' }]);
  assert.strictEqual(r.provider, 'mock');
  assert.match(r.text, /Alpha/);
  assert.ok(seen.length >= 2 && seen.every((x) => x.model === 'big-model' && x.key === 'good-key-12345678'));
  assert.ok(seen[0].hasTools);
});

test('thought signatures of tool calls are sent back unchanged (Gemini 3)', async () => {
  lastAssistantToolCall = null;
  await ask([{ id: 'mock', key: 'good-key-12345678' }]);
  assert.deepStrictEqual(lastAssistantToolCall.extra_content, { google: { thought_signature: 'sig-123' } });
});

test('a wrong key moves on to the next provider', async () => {
  seen.length = 0;
  const r = await ask([{ id: 'mock', key: 'bad-key-123456789' }, { id: 'mock', key: 'good-key-12345678' }]);
  assert.match(r.text, /Alpha/);
  assert.ok(seen.every((x) => x.key === 'good-key-12345678'));
});

test('a used-up provider (429) moves on to the next provider', async () => {
  seen.length = 0;
  const t0 = Date.now();
  const r = await ask([{ id: 'mock', key: 'limited-key-12345' }, { id: 'mock', key: 'good-key-12345678' }]);
  assert.match(r.text, /Alpha/);
  assert.ok(seen.some((x) => x.key.startsWith('limited')) && seen.some((x) => x.key.startsWith('good')));
  // no waiting for a limit that another provider can take over
  assert.ok(Date.now() - t0 < 10000, 'switched without waiting');
});

test('provider list for the settings page hides internals', () => {
  const list = assistant.providerList();
  assert.ok(list.some((p) => p.id === 'gemini' && p.keyUrl.startsWith('https://aistudio.google.com')));
  assert.ok(list.every((p) => !('chat' in p) && p.id !== 'mock'));
});

test('Ollama (local) talks to the address given as key, without a real key', async () => {
  seen.length = 0;
  const r = await ask([{ id: 'ollama', key: process.env.CL_AI_TEST_URL }]);
  assert.strictEqual(r.provider, 'ollama');
  assert.match(r.text, /Instanz/);
  assert.ok(seen.every((s) => s.key === 'ollama'));
  assert.ok(seen[0].model);
});
