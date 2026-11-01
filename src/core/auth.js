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

/** Opens the normal system browser and waits for Microsoft's redirect to the local callback. */
async function browserLogin(clientId, openBrowser, isCancelled, onBrowser) {
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
  }).toString();

  let server;
  let cancelTimer;
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    clearInterval(cancelTimer);
    server?.close();
    fn(value);
  };
  const callback = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400);
        res.end('Invalid state');
        finish(reject, new Error('Invalid Microsoft login state'));
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Microsoft-Anmeldung abgebrochen</h1><p>Du kannst dieses Fenster schließen.</p>');
        finish(reject, new Error(url.searchParams.get('error_description') || error));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        finish(reject, new Error('Microsoft returned no authorization code'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Anmeldung erfolgreich</h1><p>Du kannst dieses Fenster schließen und zum Counter Launcher zurückkehren.</p>');
      finish(resolve, code);
    });
    server.once('error', (e) => finish(reject, new Error(`Microsoft callback could not start: ${e.message}`)));
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      onBrowser?.(authorize.toString(), REDIRECT_URI);
      Promise.resolve().then(() => openBrowser(authorize.toString())).catch((e) => finish(reject, e));
    });
    cancelTimer = setInterval(() => {
      if (isCancelled?.()) finish(reject, new Error('cancelled'));
    }, 250);
  });

  const code = await callback;
  const r = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pkce.verifier,
    scope: 'XboxLive.signin offline_access',
  });
  if (!r.ok) throw new Error(r.data.error_description || r.data.error || 'Microsoft token request failed');
  return minecraftFromMs(r.data.access_token, r.data.refresh_token || stored.refreshToken);
}

async function refresh(clientId, account) {
  const stored = unprotectAccount(account);
  const r = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: stored.refreshToken,
    scope: 'XboxLive.signin offline_access',
  });
  if (!r.ok) throw new Error('Session expired, please sign in again');
  return minecraftFromMs(r.data.access_token, r.data.refresh_token);
}

async function minecraftFromMs(msAccess, refreshToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccess },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const uhs = xbl.DisplayClaims.xui[0].uhs;
  let xsts;
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
  } catch (e) {
    const code = e.data?.XErr;
    if (code === 2148916233) throw new Error('This Microsoft account has no Xbox profile yet');
    if (code === 2148916238) throw new Error('Child account: needs to be added to a family');
    throw e;
  }
  let mc;
  try {
    mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
  } catch (e) {
    if (e.message.startsWith('403')) throw new Error('Mojang has not approved this Azure app id for the Minecraft API yet');
    throw e;
  }
  const profile = await getJson('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + mc.access_token } });
  if (!profile.id) throw new Error('This account does not own Minecraft');
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
