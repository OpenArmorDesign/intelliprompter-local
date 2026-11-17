// Serves the page on http://127.0.0.1:8787 and relays TypeSafe calls, which browsers cannot make directly
// (api.typesafe.ai does not allow cross-origin requests). OpenRouter calls go straight from the browser.
//
// LOCAL MODE (intelliprompter-local fork): the same relay also forwards calls to a decision model you run
// yourself, on this machine or elsewhere on your network (POST /api/local -> <server>/v1/systemone). Going
// through the relay means the model server needs no CORS settings and the page can be served over plain
// http://127.0.0.1, which browsers treat as secure, so the microphone works.
//
//   node server.js                     # PORT=9000 node server.js to change the port
//
// If .env (or the shell) sets TYPESAFE_API_KEY, the relay uses it and the page needs no key at all.
// If it sets LOCAL_URL and LOCAL_MODEL, the page starts in local mode with those. LOCAL_API_KEY is optional
// and only needed when your model server was started with an API key.
//
// SPEECH SERVER (intelliprompter-local fork): POST /api/stt forwards a short WAV clip to a speech-to-text server
// you run (Parakeet, Whisper, anything with POST /v1/audio/transcriptions) and returns its answer. The page
// uses it only if you pick "My own speech server". STT_URL, STT_MODEL and STT_API_KEY in .env are the defaults.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, systemOneUrl } from './prompter.js';
import { sttEndpoint } from './stt.js';

const root = fileURLToPath(new URL('.', import.meta.url));
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const serverKey = process.env.TYPESAFE_API_KEY || '';
const localUrl = process.env.LOCAL_URL || '';
const localModel = process.env.LOCAL_MODEL || '';
const localKey = process.env.LOCAL_API_KEY || '';
const sttUrl = process.env.STT_URL || '';
const sttModel = process.env.STT_MODEL || '';
const sttKey = process.env.STT_API_KEY || '';
const port = Number(process.env.PORT) || 8787;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const PUBLIC = new Set(['index.html', 'prompter.js', 'stt.js']);

// Only this server's own page may use the relay. Otherwise any website open in the browser could post here (a
// text/plain POST needs no CORS preflight) and spend the key in .env, or reach the relay by DNS rebinding.
// Requiring JSON (or audio/wav for speech) forces a preflight, which this server never approves.
function ownPage(req, contentType) {
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origin = req.headers.origin;
  return own.includes(req.headers.host) && (!origin || own.some((h) => origin === `http://${h}`)) &&
    new RegExp(`^${contentType.replace('/', '\\/')}\\b`, 'i').test(req.headers['content-type'] ?? '');
}

async function readBody(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ relay: true, serverKey: !!serverKey, local: { url: localUrl, model: localModel }, stt: { url: sttUrl, model: sttModel } }));
    }
    if (path === '/api/stt' && req.method === 'POST') {
      if (!ownPage(req, 'audio/wav')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end('{"error":"The relay only accepts requests from its own page."}');
      }
      // The page names the speech server in X-Stt-Url (a setting on the page); .env is the default.
      const target = sttEndpoint(req.headers['x-stt-url'] || sttUrl);
      if (!target) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"No speech server address: enter one on the page or set STT_URL in .env"}'); }
      // Speech servers with the OpenAI-style route expect a multipart form with the audio and a model name.
      const form = new FormData();
      form.append('file', new Blob([await readBody(req, 8_000_000)], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', req.headers['x-stt-model'] || sttModel || 'whisper-1');
      form.append('response_format', 'json');
      const upstream = await fetch(target, {
        method: 'POST',
        headers: sttKey ? { Authorization: `Bearer ${sttKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    if ((path === '/api/typesafe' || path === '/api/local') && req.method === 'POST') {
      if (!ownPage(req, 'application/json')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end('{"error":"The relay only accepts requests from its own page."}');
      }
      let target, auth;
      if (path === '/api/typesafe') {
        target = PROVIDERS.typesafe.url;
        auth = req.headers.authorization || (serverKey && `Bearer ${serverKey}`);
        if (!auth) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"No TypeSafe key: paste one in the page or set TYPESAFE_API_KEY in .env"}'); }
      } else {
        // The page names the model server in X-Local-Url (so the address is a setting on the page); .env is the default.
        target = systemOneUrl(req.headers['x-local-url'] || localUrl);
        if (!target) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"No local server address: enter one on the page or set LOCAL_URL in .env"}'); }
        auth = localKey && `Bearer ${localKey}`;
      }
      const upstream = await fetch(target, {
        method: 'POST',
        headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' },
        body: await readBody(req),
        signal: AbortSignal.timeout(120_000),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const headers = { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' };
      for (const h of ['retry-after', 'x-typesafe-request-id']) if (upstream.headers.has(h)) headers[h] = upstream.headers.get(h);
      res.writeHead(upstream.status, headers);
      return res.end(body);
    }
    const file = normalize(path === '/' ? 'index.html' : path.slice(1));
    if (req.method !== 'GET' || !PUBLIC.has(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache' });
    res.end(await readFile(join(root, file)));
  } catch (e) {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json' });
    // fetch() hides the useful part (ECONNREFUSED, a timeout, DNS) in e.cause, so add it.
    const cause = e.cause?.code ?? e.cause?.errors?.[0]?.code ?? (e.name === 'TimeoutError' ? 'no answer within 120 s' : '');
    res.end(JSON.stringify({ error: `Relay failed: ${e.message}${cause ? ` (${cause})` : ''}` }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`IntelliPrompter on http://127.0.0.1:${port}/` + (serverKey ? ' (TypeSafe key loaded from .env)' : '') +
    (localUrl ? ` (local mode: ${systemOneUrl(localUrl) ?? 'LOCAL_URL is not a valid address'}, model ${localModel || 'not set'})` : '') +
    (sttUrl ? ` (speech server: ${sttEndpoint(sttUrl) ?? 'STT_URL is not a valid address'})` : ''));
});
