// Modrinth: search and install mods, resource packs and shaders (with required dependencies).
const fs = require('fs');
const path = require('path');
const { getJson, download } = require('./http');
const store = require('./store');

const API = 'https://api.modrinth.com/v2';

const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

async function search(query, type, instance, offset = 0) {
  const facets = [[`project_type:${type}`], [`versions:${instance.mcVersion}`]];
  if (type === 'mod' && instance.loader !== 'vanilla') facets.push([`categories:${instance.loader}`]);
  if (type === 'modpack') facets.splice(1, 1);
  const url = `${API}/search?limit=24&offset=${offset}&index=${query ? 'relevance' : 'downloads'}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  return getJson(url);
}

async function bestVersion(projectId, type, instance) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([instance.mcVersion]) });
  if (type === 'mod') params.set('loaders', JSON.stringify([instance.loader]));
  const list = await getJson(`${API}/project/${projectId}/version?${params}`);
  return list.find((v) => v.version_type === 'release') || list[0];
}

/** installs a project and its required dependencies into the instance; returns installed file names */
async function install(projectId, type, instance, seen = new Set()) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const version = await bestVersion(projectId, type, instance);
  if (!version) throw new Error('No version for ' + instance.mcVersion);
  const file = version.files.find((f) => f.primary) || version.files[0];
  const dir = path.join(store.dirs.instance(instance.id), FOLDERS[type] || 'mods');
  await download(file.url, path.join(dir, file.filename), file.hashes?.sha1);
  const installed = [file.filename];
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try {
        installed.push(...(await install(dep.project_id, 'mod', instance, seen)));
      } catch {
        // a missing optional chain should not stop the main install
      }
    }
  }
  return installed;
}

const META_CACHE = new Map();

/** name, version and icon from a mod jar (fabric.mod.json, quilt.mod.json or mods.toml) */
function jarMeta(file) {
  const st = fs.statSync(file);
  const key = file + '|' + st.mtimeMs;
  if (META_CACHE.has(key)) return META_CACHE.get(key);
  let meta = {};
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(file);
    const text = (n) => zip.getEntry(n) && zip.readAsText(n);
    const fabric = text('fabric.mod.json');
    const quilt = text('quilt.mod.json');
    const toml = text('META-INF/neoforge.mods.toml') || text('META-INF/mods.toml');
    let icon;
    if (fabric) {
      const j = JSON.parse(fabric.replace(/[\u0000-\u001f]+/g, ' '));
      meta = { name: j.name || j.id, version: j.version, description: j.description, authors: (j.authors || []).map((a) => (typeof a === 'string' ? a : a.name)).join(', ') };
      icon = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop();
    } else if (quilt) {
      const q = JSON.parse(quilt).quilt_loader || {};
      meta = { name: q.metadata?.name || q.id, version: q.version, description: q.metadata?.description };
      icon = q.metadata?.icon;
    } else if (toml) {
      const get = (k) => (new RegExp(k + '\\s*=\\s*"([^"]*)"').exec(toml) || [])[1];
      meta = { name: get('displayName'), version: get('version'), description: get('description') };
      icon = get('logoFile');
    }
    if (icon && zip.getEntry(icon.replace(/^\//, ''))) {
      const data = zip.getEntry(icon.replace(/^\//, '')).getData();
      if (data.length < 300000) meta.icon = 'data:image/png;base64,' + data.toString('base64');
    }
  } catch {
    // not a readable jar: show the file name only
  }
  META_CACHE.set(key, meta);
  return meta;
}

/** files in an instance folder (mods, resourcepacks, shaderpacks) with what we know about them */
function listInstalled(instance, type) {
  const dir = path.join(store.dirs.instance(instance.id), FOLDERS[type] || 'mods');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile()).map((f) => {
    const meta = type === 'mod' && /\.jar(\.disabled)?$/.test(f) ? jarMeta(path.join(dir, f)) : {};
    return { file: f, enabled: !f.endsWith('.disabled'), size: fs.statSync(path.join(dir, f)).size, ...meta };
  });
}

function toggle(instance, type, fileName) {
  const dir = path.join(store.dirs.instance(instance.id), FOLDERS[type] || 'mods');
  const from = path.join(dir, fileName);
  const to = fileName.endsWith('.disabled') ? from.slice(0, -9) : from + '.disabled';
  fs.renameSync(from, to);
}

function remove(instance, type, fileName) {
  const dir = path.join(store.dirs.instance(instance.id), FOLDERS[type] || 'mods');
  fs.rmSync(path.join(dir, fileName), { force: true });
}

/** downloads a Modrinth modpack (.mrpack) for the newest fitting version and imports it as a new instance */
async function installModpack(projectId, onStatus) {
  const list = await getJson(`${API}/project/${projectId}/version`);
  const version = list.find((v) => v.version_type === 'release') || list[0];
  if (!version) throw new Error('This modpack has no versions');
  const file = version.files.find((f) => f.primary) || version.files[0];
  const tmp = path.join(store.dirs.root, 'downloads', file.filename);
  await download(file.url, tmp, file.hashes?.sha1);
  return require('./importers').importMrpack(tmp, onStatus);
}

/** full project page: description (markdown), gallery, links */
async function project(id) {
  return getJson(`${API}/project/${id}`);
}

/** all versions of a project that fit the instance (or every version for modpacks) */
async function versions(id, type, instance) {
  const params = new URLSearchParams();
  if (type !== 'modpack') params.set('game_versions', JSON.stringify([instance.mcVersion]));
  if (type === 'mod' && instance.loader !== 'vanilla') params.set('loaders', JSON.stringify([instance.loader]));
  const list = await getJson(`${API}/project/${id}/version?${params}`);
  return list.map((v) => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published, downloads: v.downloads, loaders: v.loaders, gameVersions: v.game_versions }));
}

/** installs one specific version (chosen on the project page) */
async function installVersion(versionId, type, instance) {
  const v = await getJson(`${API}/version/${versionId}`);
  const file = v.files.find((f) => f.primary) || v.files[0];
  const dir = path.join(store.dirs.instance(instance.id), FOLDERS[type] || 'mods');
  await download(file.url, path.join(dir, file.filename), file.hashes?.sha1);
  const installed = [file.filename];
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try {
        installed.push(...(await install(dep.project_id, 'mod', instance)));
      } catch {}
    }
  }
  return installed;
}

module.exports = { search, install, installModpack, installVersion, project, versions, listInstalled, toggle, remove };
