// Home page extras: Minecraft server list ping (status, players, MOTD), a random screenshot as background and the
// skin library (local skins to preview, and uploading one to a Microsoft account).
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const crypto = require('crypto');
const { nativeImage } = require('electron');
const store = require('./store');
const extras = require('./extras');

// ---------------------------------------------------------------- server list ping

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}
function readVarint(buf, pos) {
  let n = 0, shift = 0, b;
  do {
    if (pos >= buf.length) return null;
    b = buf[pos++];
    n |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80 && shift < 35);
  return [n, pos];
}
const packet = (...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varint(body.length), body]);
};
const mcString = (s) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)]);

/** chat component / legacy § text → plain text */
function motdText(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d.replace(/§./g, '');
  return (d.text || '') + (d.extra || []).map(motdText).join('') + (d.translate && !d.text ? d.translate : '');
}

async function resolve(address) {
  let [host, port] = address.trim().split(':');
  port = Number(port) || 0;
  if (!port && !net.isIP(host)) {
    try {
      const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv[0]) return { host: srv[0].name, port: srv[0].port, original: host };
    } catch {}
  }
  return { host, port: port || 25565, original: host };
}

async function ping(address) {
  const { host, port, original } = await resolve(address);
  return new Promise((done) => {
    const sock = net.connect({ host, port });
    let data = Buffer.alloc(0);
    let start = 0;
    let status = null;
    const finish = (r) => {
      sock.destroy();
      done(r);
    };
    sock.setTimeout(4500, () => finish({ online: false, error: 'Zeitüberschreitung' }));
    sock.on('error', (e) => finish({ online: false, error: e.code === 'ENOTFOUND' ? 'Adresse unbekannt' : 'Offline' }));
    sock.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      sock.write(packet(varint(0), varint(767), mcString(original), portBuf, varint(1)));
      sock.write(packet(varint(0)));
    });
    sock.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (!status) {
        const len = readVarint(data, 0);
        if (!len || data.length < len[1] + len[0]) return;
        const id = readVarint(data, len[1]);
        const strLen = readVarint(data, id[1]);
        try {
          status = JSON.parse(data.slice(strLen[1], strLen[1] + strLen[0]).toString('utf8'));
        } catch {
          return finish({ online: false, error: 'Ungültige Antwort' });
        }
        // ping packet for the latency
        start = Date.now();
        const payload = Buffer.alloc(8);
        payload.writeBigInt64BE(BigInt(start));
        sock.write(packet(varint(1), payload));
        data = Buffer.alloc(0);
        setTimeout(() => status && finish(result(status, null)), 1500);
        return;
      }
      finish(result(status, Date.now() - start));
    });
  });
}
function result(s, latency) {
  return {
    online: true,
    players: s.players ? s.players.online : 0,
    max: s.players ? s.players.max : 0,
    sample: ((s.players && s.players.sample) || []).map((p) => String(p.name).replace(/§./g, '')).slice(0, 12),
    motd: motdText(s.description).trim(),
    version: s.version ? String(s.version.name || '').replace(/§./g, '') : '',
    favicon: typeof s.favicon === 'string' && s.favicon.startsWith('data:image/png;base64,') ? s.favicon : null,
    ping: latency,
  };
}

/** servers from every instance's servers.dat, deduplicated (suggestions for the favourites) */
function knownServers() {
  const seen = new Map();
  for (const inst of store.get().instances) {
    for (const s of extras.servers(inst)) if (s.ip && !seen.has(s.ip.toLowerCase())) seen.set(s.ip.toLowerCase(), { name: s.name, ip: s.ip, icon: s.icon ? 'data:image/png;base64,' + s.icon : null, instance: inst.id });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- random screenshot as background

function randomScreenshot() {
  const all = [];
  for (const inst of store.get().instances) {
    const dir = path.join(store.dirs.instance(inst.id), 'screenshots');
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) if (/\.png$/i.test(n)) all.push(path.join(dir, n));
  }
  if (!all.length) return null;
  const img = nativeImage.createFromPath(all[Math.floor(Math.random() * all.length)]);
  if (img.isEmpty()) return null;
  const small = img.getSize().width > 1920 ? img.resize({ width: 1920, quality: 'good' }) : img;
  return 'data:image/jpeg;base64,' + small.toJPEG(82).toString('base64');
}

// ---------------------------------------------------------------- skin library

const skinDir = () => path.join(store.dirs.root, 'skins');
const indexFile = () => path.join(skinDir(), 'skins.json');
function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
  } catch {
    return [];
  }
}
function writeIndex(list) {
  fs.mkdirSync(skinDir(), { recursive: true });
  fs.writeFileSync(indexFile(), JSON.stringify(list, null, 2));
}
function listSkins() {
  return readIndex().filter((s) => fs.existsSync(path.join(skinDir(), s.file)))
    .map((s) => ({ ...s, data: 'data:image/png;base64,' + fs.readFileSync(path.join(skinDir(), s.file)).toString('base64') }));
}
function addSkin(file, name) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  if (img.isEmpty() || width !== 64 || (height !== 64 && height !== 32)) throw new Error('Ein Skin muss ein 64×64 (oder 64×32) PNG sein');
  const id = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(skinDir(), { recursive: true });
  fs.copyFileSync(file, path.join(skinDir(), id + '.png'));
  // slim guess: the pixel right of the arm front is transparent on slim skins
  const bmp = img.toBitmap();
  const alpha = (x, y) => bmp[(y * width + x) * 4 + 3];
  const slim = height === 64 && alpha(54, 20) === 0 && alpha(55, 31) === 0;
  const list = readIndex();
  list.unshift({ id, file: id + '.png', name: name || path.basename(file, '.png'), slim, added: Date.now() });
  writeIndex(list);
  return id;
}
function updateSkin(id, patch) {
  writeIndex(readIndex().map((s) => (s.id === id ? { ...s, ...patch, id: s.id, file: s.file } : s)));
}
async function removeSkin(id, trash) {
  const s = readIndex().find((x) => x.id === id);
  if (!s) return;
  await trash(path.join(skinDir(), s.file)).catch(() => {});
  writeIndex(readIndex().filter((x) => x.id !== id));
}
function skinPath(id) {
  const s = readIndex().find((x) => x.id === id);
  return s ? { ...s, path: path.join(skinDir(), s.file) } : null;
}

/** uploads a library skin to the Microsoft account (Minecraft services API) */
async function uploadSkin(account, id) {
  const s = skinPath(id);
  if (!s) throw new Error('Skin nicht gefunden');
  const form = new FormData();
  form.append('variant', s.slim ? 'slim' : 'classic');
  form.append('file', new Blob([fs.readFileSync(s.path)], { type: 'image/png' }), 'skin.png');
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { Authorization: `Bearer ${account.accessToken}` }, body: form });
  if (!res.ok) throw new Error(`Mojang hat den Skin abgelehnt (${res.status})`);
}

module.exports = { ping, knownServers, randomScreenshot, listSkins, addSkin, updateSkin, removeSkin, skinPath, uploadSkin };
