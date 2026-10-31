// Microsoft login (device code flow) and offline accounts.
// The Azure application id is entered by the user in the settings; Mojang has to allow that app for the Minecraft API.
const crypto = require('crypto');
const { postJson, postForm, getJson } = require('./http');

function offline(name) {
  // same uuid scheme as vanilla offline mode: md5("OfflinePlayer:" + name), version 3
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { type: 'offline', name, uuid, accessToken: '0' };
}

/** step 1: returns { user_code, verification_uri, device_code, interval, expires_in } */
async function startDeviceLogin(clientId) {
  const r = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', {
    client_id: clientId,
    scope: 'XboxLive.signin offline_access',
  });
  if (!r.ok) throw new Error(r.data.error_description || 'Device code request failed');
  return r.data;
}

/** step 2: polls until the user confirmed in the browser, then signs in to Xbox and Minecraft */
async function finishDeviceLogin(clientId, device, isCancelled) {
  const deadline = Date.now() + device.expires_in * 1000;
  let msToken;
  while (Date.now() < deadline) {
    if (isCancelled?.()) throw new Error('cancelled');
    await new Promise((r) => setTimeout(r, (device.interval || 5) * 1000));
    const r = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: device.device_code,
    });
    if (r.ok) {
      msToken = r.data;
      break;
    }
    if (r.data.error !== 'authorization_pending' && r.data.error !== 'slow_down') throw new Error(r.data.error_description || r.data.error);
  }
  if (!msToken) throw new Error('Login timed out');
  return minecraftFromMs(msToken.access_token, msToken.refresh_token);
}

async function refresh(clientId, account) {
  const r = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: account.refreshToken,
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

module.exports = { offline, startDeviceLogin, finishDeviceLogin, refresh };
