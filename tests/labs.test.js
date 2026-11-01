// Run with: npm test   (node:test, no extra packages). Covers the logic that must never silently break:
// version ranges, share / theme / module codes, the health check on synthetic jars, the play-time limit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// the core files only need electron for a few helpers: not needed here
const load = Module._load;
Module._load = function (req, ...rest) {
  return req === 'electron' ? {} : load.call(this, req, ...rest);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
const store = require('../src/core/store');
store.init(tmp);
const labs = require('../src/core/labs');
const studio = require('../src/core/studio');
const AdmZip = require('adm-zip');

test('Minecraft version ranges', () => {
  const cases = [
    ['>=26.1 <26.2', '26.1.2', true], ['>=26.1 <26.2', '26.2', false], ['26.1.x', '26.1.2', true], ['26.1.x', '26.2.0', false],
    ['~26.1-', '26.1.2', true], ['~26.1-', '26.2', false], ['~1.21.1', '1.21.4', true], ['^1.20', '1.21.4', true],
    ['<1.21', '1.21.4', false], ['1.21', '1.21.1', true], ['1.20.1 || 26.1.2', '26.1.2', true], ['*', '26.1.2', true],
  ];
  for (const [range, mc, want] of cases) assert.strictEqual(labs.mcAllowed(range, mc), want, `${range} vs ${mc}`);
});

test('share codes: valid, broken and hostile', () => {
  const ok = 'CNTR1.' + Buffer.from(JSON.stringify({ v: 1, n: 'X', mc: '26.1.2', l: 'fabric', p: ['AANobbMI', 'sodium'] })).toString('base64url');
  const r = labs.parseShareCode(ok);
  assert.deepStrictEqual(r.projects, ['AANobbMI', 'sodium']);
  assert.throws(() => labs.parseShareCode('nonsense'));
  assert.throws(() => labs.parseShareCode('CNTR1.' + Buffer.from('{"mc":"1"}').toString('base64url')));
  // project ids that could escape into paths or URLs are dropped
  const evil = 'CNTR1.' + Buffer.from(JSON.stringify({ mc: '26.1.2', p: ['../../x', 'ok-mod', 'a b', 'AANobbMI'] })).toString('base64url');
  assert.deepStrictEqual(labs.parseShareCode(evil).projects, ['ok-mod', 'AANobbMI']);
});

test('design codes only let safe values through', () => {
  const settings = { theme: {}, accent: '#9d5cff' };
  const code = 'CNTRT1.' + Buffer.from(JSON.stringify({ a: '#112233', t: { accent2: '#abcdef', solid: 'url(http://x)', blur: 30, huge: 99999, evil: { x: 1 }, motion: false } })).toString('base64url');
  labs.applyThemeCode(settings, code);
  assert.strictEqual(settings.accent, '#112233');
  assert.deepStrictEqual(settings.theme, { accent2: '#abcdef', blur: 30, motion: false });
  assert.throws(() => labs.applyThemeCode(settings, 'CNTRT1.%%%'));
});

test('own modules: unknown triggers, keys and module ids are reported', () => {
  assert.throws(() => studio.cleanModule({ name: 'x', triggers: [{ when: 'on_kill', do: [] }] }), /Trigger/);
  assert.throws(() => studio.cleanModule({ name: 'x', keys: [{ key: 'ctrl+g', do: [] }] }), /Taste/);
  assert.throws(() => studio.cleanModule({ name: 'x', keys: [{ key: 'g', do: [{ action: 'toggle_module', id: 'gibtsnicht' }] }] }), /gibt es nicht/);
  assert.throws(() => studio.cleanModule({ name: 'x', keys: [{ key: 'g', do: [{ action: 'command', text: '/op me' }] }] }), /nicht erlaubt/);
  const m = studio.cleanModule({ name: 'FPS', hud: { text: 'FPS {fps}' }, triggers: [{ when: 'health_below', value: 8, do: [{ action: 'title', text: 'HEAL' }] }] });
  assert.strictEqual(m.triggers[0].value, 8);
});

function jar(dir, file, json) {
  const z = new AdmZip();
  z.addFile('fabric.mod.json', Buffer.from(JSON.stringify(json)));
  z.writeZip(path.join(dir, file));
}

test('health check finds missing, duplicate and wrong-version mods', () => {
  const inst = { id: 'ht', name: 'HT', mcVersion: '26.1.2', loader: 'fabric' };
  const dir = path.join(tmp, 'instances', 'ht', 'mods');
  fs.mkdirSync(dir, { recursive: true });
  jar(dir, 'good.jar', { id: 'good', name: 'Good', version: '1', depends: { minecraft: '~26.1-' } });
  jar(dir, 'good2.jar', { id: 'good', name: 'Good', version: '1' });
  jar(dir, 'needs.jar', { id: 'needs', name: 'Needs', version: '1', depends: { 'fabric-api': '*' } });
  jar(dir, 'old.jar', { id: 'old', name: 'Old', version: '1', depends: { minecraft: '>=1.20 <1.21' } });
  fs.writeFileSync(path.join(dir, 'broken.jar'), 'no zip');
  const titles = labs.healthCheck(inst).issues.map((i) => i.title).join(' | ');
  assert.match(titles, /beschädigt/);
  assert.match(titles, /Doppelt/);
  assert.match(titles, /Fabric API fehlt/);
  assert.match(titles, /passt nicht zu 26.1.2/);
  // the Fabric API satisfies its own parts
  jar(dir, 'fabric-api.jar', { id: 'fabric-api', name: 'Fabric API', version: '1', depends: { minecraft: '~26.1-' } });
  jar(dir, 'part.jar', { id: 'part', name: 'Part', version: '1', depends: { 'fabric-block-getter-api-v2': '*', 'fabric-api': '*' } });
  assert.doesNotMatch(labs.healthCheck(inst).issues.map((i) => i.title).join('|'), /Part/);
});

test('play-time limit: pin, bonus and blocking', () => {
  const settings = {};
  const now = Date.now();
  const instances = [{ sessions: [{ start: now - 90 * 60000, end: now - 30 * 60000 }] }]; // 60 minutes today (or since midnight)
  labs.parentSet(settings, 30, '4321');
  assert.ok(labs.parentStatus(settings, instances).blocked || labs.parentStatus(settings, instances).played < 60);
  assert.throws(() => labs.parentSet(settings, 0, '0000'), /PIN/);
  assert.throws(() => labs.parentExtend(settings, '0000', 30), /PIN/);
  labs.parentExtend(settings, '4321', 120);
  assert.strictEqual(labs.parentStatus(settings, [{ sessions: [] }]).bonus, 120);
  labs.parentSet(settings, 0, '4321');
  assert.strictEqual(labs.parentStatus(settings, instances).enabled, false);
});

test('mod profiles switch files and keep a backup', () => {
  const inst = { id: 'pf', name: 'PF', mcVersion: '26.1.2', loader: 'fabric' };
  store.get().instances.push(inst);
  const dir = path.join(tmp, 'instances', 'pf', 'mods');
  fs.mkdirSync(dir, { recursive: true });
  jar(dir, 'a.jar', { id: 'a', name: 'A', version: '1' });
  jar(dir, 'b.jar', { id: 'b', name: 'B', version: '1' });
  labs.saveProfile(inst, 'beide');
  labs.massToggle(inst, false);
  assert.ok(fs.existsSync(path.join(dir, 'a.jar.disabled')));
  labs.applyProfile(inst, 'beide');
  assert.ok(fs.existsSync(path.join(dir, 'a.jar')) && fs.existsSync(path.join(dir, 'b.jar')));
  assert.ok(labs.listModBackups(inst).length >= 1);
});

test('requests are shrunk to fit the free token budget', () => {
  const { fitBody } = require('../src/core/assistant');
  const big = 'x'.repeat(9000);
  const body = {
    model: 'm', max_tokens: 4096,
    tools: [{ type: 'function', function: { name: 't', description: 'd'.repeat(3000), parameters: { type: 'object' } } }],
    messages: [{ role: 'system', content: 'sys'.repeat(500) }, { role: 'user', content: big }, { role: 'assistant', content: big }, { role: 'user', content: 'frage' },
      { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 't', arguments: '{}' } }] }, { role: 'tool', tool_call_id: '1', content: big }],
  };
  const fitted = fitBody(body, 7000);
  const est = Math.ceil((JSON.stringify(fitted.messages).length + JSON.stringify(fitted.tools).length) / 3) + fitted.max_tokens;
  assert.ok(est <= 7000, `estimate ${est}`);
  assert.ok(fitted.max_tokens >= 600);
  assert.strictEqual(fitted.messages[fitted.messages.length - 1].role, 'tool');
  // small requests stay untouched
  const small = { model: 'm', max_tokens: 800, messages: [{ role: 'user', content: 'hi' }] };
  assert.deepStrictEqual(fitBody(small, 7000).messages, small.messages);
});
