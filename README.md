# Local Static Publisher – Local Add-on Prototype

Ein Prototyp für Local by Flywheel, der eine laufende lokale WordPress-Website als statische Dateien rendert und optional per SFTP oder GitHub veröffentlicht. Er ist nicht auf Etch beschränkt: Entscheidend ist, dass die Website im Browser vollständig auslieferbare Seiten und Assets bereitstellt.

## Enthalten

- eigener „Static Export“-Button in der Site-Ansicht von Local
- funktioniert grundsätzlich mit WordPress-Seiten unabhängig vom verwendeten Builder oder Theme
- eigene „Static Publisher“-Seite als zusätzlicher Tab neben Overview, Database, Backups und Tools
- Export von HTML-Seiten, verlinkten Seiten, Stylesheets, Scripts, Bildern und CSS-Assets
- WordPress-Sitemap als zusätzlicher URL-Input
- Umschreibung der lokalen Origin-URL auf eine öffentliche Ziel-URL
- Erkennung eingebetteter URLs in Inline-JavaScript/CSS sowie dynamischer Elementor-Chunks
- lokale Build-Ausgabe mit `export-manifest.json`
- SFTP-Zielprofile
- SFTP-Authentifizierung per Passwort, privatem Schlüssel oder SSH-Agent (inklusive 1Password)
- automatische Nutzung von `~/.ssh/config` und Standard-Schlüsseln aus `~/.ssh`
- GitHub-Commit-Transport über die Git Data API
- Fortschrittsanzeige, Warnungen und letzte Ausgabe

Formulare, Ajax, eingeloggte Inhalte, clientseitig nachgeladene Daten und komplexe URL-/Plugin-Sonderfälle sind bewusst noch nicht enthalten.

## Installation für einen lokalen Test

```bash
npm install
npm run build
```

Danach den Add-on-Ordner in Local registrieren. Unter macOS ist der erwartete Add-on-Pfad:

```text
~/Library/Application Support/Local/addons/local-static-publisher
```

Unter Windows und Linux gelten die von Local dokumentierten Add-on-Verzeichnisse. Local anschließend neu starten und das Add-on aktivieren.

## Verwendung

1. Eine Local-Website starten.
2. Den Tab „Static Publisher“ neben Overview, Database, Backups und Tools öffnen.
3. Optional ein SFTP- oder GitHub-Profil anlegen.
   Bereits angelegte Profile können über „Edit selected profile“ bearbeitet werden.
   Mit „Test connection“ lassen sich die aktuell eingegebenen SFTP- oder GitHub-Daten vor dem Speichern prüfen.
4. Die öffentliche URL und das Seitenlimit prüfen.
5. „Export starten“ oder „Export & veröffentlichen“ auswählen.

Die lokale Website wird über ihre Frontend-URL gelesen. Deshalb muss sie während des Exports laufen.
Bei „Nur lokalen Build erzeugen“ öffnet sich vor dem Export ein Dialog zur Auswahl des Ablageorts. Darin wird für jeden Export automatisch ein eigener Unterordner aus Website-Namen und Zeitstempel angelegt, zum Beispiel `bienenfutter-sb-tankstelle-2026-10-14T18-15-00-000Z`. Frühere Builds bleiben dadurch erhalten. Die HTML-Seiten werden im lokalen Build flach abgelegt: `/kontakt/` wird zu `kontakt.html`, verschachtelte Pfade verwenden `--` als Trenner. Assets behalten ihre Verzeichnisstruktur. Interne Links zeigen im lokalen Build auf diese exportierten Dateien; externe Links bleiben unverändert. SFTP- und GitHub-Exporte verwenden weiterhin einen temporären lokalen Build und veröffentlichen diesen anschließend.
Die HTML-Seiten werden in allen Exportarten flach abgelegt: `/kontakt/` wird zu `kontakt.html`, verschachtelte Pfade verwenden `--` als Trenner. Assets behalten ihre Verzeichnisstruktur. Dadurch benötigen SFTP- und GitHub-Ziele keine Ordner-Weiterleitungen für `index.html`. Interne Links zeigen auf diese exportierten Dateien; externe Links bleiben unverändert. SFTP- und GitHub-Exporte verwenden weiterhin einen temporären lokalen Build und veröffentlichen diesen anschließend.
Für SFTP kann im Profil „SSH agent (1Password)“ ausgewählt werden. Der private Schlüssel bleibt dabei in 1Password; der Exporter verwendet den verfügbaren `SSH_AUTH_SOCK` oder erkennt den 1Password-Agenten unter macOS automatisch. Ein manueller Schlüssel-Upload ist nicht erforderlich.
Alternativ steht „SSH config / default key (~/.ssh)“ zur Verfügung. Diese Option liest passende `Host`-, `HostName`-, `User`-, `Port`-, `IdentityFile`- und `IdentityAgent`-Einträge aus `~/.ssh/config`. Ohne passenden Eintrag werden `id_ed25519`, `id_ecdsa`, `id_rsa` und `id_dsa` aus `~/.ssh` geprüft. Der private Schlüssel wird nur während des Exports gelesen und nicht im Zielprofil gespeichert.

## Bewusste Prototyp-Grenzen

- Passwort- und private-Key-Profile werden aktuell in einer lokalen Datei mit restriktiven Dateirechten gespeichert. Bei Verwendung des SSH-Agenten wird kein privater Schlüssel im Zielprofil gespeichert. Für eine Produktversion sollte der Betriebssystem-Schlüsselbund verwendet werden.
- Der SFTP-Transport synchronisiert neue/geänderte Dateien, entfernt aber noch keine veralteten Remote-Dateien.
- Der GitHub-Transport setzt voraus, dass der Ziel-Branch bereits existiert.
- GitHub versioniert den statischen Output, nicht die bearbeitbare WordPress-Datenstruktur.
- Die URL-Erkennung ist crawler-basiert und benötigt weitere Regeln für mehrsprachige Websites, Sonderrouten und große Archive.

## Responsive Local-Anordnung

Der Publisher wird als eigene Seite innerhalb der Site-Ansicht gerendert. Für schmale Local-Fenster enthält der Prototyp außerdem eine responsive Regel für das bekannte mkcert-Panel: Unterhalb von 1180 px darf mkcert unter die Overview-Spalte umbrechen. Diese Regel ist bewusst auf die aktuelle mkcert-Darstellung begrenzt und sollte bei Änderungen am mkcert-Add-on erneut geprüft werden.
