# Banner and social preview

- `banner.png` – top of the README (1600 × 420 shown, rendered at 2×).
- `social-preview.png` – 1280 × 640, the picture GitHub shows when the repository is linked. GitHub has no API for it:
  upload it once under *Settings → General → Social preview → Edit → Upload an image*.
- `make.ts` draws both from one description with the colours of `branding/default/icon.svg`
  (`bun docs/media/banner/make.ts`, Chromium from `packages/browser`). Fonts are system fonts (Futura, Avenir Next), so
  render on a Mac or change `DISPLAY` and `TEXT` in the script.

The picture shows the promise of the product: Bobi's parts (IDE, Shell, your model) inside your network, and lines from
outside that stop in front of the boundary.
