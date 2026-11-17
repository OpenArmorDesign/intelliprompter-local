// Tests for the speech-to-text option: the helpers in stt.js and the /api/stt relay in server.js.
// They need no microphone, GPU or real speech server: a mock server stands in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { startMockStt } from '../tools/mock-stt.js';
import { SAMPLE_RATE, sttEndpoint, encodeWav, Resampler, Segmenter, createSttSession, makeTranscriber } from '../stt.js';

const tone = (seconds, amp = 0.3, hz = 220) => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE));
const quiet = (seconds) => new Float32Array(Math.round(seconds * SAMPLE_RATE));
const concat = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
// Feeds audio in odd-sized pieces, like a real capture would.
const feed = (target, audio, piece = 1000) => { for (let i = 0; i < audio.length; i += piece) target.push(audio.subarray(i, i + piece)); };

test('sttEndpoint normalizes what people type', () => {
  assert.equal(sttEndpoint('192.168.1.5:8000'), 'http://192.168.1.5:8000/v1/audio/transcriptions');
  assert.equal(sttEndpoint('http://box:5092/'), 'http://box:5092/v1/audio/transcriptions');
  assert.equal(sttEndpoint('http://box:5092/v1'), 'http://box:5092/v1/audio/transcriptions');
  assert.equal(sttEndpoint('https://h.example/stt/transcribe'), 'https://h.example/stt/transcribe');
  assert.equal(sttEndpoint('ftp://x'), null);
  assert.equal(sttEndpoint(''), null);
});

test('encodeWav writes a valid 16-bit mono WAV', () => {
  const wav = encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1, 2]));
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 12);
  assert.equal(wav.length, 44 + 12);
  assert.equal(v.getInt16(46, true), 16383);
  assert.equal(v.getInt16(52, true), -32768);
  assert.equal(v.getInt16(54, true), 32767, 'values above 1 are clipped, not wrapped');
});

test('Resampler turns 48 kHz into 16 kHz across chunk boundaries', () => {
  const src = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 200 * i / 48000));
  const rs = new Resampler();
  const parts = [];
  for (let i = 0; i < src.length; i += 128) parts.push(rs.process(src.subarray(i, i + 128), 48000));
  const out = concat(...parts);
  assert.ok(Math.abs(out.length - 16000) <= 2, `expected about 16000 samples, got ${out.length}`);
  const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  assert.ok(peak > 0.48 && peak < 0.52, `peak ${peak}`);
  // 44.1 kHz works too, where the ratio is not a whole number.
  const rs2 = new Resampler(); const out2 = [];
  for (let i = 0; i < 44100; i += 441) out2.push(rs2.process(new Float32Array(441).fill(0.25), 44100));
  const total = out2.reduce((n, p) => n + p.length, 0);
  assert.ok(Math.abs(total - 16000) <= 2, `got ${total}`);
});

test('Segmenter: one stretch per phrase, partials while talking, a final after the pause', () => {
  const events = [];
  const seg = new Segmenter({ onEvent: (e) => events.push(e) });
  feed(seg, concat(quiet(1), tone(3), quiet(1.5), tone(1), quiet(1.5)));
  const finals = events.filter((e) => e.type === 'final'), partials = events.filter((e) => e.type === 'partial');
  assert.equal(finals.length, 2);
  assert.deepEqual(finals.map((f) => f.id), [1, 2]);
  assert.ok(finals[0].samples.length / SAMPLE_RATE > 3 && finals[0].samples.length / SAMPLE_RATE < 4.2, 'first stretch is about 3 s plus a pause');
  assert.ok(partials.filter((p) => p.id === 1).length >= 2, 'a 3 s stretch gives at least two partials');
  assert.ok(partials.every((p, i, a) => i === 0 || p.id !== a[i - 1].id || p.samples.length > a[i - 1].samples.length), 'each partial holds more audio than the last');
  assert.equal(events.at(-1).type, 'final');
});

test('Segmenter: ignores quiet noise and short clicks, cuts very long talk, flush finishes a stretch', () => {
  const events = [];
  const seg = new Segmenter({ onEvent: (e) => events.push(e), maxSegMs: 5000 });
  feed(seg, Float32Array.from({ length: SAMPLE_RATE * 2 }, () => (Math.random() - 0.5) * 0.004));
  feed(seg, concat(quiet(0.5), tone(0.08), quiet(1)));
  assert.equal(events.length, 0, 'noise and a click are not speech');
  feed(seg, tone(12));
  assert.equal(events.filter((e) => e.type === 'final').length, 2, 'cut at 5 s twice');
  feed(seg, quiet(0.2)); seg.flush();
  assert.ok(events.filter((e) => e.type === 'final').length >= 2);
});

test('session: finals come out in order and are never dropped; slow servers only lose partials', async () => {
  const partials = [], finals = [], errors = [];
  let calls = 0;
  const session = createSttSession({
    transcribe: async (samples) => { calls++; await new Promise((r) => setTimeout(r, 30)); return `${(samples.length / SAMPLE_RATE).toFixed(1)}s`; },
    onPartial: (t, id) => partials.push([id, t]), onFinal: (t, id) => finals.push([id, t]), onError: (e) => errors.push(e),
  });
  feed(session, concat(quiet(0.5), tone(2.5), quiet(1), tone(2), quiet(1)));
  while (!session.idle()) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(finals.map((f) => f[0]), [1, 2]);
  assert.equal(errors.length, 0);
  assert.ok(partials.every(([id]) => id === 1 || id === 2));
  assert.ok(calls >= 2);
});

test('session: a partial may arrive before its final is done, errors are reported, and later stretches still work', async () => {
  const finals = [], partials = [], errors = [];
  let n = 0;
  const session = createSttSession({
    transcribe: async (samples) => { n++; if (n === 1) { await new Promise((r) => setTimeout(r, 200)); return 'late partial'; } if (n === 2) throw new Error('boom'); return `ok ${n}`; },
    onPartial: (t) => partials.push(t), onFinal: (t) => finals.push(t), onError: (e) => errors.push(e.message),
  });
  feed(session, concat(tone(1.5), quiet(1)));      // a partial starts (slow), then the final is queued behind it and fails
  feed(session, concat(tone(1), quiet(1)));        // the next stretch's final succeeds
  while (!session.idle()) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(partials, ['late partial'], 'shown while its final is still queued; the final replaces it');
  assert.deepEqual(errors, ['boom']);
  assert.equal(finals.length, 1);
});

// ---- the relay in server.js ----
async function startRelay(env) {
  const relayPort = 19000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(relayPort), TYPESAFE_API_KEY: '', LOCAL_URL: '', LOCAL_MODEL: '', STT_URL: '', STT_MODEL: '', STT_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('relay exited'))); });
  return { base: `http://127.0.0.1:${relayPort}`, port: relayPort, stop: () => child.kill() };
}
const clip = (seconds) => encodeWav(tone(seconds));

test('relay: /api/config reports the speech defaults', async () => {
  const relay = await startRelay({ STT_URL: '10.0.0.9:5092', STT_MODEL: 'parakeet' });
  try {
    const cfg = await (await fetch(`${relay.base}/api/config`)).json();
    assert.deepEqual(cfg.stt, { url: '10.0.0.9:5092', model: 'parakeet' });
  } finally { relay.stop(); }
});

test('relay: forwards a WAV clip to the speech server as an OpenAI-style form', async () => {
  const stt = await startMockStt({ port: 0, model: 'parakeet' });
  const relay = await startRelay({});
  try {
    const res = await fetch(`${relay.base}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: relay.base, 'X-Stt-Url': `127.0.0.1:${stt.port}`, 'X-Stt-Model': 'parakeet' }, body: clip(2) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).text, 'welcome everyone and let me introduce');
    assert.equal(stt.seen[0].model, 'parakeet');
    assert.equal(stt.seen[0].format, 'json');
    assert.ok(Math.abs(stt.seen[0].seconds - 2) < 0.01);
    // no model given anywhere: the usual default
    const mock2 = await startMockStt({ port: 0, model: 'whisper-1' });
    const res2 = await fetch(`${relay.base}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Stt-Url': `127.0.0.1:${mock2.port}` }, body: clip(1) });
    assert.equal(res2.status, 200);
    mock2.server.close();
  } finally { relay.stop(); stt.server.close(); }
});

test('relay: uses STT_URL and STT_API_KEY from .env, passes errors through, and reports an unreachable server', async () => {
  const stt = await startMockStt({ port: 0, apiKey: 'k1' });
  const relay = await startRelay({ STT_URL: `127.0.0.1:${stt.port}`, STT_API_KEY: 'k1' });
  try {
    const ok = await fetch(`${relay.base}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: clip(1) });
    assert.equal(ok.status, 200);
    assert.equal(stt.seen[0].headers.authorization, 'Bearer k1');
    const none = await startRelay({});
    try {
      const r = await fetch(`${none.base}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: clip(1) });
      assert.equal(r.status, 400);
      const closed = await startMockStt({ port: 0 }); const p = closed.port; closed.server.close(); await new Promise((r2) => closed.server.once('close', r2));
      const down = await fetch(`${none.base}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Stt-Url': `127.0.0.1:${p}` }, body: clip(1) });
      assert.equal(down.status, 502);
      assert.match((await down.json()).error, /Relay failed.*ECONNREFUSED/);
    } finally { none.stop(); }
  } finally { relay.stop(); stt.server.close(); }
});

test('relay: /api/stt only answers its own page', async () => {
  const stt = await startMockStt({ port: 0 });
  const relay = await startRelay({});
  try {
    const hdr = { 'X-Stt-Url': `127.0.0.1:${stt.port}` };
    const foreign = await fetch(`${relay.base}/api/stt`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'audio/wav', Origin: 'http://evil.example' }, body: clip(1) });
    assert.equal(foreign.status, 403);
    for (const type of ['text/plain', 'multipart/form-data; boundary=x', 'application/json']) {
      const r = await fetch(`${relay.base}/api/stt`, { method: 'POST', headers: { ...hdr, 'Content-Type': type, Origin: relay.base }, body: clip(1) });
      assert.equal(r.status, 403, type);
    }
    const rebind = await new Promise((resolve) => {
      const r = request({ host: '127.0.0.1', port: relay.port, path: '/api/stt', method: 'POST', headers: { ...hdr, 'Content-Type': 'audio/wav', Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', () => resolve('refused')); r.end(Buffer.from(clip(1)));
    });
    assert.equal(rebind, 403);
    assert.equal(stt.seen.length, 0, 'nothing reached the speech server');
  } finally { relay.stop(); stt.server.close(); }
});

test('makeTranscriber end to end through the relay, with errors that say what happened', async () => {
  const stt = await startMockStt({ port: 0, model: 'parakeet' });
  const relay = await startRelay({});
  try {
    const endpoint = `${relay.base}/api/stt`;
    const good = makeTranscriber({ url: `127.0.0.1:${stt.port}`, model: 'parakeet', endpoint });
    assert.equal(await good(tone(1)), 'welcome everyone and');
    const wrong = makeTranscriber({ url: `127.0.0.1:${stt.port}`, model: 'nope', endpoint });
    await assert.rejects(() => wrong(tone(1)), /Speech server -> 404: model 'nope' not found/);
  } finally { relay.stop(); stt.server.close(); }
});

// ---- remembering settings in .env ----
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('relay: /api/settings writes the four plain settings to .env and keeps everything else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ip-env-')), file = join(dir, '.env');
  writeFileSync(file, '# my notes\nTYPESAFE_API_KEY=keepme\nLOCAL_URL=old:1\n');
  const relay = await startRelay({ ENV_FILE: file });
  try {
    const post = (body, headers = {}) => fetch(`${relay.base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: relay.base, ...headers }, body: JSON.stringify(body) });
    const ok = await post({ LOCAL_URL: '10.0.0.2:11435', LOCAL_MODEL: 'd1:3b', STT_URL: '10.0.0.2:5092', STT_MODEL: 'parakeet-tdt-0.6b-v3' });
    assert.equal(ok.status, 200);
    const text = readFileSync(file, 'utf8');
    assert.equal(text, '# my notes\nTYPESAFE_API_KEY=keepme\nLOCAL_URL=10.0.0.2:11435\nLOCAL_MODEL=d1:3b\nSTT_URL=10.0.0.2:5092\nSTT_MODEL=parakeet-tdt-0.6b-v3\n');
    // the running relay reports the new defaults without a restart
    const cfg = await (await fetch(`${relay.base}/api/config`)).json();
    assert.deepEqual(cfg.local, { url: '10.0.0.2:11435', model: 'd1:3b' });
    assert.deepEqual(cfg.stt, { url: '10.0.0.2:5092', model: 'parakeet-tdt-0.6b-v3' });
    // keys are never written, unknown names are ignored, bad values are refused
    await post({ TYPESAFE_API_KEY: 'stolen', LOCAL_API_KEY: 'x', PORT: '1' });
    assert.equal(readFileSync(file, 'utf8'), text);
    const bad = await post({ LOCAL_URL: 'a\nTYPESAFE_API_KEY=evil' });
    assert.equal(bad.status, 400);
    assert.equal(readFileSync(file, 'utf8'), text);
    // the check-off threshold: a number from 0.5 to 2.5
    assert.equal((await post({ THRESHOLD: '1.3' })).status, 200);
    assert.equal((await (await fetch(`${relay.base}/api/config`)).json()).threshold, 1.3);
    assert.match(readFileSync(file, 'utf8'), /\nTHRESHOLD=1\.3\n/);
    assert.equal((await post({ THRESHOLD: '9' })).status, 400);
    assert.equal((await post({ THRESHOLD: 'abc' })).status, 400);
    assert.equal((await (await fetch(`${relay.base}/api/config`)).json()).threshold, 1.3);
    // clearing a value
    await post({ STT_URL: '' });
    assert.match(readFileSync(file, 'utf8'), /\nSTT_URL=\n/);
    // other sites and wrong content types are refused
    assert.equal((await post({ LOCAL_URL: 'x:1' }, { Origin: 'http://evil.example' })).status, 403);
    const plain = await fetch(`${relay.base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"LOCAL_URL":"x:1"}' });
    assert.equal(plain.status, 403);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /x:1/);
  } finally { relay.stop(); }
});

test('relay: a new .env created by the page is private to the user', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ip-env-')), file = join(dir, '.env');
  const relay = await startRelay({ ENV_FILE: file });
  try {
    const r = await fetch(`${relay.base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ LOCAL_URL: 'a:1' }) });
    assert.equal(r.status, 200);
    assert.equal(readFileSync(file, 'utf8'), 'LOCAL_URL=a:1\n');
    assert.equal(statSync(file).mode & 0o077, 0, 'no access for group or others');
  } finally { relay.stop(); }
});
