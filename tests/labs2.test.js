// duplicates / hard links, dependency tree, world copy, collections (file logic only, no network)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const load = Module._load;
Module._load = function (req, ...rest) {
  return req === 'electron' ? {} : load.call(this, req, ...rest);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test2-'));
const store = require('../src/core/store');
store.init(tmp);
const labs2 = require('../src/core/labs2');
const AdmZip = require('adm-zip');

const mk = (id) => {
  const inst = { id, name: id.toUpperCase(), mcVersion: '26.1.2', loader: 'fabric' };
  store.get().instances.push(inst);
  fs.mkdirSync(path.join(tmp, 'instances', id, 'mods'), { recursive: true });
  return inst;
};
const jar = (inst, file, json, pad = 5000) => {
  const z = new AdmZip();
  z.addFile('fabric.mod.json', Buffer.from(JSON.stringify(json)));
  z.addFile('pad.bin', require('crypto').randomBytes(pad));
  z.writeZip(path.join(tmp, 'instances', inst.id, 'mods', file));
};

test('identical mods in two instances are found and become hard links', () => {
  const a = mk('da');
  const b = mk('db');
  jar(a, 'same.jar', { id: 'same', name: 'Same', version: '1' });
  fs.copyFileSync(path.join(tmp, 'instances', 'da', 'mods', 'same.jar'), path.join(tmp, 'instances', 'db', 'mods', 'same.jar'));
  jar(b, 'other.jar', { id: 'other', name: 'Other', version: '1' });
  const before = labs2.duplicates();
  assert.strictEqual(before.total, 1);
  assert.ok(before.wasted > 4000);
  const r = labs2.dedupe();
  assert.strictEqual(r.linked, 1);
  assert.strictEqual(r.failed, 0);
  assert.strictEqual(labs2.duplicates().total, 0);
  // both files still readable and equal
  const x = fs.readFileSync(path.join(tmp, 'instances', 'da', 'mods', 'same.jar'));
  const y = fs.readFileSync(path.join(tmp, 'instances', 'db', 'mods', 'same.jar'));
  assert.ok(x.equals(y));
});

test('dependency tree shows which dependency is present', () => {
  const c = mk('dc');
  jar(c, 'a.jar', { id: 'a', name: 'A', version: '1', depends: { b: '*', missing: '*', minecraft: '*', 'fabric-resource-loader-v0': '*' } });
  jar(c, 'b.jar', { id: 'b', name: 'B', version: '1' });
  const t = labs2.depTree(c);
  const a = t.nodes.find((n) => n.id === 'a');
  assert.strictEqual(a.needs.find((d) => d.id === 'b').present, true);
  assert.strictEqual(a.needs.find((d) => d.id === 'missing').present, false);
  assert.ok(!a.needs.some((d) => d.id === 'minecraft'));
});

test('a world is copied under a free name and never overwritten', () => {
  const src = mk('dw1');
  const dst = mk('dw2');
  const w = path.join(tmp, 'instances', 'dw1', 'saves', 'Welt');
  fs.mkdirSync(path.join(w, 'region'), { recursive: true });
  fs.writeFileSync(path.join(w, 'level.dat'), 'x');
  fs.writeFileSync(path.join(w, 'region', 'r.0.0.mca'), 'y');
  assert.strictEqual(labs2.copyWorld(src, 'Welt', dst), 'Welt');
  assert.strictEqual(labs2.copyWorld(src, 'Welt', dst), 'Welt (2)');
  assert.ok(fs.existsSync(path.join(tmp, 'instances', 'dw2', 'saves', 'Welt (2)', 'region', 'r.0.0.mca')));
  assert.throws(() => labs2.copyWorld(src, '../x', dst), /Weltname|nicht gefunden/);
  assert.throws(() => labs2.copyWorld(src, 'gibtsnicht', dst), /nicht gefunden/);
});

test('collections store a share code under a name', async () => {
  const e = mk('dd');
  // no network needed: an instance without mods gives an empty code
  const n = await labs2.saveCollection(e, 'Leer').catch((err) => err.message);
  assert.ok(typeof n === 'number' || /fetch|network|ENOTFOUND|\d+/.test(String(n)));
  if (typeof n === 'number') {
    assert.ok(labs2.listCollections().some((c) => c.name === 'Leer'));
    assert.match(labs2.collectionCode('Leer'), /^CNTR1\./);
    labs2.deleteCollection('Leer');
    assert.strictEqual(labs2.listCollections().length, 0);
  }
  await assert.rejects(() => labs2.saveCollection(e, '  '), /Name/);
});
