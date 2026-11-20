# Bobi – Handbuch

Bobi ist ein KI-Entwicklungspartner, der **vollständig im Firmennetz** läuft: mit eurem eigenen Modell, ohne
Cloud-Dienst, ohne dass Code oder Daten das Netz verlassen. Es gibt zwei Oberflächen – **Bobi IDE** und
**Bobi Shell** – mit einem gemeinsamen Kern: dieselben Modi, Regeln und Einstellungen.

Dieses Handbuch richtet sich an Entwicklerinnen und Entwickler, die Bobi benutzen, und an Teams, die Bobi
betreiben. Technische Entscheidungen stehen in den [ADRs](adr/README.md), Kurzvorführungen in [`demos/`](demos/).
Eine Video-Tour aller Funktionen liegt unter [`media/bobi-tour/bobi-tour.mp4`](media/bobi-tour/bobi-tour.mp4).

**Inhalt**

1. [Schnellstart](#1-schnellstart)
2. [Bobi Shell](#2-bobi-shell)
3. [Bobi IDE](#3-bobi-ide)
4. [Modi](#4-modi)
5. [Projekt-Kontext: AGENTS.md, Regeln, .bobiignore, Vertrauen](#5-projekt-kontext)
6. [Freigaben und Checkpoints](#6-freigaben-und-checkpoints)
7. [Workflows: Orchestrator, Skills, Slash-Befehle, Git](#7-workflows)
8. [Code-Tipps](#8-code-tipps)
9. [MCP und eingebaute Server](#9-mcp)
10. [COBOL und Mainframe](#10-cobol-und-mainframe)
11. [A2A – Zusammenarbeit mit anderen Agenten](#11-a2a)
12. [Audit, Nutzungsstatistik, Diagramme](#12-audit-nutzung-diagramme)
13. [Sicherheit und Sandbox](#13-sicherheit-und-sandbox)
14. [Betrieb: Server, Container, Telemetrie](#14-betrieb)
15. [Konfigurationsreferenz](#15-konfigurationsreferenz)
16. [Qualität und Tests](#16-qualität-und-tests)
17. [Fehlerbehebung](#17-fehlerbehebung)
18. [Grenzen und bekannte Risiken](#18-grenzen-und-bekannte-risiken)

---

## 1. Schnellstart

### Voraussetzungen (macOS)

```bash
brew install oven-sh/bun/bun node@24 podman ripgrep bash
```

`ripgrep` muss im `PATH` liegen (sonst würde die Engine es zur Laufzeit herunterladen). Details:
[DEVELOPMENT.md](DEVELOPMENT.md).

### Installation

```bash
git clone <repo> bobi && cd bobi
git submodule update --init --depth 1
(cd vendor/opencode && bun install) && bun install
bun run browser:install          # Headless-Chromium für das Browser-Werkzeug
bash scripts/install.sh          # legt ~/.local/bin/bobi und ~/.local/bin/bobi-ide an
```

### Modell-Endpunkt eintragen

Bobi baut keine Modell-Infrastruktur, sondern spricht mit jedem **OpenAI-kompatiblen** (optional
Anthropic-kompatiblen) Endpunkt – LiteLLM, vLLM, Ollama. Standard ist `http://localhost:4000/v1` (LiteLLM).

`~/.bobi/config.jsonc`:

```jsonc
{
  "model": {
    "baseURL": "http://litellm.intranet:4000/v1",
    "protocol": "openai",
    "apiKeyEnv": "BOBI_MODEL_API_KEY",   // Name der Umgebungsvariablen – der Schlüssel selbst nie in Dateien
    "default": "qwen-coder",
    "models": ["qwen-coder", "llama-70b"]
  },
  "modes": { "plan": { "model": "llama-70b" } }   // pro Modus ein eigenes Modell
}
```

```bash
export BOBI_MODEL_API_KEY=…      # aus eurem Secret-Store
cd ~/projekte/payments
bobi                             # interaktiv
```

Beim ersten Start in einem Projekt mit Bobi-Dateien (AGENTS.md, `.bobi/…`) fragt Bobi, ob es dem Projekt
vertrauen soll – siehe [Projekt-Vertrauen](#projekt-vertrauen).

---

## 2. Bobi Shell

| Befehl | Zweck |
|---|---|
| `bobi [ordner]` | Interaktive Terminal-Oberfläche |
| `bobi run [--mode <slug>] "<Auftrag>"` | Ein Auftrag ohne Oberfläche (Skripte, CI). Beim Skripten stdin schließen: `</dev/null` |
| `bobi serve [--hostname H] [--port P]` | Nur den Server starten (für die IDE oder einen Container) |
| `bobi attach <url> [run …]` | Mit einem laufenden Server verbinden (Passwort aus `BOBI_SERVER_PASSWORD`) |
| `bobi modes [--json]` | Verfügbare Modi im aktuellen Projekt |
| `bobi trust [--status\|--yes\|--no] [ordner]` | Projekt-Vertrauen anzeigen oder setzen |
| `bobi tips [--format text\|json] [--fail-on warning\|info] [pfade]` | Code-Tipps (siehe [Kapitel 8](#8-code-tipps)) |
| `bobi usage [--from D] [--to D] [--team T] [--format md\|json]` | Nutzungsstatistik |
| `bobi audit [--from D] [--to D] [--user U] [--format md\|json]` | Audit- und Compliance-Bericht |
| `bobi diagram [code\|cobol] [--program P] [--depth N] [ordner]` | Architekturdiagramm als Mermaid |
| `--trust` | Bei `bobi`/`run`: Projekt ohne Rückfrage vertrauen |

Optionen für `run`: `--mode`, `--model/-m`, `--format json`, `--continue/-c`, `--session/-s <id>`,
`--file/-f <pfad>`. Andere Engine-Optionen sind gesperrt, damit nichts an Bobis Schutz vorbeiführt.

Beispiele:

```bash
bobi run --mode ask "Wo wird der Login geprüft?" </dev/null
bobi run --mode plan "Plane die Umstellung auf Postgres 17" </dev/null
bobi run --mode security "Prüfe src/auth auf Injection" </dev/null
```

Slash-Befehle und Skills funktionieren in der Terminal-Oberfläche genauso wie in der IDE (`/` tippen).

---

## 3. Bobi IDE

Bobi IDE ist Code-OSS (der offene Kern von VS Code) mit Bobi-Branding und eingebautem Bobi-Panel. Die
eingebauten Fremd-KI-Funktionen sind abgeschaltet.

```bash
bun run ide:setup                # einmalig: baut Code-OSS aus den Quellen (Node 24)
bobi-ide ~/projekte/payments     # oder: bun run ide
```

Eigenes Logo: `BOBI_BRANDING_DIR=<ordner mit icon.svg> bun run ide:setup`.

| Funktion | So geht's |
|---|---|
| **Chat-Panel** | Bobi-Symbol in der Seitenleiste. Modus oben wählen, Auftrag eingeben. |
| **Kontext aus offenen Tabs** | Offene Dateien und die Markierung gehen automatisch mit (`bobi.includeOpenTabs`). |
| **Diff vor dem Übernehmen** | Jede Änderung öffnet sich als Diff („proposed by Bobi“). Erst nach *Accept* wird geschrieben. |
| **Rückgängig** | „Undo“ im Panel oder Befehl *Bobi: Undo* – setzt alle Änderungen des letzten Auftrags zurück. |
| **Literate Coding** | Anweisung als Kommentar an die Code-Stelle schreiben (oder markieren), `⌘⌥⏎` / `Strg+Alt+Enter` – Ergebnis kommt als Diff. Auch im Kontextmenü. |
| **Autovervollständigung** | Grauer Vorschlagstext beim Tippen, `Tab` übernimmt. Aktiv, sobald `autocomplete.model` gesetzt ist ([Kapitel 15](#15-konfigurationsreferenz)). |
| **Code-Tipps** | Gelbe/blaue Hinweise mit Quelle „Bobi“; Glühbirne → *Bobi: Simplify …*. |
| **Commit-Nachricht** | In der Quellcodeverwaltung auf ✦ klicken – Bobi fragt im Panel, ob es `git diff --staged` lesen darf, und schreibt dann die Nachricht. |
| **Freigaben** | Erscheinen im Panel, auch für Teilaufgaben des Orchestrators. |

Einstellungen der IDE: `bobi.command`, `bobi.includeOpenTabs`, `bobi.autocomplete.enabled`, `bobi.tips.enabled`.

---

## 4. Modi

Ein Modus gibt Bobi eine Rolle und legt fest, welche Werkzeuge erlaubt sind. Was ein Modus nicht darf, sieht das
Modell gar nicht erst.

| Modus | Rolle | Werkzeuge |
|---|---|---|
| `code` | Programmieren (Standard) | lesen, schreiben, Terminal, Browser |
| `plan` | Planen und entwerfen | lesen, Browser, schreiben nur `*.md`/`*.mdx` |
| `ask` | Fragen beantworten | nur lesen |
| `advanced` | wie `code`, plus MCP | lesen, schreiben, Terminal, Browser, MCP, `a2a` |
| `orchestrator` | große Aufgaben zerlegen und delegieren | lesen, Teilaufgaben |
| `security` | Schwachstellen finden, Patches vorschlagen | lesen, Terminal, schreiben |
| `security-ci` | Sicherheits-Review in der Pipeline, nur Bericht (für das Security-Gate, siehe Abschnitt 13) | nur lesen |

### Eigene Modi

`.bobi/custom_modes.yaml` (Projekt) oder `~/.bobi/custom_modes.yaml` (global). Gleicher `slug` überschreibt einen
eingebauten Modus.

```yaml
customModes:
  - slug: docs
    name: Docs Writer
    description: Schreibt Handbücher
    roleDefinition: Du schreibst verständliche Handbücher für Kunden.
    whenToUse: Dokumentation schreiben oder überarbeiten
    groups:
      - read
      - - edit
        - fileRegex: \.md$
      - - mcp
        - servers: [jira]
```

Gruppen: `read`, `edit` (optional mit `fileRegex`), `execute` (Terminal), `browser`, `mcp` (optional mit
`servers`), `subtask` (delegieren). Änderungen an der Datei werden ohne Neustart übernommen.

---

## 5. Projekt-Kontext

| Datei | Wirkung |
|---|---|
| `AGENTS.md` | Projektbeschreibung für Bobi. `/init` erzeugt oder aktualisiert sie. |
| `.bobi/rules/*.md` | Regeln, die immer gelten (z. B. Coding-Style). |
| `.bobi/rules-<modus>/*.md` | Regeln nur für diesen Modus (z. B. `rules-security/owasp.md`). |
| `.bobiignore` | Dateien, die Bobi nie lesen, durchsuchen oder per Terminal öffnen darf (Syntax wie `.gitignore`). |
| `.bobi/config.jsonc` | Projekt-Einstellungen (Modelle pro Modus, Auto-Freigaben, MCP-Server, Code-Tipps). |
| `.bobi/skills/<name>/SKILL.md`, `.bobi/commands/*.md` | Projekt-Skills und Slash-Befehle. |

```gitignore
# .bobiignore
secrets/
*.pem
config/prod.env
```

### Projekt-Vertrauen

Ein fremdes Repository könnte über AGENTS.md, Regeln oder `.bobi/config.jsonc` versuchen, Bobi zu steuern oder
seine Rechte zu erweitern. Deshalb fragt Bobi einmal pro Projekt – und erneut, wenn sich diese Dateien ändern.
Ohne Vertrauen werden sie ignoriert; `.bobiignore` gilt immer.

```bash
bobi trust --status     # zeigt Status und die betroffenen Dateien
bobi trust --yes        # vertrauen
```

---

## 6. Freigaben und Checkpoints

**Standard:** Jede schreibende Aktion, jeder Terminal-Befehl und jeder Netzzugriff fragt nach – *einmal erlauben*,
*immer erlauben* oder *ablehnen*. Ohne Rückfrage laufen nur lesende Werkzeuge (Dateien lesen, suchen). **Jeder
Terminal-Befehl fragt, auch `git status` oder `git diff`:** Schon „lesende“ Git-Befehle können über eine Umleitung
(`git log > datei`) Dateien schreiben oder in einem präparierten Repository Code ausführen (Sicherheitsreview vom
19.11.2026). Wer Git-Befehle trotzdem freigibt, tut das ausdrücklich per Auto-Freigabe; ein Befehl, der per
Umleitung in eine Datei schreibt, fragt auch dann nach.

**Auto-Freigaben** nur explizit in der Konfiguration – damit sie im Pull Request sichtbar sind:

```jsonc
{
  "autoApprove": [
    { "action": "shell", "resource": "npm test" },
    { "action": "edit", "resource": "docs/*", "modes": ["code"] },
    { "action": "mcp", "resource": "code-graph_*" }
  ]
}
```

**Immer mit Rückfrage**, auch bei Auto-Freigabe: Änderungen an `.bobi/` und `.bobiignore` (Bobi darf seine eigenen
Rechte nicht erweitern), Schreiben und Job-Submit auf dem Mainframe, Aufrufe anderer Agenten (`a2a`).

Die Grundregeln liegen versioniert in [`packages/core/defaults/permissions.jsonc`](../packages/core/defaults/permissions.jsonc).

**Checkpoints:** Vor jeder Änderung sichert Bobi den Stand (Schatten-Git; bei Projekten ohne Git ein verstecktes
Repository unter `~/.bobi/data/shadow`). *Undo* stellt alles wieder her. Abschalten: `"checkpoints": { "enabled": false }`.

---

## 7. Workflows

### Orchestrator

Im Modus `orchestrator` zerlegt Bobi große Aufgaben und gibt Teilaufgaben an `plan`, `code`, `ask` oder `security`.
Jede Teilaufgabe läuft mit den Rechten ihres Modus; Freigaben landen trotzdem bei dir.

### Slash-Befehle

| Befehl | Zweck |
|---|---|
| `/init` | AGENTS.md erzeugen oder aktualisieren |
| `/commit` | Commit-Nachricht aus dem gestagten Diff; fragt vor dem Lesen des Diffs und vor `git commit` |
| `/pr` | Pull Request; fragt vor `git push` und `gh pr create` |
| `/security-review [pfad]` | wechselt in den Security-Modus und liefert Befunde mit Schweregrad und Fix |

Eigene Befehle als Markdown in `~/.bobi/commands/` oder `.bobi/commands/`:

```markdown
---
description: Datei für neue Kollegen erklären
mode: ask
---
Erkläre $ARGUMENTS: Zweck, Ablauf, Fallstricke.
```

Aufruf: `/explain src/app.ts`.

### Skills

`~/.bobi/skills/<name>/SKILL.md` oder `.bobi/skills/<name>/SKILL.md`:

```markdown
---
name: review-guide
description: Wie unser Team Code reviewt
---
Prüfe immer Fehlerbehandlung, Logging personenbezogener Daten und fehlende Tests.
```

Bobi lädt einen Skill, wenn die Aufgabe dazu passt.

### Git

`/commit`, `/pr` und der ✦-Knopf in der IDE. Lesende Git-Befehle laufen ohne Rückfrage, alles Schreibende fragt.

---

## 8. Code-Tipps

Bobi markiert beim Programmieren komplexe Funktionen und typische Anti-Patterns – **lokal, ohne Modellaufruf**.

| Sprache | Regeln |
|---|---|
| TypeScript/JavaScript | `complexity` (zyklomatisch), `function-length`, `nesting`, `parameters`, `empty-catch`, `explicit-any`, `loose-equality` |
| COBOL | `function-length` (Paragraph), `nesting` (IF/EVALUATE/PERFORM), `go-to`, `perform-thru`, `alter` |

In der IDE: Hinweise im Editor, Glühbirne → *Bobi: Simplify …* (Bobi schlägt ein Refactoring als Diff vor).

In der Shell und in der CI:

```bash
bobi tips src                      # datei:zeile: schwere [regel] meldung
bobi tips --fail-on warning src    # Exit-Code 1 bei Warnungen – als CI-Gate
bobi tips --since origin/main --fail-on warning   # nur das, was die Änderung NEU hinzufügt (für Pull Requests)
```

`--since` vergleicht die geänderten Dateien mit dem Stand am angegebenen Git-Stand und meldet nur neue Tipps (je Regel und
Funktion; verschobene Zeilen zählen nicht). Alte Funde blockieren eine Änderung also nicht – aber eine schon komplexe Funktion
darf in dieser Prüfung noch komplexer werden, solange sie dieselbe Regel nur einmal verletzt. In diesem Repository läuft das als
Check `tips` bei jedem Pull Request (`.github/workflows/ci.yml`); für euer Projekt genügt derselbe Schritt.

Schwellwerte pro Projekt (Standard: 10 / 60 / 4 / 5):

```jsonc
{ "tips": { "complexity": 15, "functionLines": 80, "nesting": 4, "parameters": 6 } }
```

---

## 9. MCP

Bobi ist MCP-Client für lokale und entfernte Server. MCP-Werkzeuge gibt es nur in Modi mit der Gruppe `mcp`
(z. B. `advanced`); jeder Aufruf fragt, sofern nicht explizit freigegeben.

```jsonc
{
  "mcp": {
    "servers": {
      "jira": { "type": "remote", "url": "https://jira.intranet/mcp", "headers": { "Authorization": "Bearer ${JIRA_TOKEN}" } },
      "docs": { "type": "local", "command": ["bunx", "my-docs-mcp"], "env": { "DOCS_TOKEN": "${DOCS_TOKEN}" } }
    }
  }
}
```

Zugangsdaten **nur** als `${VARIABLE}`; fehlt eine Variable, wird der Server deaktiviert statt mit leerem Token
gestartet. Projekt-Server gelten nur in vertrauenswürdigen Projekten.

**Eingebaute Server**

| Server | Werkzeuge |
|---|---|
| `code-graph` (TS/JS) | `find_symbol`, `callers`, `callees`, `call_path`, `dependencies`, `dependents`, `diagram` |
| `cobol` | `list_programs`, `find`, `program_outline`, `performs`, `program_calls`, `field`, `data_flow`, `impact`, `diagram` |
| `zowe` (wenn konfiguriert) | `list_datasets`, `list_members`, `read_dataset`, `write_dataset`, `list_uss`, `read_uss_file`, `list_jobs`, `job_status`, `job_output`, `submit_job` |

Antworten von MCP-Servern sind für Bobi **Daten, keine Anweisungen**.

---

## 10. COBOL und Mainframe

### COBOL-Analyse

Der `cobol`-Server liest Programme, Copybooks (inkl. `COPY … REPLACING`) und JCL des Projekts. Beispiele im Modus
`advanced`:

- „Welche Programme und Jobs betrifft eine Änderung am Copybook CVACT01Y?“ → `cobol_impact`
- „Wohin fließt ACCT-CURR-BAL in CBACT01C?“ → `cobol_data_flow`
- „Welche Bildschirme ruft das Sign-on-Programm auf?“ → `cobol_program_calls`
- „Welche Jobs nutzen AWS.M2.CARDDEMO.ACCTDATA.*?“ → `cobol_impact` mit `dataset`

Getestet an AWS CardDemo (`vendor/carddemo`). Diagramm: `bobi diagram cobol [--program P] <ordner>`.

### Mainframe über Zowe

Der `zowe`-Server nutzt die REST-Schnittstelle, die auch die Zowe CLI verwendet. Verbindung über ein Zowe-Profil
(`zowe.config.json` in `~/.zowe`; eine Datei im Projekt wird ignoriert, damit ein Repository nicht bestimmen kann,
wohin das Passwort geht) oder Umgebungsvariablen:

```bash
export ZOWE_OPT_HOST=mf.intranet ZOWE_OPT_PORT=443 ZOWE_OPT_USER=dev1
export ZOWE_OPT_PASSWORD=…              # nur aus der Umgebung – nie aus Dateien
export BOBI_ZOWE_DATASETS="DEV1.**,TEAM.TEST.*"   # Standard: nur eigene Datasets (<USER>.**)
export BOBI_ZOWE_USS="/u/dev1"                    # Standard: eigenes Home
export BOBI_ZOWE_JOB_OWNERS="DEV1"                # Standard: nur eigene Jobs und deren Spool; "*" für alle
```

- Datasets und USS-Pfade außerhalb der Allowlist werden abgewiesen – bevor eine Anfrage den Mainframe erreicht.
- In abgeschickter JCL werden alle `DSN=` gegen die Allowlist geprüft. Jobs, deren Datensätze Bobi nicht sehen kann,
  lehnt Bobi ab: Aufruf einer Prozedur, `INCLUDE`/`JCLLIB`, interner Reader (`INTRDR`), `PATH=` und Programme mit
  eingebetteten Befehlen (`IDCAMS`, `IKJEFT01`, `BPXBATCH`, `ADRDSSU`, …). Solche Jobs schickst du selbst ab. Die
  eigentliche Grenze bleiben die Rechte des Mainframe-Benutzers (RACF): Die Prüfung ist eine zweite Linie, keine Garantie.
- Schreiben (`write_dataset`) und Job-Submit fragen **immer**.
- Zertifikate werden immer geprüft; eine Firmen-CA kommt per `NODE_EXTRA_CA_CERTS` dazu.
- In der Sandbox den Mainframe-Host in `BOBI_EGRESS_ALLOW` aufnehmen.

---

## 11. A2A

**Bobi ruft andere Agenten** (Modus `advanced`, jeder Aufruf fragt):

```jsonc
{ "a2a": { "agents": { "tickets": { "url": "https://tickets.intranet", "headers": { "Authorization": "Bearer ${TICKETS_A2A_TOKEN}" }, "description": "Ticketsystem" } } } }
```

**Andere Agenten rufen Bobi** – nur wenn global eingeschaltet (`~/.bobi/config.jsonc` `"a2a": { "enabled": true }` oder
`BOBI_A2A=1`; ein Projekt kann das nicht):

```bash
BOBI_A2A=1 BOBI_A2A_TOKEN="$(openssl rand -base64 32)" BOBI_SERVER_PASSWORD=… bobi serve --port 4096
curl http://127.0.0.1:4096/.well-known/agent-card.json      # Agentenkarte (öffentlich)
```

JSON-RPC unter `/a2a` mit einem **eigenen Token** (`Authorization: Bearer $BOBI_A2A_TOKEN`, mindestens 24 Zeichen,
nicht das Server-Passwort): `message/send`, `tasks/get`,
`tasks/cancel`. Fremde Agenten **dürfen nur lesen**: alles andere wird sofort abgelehnt, nichts wartet auf eine
Freigabe. Das Token gilt nur für `/a2a`; das Server-Passwort öffnet `/a2a` nicht, und mit dem Token kommt man an keine
andere Schnittstelle. Ohne `BOBI_A2A_TOKEN` startet Bobi mit eingeschaltetem A2A nicht. (Bis 19.11.2026 galt hier das
Server-Passwort; damit hätte ein Agent eine Sitzung in einem anderen Modus öffnen und eigene Freigaben bestätigen können.)

---

## 12. Audit, Nutzung, Diagramme

Jede Aktion wird mit Nutzer, Team, Modus, Werkzeug und Ergebnis protokolliert – als OpenTelemetry-Spans (wenn
`OTEL_EXPORTER_OTLP_ENDPOINT` gesetzt ist) und lokal in `~/.bobi/audit/<tag>.jsonl` (nur für den Nutzer lesbar,
Geheimnisse maskiert). Auch deine Antwort auf jede Freigabe wird festgehalten.

```bash
bobi audit --from 2026-10-01 > audit.md       # Nutzer, Modi, Werkzeuge, Entscheidungen, Aktionen außerhalb des Projekts, Ablehnungen
bobi usage --team payments                    # Aufgaben, Tokens, Werkzeugaufrufe, übernommene/abgelehnte Änderungen
bobi diagram --depth 2                        # Import-Graph eines TS/JS-Projekts als Mermaid
```

Team setzen: `"telemetry": { "team": "payments" }` oder `BOBI_TEAM`. **Zeitersparnis** ist nicht messbar; sie
erscheint nur als ausgewiesene Schätzung, wenn ihr sie konfiguriert:

```jsonc
{ "usage": { "minutesPerTask": 10, "minutesPerAcceptedChange": 5 } }
```

### Änderungsprotokoll (Dossier)

Zu jeder Sitzung kannst du ein **signiertes Änderungsprotokoll** erzeugen: Auftrag (Prompt), Modus, Modell, jeder
Werkzeugaufruf mit Datei bzw. Befehl, jede Freigabe und – auf Wunsch – das Ergebnis eines Testlaufs und der Diff. Die
Einträge sind verkettet (jeder enthält den Hash des vorigen) und der Kopf ist mit deinem Schlüssel signiert. Wer das
Protokoll später ändert, kürzt oder umsortiert, wird beim Prüfen erkannt.

```bash
bobi dossier --list                                           # Sitzungen im Audit-Log (mit Zahl der Aufgaben)
bobi dossier --list --session <id>                            # die Aufgaben (Prompts) einer Sitzung
bobi dossier --out aenderung.json --diff --test "bun test"    # letzte Sitzung versiegeln (Tests und Diff dazu)
bobi dossier --task last --out aufgabe.json                   # nur die letzte Aufgabe (oder --task 2, mit --session)
bobi dossier verify aenderung.json                            # Kette und Signatur prüfen: „NOT VERIFIED“, Exit-Code 2
bobi dossier verify aenderung.json --key kollege.pub.pem      # erst damit verifiziert: mit DIESEM Schlüssel signiert (Exit 0)
```

Der Schlüssel liegt in `~/.bobi/keys/dossier-ed25519.pem` (nur für dich lesbar). Ohne `--key` beweist die Prüfung nur,
dass das Protokoll unverändert ist – wer es signiert hat, weißt du erst, wenn du den öffentlichen Schlüssel der Person
vorab kennst. Der Diff ist der Stand beim Versiegeln (nicht beim Entstehen der Änderung).

**Pro Aufgabe statt pro Sitzung (ADR-0026).** Eine Aufgabe ist ein Prompt: Sie beginnt mit dem Auftrag und reicht bis
zum nächsten Auftrag derselben Sitzung. Mit `--task` enthält das Protokoll nur diese Aufgabe; die Aufgabennummer ist
mit signiert, ein Aufgaben-Protokoll lässt sich also weder als ganze Sitzung noch als andere Aufgabe ausgeben. Ältere
Protokolle bleiben gültig. Grenze: Der Diff mit `--diff` ist weiterhin der Stand des Projekts beim Versiegeln, nicht
nur die Änderungen dieser einen Aufgabe (Bobi merkt sich den Arbeitsstand nicht pro Aufgabe); Bobi weist beim Versiegeln
darauf hin.

### Modellvergleich auf deinem Code

Dieselbe Aufgabe mit zwei bis vier Modellen, jedes in einem eigenen, frischen Git-Worktree von `HEAD`; danach läuft
derselbe Testbefehl auf jedem Ergebnis. Dein Projektordner bleibt unberührt, die Worktrees werden gelöscht.

```bash
bobi compare --models gross,klein --test "bun test" --out vergleich.json "Behebe den Rundungsfehler in src/checkout.ts"
```

Ausgabe: Tabelle mit Lauf, Test bestanden/nicht, Zeit, geänderte Dateien, +/- Zeilen, Werkzeugaufrufe und Tokens je
Modell; die Diffs stehen in `vergleich.json`. Die Modelle müssen am konfigurierten Endpunkt angeboten werden. Regeln:

- **Nur Datei-Änderungen** werden in den Worktrees automatisch freigegeben. Shell, Netzwerk usw. fragen wie immer – ein
  Lauf ohne Bildschirm kann nicht antworten, also sind sie verweigert (steht im Bericht). Den Testbefehl führt Bobi selbst aus.
- **Der Testbefehl fragt vorher:** Er läuft auf den Dateien, die das Modell geschrieben hat (Tests, Skripte,
  `package.json`), direkt auf deinem Rechner und außerhalb der Sandbox. Bobi zeigt deshalb pro Modell den Diff und
  fragt, bevor der Test läuft. Ohne Terminal wird der Test übersprungen; `--trust-tests` führt ihn ohne Frage aus
  (nur in einer Wegwerf-Umgebung verwenden).
- Voraussetzung: Git-Projekt mit mindestens einem Commit; nicht eingecheckte Änderungen fließen nicht ein.
- Ein Lauf pro Modell ist eine Momentaufnahme, kein Benchmark: mehrfach wiederholen, bevor du entscheidest.
- Jeder Lauf steht im Audit-Log, ist also mit `bobi dossier` belegbar.

### Signierte Registry für Skills und Slash-Befehle

Skills und Befehle sind Anweisungen an das Modell – ein manipulierter Skill wäre ein Einfallstor. Deshalb gibt es
keinen öffentlichen Marktplatz, sondern Pakete, die der Herausgeber signiert und die du nur von Herausgebern installierst,
denen du ausdrücklich vertraust. Eine Registry ist einfach ein Ordner (Netzlaufwerk, Git-Checkout) mit Paketdateien.

```bash
# Herausgeber (Anna)
bobi registry key > anna.pub.pem                       # öffentlichen Schlüssel weitergeben
bobi registry pack skills/review-style --version 1.0.0 --out registry/

# Nutzer (Ben)
bobi registry trust anna.pub.pem                       # einmalig: Anna vertrauen
bobi registry list --from registry/                    # was gibt es?
bobi registry install review-style --from registry/    # prüft Signatur, Hashes, Pfade, Größe; installiert
bobi registry list                                     # was ist installiert, von wem?
bobi registry untrust <schluessel-id>                  # Vertrauen entziehen
```

Abgelehnt werden: unbekannte Herausgeber, veränderte Dateien, unsichere Pfade (`..`, versteckte Dateien, Links),
Downgrades und fremde Dateien gleichen Namens (mit `--force` überschreibbar – außer Signatur und Vertrauen). MCP-Server und
IDE-Erweiterungen führen Code aus und sind bewusst nicht Teil der Registry (ADR-0023). Wichtig: Ein gestohlener
Herausgeber-Schlüssel erlaubt signierte Schad-Skills, bis ihm das Vertrauen entzogen wird.

**Pakete sperren (Sperrliste, ADR-0025).** Ist *ein* Paket falsch (z. B. ein Token im Skill) oder ein Schlüssel
gestohlen, kann ein vertrauter Herausgeber eine signierte Sperrliste in den Registry-Ordner legen:

```bash
bobi registry revoke review-style --reason "enthält ein Token" --out registry/           # alle Versionen
bobi registry revoke review-style --version 1.0.0 --reason "fehlerhaft" --out registry/  # nur diese Version
bobi registry revoke --key-id <schluessel-id> --reason "Schlüssel gestohlen" --out registry/
bobi registry verify paket.bobipkg.json                  # zeigt den Hash für --hash (genau ein Build)
```

Nutzer übernehmen die Liste beim Installieren oder mit `check`:

```bash
bobi registry check --from registry/              # meldet gesperrte, schon installierte Pakete (Exit 1)
bobi registry check --from registry/ --remove     # entfernt genau diese Pakete
```

Ein gesperrtes Paket lässt sich nicht installieren, auch nicht mit `--force`. Eine ältere Liste als die zuletzt
gesehene wird abgelehnt (niemand kann eine Sperre durch Zurücklegen einer alten Datei aufheben). Eine Liste, die
nicht stimmt oder von einem nicht vertrauten Herausgeber stammt, ist ein Fehler – kein stilles Ignorieren.
Grenzen: Bobi prüft nicht von selbst; die Sperre wirkt erst bei `install` oder `check`. Bereits installierte,
gesperrte Pakete bleiben aktiv, bis du `check --remove` ausführst.

---

## 13. Sicherheit und Sandbox

| Schutz | Umsetzung |
|---|---|
| Kein Code verlässt das Netz | nur der konfigurierte Modell-Endpunkt; Herstellerdienste der Engine sind abgeschaltet |
| Freigaben | Standard „fragen“ für Schreiben, Terminal, Netz; Policy versioniert im Repo |
| Prompt Injection | Inhalte aus Dateien, Terminal, Web und MCP werden als `<untrusted-data>` markiert; Rechte erzwingt Bobi, nicht das Modell |
| Geheimnisse | Maskierung bekannter Formate (Tokens, Schlüssel, Passwörter) in Prompts, Logs, Audit; Schlüssel nur aus der Umgebung |
| `.bobiignore` | für Lesen, Suche und gängige Terminal-Befehle; in der Sandbox zusätzlich per leerem Mount |
| Sandbox | Server und Werkzeuge im Container, ohne Root, ohne Produktivdaten |
| Netzwerk | nur über einen Egress-Proxy mit Allowlist |
| Audit | jede Aktion über OpenTelemetry, an Langfuse oder jedes andere Backend |

### Security-Gate in GitHub

Jeder Pull Request und jeder Push (also auch jeder Merge nach `main`) läuft durch `.github/workflows/security.yml`: Semgrep,
gitleaks (Geheimnisse), `bun audit` (Abhängigkeiten) und Trivy (Fehlkonfiguration). Ein Pull Request scheitert nur an dem,
was er neu hinzufügt. Der Check `security-gate` fasst alles zusammen. Damit nichts Rotes nach `main` kommt, braucht `main`
eine Sperrregel (nur Pull Requests, `security-gate` muss grün sein); der Befehl dafür steht in
[docs/security/security-gate.md](security/security-gate.md).

Optional kommentiert Bobi selbst den Pull Request: Modus `security-ci` (nur lesen), Befunde mit Schweregrad und Fix,
nur auf einem Self-hosted Runner in eurem Netz. Das ist ein Rat, keine Entscheidung; der Kommentar blockiert nie.

### Sandbox starten

```bash
podman machine init && podman machine start          # einmalig
podman build -f sandbox/Containerfile -t bobi:dev .
export BOBI_SERVER_PASSWORD="$(openssl rand -base64 24)" BOBI_MODEL=<modell> BOBI_MODEL_API_KEY=<schlüssel>
export BOBI_EGRESS_ALLOW="litellm.intranet:4000,mf.intranet:443"
sandbox/bobi-sandbox.sh up ~/projekte/payments
cd ~/projekte/payments && bobi attach http://127.0.0.1:4096
sandbox/bobi-sandbox.sh status        # Container und Egress-Entscheidungen
sandbox/bobi-sandbox.sh down
```

### Bobi als Container (Docker oder Podman)

`compose.yaml` startet Bobi mit demselben Sicherheitsmodell wie die Sandbox: **server** (ohne Root, ohne
Capabilities, nur im internen Netz), **egress** (einziger Weg nach draußen, nur Ziele aus der Allowlist),
**gateway** (reicht nur `127.0.0.1:4096` zum Server durch) und optional **mock-model** (Profil `demo`).

Docker auf dem Mac **ohne Docker Desktop** (Docker Desktop ist für große Unternehmen kostenpflichtig):

```bash
brew install colima docker docker-compose
mkdir -p ~/.docker/cli-plugins && ln -sfn /opt/homebrew/opt/docker-compose/bin/docker-compose ~/.docker/cli-plugins/docker-compose
colima start --cpu 4 --memory 6
```

Bobi für ein Projekt starten:

```bash
export BOBI_PROJECT=$HOME/projekte/payments                 # absoluter Pfad
export BOBI_SERVER_PASSWORD="$(openssl rand -base64 24)"
mkdir -p ~/.bobi/data/shadow ~/.bobi/trust
bun sandbox/compose-masks.ts "$BOBI_PROJECT" > compose.override.yaml   # .bobiignore-Dateien im Container verbergen

# Ausprobieren mit dem Test-Modell:
BOBI_MODEL_BASE_URL=http://mock-model:4001/v1 docker compose --profile demo up -d --build
# Mit eurem Gateway (muss in der Allowlist stehen):
BOBI_MODEL_BASE_URL=http://litellm.intranet:4000/v1 BOBI_MODEL=<modell> BOBI_MODEL_API_KEY=<schlüssel> \
  BOBI_EGRESS_ALLOW=litellm.intranet:4000 docker compose up -d --build

cd "$BOBI_PROJECT" && bobi attach http://127.0.0.1:4096   # Terminal-Oberfläche gegen den Container
docker compose logs -f egress                            # welche Ziele erlaubt oder blockiert wurden
docker compose down
```

Ein Modell auf dem eigenen Rechner erreicht der Container als `host.docker.internal` (Standard:
`http://host.docker.internal:4000/v1`, bereits in der Allowlist). Mit Podman funktionieren dieselben Befehle als
`podman compose …`.

### Fertiges Image aus GitHub Packages

Bei jedem Merge auf `main` baut GitHub Actions das Image für **linux/amd64 und linux/arm64** und legt es unter
`ghcr.io/weski17/bobi` ab – privat wie das Repository. Tags: `latest`, `sha-<commit>`, bei Release-Tags `vX.Y.Z`
auch `X.Y.Z` und `X.Y`.

```bash
gh auth refresh -s read:packages                         # einmalig: Leserecht für Pakete
gh auth token | docker login ghcr.io -u <github-name> --password-stdin
docker pull ghcr.io/weski17/bobi:latest
BOBI_IMAGE=ghcr.io/weski17/bobi:latest docker compose up -d   # ohne lokalen Build
```

Ohne Registry weitergeben: `docker save bobi:1.3.0 | gzip > bobi-1.3.0.tar.gz`, auf dem Zielrechner
`docker load < bobi-1.3.0.tar.gz`.

Zum Bauen braucht Docker das Plugin `buildx` (`brew install docker-buildx` und
`ln -sfn /opt/homebrew/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx`); mit Podman geht es direkt.

### Demo zum Ausprobieren (Image mit Modell)

> Für den Betrieb auf einem Server (Link für alle): [DEPLOYMENT.md](DEPLOYMENT.md).

Das Image `ghcr.io/weski17/bobi-demo` enthält **alles**, damit Kolleginnen und Kollegen jede Funktion ohne
Installation und ohne eigenes Modell ausprobieren können: den Bobi-Server, ein lokales Modell (Ollama mit
Qwen3 4B Instruct, Apache-2.0) und ein Terminal im Browser. Der Demo-Container hat **kein Internet** – das Modell
steckt im Image.

Auf einem Linux-Server oder Mac mit Docker (etwa 8 GB RAM und 4 CPU-Kerne frei):

```bash
gh auth token | docker login ghcr.io -u <github-name> --password-stdin        # Image ist privat
curl -fsSLO https://raw.githubusercontent.com/weski17/bobi/main/compose.demo.yaml   # oder aus dem Repo kopieren
export DEMO_PASSWORD="$(openssl rand -base64 18)"                              # mind. 12 Zeichen – gebt es den Testern weiter
DEMO_BIND=0.0.0.0 docker compose -f compose.demo.yaml up -d                    # nur lokal: ohne DEMO_BIND → 127.0.0.1
```

Dann im Browser öffnen, Benutzer `demo`, das Passwort eingeben:

- **`http://<server>:7682` – Web-Chat:** das Chat-Panel der IDE als Webseite (Modus wählen, Antworten mitlesen, Änderungen als
  Diff freigeben oder ablehnen, Rückgängig). Der bequemste Einstieg, ohne Terminal. Alle Besucher teilen hier einen
  Arbeitsordner (Kopie des Beispielprojekts); *Rückgängig* nimmt die Änderungen der letzten Anfrage zurück.
- **`http://<server>:7681` – Web-Terminal** mit allen Funktionen. Das Menü bietet:
**1)** Bobi starten (Chat, Modi, Freigaben, Diffs, Slash-Befehle), **2)** Beispiele zum Ausprobieren, **3)** Code-Tipps,
**4)** COBOL-Diagramm, **5)** Nutzung und Audit, **6)** A2A-Agentenkarte, **7)** Shell, **8)** Beispielprojekt zurücksetzen.
Jede Browser-Sitzung arbeitet an einer eigenen Kopie eines Beispielprojekts (TypeScript mit Fehler und unübersichtlicher
Funktion, `.bobiignore` mit erfundenen Geheimnissen, Projektregeln, Skills, eigener Befehl und Modus, COBOL/JCL).

Gut zu wissen:

- **Geschwindigkeit:** Das Modell läuft auf der CPU (nur eine Anfrage gleichzeitig, `DEMO_PARALLEL`; Sitzungstitel ohne
  Modellaufruf). Gemessen auf einem Mac in einer Linux-VM (6 Kerne): rund 25 Token/s beim Lesen des Prompts und 7 Token/s
  beim Schreiben, eine einfache Frage mit Dateizugriff dauert 1,5–3 Minuten; ein Linux-Server mit modernen x86-Kernen ist
  oft schneller. Tipp: dem kleinen Modell genau sagen, welche Datei es lesen soll. Die erste Antwort nach dem Start dauert (Modell wird geladen), danach
  Sekunden bis Minuten pro Antwort. Es ist deutlich schwächer als ein großes Gateway-Modell – die Demo zeigt die
  Funktionen, nicht die Modellqualität.
- **Sicherheit:** Passwort ist Pflicht, Container ohne Root und ohne Capabilities, Dateisystem schreibgeschützt, kein
  Internet. Das Terminal im Browser überträgt Passwort und Tastatureingaben: **außerhalb eines vertrauenswürdigen Netzes
  TLS davorschalten** (Reverse-Proxy wie Caddy oder nginx auf `http://127.0.0.1:7681`) oder ein Zertifikat nach
  `/run/tls/tls.crt` und `tls.key` einhängen (Zeile in `compose.demo.yaml` einkommentieren).
- **Gemeinsam genutzt:** alle Besucher teilen das Modell, das Login und den Bobi-Server; Dateien und Sitzungen sind getrennt,
  Nutzung und Audit der Demo (Menüpunkt 5) sind gemeinsam.
- **Nicht dabei:** Bobi IDE (Desktop-App) und Autovervollständigung. Die IDE lässt sich lokal mit eurem Gateway betreiben.
  Eine Web-IDE ist nur experimentell und nicht im Standard-Image (Port 7683, ADR-0021); der Web-Chat ersetzt ihr leeres Chat-Panel (ADR-0024).
- **Zurücksetzen:** `docker compose -f compose.demo.yaml down -v` löscht auch Audit und Nutzung der Demo.
- **Aktualisieren:** `docker compose -f compose.demo.yaml pull && docker compose -f compose.demo.yaml up -d`.

**Automatisch ausrollen (CD):** `.github/workflows/deploy.yml` zieht nach jedem erfolgreichen Image-Build das getestete
Image auf euren Server. Einmal einrichten – GitHub → Settings → Secrets and variables → Actions:
Variablen `DEPLOY_HOST`, `DEPLOY_USER` (optional `DEPLOY_PATH`), Secrets `DEPLOY_SSH_KEY` (Schlüssel eines Benutzers, der nur
`docker compose` ausführen darf) und `DEPLOY_KNOWN_HOSTS` (Ausgabe von `ssh-keyscan -t ed25519 <server>`). Auf dem Server
einmal Docker mit Compose installieren und `~/bobi-demo/.env` mit `DEMO_PASSWORD=…` anlegen; der Workflow fasst diese
Datei nie an. Ohne diese Einstellungen tut der Workflow nichts (und sagt es). Manuell starten: Actions → deploy → Run workflow.

---

## 14. Betrieb

- **Ein Server pro Arbeitsplatz oder Team.** Die IDE startet automatisch einen Server pro Workspace. Lasttest
  (Mock, 200 ms je Modellaufruf): 100 parallele Sitzungen ohne Fehler, p95 ≈ 2,3 s; bei 20 Sitzungen p95 ≈ 1 s.
- **Server im Netz:** `bobi serve --hostname 0.0.0.0` verlangt `BOBI_SERVER_PASSWORD` (mind. 16 Zeichen).
- **Telemetrie:** `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` (Header über
  `OTEL_EXPORTER_OTLP_HEADERS`). Langfuse kann die Spans direkt empfangen.
- **Daten:** `~/.bobi` bzw. `BOBI_HOME` – `config.jsonc`, `custom_modes.yaml`, `rules*/`, `skills/`, `commands/`,
  `trust/projects.json`, `audit/`, `data/bobi.db`, `data/shadow/`, `data/log/server.log`.

---

## 15. Konfigurationsreferenz

Reihenfolge (später gewinnt): eingebaute Standards → `~/.bobi/config.jsonc` → `<projekt>/.bobi/config.jsonc` (nur
bei Vertrauen) → `BOBI_CONFIG` → Umgebungsvariablen. Geheimnisse sind in Dateien verboten; Bobi meldet sie als Fehler.

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `model.baseURL` | OpenAI-/Anthropic-kompatibler Endpunkt | `http://localhost:4000/v1` |
| `model.protocol` | `openai` oder `anthropic` | `openai` |
| `model.apiKeyEnv` | Name der Variablen mit dem Schlüssel | `BOBI_MODEL_API_KEY` |
| `model.default`, `model.models` | Standardmodell, weitere wählbare Modelle | `default`, `[]` |
| `modes.<slug>.model` | Modell pro Modus | – |
| `autoApprove[]` | `{ action: edit\|shell\|webfetch\|browser\|mcp\|external_directory, resource, modes? }` | `[]` |
| `checkpoints.enabled` | Checkpoints | `true` |
| `mcp.servers`, `mcp.timeout` | MCP-Server (siehe [Kapitel 9](#9-mcp)) | `{}` |
| `telemetry.otlpEndpoint`, `.user`, `.team`, `.auditLog` | Telemetrie, Nutzer, Team, lokales Audit-Log | –, `$USER`, –, `true` |
| `autocomplete.model`, `.maxTokens` | Modell für die Autovervollständigung (aus `model.models`) – ohne Modell aus | – |
| `sessions.titles` | `model`: das Modell erzeugt den Sitzungstitel (eine Zusatzanfrage); `local`: Titel aus der ersten Nachricht, ohne Modellaufruf | `model` |
| `tips.enabled`, `.complexity`, `.functionLines`, `.nesting`, `.parameters` | Code-Tipps | `true`, 10, 60, 4, 5 |
| `usage.minutesPerTask`, `.minutesPerAcceptedChange` | Schätzung der Zeitersparnis | – |
| `a2a.enabled` | andere Agenten dürfen Bobi fragen (nur global) | `false` |
| `a2a.agents.<name>` | `{ url, headers?, description? }` | `{}` |

| Umgebungsvariable | Bedeutung |
|---|---|
| `BOBI_HOME` | Datenverzeichnis (Standard `~/.bobi`) |
| `BOBI_CONFIG` | zusätzliche Konfigurationsdatei |
| `BOBI_MODEL_BASE_URL`, `BOBI_MODEL`, `BOBI_MODEL_PROTOCOL`, `BOBI_MODEL_API_KEY` | Modell-Endpunkt |
| `BOBI_USER`, `BOBI_TEAM` | Nutzer und Team im Audit |
| `BOBI_SERVER_PASSWORD` | Passwort für `serve`/`attach` |
| `BOBI_A2A` | `1`/`true`: eingehendes A2A |
| `BOBI_A2A_TOKEN` | Token für eingehendes A2A (Pflicht, ≥ 24 Zeichen, nur für `/a2a` gültig) |
| `BOBI_SESSION_TITLES` | `model` oder `local` (siehe `sessions.titles`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | OpenTelemetry |
| `ZOWE_OPT_*`, `BOBI_ZOWE_PROFILE`, `BOBI_ZOWE_DATASETS`, `BOBI_ZOWE_USS`, `BOBI_ZOWE_JOB_OWNERS` | Mainframe |
| `BOBI_EGRESS_ALLOW`, `BOBI_SANDBOX_PORT`, `BOBI_IMAGE` | Sandbox |
| `BOBI_BRANDING_DIR` | eigenes IDE-Logo beim `ide:setup` |

Eine kommentierte Vorlage aller Einstellungen: [`bobi.example.jsonc`](../bobi.example.jsonc).

---

## 16. Qualität und Tests

| Befehl | Was |
|---|---|
| `bun run test` / `bun run test:coverage` | Unit-, Integrations-, Red-Team- und Kurzlasttests (Mock-Modell, kein Netz) – Abdeckungsgrenze 80 % |
| `bun run typecheck` | TypeScript |
| `bun run test:e2e` | Terminal-Oberfläche inkl. Freigabe per Tastatur |
| `bun run test:ide` | Integrationstest in der echten IDE |
| `bun run test:sandbox` | Sandbox: Allowlist, unprivilegierter Nutzer, `.bobiignore`-Mounts, MCP im Container |
| `bun run test:redteam` | Red-Team mit promptfoo (8 Angriffe gegen ein absichtlich kompromittiertes Modell) |
| `bun run test:load -- --sessions 100` | Lasttest mit p50–p99 |

Gegen euren echten Endpunkt:

```bash
BOBI_REDTEAM_BASE_URL=http://litellm:4000/v1 BOBI_REDTEAM_MODEL=<modell> bun run test:redteam
BOBI_LOAD_BASE_URL=http://litellm:4000/v1 BOBI_LOAD_MODEL=<modell> bun run test:load -- --sessions 20
```

Stand der letzten Prüfung (2026-10-20): 397 Tests grün (98 % Zeilenabdeckung), E2E 5/5, IDE-Test bestanden,
Sandbox 7/7, Red-Team 8/8, Semgrep 0 Befunde, Lasttest 300 Aufträge ohne Fehler.

---

## 17. Fehlerbehebung

| Problem | Lösung |
|---|---|
| „model endpoint not reachable“ | `model.baseURL` prüfen; in der Sandbox den Host in `BOBI_EGRESS_ALLOW` aufnehmen. |
| Projektregeln/Modi werden ignoriert | Projekt ist nicht vertrauenswürdig: `bobi trust --status`, ggf. `bobi trust --yes`. |
| MCP-Server fehlt | Variable aus `${…}` nicht gesetzt (Meldung „disabled: missing environment variable“) oder Modus ohne `mcp`. |
| Keine Autovervollständigung | `autocomplete.model` setzen und in `model.models` aufnehmen; nur mit `protocol: openai`. |
| „outside the allowed datasets“ | `BOBI_ZOWE_DATASETS` vom Admin erweitern lassen. |
| „rejectUnauthorized: false is not supported“ | CA-Zertifikat per `NODE_EXTRA_CA_CERTS` hinterlegen. |
| `bobi run` hängt in Skripten | stdin schließen: `bobi run "…" </dev/null`. |
| `docker compose`: „set BOBI_PROJECT …“ | `BOBI_PROJECT` (absoluter Projektpfad) und `BOBI_SERVER_PASSWORD` setzen. |
| `docker compose`: Modell nicht erreichbar | Ziel in `BOBI_EGRESS_ALLOW` aufnehmen; `docker compose logs egress` zeigt blockierte Ziele. |
| `docker: Cannot connect to the Docker daemon` | `colima start` (nach einem Neustart des Macs nötig). |
| Demo: „DEMO_PASSWORD … at least 12 characters“ | `DEMO_PASSWORD` mit mindestens 12 Zeichen setzen (Umgebung oder `.env`). |
| Demo: Antworten kommen sehr langsam oder gar nicht | Mindestens 8 GB RAM und 4 Kerne einplanen (`DEMO_MEMORY`, `DEMO_CPUS`); beim ersten Start wird das Modell erst geladen (bis zu 2 Minuten). |
| Demo: Browser meldet Verbindungsfehler | Port prüfen (`DEMO_PORT`), `DEMO_BIND=0.0.0.0` für Zugriff aus dem Netz, `docker compose -f compose.demo.yaml logs demo`. |
| Git meldet „dubious ownership“ in der Sandbox | aktuelles `sandbox/bobi-sandbox.sh` verwenden (markiert nur Projekt und Checkpoints als sicher). |
| Antwort bricht mit „exceeds the available context size“ ab (Ollama: Fehler 400) | Ollama begrenzt den Kontext standardmäßig auf 4096 Token; Bobis Anfrage mit Werkzeugen und Dateiinhalten ist größer. Ollama mit `OLLAMA_CONTEXT_LENGTH=16384 ollama serve` starten. |
| Ein eigener MCP-Server liefert nach einer Code-Änderung noch den alten Stand | Ein MCP-Server startet einmal pro Projekt und behält seinen Code im Speicher. Den Bobi-Server (oder die IDE) neu starten. |
| Engine-Logs | `~/.bobi/data/log/server.log` |

---

## 18. Grenzen und bekannte Risiken

- Einem **vertrauenswürdigen** Projekt glaubt Bobi dessen AGENTS.md und Regeln – Vertrauen ist eine bewusste Entscheidung.
- Außerhalb der Sandbox schützt `.bobiignore` im Terminal nur gängige Lesebefehle; die echte Grenze ist die Sandbox.
- Die Maskierung arbeitet mit Mustern; unbekannte Geheimnisformate können durchrutschen (bekannte Werte wie der
  API-Schlüssel werden immer maskiert). Geheimnisse in Projektdateien landen in Checkpoints.
- Der COBOL-Parser deckt den CardDemo-Dialekt ab; Compiler-Erweiterungen, `REPLACE` und verschachtelte Programme
  werden nicht analysiert.
- Der Mainframe-Zugriff ist gegen einen Mock getestet, noch nicht gegen ein echtes System. Abgeschickte JCL kann
  alles, was der Job-Nutzer darf – die Freigabe bleibt entscheidend.
- Eingehendes A2A nutzt ein gemeinsames Token für alle aufrufenden Agenten (keine Identität pro Agent).
- Bei vielen parallelen Sitzungen auf einem Server steigt Bobis Eigenanteil an der Antwortzeit (≈ 1,1 s bei 100).
- Bobi IDE läuft aus den Quellen; ein verteilbares Paket muss die proprietären Copilot-Pakete von Code-OSS entfernen.
- Die Video-Tour wird mit Piper und der frei lizenzierten Stimme „Thorsten“ vertont (Modell MIT, Daten CC0); der
  Fallback mit der macOS-Stimme ist nur für Entwürfe gedacht (Apple-Lizenz: nicht-kommerziell).
