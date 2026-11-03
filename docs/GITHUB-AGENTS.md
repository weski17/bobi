# Bobi in GitHub einsetzen (Pull Requests prüfen lassen)

Bobi lässt sich in GitHub Actions als Prüfer einsetzen. Dieses Dokument beschreibt, was im Repository schon läuft und wie
eure Firma die modellbasierte Prüfung selbst einrichtet. **Der modellbasierte Teil ist hier nicht gebaut und nicht getestet** –
er hängt von eurem Modell und eurem Runner ab.

## 1. Läuft schon: Code-Tipps als Pull-Request-Check (ohne Modell)

`.github/workflows/ci.yml`, Job `tips`: bei jedem Pull Request

```bash
bobi tips --since "origin/<ziel-branch>" --fail-on warning
```

Der PR wird rot, wenn er **neue** Warnungen hinzufügt (zu komplexe oder zu lange Funktionen, Anti-Patterns). Bestehende Funde
blockieren nicht. Grenzen und Schwellwerte: [HANDBUCH.md](HANDBUCH.md#8-code-tipps).

## 2. Für eure Firma: Review mit Modell auf einem Self-hosted Runner

Das Modell steht im Firmennetz; GitHubs eigene Runner kommen nicht heran. Deshalb ein **Self-hosted Runner** im selben Netz
(GitHub → Settings → Actions → Runners), auf dem Bobi und Bun installiert sind und `BOBI_MODEL_BASE_URL` auf euer Gateway zeigt
(Schlüssel als Secret, nie im Repository).

Gerüst (anpassen, dann **in einem Test-Repository ausprobieren**):

```yaml
name: bobi-review
on:
  pull_request:
    types: [labeled]          # nur wenn jemand das Label "bobi-review" setzt – kein automatischer Lauf für fremde PRs
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    if: github.event.label.name == 'bobi-review' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, bobi]
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Review
        env:
          BOBI_MODEL_BASE_URL: ${{ vars.BOBI_MODEL_BASE_URL }}
          BOBI_MODEL: ${{ vars.BOBI_MODEL }}
          BOBI_MODEL_API_KEY: ${{ secrets.BOBI_MODEL_API_KEY }}
          BOBI_USER: github-actions
        run: |
          bobi --trust run --mode security "Prüfe die Änderungen dieses Pull Requests gegen ${{ github.base_ref }} (git diff origin/${{ github.base_ref }}...HEAD). Nenne nur konkrete Probleme mit Datei und Zeile." > review.md
      - name: Kommentar
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
        run: gh pr comment ${{ github.event.pull_request.number }} --body-file review.md
```

Worauf ihr achten müsst:

- **Nur eigene Branches, nur auf Anforderung.** Ein PR aus einem Fork könnte Anweisungen im Code verstecken (Prompt Injection).
  Bobi behandelt Dateiinhalt als Daten, aber der Runner hat Zugriff auf euer Netz – der Lauf darf deshalb nicht automatisch für Fremde starten.
- **Lesende Modi.** `security` und `ask` verändern nichts. Ein Lauf ohne Bildschirm kann keine Freigaben beantworten; schreibende
  Aktionen werden verweigert. Für Änderungen (Modus `code`) bräuchte es eine bewusste Auto-Freigabe, nur in einem Wegwerf-Branch.
- **`--trust`** vertraut den Regeln und Modi des Repositories (AGENTS.md, `.bobi/`). Das ist bei eigenen Branches in Ordnung,
  nicht bei fremdem Code.
- **Nachweis:** `bobi dossier --out dossier.json --diff --test "<testbefehl>"` danach als Build-Artefakt hochladen; `bobi dossier verify`
  prüft es später.
- **Qualität:** hängt vom Modell ab. Das Modell der Demo ist dafür zu schwach.
