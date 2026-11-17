# How it works

This page explains the moving parts, what this fork changed compared with the original IntelliPrompter, and the
security model of the local relay.

## The big picture

```
 your microphone
       |
       v
 +--------------------------------------------+        +-------------------------------+
 | Browser at http://127.0.0.1:8787           |        | Model server (any machine)    |
 |                                            |        |                               |
 |  speech recognition  -->  transcript       |        |  POST /v1/systemone           |
 |                              |             |        |  a decision model scores      |
 |  every 500 ms, if the        v             |        |  each open talking point      |
 |  transcript changed:   prompter.js         |        |  from 0 to 3                  |
 |  one request with the last 6,000 chars     |        |                               |
 |  and one Score question per open point     |        |                               |
 +----------------|---------------------------+        +---------------^---------------+
                  | POST /api/local (X-Local-Url: address)             |
                  v                                                    |
 +--------------------------------------------+   POST <address>/v1/systemone
 | server.js (the relay, same computer)       |-----------------------+
 | serves the page, checks the request comes  |
 | from its own page, forwards it             |
 +--------------------------------------------+
```

The page then reads each point's score from the answer and checks off the points that reach the threshold.
Checked points stay checked and are no longer sent.

## The request and the answer

One request per update holds everything. Each open talking point is one **Score** question with four levels:

```json
{
  "model": "your-decision-model",
  "state": { "transcript": "the last 6000 characters of what you said" },
  "questions": {
    "p0": {
      "type": "score",
      "instructions": "A speaker is talking live ... How much has the speaker covered this talking point: \"Where the emergency exits are\"?",
      "criteria": [
        "No mention of this topic at all",
        "Topic is mentioned but not expanded upon at all",
        "Topic is discussed",
        "Topic is thoroughly discussed"
      ]
    },
    "p1": { "...": "one question per open point" }
  }
}
```

The answer has, for every question name, a probability for each level, and a `score`, which is the
probability-weighted average of the level numbers (0 to 3). The numbers below are made up to show the shape:

```json
{
  "model": "your-decision-model",
  "answers": {
    "p0": {
      "type": "score",
      "score": 1.87,
      "confidence": 0.62,
      "probabilities": { "0": 0.05, "1": 0.18, "2": 0.57, "3": 0.20 }
    }
  },
  "usage": { "input_tokens": 480, "output_tokens": 0 }
}
```

The page checks off a point when `score` reaches the threshold. `confidence` is shown but not used. This is the
shape documented for [Ollama's `/v1/systemone`](https://docs.ollama.com/api/systemone); other servers that
implement the same API should match it.

## Timing

- `TICK_MS` (500 ms, in `index.html`) is how often the page looks for new speech.
- Only one request is in flight at a time, and only when the transcript changed. That keeps answers in order and
  keeps load flat however long you talk.
- Only the last 6,000 characters go out (`MAX_TRANSCRIPT_CHARS` in `prompter.js`), so a 20-minute talk costs
  the same per request as a 2-minute one.
- Timeouts and retries: 10 seconds per attempt and up to two retries with backoff, as the original does. The
  **Test connection** button uses a 120 second timeout and no retries, so a cold model has time to load.

## What this fork changed

The goal is the smallest change that makes the whole app run against a local model. Everything else is
the original code.

| File | Change |
| --- | --- |
| `prompter.js` | New `local` provider. `makeJev` accepts a `model` (the local model name), and optional `timeoutMs` and `retries`. New helper `systemOneUrl()` that turns what you type into the full endpoint URL. A clearer message for a 404 or 400 from a local server. The questions, levels, scoring and parsing are unchanged. |
| `server.js` | New `POST /api/local` route that forwards a request to the model server named in the `X-Local-Url` header (or `LOCAL_URL` in `.env`). `/api/config` also reports the `.env` defaults. The relay's error message includes why a connection failed. The TypeSafe relay is unchanged apart from sharing the same origin check. |
| `index.html` | A box for server address and model, a Test connection button, remembered settings, a "Change server" button, and wording that says "local" where the original says "Jev". |
| `replay.js` | `--local=` and `--model=` (or `LOCAL_URL` and `LOCAL_MODEL`), median and slowest call time. |
| `.env.example`, `package.json` | New settings, `npm test` and `npm run mock`. |
| `tools/mock-systemone.js`, `test/` | A mock System One server and the automated tests. |
| `docs/`, `README.md` | This documentation. |

Unchanged on purpose: the license and copyright notice, the scoring prompt and levels, the check-off rule, the
OpenRouter and TypeSafe paths, and the credits to Allie at TypeSafe and to the original repository.

## Security model of the relay

`server.js` listens only on `127.0.0.1`. The local route can make your computer send a request to any address
named in `X-Local-Url`, so it is locked to its own page, the same way the original locks the TypeSafe key relay:

- The request's `Host` must be `127.0.0.1:<port>` or `localhost:<port>`. This blocks DNS rebinding, where a
  hostile website points its own name at your computer.
- If the request has an `Origin`, it must be the page itself.
- The body must be `application/json`. A cross-site page cannot send that without a CORS preflight, and this
  server never approves a preflight.
- Only `http` and `https` addresses are accepted, bodies over 1 MB are refused, and an upstream call gives up
  after 120 seconds.
- `LOCAL_API_KEY`, if you use one, stays in `.env` on the relay. The page never sees it.

The automated tests cover the wrong-origin, wrong-content-type and wrong-host cases.
