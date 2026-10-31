// CurseForge: mod / modpack search and install. CurseForge's API needs a personal key (console.curseforge.com),
// which the user enters in the settings; without it only Modrinth is used.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { UA, download, downloadAll } = require('./http');
const store = require('./store');

const API = 'https://api.curseforge.com/v1';
const MINECRAFT = 432;
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

function key() {
  return store.get().settings.curseforgeKey || '';
}

function available() {
  return !!key();
}

async function cf(url) {
  const res = await fetch(API + url, { headers: { 'x-api-key': key(), Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 403) throw new Error('CurseForge API key is invalid');
  if (!res.ok) throw new Error(`CurseForge ${res.status}`);
  return res.json();
}

async function search(query, type, instance, index = 0) {
  const p = new URLSearchParams({ gameId: MINECRAFT, classId: CLASS[type] || 6, searchFilter: query || '', pageSize: 24, index, sortField: query ? 1 : 2, sortOrder: 'desc' });
  if (instance && type !== 'modpack') p.set('gameVersion', instance.mcVersion);
  if (instance && type === 'mod' && LOADER[instance.loader]) p.set('modLoaderType', LOADER[instance.loader]);
  const r = await cf(`/mods/search?${p}`);
  // same shape as Modrinth search hits so the UI can show both
  return {
    hits: r.data.map((m) => ({
      project_id: String(m.id), title: m.name, description: m.summary, icon_url: m.logo?.thumbnailUrl, downloads: m.downloadCount, author: m.authors?.[0]?.name, source: 'curseforge',
    })),
  };
}

async function bestFile(modId, type, instance) {
  const p = new URLSearchParams({ gameVersion: instance.mcVersion, pageSize: 20 });
  if (type === 'mod' && LOADER[instance.loader]) p.set('modLoaderType', LOADER[instance.loader]);
  const r = await cf(`/mods/${modId}/files?${p}`);
  return r.data.find((f) => f.releaseType === 1) || r.data[0];
}

async function install(modId, type, instance, seen = new Set()) {
  if (seen.has(modId)) return [];
  seen.add(modId);
  const file = await bestFile(modId, type, instance);
  if (!file) throw new Error('No file for ' + instance.mcVersion);
  if (!file.downloadUrl) throw new Error(`The author of this project does not allow downloads from other launchers`);
  const dir = path.join(store.dirs.instance(instance.id), FOLDERS[type] || 'mods');
  const sha1 = file.hashes?.find((h) => h.algo === 1)?.value;
  await download(file.downloadUrl, path.join(dir, file.fileName), sha1);
  const installed = [file.fileName];
  for (const dep of file.dependencies || []) {
    if (dep.relationType === 3) {
      try {
        installed.push(...(await install(String(dep.modId), 'mod', instance, seen)));
      } catch {}
    }
  }
  return installed;
}

/** CurseForge modpack zip: manifest.json with project/file ids plus an overrides folder */
async function importModpack(zipFile, onStatus) {
  const zip = new AdmZip(zipFile);
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  const loaderEntry = (manifest.minecraft.modLoaders || []).find((l) => l.primary) || manifest.minecraft.modLoaders?.[0];
  const [loaderName, ...rest] = (loaderEntry?.id || 'vanilla').split('-');
  let id = (manifest.name || 'modpack').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let n = 2;
  while (store.get().instances.some((x) => x.id === id)) id = id.replace(/-\d+$/, '') + '-' + n++;
  const inst = {
    id, name: manifest.name || path.basename(zipFile, '.zip'), mcVersion: manifest.minecraft.version, loader: loaderName, loaderVersion: rest.join('-'),
    counter: false, icon: 'import', created: Date.now(), lastPlayed: 0, playTime: 0, importedFrom: 'CurseForge',
  };
  const target = store.dirs.instance(inst.id);
  const skipped = [];
  if (manifest.files?.length) {
    if (!available()) throw new Error('This modpack needs a CurseForge API key (settings) to download its mods');
    const jobs = [];
    let i = 0;
    for (const f of manifest.files) {
      onStatus?.(`CurseForge ${++i}/${manifest.files.length}`);
      try {
        const info = (await cf(`/mods/${f.projectID}/files/${f.fileID}`)).data;
        if (!info.downloadUrl) {
          skipped.push(info.fileName);
          continue;
        }
        const folder = info.fileName.endsWith('.zip') ? 'resourcepacks' : 'mods';
        jobs.push({ url: info.downloadUrl, file: path.join(target, folder, info.fileName) });
      } catch {
        skipped.push(`${f.projectID}/${f.fileID}`);
      }
    }
    await downloadAll(jobs, (d, t) => onStatus?.(`Mods ${d}/${t}`), 8);
  }
  const over = (manifest.overrides || 'overrides') + '/';
  for (const e of zip.getEntries()) {
    if (!e.entryName.startsWith(over) || e.isDirectory) continue;
    const dest = path.join(target, ...e.entryName.slice(over.length).split('/'));
    if (!dest.startsWith(target)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
  }
  store.get().instances.push(inst);
  store.save();
  return { instance: inst, skipped };
}

/** downloads the newest file of a CurseForge modpack and imports it */
async function installModpack(modId, onStatus) {
  const r = await cf(`/mods/${modId}/files?pageSize=10`);
  const file = r.data.find((f) => f.releaseType === 1) || r.data[0];
  if (!file?.downloadUrl) throw new Error('This modpack can only be downloaded on curseforge.com');
  const tmp = path.join(store.dirs.root, 'downloads', file.fileName);
  await download(file.downloadUrl, tmp);
  return importModpack(tmp, onStatus);
}

module.exports = { available, search, install, importModpack, installModpack };
