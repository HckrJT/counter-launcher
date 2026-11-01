const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const auth = require('../src/core/auth');
const store = require('../src/core/store');

test('the bundled Azure client ID is present and public', () => {
  assert.strictEqual(store.DEFAULT_AZURE_CLIENT_ID, 'bb5d17f5-97e1-4cb0-b2e8-de162f69470d');
});

test('PKCE verifier and challenge use the RFC 7636 S256 encoding', () => {
  const { verifier, challenge } = auth.createPkce();
  const expected = crypto.createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.strictEqual(challenge, expected);
  assert.strictEqual(auth.REDIRECT_URI, 'http://localhost:53682/auth/callback');
});

test('offline accounts retain the existing launcher UUID contract', () => {
  const account = auth.offline('Counter');
  assert.strictEqual(account.type, 'offline');
  assert.strictEqual(account.uuid, '0e716d76-593a-3472-9ac4-46b0792649f5');
  assert.strictEqual(account.accessToken, '0');
});
