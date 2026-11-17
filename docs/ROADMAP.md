# Roadmap and ideas

Nothing on this page is implemented yet. It records what would make local mode complete, and the thinking behind
it, so the next step is easy to pick up.

## 1. Local speech-to-text (the main missing piece)

**Why.** Local mode keeps your transcript on your network, but the microphone audio still goes to the browser
vendor's speech service, because the page uses the browser's built-in speech recognition. That built-in
recognition also does not exist in Firefox, and it needs a secure page. A speech-to-text server of your own fixes
all three.

**How it would work, at a high level**

1. The page captures microphone audio (`getUserMedia`, which works on `http://127.0.0.1`) and cuts it into small
   chunks, a fraction of a second each, as 16 kHz mono audio. The audio is a continuous stream, not a whole
   recording uploaded at the end.
2. The chunks go to `server.js` (a new route, for example `/api/stt`), which forwards them to the speech-to-text
   server over your network. Going through the relay again means no certificate and no CORS settings, and it
   works in Firefox because the page only needs to capture audio.
3. The speech-to-text server returns text as you talk: quick partial guesses while you are mid-sentence, then
   settled text when you pause. The page feeds that into the same transcript the built-in recognition feeds today.
4. Everything after that is unchanged: the transcript tail goes to the decision model, points get checked off.

**Open questions**

- Whether the speech server supports true streaming (a WebSocket, for example) or only takes whole clips. If only
  clips, the page sends short overlapping windows every second or so and accepts a delay of one to two seconds.
- Detecting pauses so text is finalized promptly.
- Which servers to document first. The author plans to use NVIDIA Parakeet; Whisper-based servers are the other
  obvious choice.
- A **Test microphone** button, like the existing **Test connection**.

## 2. Smaller improvements

- **A setting for the update interval** (today `TICK_MS = 500` in `index.html`), for the shortest delay a server can
  keep up with.
- **Compare models in the page**: score the same live speech with two models side by side, to choose by eye.
- **Remember the threshold per model.**
- **A warm-up on page load** so the first call after idle is not slow.
- **A `keep_alive` option** for servers that support it, so the model stays loaded.
- **More servers verified** in [LOCAL-MODE.md](LOCAL-MODE.md), with real response bodies as test fixtures.

## 3. OBS

The checklist is useful while recording, and the recording software is already open. Two routes, in order of
effort:

1. **A browser dock or source.** OBS can show a web page. A compact, read-only view of the checklist at its own
   address (for example `/obs`), served by the same `server.js`, could sit in a dock beside the preview. No plugin
   needed.
2. **A real plugin.** Marker or chapter creation when a point is checked off, scene hints, or a hotkey to toggle
   a point. That would be a separate project that talks to `server.js`.

## 4. Upstream

The changes are kept small and optional so that the local provider could be offered to the original project as a
pull request. See [UPSTREAM.md](UPSTREAM.md).
