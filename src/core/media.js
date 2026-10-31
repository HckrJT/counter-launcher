// Video backgrounds: own video files and video wallpapers from Wallpaper Engine (read where Steam installed them).
// The window may only load files registered here, through the clmedia:// protocol.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const VIDEO = /\.(mp4|webm|m4v|mov)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp)$/i;
const allowed = new Map();

/** clmedia:// URL for a file, which the protocol handler will then serve */
function urlFor(file) {
  const token = crypto.createHash('sha1').update(file).digest('hex').slice(0, 20);
  allowed.set(token, file);
  return `clmedia://f/${token}${path.extname(file).toLowerCase()}`;
}
function fileFor(url) {
  const m = /^clmedia:\/\/f\/([0-9a-f]{20})/.exec(url);
  return m ? allowed.get(m[1]) : null;
}

function register(protocol, net) {
  protocol.handle('clmedia', (req) => {
    const file = fileFor(req.url);
    if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
  });
}

function isVideo(file) {
  return VIDEO.test(file) && fs.existsSync(file);
}

// ---------------------------------------------------------------- Wallpaper Engine

function steamLibraries() {
  const roots = new Set(['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']);
  for (const r of [...roots]) {
    const vdf = path.join(r, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(vdf)) continue;
    for (const m of fs.readFileSync(vdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) roots.add(m[1].replace(/\\\\/g, '\\'));
  }
  return [...roots].filter((r) => fs.existsSync(r));
}

function wallpapers() {
  const out = [];
  let other = 0;
  const dirs = [];
  for (const lib of steamLibraries()) {
    const ws = path.join(lib, 'steamapps', 'workshop', 'content', '431960');
    if (fs.existsSync(ws)) for (const d of fs.readdirSync(ws)) dirs.push(path.join(ws, d));
    const own = path.join(lib, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects');
    if (fs.existsSync(own)) for (const d of fs.readdirSync(own)) dirs.push(path.join(own, d));
  }
  for (const dir of dirs) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
      const file = p.file && path.join(dir, p.file);
      if (String(p.type).toLowerCase() !== 'video' || !file || !isVideo(file)) {
        other++;
        continue;
      }
      const preview = p.preview && IMAGE.test(p.preview) && fs.existsSync(path.join(dir, p.preview)) ? urlFor(path.join(dir, p.preview)) : null;
      out.push({ title: String(p.title || path.basename(dir)).slice(0, 80), file, preview, size: fs.statSync(file).size });
    } catch {
      // not a wallpaper folder
    }
  }
  return { videos: out, other };
}

// ---------------------------------------------------------------- shader videos recorded in game (GitHub release)

const SHADER_TAG = 'backgrounds-v1';
const TITLES = { campfire: 'Lagerfeuer am See', cherry: 'Kirschblütenhang', village: 'Dorf am Fluss', ocean: 'Meer im Abendlicht' };
let shaderCache = null;
async function shaderBackgrounds(root, getJson, publish) {
  const dir = path.join(root, 'backgrounds');
  if (!shaderCache) {
    const rel = await getJson(`https://api.github.com/repos/${publish.owner}/${publish.repo}/releases/tags/${SHADER_TAG}`);
    const assets = rel.assets || [];
    shaderCache = assets.filter((a) => a.name.endsWith('.mp4')).map((a) => {
      const name = a.name.replace(/\.mp4$/, '');
      const thumb = assets.find((t) => t.name === name + '.jpg');
      return { name, title: TITLES[name] || name, url: a.browser_download_url, size: a.size, thumb: thumb ? thumb.browser_download_url : null };
    });
  }
  return shaderCache.map((b) => {
    const file = path.join(dir, b.name + '.mp4');
    return { ...b, file, downloaded: fs.existsSync(file) && fs.statSync(file).size === b.size };
  });
}

module.exports = { register, urlFor, isVideo, wallpapers, shaderBackgrounds };
