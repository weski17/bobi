# Checkliste: von der Entwicklung in den Einsatz

Stand: 2026-11-21, Release 1.3.0. Diese Liste sagt ehrlich, was fehlt, bevor Bobi im Alltag einer Firma laufen sollte.
Sie ersetzt keine Sicherheitsfreigabe.

## Wo Bobi heute steht

- Alle Anforderungen 1–20 aus `CLAUDE.md` sind umgesetzt; Tests, Red-Team-Suite und Scans laufen in der CI grün.
- Das Sicherheitsreview vom 2026-11-19 ergab 33 Befunde (2 kritisch, 7 hoch, 13 mittel, 11 niedrig). Alle sind
  behoben, bis auf drei, die nur teilweise behoben sind: H6/H7 (Abschottung der CI-Runner), M13 (Trivy-Basisliste gilt für
  alle Images). Details: `docs/STATUS.md`, `CHANGELOG.md`.
- **Nicht** nachgewiesen: Verhalten mit echten Modellen über längere Zeit, Betrieb auf einem Server mit Domain,
  Prüfung durch Dritte. Bobi ist ein Forschungsprojekt (siehe `CLAUDE.md`).

**Einschätzung:** bereit für einen **kontrollierten Pilot** mit wenigen Entwicklerinnen und Entwicklern, nicht für die
breite Einführung. Die Stufen unten bauen aufeinander auf; eine Stufe beginnt erst, wenn die davor abgehakt ist.

## Stufe 1: vor dem Pilot (Pflicht)

Was Bobi selbst betrifft:

- [ ] Ollama (oder das Modell-Gateway) aktualisieren. Die Ausnahme für CVE-2026-97054 in `.trivyignore.yaml` läuft am
      **2026-12-19** ab; sie braucht ein Ollama, das mit Go ab 1.26.11 gebaut ist. Danach die Ausnahme entfernen und den
      Image-Workflow grün sehen. Regeln: `docs/security/image-scan.md`.
- [ ] Trivy-Basisliste (`.trivyignore.yaml`, 54 Einträge, läuft am **2027-02-06** ab) nach dem Engine-Update
      verkleinern. Jeden verbleibenden Eintrag einzeln begründen, nicht pauschal verlängern.
- [ ] Standardwerte nicht lockern: keine `autoApprove`-Regeln für Shell oder Schreiben, `BOBI_A2A_TOKEN` nur setzen,
      wenn A2A gebraucht wird, `BOBI_ZOWE_JOB_OWNERS` nur mit den Kennungen, die wirklich gebraucht werden.
- [ ] Pilot-Rechner im Firmennetz: Server und Modell-Gateway nur intern erreichbar, Egress-Proxy mit Allowlist
      (`BOBI_EGRESS_ALLOW`), Container mit den Standardeinstellungen aus `compose.yaml` (schreibgeschützt, keine
      zusätzlichen Rechte).

Was die Umgebung betrifft (das kann nur die Inhaberin des Repositorys tun):

- [ ] CI-Runner abschotten (H6/H7), **bevor** ein eigener (self-hosted) Runner eingerichtet wird: kurzlebig und pro Lauf
      neu, kein Zugriff auf Produktivnetz oder Zugangsdaten, Secrets nur über die GitHub-Umgebung `production`.
- [ ] Branch-Regel auf `main` prüfen (Ruleset 27686498): nur Pull Requests, Pflicht-Checks `security-gate`, `test`,
      `redteam`, `tips`, kein Bypass.
- [ ] Benennen, wer Sicherheitsmeldungen (`SECURITY.md`) liest und wer Updates freigibt.

## Stufe 2: Pilot mit 3–5 Personen

- [ ] Echtes Modell anbinden (OpenAI-kompatibler Endpunkt, siehe `docs/HANDBUCH.md`); ein Modell pro Modus festlegen.
- [ ] Alle Freigaben bleiben auf „fragen“. Die Pilotgruppe weiß, dass sie Befehle und Dateiänderungen jedes Mal
      prüft.
- [ ] `bobi compare` einmal mit den echten Modellen auf eigenem Code laufen lassen und das Ergebnis im
      Änderungsprotokoll (`bobi dossier`) festhalten.
- [ ] Lasttest gegen das echte Gateway: `bun run test:load` (vorher nur gegen das Mock-Modell gelaufen). Antwortzeiten
      bei der erwarteten Zahl gleichzeitiger Sitzungen notieren.
- [ ] Red-Team gegen das echte Modell: `bun run test:redteam` mit `BOBI_REDTEAM_BASE_URL` und `BOBI_REDTEAM_MODEL`.
      Es zeigt, ob das Modell auf die Angriffe hereinfällt, nicht nur, ob Bobi sie eindämmt.
- [ ] Jede Woche `bobi audit` und `bobi usage` ansehen: unerwartete Werkzeuge, abgelehnte Aktionen, Ausreißer bei
      Tokens.
- [ ] Rückmeldungen sammeln: was nervt, was fehlt, wo Freigaben zu oft oder zu selten kommen.

## Stufe 3: vor der breiten Einführung

- [ ] **Externer Penetrationstest** (Bobi Shell, IDE-Erweiterung, Server, Container, Web-Chat). Das interne Review hat
      zwei kritische Lücken gefunden, nachdem alles „fertig“ war; mit weiteren muss gerechnet werden.
- [ ] Betrieb festlegen: Backup der Daten (Checkpoints, Änderungsprotokolle), Updates von Bobi und Basis-Images, wer
      hat Bereitschaft, wohin gehen Logs und OpenTelemetry-Daten.
- [ ] Datenschutz und Betriebsrat: welche Daten Bobi sieht und protokolliert (Prompts, Dateien, Befehle), wie lange sie
      liegen, wer sie lesen darf.
- [ ] Demo-Betrieb **nicht** mit dem Produktivsystem mischen: Besucher der Demo sind untereinander nicht isoliert
      (`SECURITY.md`).
- [ ] Wenn die Demo auf einem Server mit Domain laufen soll: Caddy- und Firewall-Schritte aus `docs/DEPLOYMENT.md`
      (Abschnitte 6 und 7) sind nie auf einem echten Server getestet worden; beim ersten Mal prüfen.

## Laufende Pflichten

- Neue Abhängigkeit: Lizenz prüfen und in `LICENSES.md` eintragen.
- Bei jeder Änderung an Rechten oder Werkzeugen: Red-Team-Fall ergänzen (`tests/redteam/cases.ts`).
- Nach dem Engine-Update (`vendor/opencode`) die Image-Scans neu bewerten.
- Termine: **2026-12-19** (Ausnahme CVE-2026-97054), **2027-02-06** (Trivy-Basisliste).
