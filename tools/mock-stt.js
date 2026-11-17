// A tiny stand-in for a speech-to-text server, for testing without a GPU or a real model. It speaks the OpenAI-style
// transcription route that Parakeet and Whisper servers offer (POST /v1/audio/transcriptions, multipart form with
// `file` and `model`) and answers with {"text": "..."}. It does NOT recognize speech: it returns the first words of a
// fixed script, about three words per second of audio, so tests can tell a short clip from a long one.
//
//   node tools/mock-stt.js                         # http://127.0.0.1:11998
//   MOCK_STT_PORT=12001 MOCK_STT_API_KEY=secret node tools/mock-stt.js
import { createServer } from 'node:http';

const SCRIPT = 'welcome everyone and let me introduce myself as your host tonight the emergency exits are at the back of the room';

export function startMockStt({ port = 11998, apiKey = '', model = '', script = SCRIPT, delayMs = 0, wordsPerSecond = 3, log = false } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || req.url !== '/v1/audio/transcriptions') return send(404, { error: 'not found' });
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: 'invalid API key' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const latin = body.toString('latin1');
    const field = (name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(latin)?.[1];
    const riff = body.indexOf('RIFF');
    if (riff < 0) return send(400, { error: 'no WAV file in the request' });
    const wavBytes = body.length - riff;
    const seconds = Math.max(0, (wavBytes - 44) / 32000);
    seen.push({ headers: req.headers, model: field('model'), format: field('response_format'), seconds, bytes: wavBytes });
    if (log) console.log(`mock stt: model=${field('model')} ${seconds.toFixed(1)} s of audio`);
    if (model && field('model') !== model) return send(404, { error: `model '${field('model')}' not found` });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const words = script.split(' ').slice(0, Math.floor(seconds * wordsPerSecond));
    send(200, { text: words.join(' ') });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMockStt({
    port: Number(process.env.MOCK_STT_PORT) || 11998, apiKey: process.env.MOCK_STT_API_KEY || '',
    model: process.env.MOCK_STT_MODEL || '', delayMs: Number(process.env.MOCK_STT_DELAY_MS) || 0, log: true,
  });
  console.log(`Mock speech server on http://127.0.0.1:${port}/v1/audio/transcriptions`);
}
