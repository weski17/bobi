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
