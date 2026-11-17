# IntelliPrompter (local mode fork)

> **This is a fork of [finetuningsingh/intelliprompter](https://github.com/finetuningsingh/intelliprompter)** that
> adds a **local mode**: score your talking points with a decision model that **you run yourself** (Ollama,
> llama.cpp's `llama-server`, LM Studio, or any server that offers `/v1/systemone`), with no API key, no account
> and no per-call cost. Everything the original does still works. The idea, design and original code are credited
> below and are unchanged; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for exactly what this fork changes.
>
> **Start here:** [docs/LOCAL-MODE.md](docs/LOCAL-MODE.md) (setup in five steps).
> More: [how it works](docs/ARCHITECTURE.md) · [choosing a model and tuning](docs/TUNING.md) ·
> [troubleshooting](docs/TROUBLESHOOTING.md) · [roadmap](docs/ROADMAP.md) ·
> [staying in sync with the original](docs/UPSTREAM.md)


A teleprompter of talking points, not a script. You talk in your own words
and in any order, and each point is checked off once you have covered it.

**The original's hosted page:** https://finetuningsingh.github.io/intelliprompter/ (paste an
[OpenRouter key](https://openrouter.ai/keys); for a TypeSafe key, run it
locally, see below). It has no local mode: a page on the web cannot reach a model on your own network, so to use
a local model, run this fork with `npm start`.

The idea and design come from Allie at [TypeSafe](https://typesafe.ai). She
built the original IntelliPrompter so she would not forget anything in the
long list of announcements that opens her stage shows. She demoed it at a
TypeSafe Discord town hall. It was her first app with AI inside, and running it
on LLMs cost about $40 an hour. With
[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) it
costs at most about $0.50 an hour (two calls a second at about $0.00007 each),
and less in practice, since calls stop while you are silent and checked
points are no longer sent. This is an independent rebuild of her design, as
she described it.

## How it works

Every talking point is a separate **Score** question for a decision model (Jev, or a local model through the same System One API), and all the open
points are scored in parallel, in one request, against everything you have
said so far:

```js
state: { transcript: "…what you have said so far…" }
questions: {
  p0: { type: 'score', instructions: 'How much has the speaker covered this talking point: "Where the emergency exits are"?',
        criteria: ['No mention of this topic at all',
                   'Topic is mentioned but not expanded upon at all',
                   'Topic is discussed',
                   'Topic is thoroughly discussed'] },
  p1: { … one per open point … },
}
```

The model returns a `score` from 0 to 3 for each point: the probability-weighted
level, so it can fall between levels. The code owns the rules:

- A point is **checked off when its score reaches the threshold** (1.5 by
  default: between "mentioned" and "discussed"; adjustable on the page from
  0.5 to 2.5). At 1.0, a passing mention was enough to check a point off, for
  example saying "performers" before saying anything about tipping them.
- **Order does not matter**, because every open point is scored on every call.
- **Checked points stay checked** and are no longer sent. You can also click a
  point to check or uncheck it yourself.
- **Confidence is shown but ignored**, as in Allie's version. It measures how
  concentrated the model's probabilities are, not whether a point was covered.
- The page sends an update **every 500 ms**, but only when the transcript has
  changed and no request is already waiting. Only the last 6,000 characters
  are sent.

The page's "How the decision model scores each point" section explains Score step by step and
shows the model's latest answer for every point: the probability of each level and
the sum that gives the score.

The shared logic is in [`prompter.js`](prompter.js). Allie used ElevenLabs for
live transcription; this page uses the browser's built-in speech recognition
(Chrome, Edge or Safari). "Start without microphone" lets you type or paste
what you say instead.

## Local mode (this fork)

Instead of a key, point the page at a model server you run:

```sh
git clone https://github.com/OpenArmorDesign/intelliprompter-local.git
cd intelliprompter-local
npm start                # http://127.0.0.1:8787/
```

Open the page, enter the **server address** (for example `192.168.1.50:11434`) and the **model name**, press
**Test connection**, then **Use this server**. Or set `LOCAL_URL` and `LOCAL_MODEL` in `.env` and the page starts
in local mode. The server must offer the System One API (`POST /v1/systemone`) with a **decision model** loaded,
not a chat model. Works with Ollama 0.35+, recent llama.cpp `llama-server` builds and LM Studio. Details,
network setup and privacy notes: [docs/LOCAL-MODE.md](docs/LOCAL-MODE.md).

| Setting | Page field | `.env` | `replay.js` |
| --- | --- | --- | --- |
| Server address | Server address | `LOCAL_URL` | `--local=` |
| Model name | Model | `LOCAL_MODEL` | `--model=` |
| Server API key (only if your server needs one) | not on the page | `LOCAL_API_KEY` | uses `LOCAL_API_KEY` |
| Speech server address | Speech server address | `STT_URL` | not used |
| Speech server model | Model | `STT_MODEL` | not used |
| Speech server API key (only if needed) | not on the page | `STT_API_KEY` | not used |

Things to know:

- **Your settings are remembered on disk.** When you press **Use this server**, or enter a speech server, the page
  also writes the addresses and model names to the `.env` file next to the server (created with owner-only
  permissions). So they survive restarts, cleared cookies and private windows with no file editing. API keys are
  never written by the page. Delete the lines in `.env` to forget them.
- **The check-off threshold is remembered too.** Move the "Check off at" slider and the new value is saved as
  `THRESHOLD` in `.env`, and becomes the starting value next time (default 1.5). You can also set it by hand there,
  from 0.5 to 2.5.

- **Speech-to-text is your choice.** By default the page uses the browser's built-in speech recognition, as the
  original does (it sends audio to the browser vendor, and Firefox does not offer it). Under **Speech to text** on
  the setup screen you can instead enter the address and port of your own speech server, such as Parakeet or a
  Whisper server (`STT_URL` in `.env`). Typing or pasting ("Start without microphone") also keeps everything on your
  network. See [docs/SPEECH-TO-TEXT.md](docs/SPEECH-TO-TEXT.md).
- **Status.** The automated tests (`npm test`) run against mock servers. By hand it has been used with Liquid AI's
  `d1:3b` on Ollama 0.40.16 (an RTX 3070 Ti, about 150 ms per request once loaded) and a Parakeet speech server.
  Reports from other servers and models are welcome: please include the response body if something does not parse.
- **Tune it.** Models score a little differently from Jev. [docs/TUNING.md](docs/TUNING.md) shows how to compare
  models and set the threshold with `replay.js`.

## Keys: OpenRouter or TypeSafe

Jev is available two ways, with the same questions and answers:

| Key | Endpoint | Works on the hosted page | Works locally |
| --- | --- | --- | --- |
| OpenRouter (`sk-or-…`) | `openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.13` | yes | yes |
| TypeSafe | `api.typesafe.ai/v1/systemone`, model `jev-1.13.0` | no | yes |

The page tells the two apart by the `sk-or-` prefix. api.typesafe.ai does not
accept calls from web pages (CORS), so a TypeSafe key needs the small local
server in `server.js`. The server serves the page and passes the page's
TypeSafe requests on to the API. OpenRouter calls always go straight from your
browser to openrouter.ai.

Both paths are pinned to Jev 1.13, the version the 1.5 threshold was tuned on;
TypeSafe's docs advise pinning a version rather than the moving `jev-latest`
alias once thresholds are tuned. Requests follow TypeSafe's SDK defaults: a
10-second timeout, and up to two retries with backoff (honoring `Retry-After`)
on timeouts, 408, 429, 529 and other server errors. After further failures the
page waits longer each time, up to 30 seconds. A rejected key (401) stops the
requests.

### Your key is stored only in your browser

- **Stored only in your browser.** A key you paste is kept in the tab (session
  storage) and cleared when you close it. If you tick "Remember on this device",
  it goes in local storage instead, until you press "Forget key".
- **Sent only to the service that bills it.** An OpenRouter key goes from the
  browser straight to openrouter.ai. A TypeSafe key goes to `server.js` on your
  own computer, which passes it on to api.typesafe.ai and doesn't store or log
  it. With the local server you can also put `TYPESAFE_API_KEY` in `.env`, and
  then the page never sees a key at all. The server only relays requests from
  its own page, so other websites open in your browser can't spend that key.
- **No server of ours.** The hosted page is two static files on GitHub Pages,
  with no backend, no analytics and no third-party scripts. You can check this
  in your browser's developer tools (Network tab) or by reading `index.html`
  and `prompter.js`.

Each request also carries your transcript to the same service. In Chrome,
speech recognition sends your microphone audio to Google.

## Run locally

Requires Node 18+. There is nothing to install.

```sh
git clone https://github.com/OpenArmorDesign/intelliprompter-local.git
cd intelliprompter-local
cp .env.example .env    # optional: add TYPESAFE_API_KEY and/or OPENROUTER_API_KEY, or LOCAL_URL and LOCAL_MODEL
npm start               # http://127.0.0.1:8787/
```

The microphone needs `localhost` or HTTPS, so open the page through the server
rather than as a file.

### Replay a talk in the terminal

```sh
npm run replay                                   # examples/show-opening-*.txt
node replay.js --every=10 --threshold=1.5
node replay.js --transcript=talk.txt --points=points.txt
```

This feeds a transcript to Jev 15 words at a time, as live speech would
arrive, and prints when each point is checked off. It uses a local model if
`--local` or `LOCAL_URL` is given, otherwise `TYPESAFE_API_KEY` if it is set, and
`OPENROUTER_API_KEY` otherwise.

```sh
node replay.js --local=192.168.1.50:11434 --model=your-decision-model
```

### Tests

```sh
npm test            # runs against a mock model server; needs no GPU, key or network
npm run mock        # starts that mock server by itself, to try the page without a real model
```

## Results (2026-09-19, OpenRouter, `typesafe/jev-1.13`, threshold 1.5)

`npm run replay` on the example show opening (383 words, 7 points). The talk
covers the points in a different order from the list and never mentions the
bar:

| Point | Checked at word | Score |
| --- | ---: | ---: |
| Welcome everyone and introduce yourself as the host | 30 | 1.97 |
| Where the emergency exits are | 120 | 1.80 |
| Phones on silent, no flash photography | 165 | 1.70 |
| Tip the performers, and bring cash | 255 | 2.38 |
| Thank the theater and the staff | 315 | 2.00 |
| Introduce the first performer | 360 | 1.91 |
| The bar is open during intermission | never | best 0.03 |

This took 26 calls averaging 236 ms and cost $0.0011 in total. On a longer
recorded talk (1,581 words, 7 points), all 6 points covered were checked off,
and the point never mentioned peaked at 0.23. That run took 106 calls
averaging 252 ms, for $0.0074 in total.

## Credits and license

- The idea and design of IntelliPrompter are Allie's at [TypeSafe](https://typesafe.ai).
- The original code is [finetuningsingh/intelliprompter](https://github.com/finetuningsingh/intelliprompter).
- Local mode was added in this fork, [OpenArmorDesign/intelliprompter-local](https://github.com/OpenArmorDesign/intelliprompter-local).

[MIT](LICENSE), unchanged from the original.
