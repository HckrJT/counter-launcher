// Counter AI worker. Shared provider keys stay in Cloudflare Worker secrets.
const GROQ = 'https://api.groq.com/openai';
const OPENROUTER = 'https://openrouter.ai/api/v1';
const TURNS_PER_MINUTE = 5;
const PER_TURN = 24;
const PER_DAY = 700;
const OLD_PER_MINUTE = 6;
const MAX_BODY = 250_000;
const RESERVE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const hits = new Map();

// The client header is public, so it only keeps random bots away. Real protection: limits per IP (a changed
// X-Counter-User does not help), only free / known models, and only the fields Counter itself sends.
const IP_PER_MINUTE = 20;
const IP_PER_DAY = 2500;
const ipHits = new Map();
function ipLimited(ip) {
  const now = Date.now();
  const h = ipHits.get(ip) || { min: [], day: 0, dayStart: now };
  h.min = h.min.filter((t) => now - t < 60_000);
  if (now - h.dayStart > 86_400_000) { h.day = 0; h.dayStart = now; }
  if (h.day >= IP_PER_DAY) return 3600;
  if (h.min.length >= IP_PER_MINUTE) return Math.ceil((60_000 - (now - h.min[0])) / 1000) + 1;
  h.min.push(now);
  h.day++;
  ipHits.set(ip, h);
  if (ipHits.size > 50_000) ipHits.clear();
  return 0;
}
// OpenRouter: only free models (the shared key must never pay); Groq: the model families Counter uses
const ALLOWED_MODEL = {
  openrouter: (m) => m === 'openrouter/free' || /^[\w.\-/]+:free$/.test(m),
  groq: (m) => /^(qwen\/|moonshotai\/|openai\/gpt-oss|meta-llama\/|llama-|groq\/compound|compound)[\w.\-/]*$/.test(m),
};
const BODY_FIELDS = ["model", "messages", "tools", "tool_choice", "temperature", "max_tokens", "reasoning_effort", "include_reasoning", "reasoning_format"];

function limited(id, turn) {
  const now = Date.now();
  const h = hits.get(id) || { min: [], turns: new Map(), day: 0, dayStart: now };
  h.min = h.min.filter((x) => now - x.t < 60_000);
  for (const [k, v] of h.turns) if (now - v.t > 600_000) h.turns.delete(k);
  if (now - h.dayStart > 86_400_000) { h.day = 0; h.dayStart = now; }
  if (h.day >= PER_DAY) return 3600;
  if (turn) {
    const t = h.turns.get(turn);
    if (t) {
      if (t.n >= PER_TURN) return 60;
      t.n++;
    } else {
      const started = h.min.filter((x) => x.turn);
      if (started.length >= TURNS_PER_MINUTE) return Math.ceil((60_000 - (now - started[0].t)) / 1000) + 1;
      h.turns.set(turn, { n: 1, t: now });
      h.min.push({ t: now, turn: true });
    }
  } else {
    if (h.min.length >= OLD_PER_MINUTE) return Math.ceil((60_000 - (now - h.min[0].t)) / 1000) + 1;
    h.min.push({ t: now });
  }
  h.day++;
  hits.set(id, h);
  if (hits.size > 50_000) hits.clear();
  return 0;
}

async function workersAi(env, body) {
  const messages = (body.messages || []).map((m) => {
    if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments } })) };
    if (Array.isArray(m.content)) return { role: m.role, content: m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') };
    return { role: m.role, content: String(m.content ?? '') };
  });
  const input = { messages, max_tokens: Math.min(body.max_tokens || 1200, 2048), temperature: body.temperature ?? 0.4 };
  if (body.tools?.length) input.tools = body.tools.map((t) => t.function ? { name: t.function.name, description: t.function.description, parameters: t.function.parameters } : t);
  const res = await env.AI.run(RESERVE_MODEL, input);
  const calls = (res.tool_calls || []).map((t, i) => ({ id: `call_${i}_${Date.now().toString(36)}`, type: 'function', function: { name: t.name || t.function?.name, arguments: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments || t.function?.arguments || {}) } }));
  const text = typeof res.response === 'string' ? res.response : res.response ? JSON.stringify(res.response) : '';
  if (!text && !calls.length) return null;
  return { id: 'cf-reserve', object: 'chat.completion', model: RESERVE_MODEL, choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) } }] };
}

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('X-Counter-Client') !== 'counter-launcher') return json(403, { error: { message: 'Nur für den Counter Launcher' } });
    const requested = (request.headers.get('X-Counter-Provider') || 'groq').toLowerCase() === 'openrouter' ? 'openrouter' : 'groq';
    const base = requested === 'openrouter' ? OPENROUTER : GROQ;
    const apiPath = (path) => requested === 'openrouter' ? path : `/v1${path}`;
    const key = requested === 'openrouter' ? env.OPENROUTER_KEY : env.GROQ_KEY;
    if (!key) return json(500, { error: { message: `${requested === 'openrouter' ? 'OPENROUTER_KEY' : 'GROQ_KEY'} fehlt im Worker` } });
    const auth = { Authorization: `Bearer ${key}`, ...(requested === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/HckrJT/counter-launcher', 'X-Title': 'Counter Launcher' } : {}) };

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      const r = await fetch(base + apiPath('/models'), { headers: auth });
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const ip = request.headers.get('CF-Connecting-IP') || '';
      // optional Cloudflare rate limit binding (wrangler: [[unsafe.bindings]] type = "ratelimit", name = "RATE_LIMITER")
      const ipWait = env.RATE_LIMITER ? ((await env.RATE_LIMITER.limit({ key: ip })).success ? 0 : 30) : ipLimited(ip);
      if (ipWait) return new Response(JSON.stringify({ error: { message: 'Zu viele Anfragen – kurz warten' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': String(ipWait) } });
      const user = (request.headers.get('X-Counter-User') || '').slice(0, 64) + '|' + ip;
      const turn = (request.headers.get('X-Counter-Turn') || '').slice(0, 40);
      const wait = limited(user, turn);
      if (wait) return new Response(JSON.stringify({ error: { message: 'Zu viele Anfragen – kurz warten' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': String(wait) } });
      const text = await request.text();
      if (text.length > MAX_BODY) return json(413, { error: { message: 'Anfrage zu groß' } });
      let body;
      try { body = JSON.parse(text); } catch { return json(400, { error: { message: 'Ungültige Anfrage' } }); }
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || !ALLOWED_MODEL[requested](String(body.model || ''))) return json(400, { error: { message: 'Modell nicht erlaubt' } });
      // forward only what Counter sends: no plugins, provider routing or other options that could change costs
      body = Object.fromEntries(BODY_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
      body.max_tokens = Math.min(Number(body.max_tokens) || 1500, 4096);
      body.stream = false;
      const r = await fetch(base + apiPath('/chat/completions'), { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (requested === 'groq' && (r.status === 429 || r.status >= 500) && env.AI && !body.__noFallback) {
        try { const out = await workersAi(env, body); if (out) return json(200, out); } catch {}
      }
      const headers = { 'Content-Type': 'application/json' };
      const retry = r.headers.get('retry-after');
      if (retry) headers['retry-after'] = retry;
      return new Response(r.body, { status: r.status, headers });
    }
    return json(404, { error: { message: 'Nicht gefunden' } });
  },
};
