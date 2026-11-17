# Roadmap and ideas

Local speech-to-text is now implemented (see [SPEECH-TO-TEXT.md](SPEECH-TO-TEXT.md)). This page records what
would improve it and the rest of local mode, so the next step is easy to pick up.

## 1. Speech-to-text, next steps

- **Test against real servers.** The feature is tested against a mock that follows the OpenAI-style
  `/v1/audio/transcriptions` API. Reports from Parakeet and Whisper servers are the most useful thing right now.
- **True streaming.** If a speech server offers a WebSocket or streaming API, partial text could arrive sooner than
  the current clip-every-1.2-seconds approach. The `createSttSession` function in `stt.js` is the seam to replace.
- **A better pause detector.** The current one is loudness based and needs no model. A small voice-activity model
  would cope better with noisy rooms.
- **A microphone level meter** on the setup screen, to help set up a room.
- **An OBS plugin or overlay** that shows the checklist on stream or on a second screen.

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
