# Bobi showcase video

The feature tour of `../bobi-tour`, extended with phase 8 (signed change dossier, model comparison, signed registry with
revocation, web chat, CI checks) and a **live demo** recorded from the real web chat with the bundled model.

What is real and what is drawn:

- **Live scenes** (`live-ask`, `live-fix`, `live-secret`): screen recordings of the real web chat (local demo image,
  Qwen3 4B on the CPU). Only the model's waiting time is cut; every cut shows a badge with the real waiting time.
  The fix is accepted and then undone; the test command the model asked for is rejected on screen.
- **Terminal scenes** (dossier, registry, revocation): real command output, IDs and hashes shortened with "…".
  The dossier comes from a real session in the demo; the tampered file is really refused.
- **Model comparison**: a diagram and the report's columns only. No run with real models has been made, so no numbers.
- Everything else is an illustration in the style of the first tour.

## Build

Needs ffmpeg/ffprobe, Playwright's Chromium (`bun run browser:install`), Docker or Podman (for the voice) and the
local demo (see `docs/DEPLOYMENT.md`, "Ohne Server") for the live clips.

```bash
# voice: Piper 2023.11.14-2 linux_aarch64 (MIT) and de_DE-thorsten-high (model MIT, data CC0), outside the repository
#   ~/.cache/bobi-voice/piper/…, ~/.cache/bobi-voice/de_DE-thorsten-high.onnx[.json], and the wrapper piper-docker
bun docs/media/bobi-showcase/record-live.ts                 # live clips → .work/live/*.mp4 (minutes: real model)
PIPER_BIN=~/.cache/bobi-voice/piper-docker PIPER_MODEL=~/.cache/bobi-voice/de_DE-thorsten-high.onnx \
  bun docs/media/bobi-showcase/make.ts                      # → bobi-showcase.mp4, .m4a, .srt, .vtt
bun docs/media/bobi-showcase/make.ts --stills               # one PNG per scene in .stills/ for review
```

`record-live.ts` reads the demo password from `~/.bobi-demo.env` and never prints it. It uses a fresh chat for every
clip in the shared working folder of the demo; the fix is undone at the end.
