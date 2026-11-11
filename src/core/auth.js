// Microsoft login (OAuth authorization code + PKCE) and offline accounts.
// The Azure application id is entered by the user in the settings; no client secret belongs in this app.
const crypto = require('crypto');
const http = require('http');
const { postJson, postForm, getJson } = require('./http');

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function secureStorage() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch {
    return null;
  }
}

function protectAccount(account) {
  if ((!account?.refreshToken && !account?.accessToken) || (account.refreshTokenEncrypted && account.accessTokenEncrypted)) return account;
  const storage = secureStorage();
  if (!storage) throw new Error('SECURE_STORAGE_UNAVAILABLE');
  const { refreshToken, accessToken, ...rest } = account;
  return {
    ...rest,
    ...(refreshToken ? { refreshTokenEncrypted: storage.encryptString(refreshToken).toString('base64') } : {}),
    ...(accessToken ? { accessTokenEncrypted: storage.encryptString(accessToken).toString('base64') } : {}),
  };
}

function unprotectAccount(account) {
  if (account?.refreshToken && account?.accessToken) return account;
  const storage = secureStorage();
  if (!storage) {
    if (account?.refreshTokenEncrypted || account?.accessTokenEncrypted) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    return account;
  }
  return {
    ...account,
    ...(account.refreshToken ? {} : account.refreshTokenEncrypted ? { refreshToken: storage.decryptString(Buffer.from(account.refreshTokenEncrypted, 'base64')) } : {}),
    ...(account.accessToken ? {} : account.accessTokenEncrypted ? { accessToken: storage.decryptString(Buffer.from(account.accessTokenEncrypted, 'base64')) } : {}),
  };
}

function offline(name) {
  // same uuid scheme as vanilla offline mode: md5("OfflinePlayer:" + name), version 3
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { type: 'offline', name, uuid, accessToken: '0' };
}

const STEP_TIMEOUT_MS = 20000;
const withTimeout = () => ({ signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function resultPage(title, text) {
  return '<!doctype html><meta charset="utf-8"><title>Counter Launcher</title>'
    + '<body style="font-family:system-ui,sans-serif;background:#111318;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0">'
    + `<div style="max-width:520px;padding:24px"><h1 style="font-size:22px">${escapeHtml(title)}</h1><p style="line-height:1.5;color:#b9bcc4">${escapeHtml(text)}</p></div></body>`;
}

/**
 * Runs one network step of the login. Timeouts, dropped connections, 429 and 5xx are retried twice;
 * anything else (wrong account, missing profile ...) is thrown right away so the caller can explain it.
 */
async function step(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const transient = !e.status || e.status === 429 || e.status >= 500;
      if (!transient || attempt >= 2) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error(`${label}: keine Antwort vom Server (Zeitüberschreitung). Prüfe Internet, VPN oder Firewall und versuche es erneut.`);
        if (!e.status) throw new Error(`${label}: keine Verbindung (${e.cause?.code || e.message}). Prüfe Internet, VPN oder Firewall und versuche es erneut.`);
        if (e.status === 429) throw new Error(`${label}: zu viele Anmeldungen in kurzer Zeit. Warte eine Minute und versuche es erneut.`);
        throw e;
      }
      await sleep(e.status === 429 ? 4000 : 1000 * (attempt + 1));
    }
  }
}

/** postForm only reports the status; turn retryable failures into errors so step() can retry them */
async function postFormChecked(url, form) {
  const r = await postForm(url, form, withTimeout());
  if (r.status === 429 || r.status >= 500) {
    const err = new Error(`${r.status} for ${url}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

/**
 * Opens the normal system browser and waits for Microsoft's redirect to the local callback.
 * The browser tab is only answered once the whole chain (Microsoft → Xbox → Minecraft) is done,
 * so it shows the real result instead of "success" while the launcher is still working or already failed.
 */
async function browserLogin(clientId, openBrowser, isCancelled, onBrowser, onStep) {
  const pkce = createPkce();
  const state = base64Url(crypto.randomBytes(24));
  const authorize = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: 'XboxLive.signin offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  }).toString();

  const servers = [];
  let cancelTimer;
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    clearInterval(cancelTimer);
    for (const s of servers) s.close();
    fn(value);
  };
  const callback = new Promise((resolve, reject) => {
    const onRequest = (req, res) => {
      // no keep-alive: a browser would otherwise send the next login attempt's redirect over the old,
      // already closed server of an earlier attempt, and the new attempt would wait forever
      res.setHeader('Connection', 'close');
      const url = new URL(req.url, REDIRECT_URI);
      const html = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (settled || url.searchParams.get('state') !== state) {
        // an old tab from an earlier attempt (or a reload): don't let it break the login that is running now
        res.writeHead(400, html);
        res.end(resultPage('Veralteter Anmelde-Tab', 'Dieser Tab gehört zu einem älteren Anmeldeversuch. Nutze den zuletzt geöffneten Tab oder starte die Anmeldung im Counter Launcher neu.'));
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, html);
        res.end(resultPage('Microsoft-Anmeldung abgebrochen', 'Du kannst dieses Fenster schließen.'));
        finish(reject, new Error(error === 'access_denied' ? 'cancelled' : url.searchParams.get('error_description') || error));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, html);
        res.end(resultPage('Kein Anmeldecode', 'Microsoft hat keinen Code geschickt. Starte die Anmeldung im Counter Launcher neu.'));
        return;
      }
      finish(resolve, { code, res, html });
    };
    const main = http.createServer(onRequest);
    servers.push(main);
    main.once('error', (e) => finish(reject, new Error(e.code === 'EADDRINUSE'
      ? `Port ${REDIRECT_PORT} ist belegt (läuft der Launcher doppelt?). Schließe andere Launcher-Fenster und versuche es erneut.`
      : `Microsoft callback could not start: ${e.message}`)));
    main.listen(REDIRECT_PORT, '127.0.0.1', () => {
      onBrowser?.(authorize.toString(), REDIRECT_URI);
      Promise.resolve().then(() => openBrowser(authorize.toString())).catch((e) => finish(reject, e));
    });
    // some browsers resolve "localhost" to ::1 first; answer there too when the IPv6 loopback exists
    const v6 = http.createServer(onRequest);
    v6.on('error', () => {});
    v6.listen(REDIRECT_PORT, '::1');
    servers.push(v6);
    cancelTimer = setInterval(() => {
      if (isCancelled?.()) finish(reject, new Error('cancelled'));
    }, 250);
  });

  const { code, res, html } = await callback;
  const answer = (status, title, text) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, html);
    res.end(resultPage(title, text));
  };
  const progress = (text) => {
    if (isCancelled?.()) throw new Error('cancelled');
    onStep?.(text);
  };
  try {
    progress('Microsoft bestätigt – hole Zugangsdaten …');
    const r = await step('Microsoft', () => postFormChecked('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.verifier,
      scope: 'XboxLive.signin offline_access',
    }));
    if (!r.ok) throw new Error(r.data.error_description || r.data.error || 'Microsoft token request failed');
    const account = await minecraftFromMs(r.data.access_token, r.data.refresh_token, progress);
    answer(200, 'Anmeldung erfolgreich', `Angemeldet als ${account.name}. Du kannst dieses Fenster schließen und zum Counter Launcher zurückkehren.`);
    return account;
  } catch (e) {
    if (e.message === 'cancelled') answer(400, 'Anmeldung abgebrochen', 'Du kannst dieses Fenster schließen.');
    else answer(500, 'Anmeldung fehlgeschlagen', `${e.message} Gehe zurück zum Counter Launcher und versuche es erneut.`);
    throw e;
  }
}

async function refresh(clientId, account) {
  const stored = unprotectAccount(account);
  const r = await step('Microsoft', () => postFormChecked('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: stored.refreshToken,
    scope: 'XboxLive.signin offline_access',
  }));
  if (!r.ok) throw new Error('Session expired, please sign in again');
  return minecraftFromMs(r.data.access_token, r.data.refresh_token || stored.refreshToken);
}

const XSTS_ERRORS = {
  2148916233: 'Dieses Microsoft-Konto hat noch kein Xbox-Profil. Melde dich einmal auf xbox.com an und lege eins an.',
  2148916235: 'Xbox Live ist in deinem Land nicht verfügbar.',
  2148916236: 'Das Konto braucht eine Altersverifizierung (Südkorea).',
  2148916237: 'Das Konto braucht eine Altersverifizierung (Südkorea).',
  2148916238: 'Kinderkonto: muss von einem Erwachsenen zu einer Microsoft-Familie hinzugefügt werden.',
};

async function minecraftFromMs(msAccess, refreshToken, progress = () => {}) {
  progress('Xbox-Anmeldung …');
  const xbl = await step('Xbox Live', () => postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccess },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  }, {}, withTimeout()));
  const uhs = xbl?.DisplayClaims?.xui?.[0]?.uhs;
  if (!xbl?.Token || !uhs) throw new Error('Xbox Live hat keine gültige Antwort geschickt. Versuche es erneut.');
  let xsts;
  try {
    xsts = await step('Xbox Live', () => postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }, {}, withTimeout()));
  } catch (e) {
    const known = XSTS_ERRORS[e.data?.XErr];
    if (known) throw new Error(known);
    throw e;
  }
  progress('Minecraft-Anmeldung …');
  let mc;
  try {
    mc = await step('Minecraft', () => postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }, {}, withTimeout()));
  } catch (e) {
    if (e.status === 403) throw new Error('Mojang has not approved this Azure app id for the Minecraft API yet');
    throw e;
  }
  progress('Minecraft-Profil wird geladen …');
  let profile;
  try {
    profile = await step('Minecraft', () => getJson('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + mc.access_token }, ...withTimeout() }));
  } catch (e) {
    if (e.status === 404) throw new Error('Dieses Konto besitzt kein Minecraft: Java Edition oder hat noch keinen Spielernamen. Starte einmal den offiziellen Minecraft Launcher und wähle dort einen Namen (auch bei Game Pass).');
    throw e;
  }
  if (!profile?.id) throw new Error('This account does not own Minecraft');
  const id = profile.id;
  return {
    type: 'msa',
    name: profile.name,
    uuid: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    accessToken: mc.access_token,
    refreshToken,
    xuid: xsts.DisplayClaims?.xui?.[0]?.xid || '',
    expires: Date.now() + mc.expires_in * 1000,
  };
}

module.exports = { offline, browserLogin, refresh, protectAccount, unprotectAccount, createPkce, REDIRECT_URI };
