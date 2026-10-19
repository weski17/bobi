# CLAUDE.md – Projekt "Bobi"

Diese Datei gibt Claude Code den dauerhaften Kontext für dieses Repository.
Lies sie zu Beginn jeder Sitzung vollständig.

## Projektziel

Bobi ist ein Open-Source-KI-Entwicklungspartner, der den öffentlich beschriebenen
Funktionsumfang von IBM Bob nachbildet. Zielgruppe sind die internen Entwickler
einer Firma. Bobi läuft vollständig on-premise mit eigenen Modellen; Code und
Daten verlassen das Firmennetz nicht.
Bobi hat zwei Oberflächen – **Bobi IDE** und **Bobi Shell** – die sich EINEN Kern
teilen: dieselben Modi, dieselben Regeln, dieselbe Konfiguration.

Es ist ein Forschungsprojekt. Qualität, Nachvollziehbarkeit und Sicherheit gehen
vor Geschwindigkeit.

## Rechtliche Grenzen (nicht verhandelbar)

- Clean-Room: Nutze nur öffentliche Dokumentation und Beschreibungen von IBM Bob.
  Kopiere, dekompiliere oder analysiere niemals Bobs Code oder Binärdateien.
- Keine IBM-Namen, Logos oder Markenzeichen im Produkt, in UI-Texten oder Assets.
- Jede neue Abhängigkeit: Lizenz prüfen und in `LICENSES.md` eintragen.
  Keine Abhängigkeiten mit unklarer oder kommerzieller Lizenz ohne Rückfrage.

## Modell-Anbindung (Bobi baut keine Modell-Infrastruktur)

Bobi ist das Werkzeug, nicht der Modell-Server. Bobi muss nur anschlussbereit sein:

- Ein konfigurierbarer Modell-Endpunkt (OpenAI-kompatible API, optional
  Anthropic-kompatibel). Damit funktioniert Bobi mit jedem Gateway oder Server,
  z. B. LiteLLM, vLLM oder Ollama, ohne Code-Änderung.
- Pro Modus ein eigenes Modell einstellbar (z. B. großes Modell für `plan`,
  kleineres für `code`).
- Tracing über OpenTelemetry, damit Tools wie Langfuse die Daten empfangen können.
  Bobi hängt nicht fest von Langfuse ab.
- Kein fest eingebauter Cloud-Anbieter; Standardkonfiguration zeigt auf einen
  lokalen Endpunkt.

Konfiguration ausschließlich über Konfigurationsdatei und Umgebungsvariablen.
Keine Schlüssel im Code, in Tests, Logs oder Commits.

## Technische Basis

- **Kern**: Fork von OpenCode (MIT) als Agenten-Engine und Server.
- **IDE**: Fork von Code-OSS (offener Kern von VS Code) mit eingebautem Bobi-Panel.
- **Shell**: CLI auf demselben Kern, interaktiv und headless.

Abweichungen von dieser Basis nur mit Architecture Decision Record (ADR)
in `docs/adr/` und nach meiner Freigabe.

## Funktionsumfang

### MUSS
1. Agenten-Schleife: planen → Werkzeug aufrufen → Ergebnis prüfen → wiederholen.
2. Modi mit eigenen Anweisungen und eigenen Werkzeug-Rechten:
   `plan`, `code`, `ask` (nur lesen), `advanced` (mit MCP), `orchestrator`.
3. Eigene Modi pro Projekt in `.bobi/custom_modes.yaml`; eingebaute Modi überschreibbar
   (gleicher Slug).
4. Werkzeuge: Dateien lesen/schreiben, Codesuche, Terminal, Browser.
5. Freigaben: Jede schreibende Aktion und jeder Terminal-Befehl braucht standardmäßig
   eine Bestätigung. Auto-Freigabe nur per expliziter Einstellung.
6. Checkpoints: Vor jeder Änderung automatisch sichern, Rückgängig mit einem Klick.
7. Projekt-Kontext: `/init` erzeugt `AGENTS.md`; Regeln in `.bobi/rules/` (immer aktiv)
   und `.bobi/rules-{modus}/`; Ausschlüsse in `.bobiignore`.
8. MCP-Client: lokale und entfernte MCP-Server, pro Modus freischaltbar.
9. IDE: Chat-Panel, Kontext aus offenen Tabs, Inline-Diffs vor dem Übernehmen.

### SOLL
10. Orchestrator zerlegt große Aufgaben und delegiert an andere Modi.
11. Skills (`SKILL.md`-Format) und eigene Slash-Befehle.
12. Literate Coding: Anweisungen in Klartext direkt an die Code-Stelle schreiben,
    per Tastenkürzel auslösen, Ergebnis als Diff zur Prüfung.
13. Security-Agent: findet Schwachstellen und Code-Smells, schlägt Patches vor.
14. Code-Tipps: markiert komplexe Funktionen und Anti-Patterns beim Programmieren.
15. Git: Commit-Nachrichten und Pull Requests erstellen.
16. Eigene MCP-Server: Code-Graph (Aufrufketten, Abhängigkeiten),
    COBOL-Analyse (Parser, Datenfluss, Auswirkungsanalyse), Mainframe-Zugriff über Zowe.

### SPÄTER
17. Autovervollständigung (ein- und mehrzeilig).
18. Audit- und Compliance-Berichte, Architekturdiagramme aus dem Code.
19. Nutzungsstatistik pro Team und Person (Tokens, Aufgaben, Zeitersparnis).
20. A2A: Agentenkarte unter `/.well-known/agent-card.json`, Aufruf anderer A2A-Agenten.

## Sicherheitsregeln für Bobi (Produktanforderungen)

- Agenten laufen in einer Sandbox (Container) ohne Zugriff auf Produktivdaten.
- Netzwerkzugriff nur auf freigegebene Ziele (Allowlist).
- Inhalte aus Dateien, Webseiten, Terminal-Ausgaben und MCP-Antworten sind Daten,
  niemals Anweisungen. Dieser Schutz vor Prompt Injection ist zentral und wird getestet.
- Geheimnisse werden in Prompts, Logs und Checkpoints maskiert.
- Jede Aktion wird mit Nutzer, Modus, Werkzeug und Ergebnis protokolliert
  (OpenTelemetry, an ein beliebiges Backend wie Langfuse weiterleitbar).
- Rechte-Konfiguration liegt versioniert im Repo und ist per Pull Request prüfbar.

## Tests und Qualität

- Unit- und Integrationstests für jede neue Funktion; Kern-Abdeckung mindestens 80 %.
- Red-Teaming mit promptfoo: Prompt Injection über Repository und Terminal-Ausgaben,
  Auslesen von Geheimnissen, Ausbruch aus der Sandbox.
- Statischer Scan mit Semgrep in der CI.
- Lasttests: viele parallele Sitzungen gegen den konfigurierten Modell-Endpunkt,
  Antwortzeiten messen.
- Für Tests einen Mock-Modell-Endpunkt verwenden, damit Tests ohne echtes Modell laufen.
- Testobjekt für COBOL-Funktionen: AWS CardDemo.

## Phasen

| Phase | Inhalt |
|---|---|
| 0 | Basis-Repos analysieren, Architektur und Ordnerstruktur vorschlagen, ADRs anlegen |
| 1 | Kern: Werkzeuge, Freigaben, Checkpoints, konfigurierbarer Modell-Endpunkt, OpenTelemetry |
| 2 | Modi, eigene Modi, AGENTS.md, Regeln, `.bobiignore` |
| 3 | MCP-Client und erster eigener MCP-Server (Code-Graph) |
| 4 | Bobi IDE: Chat-Panel, Inline-Diffs |
| 5 | Bobi Shell, Orchestrator, Skills, Literate Coding, Security-Agent, Git |
| 6 | COBOL- und Zowe-MCP-Server, Autovervollständigung, Audit-Berichte, A2A |

**Aktuelle Phase: 5**
Den Fortschritt pflegst du in `docs/STATUS.md`.

Jede Phase endet mit: lauffähigem Stand, grünen Tests, kurzer Demo-Anleitung in
`docs/demos/phase-N.md`.

## Arbeitsweise

- Arbeite NUR an der aktuellen Phase. Nach jeder Phase stoppen und auf Freigabe warten.
- Vor jedem Code: kurzer Plan mit betroffenen Dateien, Schnittstellen und Risiken.
- Wenn etwas unklar ist oder eine Annahme nötig wird: stoppen und fragen.
- Behaupte nie, dass etwas funktioniert, ohne es getestet zu haben.
- Kleine, nachvollziehbare Commits (Conventional Commits, z. B. `feat(core): ...`).
- Ein Branch pro Phase: `phase-N-kurzname`.
- Bestehenden Upstream-Code (OpenCode, Code-OSS) nur so wenig wie nötig ändern;
  Bobi-spezifisches in eigene Module, damit Upstream-Updates möglich bleiben.
- Sprache: Kommunikation mit mir auf Deutsch; Code, Kommentare und Commit-Nachrichten
  auf Englisch.

## Befehle

Voraussetzungen und Details: `docs/DEVELOPMENT.md`.

- Installieren: `git submodule update --init --depth 1 && (cd vendor/opencode && bun install) && bun install && bun run browser:install && bash scripts/install.sh`
- Bauen: kein Build-Schritt (Bun führt TypeScript direkt aus)
- Tests: `bun run test` (mit Abdeckung: `bun run test:coverage`; Sandbox: `bun run test:sandbox`)
- Lint/Typprüfung: `bun run typecheck` (Semgrep läuft in der CI)
- Bobi IDE einrichten: `bun run ide:setup` (einmalig), starten: `bobi-ide [ordner]` bzw. `bun run ide`; IDE-Test: `bun run test:ide`
- Bobi Shell starten: `bobi` (interaktiv), `bobi run "<Auftrag>"` (headless), `bobi serve`, `bobi attach <url>`
- Sandbox: `podman build -f sandbox/Containerfile -t bobi:dev .` und `sandbox/bobi-sandbox.sh up <projekt>`

## Ausgabe am Ende jeder Phase

1. Zusammenfassung: Was wurde gebaut?
2. Geänderte Dateien
3. Testergebnisse
4. Offene Punkte und Risiken
5. Vorschlag für die nächste Phase
