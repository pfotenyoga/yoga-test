# PAWIO – Freigabecheck vor Livegang

Stand: 12. November 2026. Diese Datei dokumentiert **offene** Prüfungen; sie ist kein erfolgreicher Testbericht.

## Bereits auf diesem Branch geändert
- CLI-Befehle in `package.json` an vorhandene Root-Dateien angepasst.
- `seed.js` und `make-admin.js` auf vorhandene Root-Module umgestellt.
- Render-Konfiguration: kein automatisches Demo-Seeding, Verifizierung nicht mehr automatisch, Datenverzeichnis auf persistentem Datenträger vorgesehen.
- `server.js`: verweigert unsichere Produktivkonfigurationen.
- Eigenständiger Premium-Startseitenentwurf: `premium-homepage.html`. **Nicht** mit der vorhandenen App integriert.

## Blocker
1. `server.js` und `api.test.js` importieren `./lib/app` beziehungsweise `../lib/app`, aber im aktuellen Repository fehlt `lib/app.js`. Das vorhandene `app.js` ist Browsercode und kein Ersatz.
2. Die Backend-Implementierung und gegebenenfalls der ursprüngliche Projektaufbau müssen aus einer vertrauenswürdigen Version wiederhergestellt werden. Keine API aus Annahmen neu erfinden.
3. `api.test.js` erwartet die alte Ordnerstruktur. Erst nach Wiederherstellung der Backend-Module die Testpfade korrigieren und Tests tatsächlich ausführen.
4. Die neue Render-Konfiguration erfordert einen kostenpflichtigen Plan und persistenten Datenträger; **nicht ohne Kostenfreigabe deployen**. Datenmigration und Backup vor Wechsel planen.
5. Resend-Absender, E-Mail-Versand, Stripe-Schlüssel/Webhook, Datenschutz, Impressum, Backups und Restore müssen vor echten Buchungen geprüft werden.
6. Die Startseite verwendet externe Bildplatzhalter. Vor Launch Bildrechte und Bildauswahl klären, echte Browser-Screenshots für Desktop/Mobil erstellen und Buchungslinks verifizieren.

## Freigabekriterien
- `npm start` erfolgreich mit wiederhergestelltem Backend
- `npm test` erfolgreich und Integrationsabläufe geprüft
- Registrieren, Verifizieren, Buchen, Stornieren, Bezahlen und Webhooks getestet
- Persistente Datenbank und Restore-Test nachgewiesen
- Echte Desktop- und Mobil-Screenshots der integrierten Startseite
- Kosten und Deployment ausdrücklich freigegeben
