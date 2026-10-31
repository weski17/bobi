#!/usr/bin/env bash
# One browser session: a private copy of the sample project and a menu with everything to try.
unset DEMO_PASSWORD NO_COLOR
export TERM="${TERM:-xterm-256color}"
URL=http://127.0.0.1:4096
WS="$(mktemp -d /tmp/bobi-demo.XXXXXX)"
trap 'rm -rf "$WS"' EXIT

b=$'\e[1m'; d=$'\e[2m'; g=$'\e[38;5;86m'; v=$'\e[38;5;141m'; y=$'\e[33m'; r=$'\e[0m'

reset_workspace() {
  rm -rf "${WS:?}"/* "$WS"/.[!.]* 2> /dev/null
  cp -a /opt/demo/workspace/. "$WS"/
  ( cd "$WS" && git init -q -b main && git add -A && git -c user.name="Bobi Demo" -c user.email=demo@bobi.local commit -qm "Beispielprojekt" )
}
reset_workspace

wait_for_model() {
  if curl -fsS http://127.0.0.1:11434/api/ps 2> /dev/null | grep -q "$BOBI_MODEL"; then return; fi
  printf '%s' "${y}Das Modell wird geladen (nach dem Start einmalig, bis zu 2 Minuten) …${r}"
  for _ in $(seq 1 180); do
    curl -fsS http://127.0.0.1:11434/api/ps 2> /dev/null | grep -q "$BOBI_MODEL" && { echo " bereit."; return; }
    sleep 1; printf '.'
  done
  echo " dauert ungewöhnlich lange – du kannst trotzdem starten."
}

pause() { echo; read -r -p "${d}Enter drücken, um zum Menü zurückzukehren …${r}" _; }

banner() {
  clear
  cat <<BANNER
${g}${b}  ____        _     _
 |  _ \\      | |   (_)     ${r}${b}Bobi Demo${r}
${g}${b} | |_) | ___ | |__  _      ${r}${d}Dein KI-Entwicklungspartner – komplett on-premise${r}
${g}${b} |  _ < / _ \\| '_ \\| |     ${r}${d}Modell: ${BOBI_MODEL} (läuft lokal in diesem Container)${r}
${g}${b} | |_) | (_) | |_) | |
 |____/ \\___/|_.__/|_|${r}

BANNER
}

tips() {
  cat <<TIPS
${b}Das kannst du ausprobieren${r} ${d}(in „Bobi starten“; Modus wechseln mit Shift+Tab)${r}
${d}Das Modell ist klein: nenne ihm genau, welche Datei es lesen soll – dann arbeitet es am besten.${r}

${g}Modus code${r}       „Lies src/checkout.ts und test/checkout.test.ts, finde den Fehler in total(), repariere ihn
                  und führe bun test aus.“  ${d}→ Bobi liest, ändert, fragt vor Änderung und Befehl nach Freigabe.${r}
${g}Modus ask${r}        „Lies src/checkout.ts und erkläre sie in zwei Sätzen.“  ${d}(nur lesen, ändert nichts)${r}
${g}Modus plan${r}       „Lies src/checkout.ts und plane, wie wir Rabattcodes aus einer Datei laden.“
${g}Modus advanced${r}   „Nutze code-graph_callers und nenne die Aufrufer von total.“ ${d}(Code-Graph)${r}
                  „Nutze cobol_impact mit copybook EMPREC: Was betrifft eine Änderung?“ ${d}(COBOL)${r}
${g}Modus security${r}   „Lies src/rules.ts und src/checkout.ts und prüfe sie auf Schwachstellen.“
${g}Modus orchestrator${r} „Dokumentiere src/checkout.ts in README.md.“ ${d}(verteilt an andere Modi)${r}

${g}Slash-Befehle${r}    /init  ·  /commit  ·  /pr  ·  /security-review  ·  /explain src/rules.ts ${d}(eigener Befehl)${r}
${g}Geheimnisse${r}      „Lies secrets/prod.env.“ ${d}→ steht in .bobiignore, Bobi bekommt die Datei nie zu sehen.${r}
${g}Rückgängig${r}       Jede Änderung ist gesichert; im Chat lässt sie sich zurücknehmen.

${b}Im Menü${r}: Code-Tipps (3), COBOL-Diagramm (4), Nutzung und Audit (5), A2A-Agentenkarte (6).
${y}Hinweis:${r} Das Modell (4 Mrd. Parameter) läuft auf der CPU: Antworten brauchen Geduld und sind nicht so stark
wie bei einem großen Modell. In echten Installationen läuft Bobi mit eurem eigenen Gateway.
TIPS
}

while true; do
  banner
  cat <<MENU
  ${g}1${r}) Bobi starten ${d}(interaktiv: Chat, Modi, Freigaben, Diffs, Slash-Befehle)${r}
  ${g}2${r}) Beispiele und Tipps zum Ausprobieren
  ${g}3${r}) Code-Tipps für das Beispielprojekt          ${d}bobi tips src${r}
  ${g}4${r}) COBOL-Diagramm aus dem Mainframe-Beispiel   ${d}bobi diagram cobol mainframe${r}
  ${g}5${r}) Nutzungsstatistik und Audit dieser Demo     ${d}bobi usage · bobi audit${r}
  ${g}6${r}) Agentenkarte (A2A) abrufen
  ${g}7${r}) Shell im Beispielprojekt ${d}(volle Kontrolle)${r}
  ${g}8${r}) Beispielprojekt zurücksetzen
  ${g}q${r}) Beenden

MENU
  read -r -p "  Auswahl: " choice || exit 0
  echo
  case "$choice" in
    1) wait_for_model; ( cd "$WS" && bobi --trust attach "$URL" ) ;;
    2) tips; pause ;;
    3) ( cd "$WS" && bobi tips src ); pause ;;
    4) ( cd "$WS" && bobi diagram cobol mainframe ); echo; echo "${d}Mermaid-Text – in einen Viewer wie mermaid.live einfügen.${r}"; pause ;;
    5) bobi usage; echo; bobi audit | head -30; pause ;;
    6) curl -fsS "$URL/.well-known/agent-card.json" | bun -e 'console.log(JSON.stringify(await Bun.stdin.json(), null, 2))'; pause ;;
    7) echo "${d}Shell im Beispielprojekt. „exit“ führt zurück zum Menü.${r}"; ( cd "$WS" && PS1='bobi-demo \W $ ' bash --norc -i ) ;;
    8) reset_workspace; echo "Beispielprojekt zurückgesetzt."; sleep 1 ;;
    q|Q) exit 0 ;;
  esac
done
