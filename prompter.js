// IntelliPrompter core, shared by the browser page (index.html) and the Node replay (replay.js).
// Each talking point is its own Score question; all of them go to Jev in one call over the same transcript,
// so points can be covered in any order. Code owns the policy: a point is checked off once its score
// reaches the threshold, and stays checked.

// Coverage levels from Allie's description of her IntelliPrompter (TypeSafe Discord).
export const CRITERIA = [
  'No mention of this topic at all',
  'Topic is mentioned but not expanded upon at all',
  'Topic is discussed',
  'Topic is thoroughly discussed',
];

// Only the most recent speech matters for points still open; older text was already scored.
export const MAX_TRANSCRIPT_CHARS = 6000;

// Jev is reachable two ways with the same request and answer shapes: OpenRouter's decisions endpoint,
// or TypeSafe's own API. OpenRouter keys start with sk-or-; anything else is treated as a TypeSafe key.
// Both are pinned to Jev 1.13, the version the default threshold was tuned on; TypeSafe's docs advise pinning
// the versioned ID over the moving `jev-latest` alias when thresholds are tuned against a version.
export const PROVIDERS = {
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' },
  typesafe: { name: 'TypeSafe', url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0' },
};
export const providerFor = (key) => (/^sk-or-/.test(key) ? 'openrouter' : 'typesafe');

// LOCAL MODE (added in the intelliprompter-local fork). Any server that implements the System One API
// (POST /v1/systemone) and has a decision model loaded can stand in for Jev: Ollama 0.35+, llama.cpp's
// llama-server, LM Studio. The address and the model name are settings, not constants, so `url` and `model`
// are filled in per session by the page, replay.js or server.js. It needs no key.
PROVIDERS.local = { name: 'Local server', url: null, model: null };

// Turns what a person types ("192.168.5.240:11435", "http://box:8080/", or a full ".../v1/systemone")
// into the full endpoint URL. Returns null when it is not a usable http(s) address.
export function systemOneUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const path = u.pathname.replace(/\/+$/, '').replace(/\/v1\/systemone$/, '').replace(/\/v1$/, '');
  return `${u.origin}${path}/v1/systemone`;
}

// Timeout and retries follow TypeSafe's SDK defaults: 10 s per attempt, and up to 2 retries on timeouts,
// network errors, 408, 429 and 5xx (529 is "overloaded"), backing off from 500 ms and honoring Retry-After.
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const retryable = (status) => status === 408 || status === 429 || status >= 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns jev(state, questions) -> {answers, cost}. TypeSafe reports tokens, not dollars, so its cost is null.
// `url` overrides the endpoint (the page sends TypeSafe and local calls through server.js); `key` may be empty
// when that server holds the key itself. `model` overrides the pinned model ID (local mode needs it, since the
// model is whatever you have loaded). `timeoutMs` and `retries` default to TypeSafe's SDK values.
export function makeJev({ provider, key, url, model, headers = {}, timeoutMs = TIMEOUT_MS, retries = MAX_RETRIES }) {
  const p = PROVIDERS[provider];
  const modelId = model ?? p.model;
  if (provider === 'local' && !(url ?? p.url)) throw new Error('Local mode needs a server address.');
  if (provider === 'local' && !modelId) throw new Error('Local mode needs a model name.');
  const send = async (body) => {
    const res = await fetch(url ?? p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}
    return { res, text, json };
  };
  return async (state, questions) => {
    const body = JSON.stringify({ model: modelId, state, questions });
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await send(body);
      } catch (e) {
        if (attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
        throw new Error(e.name === 'TimeoutError' ? `${p.name} did not answer within ${timeoutMs / 1000} s.` : `Could not reach ${p.name}: ${e.message}`);
      }
      const { res, text, json } = r;
      if (res.ok && !json.error) return { answers: json.answers ?? {}, cost: provider === 'openrouter' ? json.usage?.cost ?? 0 : null };
      if (retryable(res.status) && attempt < retries) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(after > 0 ? Math.min(after * 1000, 60_000) : 500 * 2 ** attempt);
        continue;
      }
      // TypeSafe errors look like {detail: {error_type, message}} or {detail: "..."}; OpenRouter's like {error: {message}}.
      const d = (json.error?.message ?? json.error ?? json.detail?.message ?? json.detail ?? text.slice(0, 200)) || res.statusText || 'no details';
      const detail = typeof d === 'string' ? d : JSON.stringify(d);
      if (res.status === 401) throw new Error(`${p.name} rejected the key (401): ${detail}`);
      // Local servers: a 404 or 400 usually means the model is not downloaded or is not a decision model.
      if (provider === 'local' && (res.status === 404 || res.status === 400)) {
        throw new Error(`${p.name} -> ${res.status}: ${detail} (check the model name, and that it is a decision model the server supports at /v1/systemone)`);
      }
      throw new Error(`${p.name} -> ${res.status}: ${detail}`);
    }
  };
}

export function buildQuestions(points) {
  return Object.fromEntries(points.map((p) => [p.id, {
    type: 'score',
    instructions:
      `A speaker is talking live from a list of talking points, in their own words and in any order. ` +
      `\`transcript\` is what they have said so far (speech-to-text, so expect errors). ` +
      `How much has the speaker covered this talking point: "${p.text}"?`,
    criteria: CRITERIA,
  }]));
}

export const buildState = (transcript) => ({ transcript: transcript.slice(-MAX_TRANSCRIPT_CHARS) });

// Scores `points` (each {id, text}) against `transcript`. `jev(state, questions)` resolves to {answers, cost}.
export async function scorePoints(jev, transcript, points) {
  if (!points.length) return { scores: {}, cost: 0 };
  const { answers, cost } = await jev(buildState(transcript), buildQuestions(points));
  const scores = {};
  for (const p of points) {
    const a = answers[p.id];
    if (a) scores[p.id] = { score: a.score, confidence: a.confidence, probabilities: a.probabilities };
  }
  return { scores, cost };
}

export function parsePoints(text) {
  return text.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean)
    .map((t, i) => ({ id: `p${i}`, text: t }));
}
