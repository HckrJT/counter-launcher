const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const os = require('os');
const path = require('path');
const { Rpc, frame, parseFrames, activityFor } = require('../src/core/discord-rpc');

test('frames round trip', () => {
  const r = parseFrames(Buffer.concat([frame(1, { a: 1 }), frame(3, { b: 2 }), Buffer.from([1, 2])]));
  assert.equal(r.frames.length, 2);
  assert.deepEqual(r.frames[1].data, { b: 2 });
  assert.equal(r.rest.length, 2);
});

test('handshake and activity against a mock pipe', async () => {
  const p = process.platform === 'win32' ? `\\\\?\\pipe\\cl-test-${process.pid}` : path.join(os.tmpdir(), `cl-test-${process.pid}`);
  const got = [];
  const srv = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      const r = parseFrames(Buffer.concat([buf, d]));
      buf = r.rest;
      for (const f of r.frames) {
        got.push(f);
        if (f.op === 0) s.write(frame(1, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
      }
    });
  });
  await new Promise((r) => srv.listen(p, r));
  const rpc = new Rpc('123456789012345678', { paths: ['\\\\?\\pipe\\nope-x', p] });
  assert.equal(await rpc.connect(), true);
  rpc.setActivity(activityFor({ name: 'Test', mcVersion: '1.21', loader: 'fabric' }, Date.now()));
  await new Promise((r) => setTimeout(r, 150));
  rpc.close();
  srv.close();
  assert.equal(got[0].data.client_id, '123456789012345678');
  const act = got.find((f) => f.data.cmd === 'SET_ACTIVITY');
  assert.equal(act.data.args.activity.details, 'Spielt Test');
  assert.match(act.data.args.activity.state, /1\.21 · fabric/);
});

test('invalid client id does not connect', async () => {
  assert.equal(await new Rpc('abc').connect(), false);
});
