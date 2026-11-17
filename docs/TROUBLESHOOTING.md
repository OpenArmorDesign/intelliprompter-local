# Troubleshooting

Find the message you see, then the likely cause.

## Messages in the page

| Message | Cause and fix |
| --- | --- |
| `Relay failed: fetch failed (ECONNREFUSED)` | Nothing is listening at the address you entered. Check the model server is running, the port is right, and, if it is on another machine, that it listens on the network (not only `localhost`) and the firewall allows the port. |
| `Relay failed: fetch failed (ENOTFOUND)` or `(EAI_AGAIN)` | The host name does not resolve. Use the IP address, or fix the name. |
| `Relay failed: ... (no answer within 120 s)` | The server accepted the connection but never answered. It may be overloaded or still loading the model. |
| `Local server -> 404: ... (check the model name, ...)` | The model name is wrong, or the model is not downloaded on that server, or the server is too old to have `/v1/systemone` (Ollama before 0.35, llama.cpp builds before October 2026). A 404 for the route itself looks the same as a missing model, so read the text after the colon. |
| `Local server -> 400: ...` | Usually a model that is not a decision model, or a request the server rejects. Check the model is a decision model. |
| `Local server rejected the key (401)` | Your model server wants an API key. Put it in `.env` as `LOCAL_API_KEY`, restart `npm start`, and reload the page. |
| `Local server did not answer within 10 s.` | The first call after idle can include loading the model. Press **Test connection** first. If it keeps happening, the server is too slow or busy. |
| `The server answered, but not with a score` | The server returned something other than a score answer. Is it a decision model? Is it a server that really implements `/v1/systemone`? |
| `The relay only accepts requests from its own page.` | You opened the page some other way (a file, another port, another host name). Open `http://127.0.0.1:8787/` after `npm start`. |
| "Local mode needs the small local server" (greyed out boxes) | You are on a hosted copy of the page. Run `npm start` and use the address it prints. |
| `Microphone access was blocked` | Allow the microphone in the address bar. It only works on `localhost` or HTTPS, so use `http://127.0.0.1:8787/`, not your computer's network address. |
| "This browser has no built-in speech recognition" | Use Chrome, Edge or Safari, choose **My own speech server** (see [SPEECH-TO-TEXT.md](SPEECH-TO-TEXT.md)), or press "Start without microphone" and type or paste. |
| `Speech server -> 404 ...` | The model name is wrong, or the server does not have that route. Check the model name, and that the server offers `POST /v1/audio/transcriptions` (or enter the full URL of its route). |
| `Speech server -> 401 ...` | The speech server wants an API key. Put it in `.env` as `STT_API_KEY`, restart `npm start`, reload. |
| `Relay failed ... ECONNREFUSED` on a speech test | Nothing is listening at that address and port, or a firewall blocks it. Check the address from the computer running `npm start`. |
| The transcript never fills, but the test works | The pause detector may not hear a pause, or the microphone level is very low. Speech still arrives every 20 seconds at most. Try a quieter room or a closer microphone. |
| Words appear, then change | That is expected: partial guesses are replaced by the final text when you pause. |

## Behavior

- **Scores are always low, even when I cover the point.** Check the point wording is specific. Try `replay.js`
  on a recording and read the scores (see [TUNING.md](TUNING.md)). Lower the threshold. Consider a different model.
- **Scores are high for things I did not say.** Raise the threshold, or make the level wording stricter.
- **A point is checked when I mention a related word.** Same fix. Reword the point to be more specific.
- **There is a pause before checkmarks appear.** Part of that is speech-to-text, which finalizes text after
  you pause. The model itself usually answers in tens of milliseconds. See "Speed and memory" in
  [LOCAL-MODE.md](LOCAL-MODE.md).
- **It stopped updating.** The page waits 2, 4, 8, ... up to 30 seconds after repeated failures. The error line
  says when it will retry. Fix the cause, then press Reset.

## Checking the model server by hand

From the computer you record on, with `curl` (replace the address and model):

```sh
curl -sS http://192.168.1.50:11434/v1/systemone -H 'Content-Type: application/json' -d '{
  "model": "your-decision-model",
  "state": "Welcome everyone, glad you could make it tonight.",
  "questions": { "p0": { "type": "score",
    "instructions": "How much has the speaker covered this talking point: welcome everyone?",
    "criteria": ["Not at all", "Mentioned", "Discussed", "Thoroughly discussed"] } } }'
```

You should get JSON with `answers.p0.score`. If this works but the page does not, the problem is between the page
and `server.js`. If this fails, the problem is the model server or model, and the page cannot fix it.

Run `npm test` to confirm the app itself is healthy: it uses a mock server and needs no GPU.
