// Discord Rich Presence over the local Discord IPC pipe (no extra dependency). Needs an application ID
// (Einstellungen → Discord). Failures are silent: Discord not running just means no presence.
const net = require('net');
const os = require('os');
const path = require('path');

function pipePath(n) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${n}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || os.tmpdir();
  return path.join(base, `discord-ipc-${n}`);
}
function frame(op, data) {
  const body = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
/** splits a buffer into complete frames, returns {frames, rest} */
function parseFrames(buf) {
  const frames = [];
  while (buf.length >= 8) {
    const len = buf.readInt32LE(4);
    if (buf.length < 8 + len) break;
    let data = null;
    try { data = JSON.parse(buf.subarray(8, 8 + len).toString()); } catch { /* ignore broken frame */ }
    frames.push({ op: buf.readInt32LE(0), data });
    buf = buf.subarray(8 + len);
  }
  return { frames, rest: buf };
}

class Rpc {
  constructor(clientId, opts = {}) {
    this.clientId = String(clientId || '');
    this.paths = opts.paths || Array.from({ length: 10 }, (_, i) => pipePath(i));
    this.sock = null;
    this.ready = false;
    this.pending = null;
    this.buf = Buffer.alloc(0);
  }
  connect() {
    if (this.sock || !/^\d{10,25}$/.test(this.clientId)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const tryNext = (i) => {
        if (i >= this.paths.length) return resolve(false);
        const s = net.connect(this.paths[i]);
        s.once('error', () => tryNext(i + 1));
        s.once('connect', () => {
          s.removeAllListeners('error');
          this.sock = s;
          s.on('error', () => this.close());
          s.on('close', () => { this.sock = null; this.ready = false; });
          s.on('data', (d) => {
            const r = parseFrames(Buffer.concat([this.buf, d]));
            this.buf = r.rest;
            for (const f of r.frames) {
              if (f.op === 3) s.write(frame(4, f.data)); // ping → pong
              else if (f.data?.evt === 'READY') { this.ready = true; if (this.pending) this.setActivity(this.pending); resolve(true); }
            }
          });
          s.write(frame(0, { v: 1, client_id: this.clientId }));
        });
      };
      tryNext(0);
      setTimeout(() => resolve(this.ready), 4000).unref?.();
    });
  }
  setActivity(activity) {
    this.pending = activity;
    if (!this.ready || !this.sock) return false;
    const nonce = Math.random().toString(36).slice(2);
    this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || undefined }, nonce }));
    return true;
  }
  clear() { this.pending = null; return this.setActivity(null); }
  close() { try { this.sock?.destroy(); } catch { /* already gone */ } this.sock = null; this.ready = false; }
}

/** the text shown on the profile while an instance is running */
function activityFor(inst, startedMs) {
  return {
    details: `Spielt ${inst.name}`.slice(0, 120),
    state: `Minecraft ${inst.mcVersion || ''}${inst.loader && inst.loader !== 'vanilla' ? ' · ' + inst.loader : ''}`.trim().slice(0, 120),
    timestamps: { start: Math.floor(startedMs / 1000) },
  };
}

module.exports = { Rpc, frame, parseFrames, activityFor, pipePath };
