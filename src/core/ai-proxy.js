// The Counter AI worker (Cloudflare) that forwards to shared Groq/OpenRouter keys kept as Cloudflare secrets.
// Empty url = no shared assistant, users need their own Groq key.
const os = require('os');
const crypto = require('crypto');

module.exports = {
  url: 'https://counter-ai.counter-client.workers.dev',
  client: 'counter-launcher',
  /** anonymous, stable id per PC for the rate limit in the worker (no name, no account) */
  user: () => crypto.createHash('sha256').update(os.hostname() + os.userInfo().username + 'counter').digest('hex').slice(0, 24),
};
