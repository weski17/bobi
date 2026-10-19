# ADR-0012: Configurable branding

- Status: Accepted (2026-10-19) – internal FI experiment; logo kept out of the repo
- Date: 2026-10-19

## Context

Bobi is open source, but it is deployed inside one company that wants its own logo in the product.
The proposed logo contains a company mark and a registered third-party trademark. Trademarks must not be
committed to a public repository or shipped without written permission from the rights holder.

## Decision

- The open-source repo ships a **neutral default Bobi logo** only.
- Company branding (logo, product name, colours) lives in a **branding pack** outside the public repo
  (e.g. an internal repo or a CI secret/artifact) and is applied at build time:
  `branding/<pack>/{icon.svg, icon.icns, icon.ico, icon.png, branding.json}`.
- Build scripts (IDE `product.json` overlay, Shell/TUI banner, chat panel icon) read the pack path from
  `BOBI_BRANDING_DIR`; without it, the neutral default is used.
- `branding/*` except `branding/default/` is ignored by git.

## Consequences

- The public repo stays free of third-party marks; internal builds can carry the company logo once usage is approved.
- Each surface needs icons in several formats (icns, ico, png, svg) – generated from one SVG by a script.
