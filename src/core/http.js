// Small HTTP helpers: JSON requests and verified, parallel downloads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'CounterLauncher/1.0 (github.com/astraxsmp)';

async function getJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${res.status} for ${url}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** downloads url to file unless it already exists with the right sha1 (or size when no hash is known) */
async function download(url, file, sha1, size) {
  if (fs.existsSync(file)) {
    if (sha1) {
      if ((await sha1File(file)) === sha1) return false;
    } else if (!size || fs.statSync(file).size === size) {
      return false;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha1) {
        const got = crypto.createHash('sha1').update(buf).digest('hex');
        if (got !== sha1) throw new Error(`hash mismatch for ${url}`);
      }
      const tmp = file + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** runs download jobs with limited parallelism and reports progress */
async function downloadAll(jobs, onProgress, parallel = 16) {
  let done = 0;
  let index = 0;
  const total = jobs.length;
  async function worker() {
    while (index < jobs.length) {
      const job = jobs[index++];
      await download(job.url, job.file, job.sha1, job.size);
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
}

module.exports = { UA, getJson, postJson, postForm, download, downloadAll, sha1File };
