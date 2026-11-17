# Speech to text on your own server

By default the page uses your browser's built-in speech recognition, exactly as the original does. In Chrome and
Edge that sends your microphone audio to the browser vendor, and Firefox does not offer it at all. This fork adds
a second choice: send the audio to a speech-to-text server you run yourself (NVIDIA Parakeet, a Whisper server,
or anything else with the same API). Nothing about the old paths changes. You pick one on the setup screen.

| Choice | Needs | Where audio goes |
| --- | --- | --- |
| Browser speech recognition (default) | Chrome, Edge or Safari | The browser vendor |
| My own speech server | `npm start` and a speech server | Only the address you enter |
| No microphone (type or paste) | Nothing | Nowhere |

## What your speech server must offer

The OpenAI-style transcription route:

```
POST /v1/audio/transcriptions        multipart form: file (WAV), model, response_format=json
-> {"text": "..."}
```

Many servers implement it: faster-whisper-server and similar Whisper wrappers, whisper.cpp's server, Speaches,
and most Parakeet containers that advertise "OpenAI compatible". If yours uses a different path, type the full
URL (for example `http://box:5092/transcribe`) and the page keeps it as typed.

**Status.** The automated tests and a headless-browser test use a mock server that follows this API. It has also been
used by hand with a real Parakeet server (the `parakeet-tdt-0.6b-v3` model in a CPU Docker container), through a
laptop microphone over wifi, where it transcribed well. It has not been tried with a Whisper server. If your server
answers with something the page cannot read, the error message shows what came back. Please report it.

**The model name may be required.** The page sends `whisper-1` when the Model field is empty, which many servers
accept for anything. Some, including the Parakeet container above, refuse a name they do not serve and answer with
`Unknown model 'whisper-1'. Available models: [...]` and a list. Copy one of the listed names into the Model field.

## Setup

1. Run your speech server and note its address and port (for example `192.168.1.50:5092`).
2. Start the page with `npm start` and open `http://127.0.0.1:8787/`.
3. Pick a scoring mode so the setup screen appears. Under **Speech to text**, choose **My own speech server**.
4. Enter the address, and the model name if your server needs one. Press **Test speech server**. It records four
   seconds from your microphone, sends them, and shows what the server heard and how long it took.
5. Start with the microphone as usual.

Or set `STT_URL`, `STT_MODEL` and `STT_API_KEY` in `.env` (see `.env.example`). The page then starts with the
speech server selected.

| Setting | Page field | `.env` |
| --- | --- | --- |
| Address and port | Speech server address | `STT_URL` |
| Model name (default `whisper-1`) | Model | `STT_MODEL` |
| API key, only if your server needs one | not on the page | `STT_API_KEY` |

The speech server is independent of the scoring mode. You can use the paid API with your own speech server, a
local decision model with browser speech recognition, or any other mix.

## How it works

Most speech servers take a finished clip, not a live stream, so the page cuts your talking into clips.

1. The microphone is captured in the page (`getUserMedia`, which works on `http://127.0.0.1`) and converted to
   16 kHz mono.
2. A simple loudness detector finds when you are speaking. While you talk, the page sends everything since you
   started the phrase about every 1.2 seconds. The text that comes back is a quick **partial** guess, shown in
   the transcript right away so scoring can start before you finish the sentence.
3. When you pause for about 0.7 seconds, or talk for 20 seconds without pausing, the page sends the whole phrase
   once more as a **final**. The final replaces the partials for that phrase.
4. One request is in flight at a time. If the server is slower than you talk, partials are skipped but finals are
   never dropped and always arrive in order.
5. The text joins the same transcript the browser recognition feeds, so scoring is unchanged.

Audio goes from the page to the relay (`server.js`, on your computer), which forwards it to the speech server.
That is why there is no certificate to set up and no CORS problem, and why it works in Firefox: the page only
captures audio and posts it to `http://127.0.0.1`.

Expect text to lag your voice by roughly the time your server needs to transcribe about a second of audio, plus the
pause detection. On a GPU this is usually well under a second. A CPU-only model is slower, and the first request
after idle can include loading the model.

## Limits and notes

- The pause detector is loudness based. A noisy room can keep it from ever seeing a pause (the 20 second cut
  still applies) and a very quiet voice can be missed. Use **Test speech server** and watch the transcript.
- Clips are limited to about 8 MB (roughly four minutes), far above the 20 second maximum the page sends.
- The relay locks `/api/stt` to its own page, with the same checks as the other routes (see ARCHITECTURE.md).
  Audio must be sent as `audio/wav`, which a web page on another site cannot do without a preflight that is
  never approved.
- Your audio is not stored by this project. Whether your speech server keeps it is up to that server.
- Words a model gets wrong reach the decision model as written. Specific point wording helps (see TUNING.md).
