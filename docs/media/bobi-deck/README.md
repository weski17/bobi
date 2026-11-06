# Bobi deck (PowerPoint)

`bobi-deck.pptx` – 20 slides in German, in the look of the feature tour video (`../bobi-tour/tour.html`): the same dark
background with glows and grid, the same palette, the gradient logo and wordmark. Every slide has speaker notes.

| Slide | Topic |
|---|---|
| 1 | Title |
| 2–10 | Why Bobi, two surfaces and one core, the loop, modes, project context, tools, tips and security agent, MCP, security |
| 11–15 | New in phase 8: change dossier (also per task), model comparison, signed registry with revocation list, web chat and demo, tips check and image scan in CI |
| 16 | Live demo: five tasks of [`../../demos/tester-anleitung.md`](../../demos/tester-anleitung.md), with real screenshots |
| 17 | Quality in numbers |
| 18 | Honest limits and open points |
| 19–20 | Next steps, questions |

## What is real and what is not

- `screens/` – **real screenshots** of the web chat of the local demo (`capture-screens.mjs`). Part 1 only reads (mode
  *ask*), the edit request ends with *Reject*, so the shared working folder is not changed.
- `terminal/` – **real command output** (`capture-terminal.sh`): the dossier commands run on a copy of the audit log of the
  demo container (real model turns), the registry commands in throw-away homes. Long ids are shortened with `…` and the
  throw-away home is shown as `~/.bobi`; nothing else is changed.
- The model comparison slide shows the command and what the table contains, **no numbers**: no run with real models
  has been done yet (said on the slide).
- Numbers on slide 17: 484 tests (full run on the branch with the web chat long-poll change), 99 % line coverage
  (measured with `bun run test:coverage`: 99.7 % lines, 98.3 % functions), red team 8/8 and 100 parallel sessions with
  0 errors (README). All against the mock model.

## Rebuild

```bash
npm install --prefix ~/.cache/bobi-deck pptxgenjs      # MIT; kept outside the repository (or set DECK_HOME)
node docs/media/bobi-deck/assets.mjs                   # background, logo, wordmark (Chromium from packages/browser)
node docs/media/bobi-deck/build-deck.mjs --preview     # bobi-deck.pptx + preview/NN.png, reports text that does not fit
python3 docs/media/bobi-deck/check-deck.py --dump      # structure, fonts, secrets check, text and notes per slide
```

Refresh the screenshots and terminal output (needs the demo running, see `docs/DEPLOYMENT.md`, "Ohne Server"):

```bash
node docs/media/bobi-deck/capture-screens.mjs          # password from ~/.bobi-demo.env, never printed
bash docs/media/bobi-deck/capture-terminal.sh
```

Fonts are Arial and Courier New, so it renders the same on Windows and macOS. `lib.mjs` describes each slide once and
writes it as `.pptx` and as an HTML preview (used to look at the slides and to find text that overflows); the preview is
Chromium's rendering, not PowerPoint's, so open the file once in PowerPoint or Keynote before presenting.
