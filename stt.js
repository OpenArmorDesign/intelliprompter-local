// Speech-to-text through a server you run (intelliprompter-local fork). Optional: the page still defaults to the
// browser's built-in speech recognition, and nothing here is loaded unless you choose "My own speech server".
//
// How it works, at a high level:
//   microphone -> small chunks -> 16 kHz mono -> Segmenter (finds where you start and stop talking)
//     -> while you talk: the audio so far in this stretch is sent every ~1.2 s for a quick partial transcript
//     -> when you pause: the whole stretch is sent once more for the final transcript
//   Each send is a small WAV file posted to the page's own server (server.js), which forwards it to your speech
//   server as an OpenAI-style transcription request (POST /v1/audio/transcriptions). That works with Parakeet
//   and Whisper servers that offer that route. Only one request is in flight at a time.
//
// This file has no browser-only code at import time, so server.js and the tests can import it too.

export const SAMPLE_RATE = 16000;

// "host:port", "http://host:port", or a full URL -> the transcription endpoint. A bare address gets the standard
// OpenAI-style path; a URL that already has a path is used as given. Returns null if it is not an http(s) address.
export function sttEndpoint(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (path === '' ) return `${u.origin}/v1/audio/transcriptions`;
  if (path === '/v1') return `${u.origin}/v1/audio/transcriptions`;
  return `${u.origin}${path}${u.search}`;
}

// 16-bit PCM mono WAV from samples in -1..1.
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

// Converts audio of any sample rate to 16 kHz, a chunk at a time, keeping its place between chunks.
export class Resampler {
  constructor(outRate = SAMPLE_RATE) { this.outRate = outRate; this.pos = 0; this.last = 0; this.inRate = 0; }
  process(chunk, inRate) {
    if (inRate === this.outRate) return chunk;
    this.inRate = inRate;
    const step = inRate / this.outRate;
    const out = [];
    // `pos` is measured from the previous chunk's last sample (index -1 is `this.last`).
    while (this.pos < chunk.length) {
      const i = Math.floor(this.pos), frac = this.pos - i;
      const a = i < 0 ? this.last : chunk[i];
      const b = i + 1 < chunk.length ? chunk[i + 1] : null;
      if (b === null) break;
      out.push(a + (b - a) * frac);
      this.pos += step;
    }
    this.pos -= chunk.length;
    this.last = chunk[chunk.length - 1] ?? this.last;
    return Float32Array.from(out);
  }
}

// Finds stretches of speech in a stream of 16 kHz audio, by loudness. It emits {type, id, samples}:
//   'partial' every `partialEveryMs` of audio while you are talking (the audio of this stretch so far),
//   'final'   once you have paused for `endSilenceMs`, or the stretch reached `maxSegMs` (all of it).
// It works in audio time (counting samples), not clock time, so it behaves the same however fast it is fed.
export class Segmenter {
  constructor({ onEvent, frameMs = 20, startFrames = 3, endSilenceMs = 700, preRollMs = 300, partialEveryMs = 1200,
                maxSegMs = 20000, minVoicedMs = 200, minThreshold = 0.012 } = {}) {
    Object.assign(this, { onEvent, frameMs, startFrames, endSilenceMs, preRollMs, partialEveryMs, maxSegMs, minVoicedMs, minThreshold });
    this.frameLen = Math.round(SAMPLE_RATE * frameMs / 1000);
    this.carry = new Float32Array(0);
    this.floor = 0.003;            // running estimate of the background noise level
    this.preRoll = [];             // recent quiet frames, kept so the first syllable is not clipped
    this.voicedRun = 0;
    this.seg = null;
    this.nextId = 1;
  }
  push(samples) {
    let buf = samples;
    if (this.carry.length) { buf = new Float32Array(this.carry.length + samples.length); buf.set(this.carry); buf.set(samples, this.carry.length); }
    let i = 0;
    for (; i + this.frameLen <= buf.length; i += this.frameLen) this.#frame(buf.subarray(i, i + this.frameLen));
    this.carry = buf.slice(i);
  }
  // Call when the microphone stops: finishes any stretch in progress.
  flush() { if (this.seg) this.#finish(); this.preRoll = []; this.voicedRun = 0; this.carry = new Float32Array(0); }
  #frame(f) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    const voiced = rms > Math.max(this.minThreshold, this.floor * 4);
    if (!voiced) this.floor = Math.max(0.0005, 0.97 * this.floor + 0.03 * rms);
    const copy = Float32Array.from(f);
    if (!this.seg) {
      this.preRoll.push(copy);
      const keep = Math.ceil(this.preRollMs / this.frameMs) + this.startFrames;
      if (this.preRoll.length > keep) this.preRoll.shift();
      this.voicedRun = voiced ? this.voicedRun + 1 : 0;
      if (this.voicedRun >= this.startFrames) {
        this.seg = { id: this.nextId++, frames: this.preRoll.splice(0), silence: 0, voiced: this.voicedRun, sinceFlush: 0, partials: 0 };
        this.seg.sinceFlush = this.seg.frames.length * this.frameMs;
        this.voicedRun = 0;
      }
      return;
    }
    const s = this.seg;
    s.frames.push(copy);
    s.sinceFlush += this.frameMs;
    if (voiced) { s.silence = 0; s.voiced++; } else s.silence += this.frameMs;
    if (s.silence >= this.endSilenceMs || s.frames.length * this.frameMs >= this.maxSegMs) return this.#finish();
    if (voiced && s.sinceFlush >= this.partialEveryMs) {
      s.sinceFlush = 0; s.partials++;
      this.onEvent({ type: 'partial', id: s.id, samples: this.#join(s.frames) });
    }
  }
  #finish() {
    const s = this.seg; this.seg = null;
    if (s.voiced * this.frameMs >= this.minVoicedMs) this.onEvent({ type: 'final', id: s.id, samples: this.#join(s.frames) });
  }
  #join(frames) {
    const out = new Float32Array(frames.length * this.frameLen);
    frames.forEach((fr, i) => out.set(fr, i * this.frameLen));
    return out;
  }
}

// Ties the Segmenter to a `transcribe(samples) -> text` function. Rules: one request at a time; finals are never
// dropped and come out in order; partials are skipped if the server is busy (so a slow server just updates less
// often) and ignored if their stretch has already been finalized.
export function createSttSession({ transcribe, onPartial, onFinal, onError }) {
  let busy = false, lastFinalId = 0, closed = false;
  const finals = [];
  const report = (e) => { try { onError?.(e); } catch {} };
  async function drain() {
    if (busy) return;
    busy = true;
    try {
      while (finals.length) {
        const ev = finals.shift();
        try {
          const text = (await transcribe(ev.samples)).trim();
          lastFinalId = ev.id;
          if (text) onFinal(text, ev.id);
        } catch (e) { lastFinalId = ev.id; report(e); }
      }
    } finally { busy = false; }
  }
  const segmenter = new Segmenter({
    onEvent: (ev) => {
      if (ev.type === 'final') { finals.push(ev); drain(); return; }
      if (busy || finals.length) return;
      busy = true;
      transcribe(ev.samples).then((text) => {
        if (!closed && ev.id > lastFinalId && text.trim()) onPartial(text.trim(), ev.id);
      }).catch(report).finally(() => { busy = false; if (finals.length) drain(); });
    },
  });
  return {
    push: (samples16k) => segmenter.push(samples16k),
    flush: () => segmenter.flush(),
    close: () => { closed = true; segmenter.flush(); },
    // True when nothing is waiting to be transcribed (used by tests).
    idle: () => !busy && !finals.length,
  };
}

// ---- browser-only helpers (they use navigator, fetch and AudioContext when called, not when imported) ----

// Sends samples to the page's own server, which forwards them to the speech server you named.
export function makeTranscriber({ url, model, endpoint = 'api/stt', timeoutMs = 60_000 }) {
  return async (samples) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      // audio/wav is not a content type a web page on another site may send without permission, which is what
      // keeps other sites from using this relay.
      headers: { 'Content-Type': 'audio/wav', 'X-Stt-Url': url ?? '', 'X-Stt-Model': model ?? '' },
      body: encodeWav(samples),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const d = json?.error?.message ?? json?.error ?? json?.detail?.message ?? json?.detail ?? text.slice(0, 200) ?? res.statusText;
      throw new Error(`Speech server -> ${res.status}: ${typeof d === 'string' ? d : JSON.stringify(d)}`);
    }
    return String(json ? (json.text ?? '') : text).trim();
  };
}

// Opens the microphone and calls onChunk(Float32Array, sampleRate) with raw audio. Needs a secure page
// (http://127.0.0.1 counts) and a user gesture. Returns {stop()}.
export async function startMic(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const code = `class Capture extends AudioWorkletProcessor { process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor('ip-capture', Capture);`;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const node = new AudioWorkletNode(ctx, 'ip-capture');
  node.port.onmessage = (e) => onChunk(e.data, ctx.sampleRate);
  // The worklet is only run while it is connected to the output, so route it through a muted gain.
  const mute = ctx.createGain(); mute.gain.value = 0;
  source.connect(node); node.connect(mute); mute.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume();
  return {
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      try { node.disconnect(); source.disconnect(); mute.disconnect(); } catch {}
      ctx.close().catch(() => {});
    },
  };
}
