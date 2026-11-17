# Local mode: setup guide

Local mode lets IntelliPrompter score your talking points with a **decision model that you run yourself**, on
the same computer or on another machine on your network, instead of calling Jev through OpenRouter or TypeSafe.
There is no API key, no account, no per-call cost, and your transcript never leaves your network.

This guide takes you from nothing to a working setup. For how it works inside, see
[ARCHITECTURE.md](ARCHITECTURE.md). If something goes wrong, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## What you need

1. **Node 18 or newer** on the computer where you open the page (the one with your microphone and camera).
   Nothing to install: `npm start` is just `node server.js`.
2. **A model server** that offers the System One API, `POST /v1/systemone`, with a **decision model** loaded.
   Servers known to offer it (see the notes on status at the end of this section):

   | Server | Notes |
   | --- | --- |
   | [Ollama](https://ollama.com) | Version 0.35.0 or later. [Docs](https://docs.ollama.com/capabilities/decision) |
   | [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` | The endpoint was added on 2 October 2026, in a build that was a pre-release at the time, so old builds and old Docker images do not have it. |
   | [LM Studio](https://lmstudio.ai/docs/developer/jev-compat/systemone) | Has a Jev-compatible `/v1/systemone` endpoint. |

3. **A decision model, not a chat model.** A decision model does not write text. It answers typed questions with
   probabilities, in one pass, which is why it is fast. A normal chat model such as Qwen, Gemma or Llama will
   not work here, even though the same server may be serving it. Ask your server for a decision model by its
   name (for example `ollama pull <name>`, or a GGUF from the
   [Hugging Face decision-model collection](https://huggingface.co/ggml-org/OpenJev-GGUF) for llama.cpp).

**Status of server compatibility.** This fork was written against the published System One request and
response format, and its automated tests run against a mock server that follows that format
(`npm test`). The author has not yet verified every server in the table with real hardware. If a server answers
in a slightly different shape, [open an issue](https://github.com/OpenArmorDesign/intelliprompter-local/issues)
with the response body and it can be fixed in `prompter.js`.

## Quick start

1. **Start your model server** and make sure it can be reached from the computer you record on.
   - Ollama: `ollama pull <decision-model>`, then make sure the server listens on your network if it is on
     another machine (`OLLAMA_HOST=0.0.0.0` before `ollama serve`, or the equivalent in your service file).
   - llama.cpp: `llama-server -hf <decision-model-gguf> --host 0.0.0.0 --port 8081`.
   - LM Studio: load the model and turn on the local server in its developer settings.
2. **Get this fork and start it** on the computer you record on:
   ```sh
   git clone https://github.com/OpenArmorDesign/intelliprompter-local.git
   cd intelliprompter-local
   npm start        # http://127.0.0.1:8787/
   ```
3. **Open http://127.0.0.1:8787/** in your browser. You will see a box titled "Or use a model you run yourself".
4. **Enter the server address and the model name**, for example `192.168.1.50:11434` and the model's name as
   your server lists it. Press **Test connection**. The first test can take several seconds, because the server
   may have to load the model into memory. It should say "Connected" and show a score for a simple greeting.
5. **Press "Use this server"**, type your talking points, and press Start. The page remembers the server for
   next time.

### Skip the page settings with `.env`

If you always use the same server, put it in `.env` and the page starts in local mode by itself:

```sh
cp .env.example .env
# then edit .env:
LOCAL_URL=192.168.1.50:11434
LOCAL_MODEL=your-decision-model
```

## Settings reference

| Setting | Where | What it is |
| --- | --- | --- |
| Server address | page field, `LOCAL_URL`, `--local=` for `replay.js` | Where the model server is. `host:port`, `http://host:port`, or a full `.../v1/systemone` URL all work. A missing `http://` is added. Only `http` and `https` are accepted. |
| Model | page field, `LOCAL_MODEL`, `--model=` | The model name as the server knows it. |
| API key (optional) | `LOCAL_API_KEY` in `.env` | Only if you started your model server with an API key. Sent as `Authorization: Bearer ...`. It is never entered on the page and never leaves the relay. |
| Port of this page | `PORT` | Default 8787. |
| Check-off threshold | slider on the page | 0.5 to 2.5, default 1.5. Models score a little differently, so tune it: see [TUNING.md](TUNING.md). |

The page address is checked against `.env` in this order: `LOCAL_URL` plus `LOCAL_MODEL` (local mode),
then `TYPESAFE_API_KEY`, then what you used last time in this browser.

## Why the page goes through a small local server

Browsers do not let a web page call another address freely (CORS), and they only allow microphone access on
`localhost` or HTTPS. IntelliPrompter solves both with `server.js`: you open the page at
`http://127.0.0.1:8787` (a secure origin as far as microphone permission goes), and the page sends its scoring
requests to the same address. `server.js` forwards them to your model server. So:

- The model server needs **no CORS settings** and no certificate.
- The microphone works without HTTPS, because the page is on `127.0.0.1`.
- The model server can be anywhere you can reach from this computer.
- The page hosted on GitHub Pages cannot reach your network, so local mode is only available from `npm start`.

Traffic between your computer and the model server is plain `http` unless you put `https` in the address. On a
home network that is usually fine. Do not point it across the internet without HTTPS.

## Privacy: what goes where

| Data | Where it goes |
| --- | --- |
| Your transcript (the last 6,000 characters, every half second while it changes) | Only to the model server address you entered. |
| Your talking points | Same place, inside each question. |
| Your microphone audio | **By default, the browser's built-in speech recognition sends it to the browser vendor's service** (the original README notes that Chrome sends it to Google). Choose **My own speech server** under Speech to text and it goes only to the address you enter: see [SPEECH-TO-TEXT.md](SPEECH-TO-TEXT.md). "Start without microphone" (type or paste) sends no audio anywhere. |
| Your settings | Saved in your browser's local storage, on your computer. |

## Which browser

The built-in speech recognition exists in Chrome, Edge and Safari. **Firefox does not offer it by default**, so in
Firefox either choose **My own speech server** (see [SPEECH-TO-TEXT.md](SPEECH-TO-TEXT.md)) or use "Start without
microphone". Everything else works in Firefox.

## Speed and memory

- **First call after idle is slower.** Many servers unload a model after some minutes without use. Press
  **Test connection** before you start recording to load it. Your server's documentation says how to keep a model
  loaded longer (for Ollama, the keep-alive setting).
- **The model itself is quick.** Decision models answer in one forward pass. The delay you notice is mostly the
  speech-to-text (a speech server of your own adds a pause detector and transcription time) and the half-second update interval (`TICK_MS` in `index.html`).
- **Graphics memory.** A small decision model needs a few GB. If you share a graphics card with another model,
  unload the other model while you record.

## Using more than one model

Change the **Model** field and press "Use this server" again, or run `replay.js` with `--model=` to compare
models on the same transcript before you pick one. See [TUNING.md](TUNING.md).
