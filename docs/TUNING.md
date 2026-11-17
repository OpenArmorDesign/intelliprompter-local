# Choosing a model and tuning the threshold

Different decision models score the same sentence a little differently. Before you rely on one on camera,
measure it on your own speech. `replay.js` is built for that.

## What the score means

Each open talking point gets a score from 0 to 3, the probability-weighted level:

| Level | Meaning |
| --- | --- |
| 0 | No mention of the topic at all |
| 1 | Mentioned, not expanded on |
| 2 | Discussed |
| 3 | Thoroughly discussed |

A point is checked off when its score reaches the **threshold** (slider on the page, default 1.5, halfway
between "mentioned" and "discussed"). The default was tuned on Jev 1.13. A different model may sit higher or lower,
so expect to move it.

- **Points get checked too early** (a passing word is enough): raise the threshold, for example to 1.8.
- **Points never get checked even though you covered them**: lower it, for example to 1.2.

## Compare models with `replay.js`

`replay.js` feeds a transcript to the model a few words at a time, as live speech would arrive, and reports when
each point is checked off.

1. **Make a transcript and a points list from real talks.** Record yourself talking from a list of points
   (a phone voice memo is fine), get the text, and save it as `my-talk.txt`. Put the points in `my-points.txt`,
   one per line. Include one point you will **not** talk about, to see what a miss looks like.
2. **Run each model on the same files:**
   ```sh
   node replay.js --local=192.168.1.50:11434 --model=model-a --transcript=my-talk.txt --points=my-points.txt
   node replay.js --local=192.168.1.50:11434 --model=model-b --transcript=my-talk.txt --points=my-points.txt
   ```
   Useful options: `--every=10` (words between calls, smaller is closer to live), `--threshold=1.5`.
3. **Compare what matters on camera:**
   - **Misses**: points you covered that never got checked.
   - **False checks**: points checked before you covered them, or the point you never mentioned.
   - **Lag**: how many words after you finished a point it was checked off (the printed word number).
   - **Speed**: the summary line shows average, median and slowest call time.

   Pick the model with the fewest misses and false checks, then break ties on speed.
4. **Tune the threshold** with `--threshold=` on the same files until misses and false checks are both low.
   Then set the slider on the page to that value.

The `examples/` folder has a sample show opening and its points. It is a good first run to confirm the
connection works, but tune on your own speech, since your phrasing and the way speech-to-text mangles it are what
matter.

## Record your results

Keep a table in your own notes, or add it here with a pull request:

| Model | Server | Hardware | Misses | False checks | Median call | Best threshold |
| --- | --- | --- | --- | --- | --- | --- |
| (example) model-a | Ollama | your GPU | 0 of 6 | 0 | 40 ms | 1.4 |

## Other knobs

- **How the levels are worded.** `CRITERIA` in `prompter.js` defines what each level means to the model. Making
  level 2 stricter ("Topic is discussed with at least one concrete detail") is a cheap way to cut false checks.
- **How often it updates.** `TICK_MS` in `index.html`.
- **How much of the talk is sent.** `MAX_TRANSCRIPT_CHARS` in `prompter.js`.
- **Wording of your points.** Short, specific points score better than vague ones. "Say where the emergency exits
  are" beats "Safety".
