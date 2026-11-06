# Demo auf einem Server betreiben (Schritt für Schritt)

Ziel: Kolleginnen und Kollegen öffnen **einen Link im Browser**, melden sich an und probieren Bobi aus – ohne etwas zu
installieren oder zu konfigurieren. Das Modell steckt im Image. Das Vorgehen ist für Windows, macOS und Linux gleich,
weil nur der Browser gebraucht wird.

Was hier beschrieben ist, passt zu `compose.demo.yaml` und `.github/workflows/deploy.yml`. Die Schritte zu Caddy und zur
Firewall (Abschnitte 6 und 7) wurden in diesem Repository **nicht auf einem echten Server getestet** – prüfe sie beim ersten Mal.

## 1. Was du brauchst

| Was | Richtwert |
|---|---|
| Linux-Server (Ubuntu 24.04 o. Ä.), eigene IP, SSH-Zugang | 4 CPU-Kerne, 8 GB RAM, 20 GB Platz – ca. 15–30 € im Monat |
| Domain oder Subdomain, z. B. `demo.firma.de`, die auf die Server-IP zeigt | für HTTPS |
| GitHub-Zugriff auf dieses Repository (Einstellungen ändern) | für das automatische Ausrollen |

Ohne GPU antwortet das Modell in Sekunden bis Minuten pro Antwort; es bedient praktisch eine Person gleichzeitig gut.
Für viele Gäste gleichzeitig braucht es einen größeren oder einen GPU-Server – das ist nicht getestet.

## 2. Server vorbereiten (einmalig, als root oder mit sudo)

```bash
# Docker mit Compose-Plugin (offizielle Anleitung: docs.docker.com/engine/install/ubuntu)
sudo apt-get update && sudo apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh

# Ein eigener Benutzer nur für das Ausrollen. Er darf Docker bedienen, sonst nichts.
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
```

Hinweis: Wer in der Gruppe `docker` ist, hat faktisch Root-Rechte auf dem Server. Nutze den Server deshalb nur für die Demo.

## 3. SSH-Schlüssel für das Ausrollen

Auf deinem Rechner (nicht auf dem Server):

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "bobi-deploy"
ssh-copy-id -i deploy_key.pub deploy@<server>        # oder den Inhalt in ~deploy/.ssh/authorized_keys eintragen
ssh-keyscan -t ed25519 <server> > known_hosts        # Fingerabdruck des Servers; prüfe ihn einmal gegen den echten
```

## 4. Passwort auf dem Server hinterlegen

Das Passwort steht **nur** auf dem Server, nie in GitHub oder im Repository:

```bash
ssh deploy@<server>
mkdir -p ~/bobi-demo && cd ~/bobi-demo
umask 077
printf 'DEMO_PASSWORD=%s\n' "$(openssl rand -base64 18)" > .env      # mindestens 12 Zeichen
cat .env                                                             # notieren – das gibst du den Gästen (Benutzer: demo)
```

Bleibt `DEMO_BIND` ungesetzt, hört die Demo nur auf `127.0.0.1` (richtig, wenn Caddy davor steht, Abschnitt 6).

## 5. GitHub einrichten

Repository → Settings → Secrets and variables → Actions:

| Typ | Name | Wert |
|---|---|---|
| Variable | `DEPLOY_HOST` | Servername oder IP |
| Variable | `DEPLOY_USER` | `deploy` |
| Secret | `DEPLOY_SSH_KEY` | Inhalt der Datei `deploy_key` (privater Schlüssel) |
| Secret | `DEPLOY_KNOWN_HOSTS` | Inhalt der Datei `known_hosts` |

Danach die lokalen Dateien `deploy_key` und `known_hosts` löschen oder sicher ablegen.

Ausrollen: bei jedem Merge auf `main` baut und testet GitHub das Image und rollt es dann automatisch aus. Zum ersten Mal von
Hand: Actions → **deploy** → *Run workflow*. Der Lauf kopiert `compose.demo.yaml`, meldet den Server für diesen Lauf bei ghcr.io
an, lädt das Image (mehrere GB, dauert beim ersten Mal), startet es und wartet, bis es „healthy“ meldet.

## 6. HTTPS mit Caddy (Passwort und Eingaben dürfen nicht unverschlüsselt durchs Netz)

Auf dem Server (als sudo-Benutzer), nach der Anleitung von caddyserver.com installieren, dann `/etc/caddy/Caddyfile`:

```
demo.firma.de {
	reverse_proxy 127.0.0.1:7681
}
```

```bash
sudo systemctl reload caddy
```

Der Web-Chat (Port 7682) bekommt eine eigene Adresse, z. B. `chat.firma.de` – ebenfalls auf die Server-IP zeigen lassen:

```
chat.firma.de {
	reverse_proxy 127.0.0.1:7682
}
```

Caddy holt das Zertifikat selbst (Let's Encrypt) und leitet WebSockets automatisch durch. Das Web-Terminal prüft, dass
die Anfrage von derselben Adresse kommt (`ttyd -O`); Caddy gibt den Host-Header unverändert weiter, daher geht das.

## 7. Firewall

Nur SSH und HTTPS nach außen. Die Demo-Ports 7681 und 7682 bleiben zu (die Demo hört ohnehin nur lokal):

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Achtung: Docker umgeht `ufw` für veröffentlichte Ports. Deshalb bindet `compose.demo.yaml` an `127.0.0.1` – lass
`DEMO_BIND=0.0.0.0` weg, solange Caddy davor steht.

## 8. Prüfen

1. `https://demo.firma.de` öffnen → Anmeldefenster; Benutzer `demo`, Passwort aus `.env`.
2. Menü erscheint → „Bobi starten“. Die erste Modellantwort braucht einen Moment (Modell wird geladen).
   Der Web-Chat unter `https://chat.firma.de` (gleiche Anmeldung) zeigt oben die Modi und nimmt Fragen entgegen.
3. Auf dem Server: `docker compose -f ~/bobi-demo/compose.demo.yaml ps` zeigt `healthy`.

## 9. Betrieb

```bash
cd ~/bobi-demo
docker compose -f compose.demo.yaml logs --tail 100       # Protokoll
docker compose -f compose.demo.yaml restart                # neu starten
docker compose -f compose.demo.yaml down -v                # stoppen und die Gast-Daten (Volumes) löschen
```

- **Passwort ändern:** `.env` bearbeiten, dann `docker compose -f compose.demo.yaml up -d`.
- **Zurückrollen:** Actions → deploy ist nur für `latest`/den Stand von `main`. Für einen älteren Stand auf dem Server
  `BOBI_DEMO_IMAGE=ghcr.io/<owner>/bobi-demo:sha-<commit>` vor `docker compose up -d` setzen (die Tags `sha-…` bleiben erhalten).
- **Gäste sehen nur ein Beispielprojekt** in einem Container ohne Internet; ihre Daten liegen in Docker-Volumes und bleiben
  bis `down -v` bestehen. Es gibt ein gemeinsames Passwort, keine Einzelkonten – ändere es, wenn jemand die Demo verlässt.

## 10. Wenn etwas nicht klappt

| Symptom | Ursache / Lösung |
|---|---|
| Deploy-Lauf zeigt „Deploy skipped“ | Eine der vier Einstellungen aus Abschnitt 5 fehlt. |
| `Missing …/.env` | Abschnitt 4 nicht gemacht oder falsches Verzeichnis (`DEPLOY_PATH`). |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` passt nicht zum Server (z. B. neuer Server). Neu mit `ssh-keyscan` erzeugen. |
| Pull schlägt mit „denied“ fehl | Das Image ist privat; der Lauf meldet mit dem GitHub-Token an. Prüfe, ob das Paket dem Repository zugeordnet ist und Actions Zugriff hat. |
| Container wird nicht „healthy“ | `logs --tail 100`. Meist zu wenig RAM (mindestens 8 GB) oder zu wenige Kerne. |
| Anmeldefenster kommt immer wieder | Falsches Passwort oder `.env` nach dem Start geändert, ohne `up -d`. |
| Terminal bleibt leer / „origin“-Fehler | Reverse Proxy ändert den Host-Header. Bei Caddy Standard lassen. |
| Web-IDE leer | Die Web-IDE ist experimentell und standardmäßig nicht im Image (ADR-0021). Nimm den Web-Chat (Port 7682). |
| Web-Chat zeigt „Login required“ oder nichts | Dieselben Zugangsdaten wie beim Terminal (Benutzer `demo`). Adresse mit `https://` und ohne Zugangsdaten in der URL öffnen. |

## Ohne Server: Demo auf dem eigenen Mac mit Tunnel (kostenlos, für wenige Tester)

Wenn du keinen Server mieten willst: Die Demo läuft auf deinem Rechner, ein **Tunnel** macht den Web-Chat für die
Tester erreichbar. Passt für **wenige Tester zu abgesprochenen Zeiten**. Dein Rechner muss währenddessen an und wach
sein, und die Antworten sind so langsam wie auf einem Server ohne GPU (1 bis 3 Minuten pro Antwort, eine Anfrage
gleichzeitig). Die Schritte 1 bis 4 wurden auf einem Mac mit Apple-Prozessor (10 Kerne, 16 GB, Colima mit 6 Kernen
und 10 GB) ausprobiert: Bauen (rund 20 bis 30 Minuten, hauptsächlich das Laden von Ollama und Modell), Start, Passwortschutz
(401 ohne und mit falschem Passwort), Seite, gesperrte Aufrufe (404) und eine echte Modellantwort (Aufgabe 1 der
Testanleitung: 85 Sekunden). Der **Tunnel (Schritt 5) wurde in diesem Repository nicht getestet** – prüfe ihn beim
ersten Mal selbst.

**Was du brauchst:** Docker (Docker Desktop oder Colima, mit mindestens 10 GB für die Docker-VM), 16 GB RAM am Rechner,
ca. 20 GB freien Platz.

**1. Passwort anlegen** (einmalig; die Datei liegt außerhalb des Repositorys und nur du kannst sie lesen):

```bash
umask 077
printf 'DEMO_PASSWORD=%s\nBOBI_DEMO_IMAGE=bobi-demo:local\n' "$(openssl rand -base64 18)" > ~/.bobi-demo.env
```

**2. Image bauen** (im Repository-Ordner; einmalig, dauert eine Weile und lädt das Modell, ca. 2,5 GB):

```bash
git submodule update --init --depth 1
docker compose --env-file ~/.bobi-demo.env -f compose.demo.yaml build demo
```

Statt zu bauen kannst du auch das fertige Image ziehen (`ghcr.io/weski17/bobi-demo`); es ist privat, dafür brauchst du
bei `docker login ghcr.io` einen Token mit Leserecht auf Pakete. Das veröffentlichte `latest` ist aber nicht immer der
neueste Stand: prüfe, ob der Web-Chat (Port 7682) darin ist.

**3. Starten** (nur auf deinem Rechner erreichbar, `127.0.0.1`):

```bash
docker compose --env-file ~/.bobi-demo.env -f compose.demo.yaml up -d
```

**4. Lokal prüfen**, bevor du irgendetwas freigibst:

```bash
# ohne Passwort muss es abgelehnt werden (401); die erste Antwort kommt erst, wenn das Modell geladen ist
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7682/
```

Dann im Browser `http://127.0.0.1:7682` öffnen (Benutzer `demo`, Passwort aus `~/.bobi-demo.env`) und selbst die
[Testaufgaben](demos/tester-anleitung.md) durchspielen.

**5. Tunnel** – nur den **Web-Chat (Port 7682)** freigeben, **nicht** das Web-Terminal (Port 7681): Das Terminal gibt
eine Shell im Container und gehört nicht ins Internet. Mit Cloudflare Tunnel (`brew install cloudflared`) geht es ohne
eigene Domain:

```bash
cloudflared tunnel --url http://127.0.0.1:7682
```

Das Programm gibt eine Adresse wie `https://<zufallsname>.trycloudflare.com` aus. Diese Adresse (HTTPS) plus das Passwort
schickst du den Testern. Sie ändert sich bei jedem Start. Solange der Tunnel läuft, ist dein Chat im Internet erreichbar,
geschützt nur durch das Passwort (und die Vorkehrungen des Gates: nur die Chat-Aufrufe, Herkunftsprüfung, strenge
Sicherheits-Header).

**6. Rechner wach halten** (in einem eigenen Terminal, solange getestet wird):

```bash
caffeinate -dims
```

**7. Danach alles abschalten:**

```bash
# Tunnel: im Terminal Ctrl-C drücken
docker compose --env-file ~/.bobi-demo.env -f compose.demo.yaml down
```

Für den nächsten Testtermin ein **neues Passwort** erzeugen (Schritt 1, Datei vorher löschen). Willst du die Chats und
Änderungen der Tester loswerden: `docker compose … down -v`.

**Grenzen:** Mehr als zwei, drei Tester gleichzeitig sind zu viel (eine Anfrage gleichzeitig). Alle Tester teilen einen
Arbeitsordner. Fällt dein Rechner in den Ruhezustand oder die Verbindung weg, sind die Tester getrennt. Es gibt keine
Verfügbarkeitszusage. Für einen dauerhaften Betrieb nimm die Schritte oben mit einem Server.

## Testerinnen und Tester einladen

Wenn die Demo läuft: schicke den Gästen die Adresse (Web-Chat, Port 7682 bzw. `https://chat.firma.de`) und das Passwort einzeln, nicht im Team-Chat. Dazu die [Testanleitung](demos/tester-anleitung.md) und den [Rückmeldebogen](demos/tester-feedback.md). Alle Gäste teilen einen Arbeitsordner; sprecht Zeiten ab.

