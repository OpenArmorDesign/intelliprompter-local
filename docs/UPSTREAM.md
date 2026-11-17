# Staying in sync with the original, and sending changes back

This repository is a fork of [finetuningsingh/intelliprompter](https://github.com/finetuningsingh/intelliprompter).
The idea and design are Allie's at [TypeSafe](https://typesafe.ai); the original code, license and copyright
belong to its author. They are kept as they were.

## Getting the original's new changes

```sh
git remote add upstream https://github.com/finetuningsingh/intelliprompter.git   # once
git fetch upstream
git merge upstream/main
npm test
```

Most likely to conflict: `index.html` (the key panel and the page script), `server.js` and `prompter.js`. Each
local-mode addition is marked with "LOCAL MODE" or "local" in a comment, so it is easy to find.

## Offering local mode to the original project

Pull requests are the way to send changes upstream, and it is the original author's call whether to take them.
If you want to try:

1. Make a branch from the original's `main`, not from this fork's `main`:
   ```sh
   git fetch upstream
   git switch -c local-provider upstream/main
   ```
2. Bring over only the code changes: `prompter.js`, `server.js`, `index.html`, `replay.js`, `.env.example`, and the
   tests with the mock if the author wants them. Leave the fork's README wording and the `docs/` folder behind, or
   shrink them to a short README section.
3. Keep the pull request about one thing: "add a `local` provider for servers that implement `/v1/systemone`".
   Explain that it does not change the Jev paths.
4. Open it from GitHub's "Contribute" button on your fork, or with `gh pr create`.

Do not commit your `.env` or any keys.

## Credits to keep

- The `LICENSE` file, unchanged.
- The credit to Allie at TypeSafe and to the original repository in the README and on the page.
- A line saying this is a fork with a local mode, which the README and the page already have.
