// Tests for local mode. They need no GPU and no real model: a mock System One server stands in for Ollama,
// llama-server or LM Studio. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { startMock } from '../tools/mock-systemone.js';
import { makeJev, scorePoints, parsePoints, systemOneUrl } from '../prompter.js';

const MODEL = 'mock-decider';
const POINTS = parsePoints('Welcome everyone and introduce yourself\nWhere the emergency exits are\nThe bar is open during intermission');
const TALK = 'Welcome everyone, I will introduce myself as your host tonight. The emergency exits are at the back of the room.';

test('systemOneUrl normalizes what people type', () => {
  assert.equal(systemOneUrl('192.168.1.5:11434'), 'http://192.168.1.5:11434/v1/systemone');
  assert.equal(systemOneUrl('http://box:8080/'), 'http://box:8080/v1/systemone');
  assert.equal(systemOneUrl('http://box:8080/v1'), 'http://box:8080/v1/systemone');
  assert.equal(systemOneUrl('http://box:8080/v1/systemone'), 'http://box:8080/v1/systemone');
  assert.equal(systemOneUrl('https://h.example/x/'), 'https://h.example/x/v1/systemone');
  assert.equal(systemOneUrl('ftp://x'), null);
  assert.equal(systemOneUrl(''), null);
});

test('makeJev local: scores points against a System One server', async () => {
  const { server, seen, port } = await startMock({ port: 0, model: MODEL });
  try {
    const jev = makeJev({ provider: 'local', url: systemOneUrl(`127.0.0.1:${port}`), model: MODEL });
    const { scores, cost } = await scorePoints(jev, TALK, POINTS);
    assert.equal(cost, null);
    assert.ok(scores.p0.score >= 1.5, `p0 should be covered, got ${scores.p0.score}`);
    assert.ok(scores.p1.score >= 1.5, `p1 should be covered, got ${scores.p1.score}`);
    assert.ok(scores.p2.score < 1.5, `p2 should not be covered, got ${scores.p2.score}`);
    assert.equal(seen[0].body.model, MODEL);
    assert.equal(seen[0].body.questions.p0.type, 'score');
    assert.equal(seen[0].body.questions.p0.criteria.length, 4);
    assert.equal(seen[0].headers.authorization, undefined, 'no key means no Authorization header');
  } finally { server.close(); }
});

test('makeJev local: refuses to start without an address or model', () => {
  assert.throws(() => makeJev({ provider: 'local', model: MODEL }), /server address/);
  assert.throws(() => makeJev({ provider: 'local', url: 'http://x/v1/systemone' }), /model name/);
});

test('makeJev local: a missing model gives a helpful 404 message and is not retried', async () => {
  const { server, seen, port } = await startMock({ port: 0, model: MODEL });
  try {
    const jev = makeJev({ provider: 'local', url: systemOneUrl(`127.0.0.1:${port}`), model: 'nope' });
    await assert.rejects(() => scorePoints(jev, TALK, POINTS), /404.*model 'nope' not found.*decision model/s);
    assert.equal(seen.length, 1);
  } finally { server.close(); }
});

test('makeJev local: sends an API key only when one is given', async () => {
  const { server, seen, port } = await startMock({ port: 0, model: MODEL, apiKey: 'secret' });
  try {
    const url = systemOneUrl(`127.0.0.1:${port}`);
    await assert.rejects(() => scorePoints(makeJev({ provider: 'local', url, model: MODEL }), TALK, POINTS), /\(401\)/);
    await scorePoints(makeJev({ provider: 'local', url, model: MODEL, key: 'secret' }), TALK, POINTS);
    assert.equal(seen.at(-1).headers.authorization, 'Bearer secret');
  } finally { server.close(); }
});

// ---- the relay in server.js ----
async function startRelay(env) {
  const relayPort = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(relayPort), TYPESAFE_API_KEY: '', LOCAL_URL: '', LOCAL_MODEL: '', LOCAL_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('relay exited'))); });
  const base = `http://127.0.0.1:${relayPort}`;
  return { base, port: relayPort, stop: () => child.kill() };
}
const own = (relay, extra = {}) => ({ 'Content-Type': 'application/json', Origin: relay.base, ...extra });
const body = JSON.stringify({ model: MODEL, state: { transcript: TALK }, questions: {
  p0: { type: 'score', instructions: 'How much has the speaker covered this talking point: "Where the emergency exits are"?', criteria: ['a', 'b', 'c', 'd'] } } });

test('relay: /api/config reports the .env defaults', async () => {
  const relay = await startRelay({ LOCAL_URL: '10.0.0.9:11434', LOCAL_MODEL: 'nimble' });
  try {
    const cfg = await (await fetch(`${relay.base}/api/config`)).json();
    assert.deepEqual(cfg, { relay: true, serverKey: false, local: { url: '10.0.0.9:11434', model: 'nimble' }, stt: { url: '', model: '' }, threshold: null });
  } finally { relay.stop(); }
});

test('relay: forwards /api/local to the address in X-Local-Url', async () => {
  const { server, seen, port } = await startMock({ port: 0, model: MODEL });
  const relay = await startRelay({});
  try {
    const res = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: own(relay, { 'X-Local-Url': `127.0.0.1:${port}` }), body });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.answers.p0.score > 1.5);
    assert.equal(seen[0].body.model, MODEL);
  } finally { relay.stop(); server.close(); }
});

test('relay: falls back to LOCAL_URL and adds LOCAL_API_KEY', async () => {
  const { server, seen, port } = await startMock({ port: 0, model: MODEL, apiKey: 'k1' });
  const relay = await startRelay({ LOCAL_URL: `127.0.0.1:${port}`, LOCAL_API_KEY: 'k1' });
  try {
    const res = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: own(relay), body });
    assert.equal(res.status, 200);
    assert.equal(seen[0].headers.authorization, 'Bearer k1');
  } finally { relay.stop(); server.close(); }
});

test('relay: passes upstream errors through, and reports an unreachable server', async () => {
  const { server, port } = await startMock({ port: 0, model: MODEL });
  const relay = await startRelay({});
  try {
    const bad = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: own(relay, { 'X-Local-Url': `127.0.0.1:${port}` }), body: body.replace(MODEL, 'other') });
    assert.equal(bad.status, 404);
    assert.match((await bad.json()).error, /not found/);
    // A port nothing listens on: start a server, note its port, close it.
    const closed = await startMock({ port: 0 }); const closedPort = closed.port; closed.server.close(); await once(closed.server, 'close');
    const down = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: own(relay, { 'X-Local-Url': `127.0.0.1:${closedPort}` }), body });
    assert.equal(down.status, 502);
    assert.match((await down.json()).error, /Relay failed.*ECONNREFUSED/);
    const none = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: own(relay), body });
    assert.equal(none.status, 400);
  } finally { relay.stop(); server.close(); }
});

test('relay: only answers its own page', async () => {
  const { server, seen, port } = await startMock({ port: 0, model: MODEL });
  const relay = await startRelay({});
  try {
    const hdr = { 'X-Local-Url': `127.0.0.1:${port}` };
    const foreign = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body });
    assert.equal(foreign.status, 403);
    const plain = await fetch(`${relay.base}/api/local`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'text/plain', Origin: relay.base }, body });
    assert.equal(plain.status, 403);
    // DNS rebinding: a request that reaches the relay under another hostname (fetch won't let us set Host, so use http.request).
    const rebind = await new Promise((resolve) => {
      const r = request({ host: '127.0.0.1', port: relay.port, path: '/api/local', method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json', Host: 'evil.example' } },
        (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', () => resolve('refused')); r.end(body);
    });
    assert.equal(rebind, 403);
    assert.equal(seen.length, 0, 'nothing reached the model server');
  } finally { relay.stop(); server.close(); }
});

test('replay.js scores a talk against a local model', async () => {
  const { server, port } = await startMock({ port: 0, model: MODEL });
  try {
    const child = spawn(process.execPath, ['replay.js', `--local=127.0.0.1:${port}`, `--model=${MODEL}`, '--every=10'], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: '', LOCAL_URL: '' },
    });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, out);
    assert.match(out, /Local server \(mock-decider at http:\/\/127\.0\.0\.1:\d+\/v1\/systemone\): 383 words, 7 points/);
    assert.match(out, /✓ word +\d+ +score \d\.\d\d +Tip the performers, and bring cash/);
    assert.match(out, /no cost, \d+ ms average per call \(median \d+ ms, slowest \d+ ms\)/);
  } finally { server.close(); }
});
