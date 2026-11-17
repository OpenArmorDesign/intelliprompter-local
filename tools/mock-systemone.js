// A tiny stand-in for a decision-model server, for testing without a GPU. It speaks the same System One API
// as Ollama, llama-server and LM Studio (POST /v1/systemone) and answers Score questions by checking how many
// of a talking point's words appear in the transcript. It is NOT a real model: it exists so the relay, the page
// and replay.js can be tested, and so you can see the wire format.
//
//   node tools/mock-systemone.js                    # http://127.0.0.1:11999
//   MOCK_PORT=12000 MOCK_API_KEY=secret node tools/mock-systemone.js
//   MOCK_DELAY_MS=300 MOCK_MODEL=nimble node tools/mock-systemone.js
import { createServer } from 'node:http';

const words = (t) => String(t).toLowerCase().match(/[a-z']{4,}/g) ?? [];

// Maps the fraction of a point's words found in the transcript to probabilities over the four levels.
export function scoreOne(transcript, point, nLevels = 4) {
  const have = new Set(words(transcript));
  const want = words(point);
  const frac = want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
  const centre = frac * (nLevels - 1);
  const raw = Array.from({ length: nLevels }, (_, i) => Math.exp(-((i - centre) ** 2) / 0.5));
  const sum = raw.reduce((a, b) => a + b, 0);
  const probabilities = Object.fromEntries(raw.map((v, i) => [String(i), v / sum]));
  const score = raw.reduce((a, v, i) => a + (i * v) / sum, 0);
  const confidence = 1 - -raw.reduce((a, v) => a + (v / sum) * Math.log(v / sum || 1), 0) / Math.log(nLevels);
  return { score, confidence, probabilities };
}

export function startMock({ port = 11999, apiKey = '', delayMs = 0, model = 'mock-decider', log = false } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || req.url !== '/v1/systemone') return send(404, { error: 'not found' });
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: 'invalid API key' });
    let raw = '';
    for await (const c of req) raw += c;
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: 'invalid JSON' }); }
    seen.push({ headers: req.headers, body });
    if (log) console.log(`mock: model=${body.model} questions=${Object.keys(body.questions ?? {}).length}`);
    if (body.model !== model) return send(404, { error: `model '${body.model}' not found` });
    if (!body.state || !body.questions) return send(400, { error: 'state and questions are required' });
    const transcript = typeof body.state === 'string' ? body.state : (body.state.transcript ?? JSON.stringify(body.state));
    const answers = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type !== 'score' || !Array.isArray(q.criteria)) return send(400, { error: `unsupported question ${id}` });
      const point = /talking point: "(.*)"\?/s.exec(q.instructions)?.[1] ?? q.instructions;
      const a = scoreOne(transcript, point, q.criteria.length);
      answers[id] = { type: 'score', score: a.score, legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities: a.probabilities, confidence: a.confidence };
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    send(200, { model: body.model, answers, usage: { input_tokens: Math.ceil(raw.length / 4), output_tokens: 0 } });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMock({
    port: Number(process.env.MOCK_PORT) || 11999, apiKey: process.env.MOCK_API_KEY || '',
    delayMs: Number(process.env.MOCK_DELAY_MS) || 0, model: process.env.MOCK_MODEL || 'mock-decider', log: true,
  });
  console.log(`Mock System One server on http://127.0.0.1:${port}/v1/systemone (model ${process.env.MOCK_MODEL || 'mock-decider'})`);
}
