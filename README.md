# Yoga mit Pfoten – Buchungs-Website

Website mit Kursen (Welpenyoga, Yoga mit eigenem Hund, Yoga ohne Hund), Raum-Vorstellung, Team,
Kalender, Konten mit drei Rollen und Buchung mit Zahlungsart. Keine Abhängigkeiten, nur Node.js ab Version 22.5.

## Starten

    cp .env.example .env      # Werte anpassen
    npm start                 # läuft auf http://localhost:3000
    npm run seed              # optional: Beispielkurse (als Beispiel markiert)
    npm test                  # automatische Tests

## Sprachen
Die Seite gibt es auf Deutsch und Englisch (Umschalter „DE | EN“ oben rechts). Die Sprache folgt zuerst dem Browser und wird gemerkt. Mails gehen in der Sprache, die das Konto zuletzt gewählt hat. Alle Texte der Oberfläche stehen in `public/en.js`.
Texte, die du selbst in der Verwaltung eingibst (Kurstitel, Raumtext, Beschreibungen), bleiben so, wie du sie schreibst.

## Rechtliche Texte
Impressum, Datenschutz und AGB pflegst du in der Verwaltung unter „Rechtliches“ (Deutsch, optional Englisch). Bis die Texte eingetragen sind, zeigt die Seite Platzhalter. Lass die Texte rechtlich prüfen. Beim Buchen muss jeder Kunde die AGB und die Datenschutzerklärung bestätigen.

## Rollen

- **Kunde**: registriert sich selbst, bestätigt die E-Mail, bucht und storniert (bis 24 Std. vorher, einstellbar mit `CANCEL_HOURS`).
- **Trainer/in**: ein Kunde stellt unter „Trainer werden“ eine Anfrage, die Admin freigibt. Trainer ändern nur ihr Profil und schlagen Kurse (mit Hund / ohne Hund) vor. Jede Änderung wird erst nach Freigabe sichtbar. Welpenyoga legt nur der Admin an.
- **Admin (du)**: Freigaben, Kurse und Kalender, Buchungen (bezahlt markieren, nachrücken, entfernen), Konten und Rollen, Raum samt Foto, Mails.

### Ersten Admin anlegen
1. `ADMIN_EMAIL=deine@adresse.de` in `.env` setzen, mit dieser Adresse registrieren und den Bestätigungslink in der Mail anklicken.
2. Oder ohne Mail: registrieren und dann `npm run make-admin -- deine@adresse.de`.

## Zahlung
- **PayPal:** In der Verwaltung unter „Raum und Studio“ den PayPal.me-Namen eintragen (zum Beispiel `paypal.me/deinname`). Dann ist PayPal beim Buchen wählbar. Der Kunde bekommt einen Link mit dem richtigen Betrag. Sobald das Geld da ist, markierst du die Buchung unter „Buchungen“ als bezahlt, dann geht automatisch eine Zahlungsbestätigung per Mail raus.
- **Überweisung, bar, Karte vor Ort:** Genauso, du markierst selbst als bezahlt. Die Bankverbindung trägst du unter „Zahlungshinweise“ ein.
- **Online (Karte, PayPal über Stripe):** automatisch, siehe Stripe unten. Hier wird die Buchung von allein als bezahlt gesetzt.

## Einstellungen (.env)

| Name | Bedeutung |
|---|---|
| `SITE_URL` | Öffentliche Adresse, wird in Mail-Links und für Stripe genutzt |
| `PORT`, `DATA_DIR` | Port und Ordner für Datenbank und Uploads (muss dauerhaft gespeichert werden) |
| `ADMIN_EMAIL` | Diese bestätigte Adresse wird Admin |
| `CANCEL_HOURS` | Stornofrist in Stunden |
| `RESEND_API_KEY`, `MAIL_FROM` | Mailversand über Resend. Ohne Schlüssel werden Mails nur in der Verwaltung unter „Mails“ aufgelistet, nicht verschickt. Dann kann sich niemand per Link bestätigen. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Online-Zahlung. Webhook-Adresse in Stripe: `SITE_URL/api/stripe/webhook`, Ereignis `checkout.session.completed`. Ohne Schlüssel gibt es bar, Karte vor Ort und Überweisung. |
| `TRUST_PROXY` | `1`, wenn die Seite hinter einem Proxy läuft (für Rate-Limits) |
| `AUTO_VERIFY` | Nur für Tests: Konten gelten sofort als bestätigt. Auf einer echten Seite nicht setzen. |

## Online stellen
Du brauchst einen Anbieter, der Node 22.5+ ausführt und einen **dauerhaften Datenträger** bietet (z. B. Fly.io, Railway, Render mit Disk oder ein kleiner Server). `DATA_DIR` zeigt auf diesen Datenträger. Starten mit `npm start`, HTTPS übernimmt der Anbieter. Sichere den Ordner `DATA_DIR` regelmäßig.

## Noch zu tun vor dem Start
- Impressum, Datenschutz und AGB: die Seite „Rechtliches“ enthält nur Platzhalter. Bitte rechtlich prüfen lassen.
- Stripe und Resend sind eingebaut, aber nur lokal getestet (Signaturprüfung). Vor dem Start einmal mit Testschlüsseln durchspielen.
- Raumtext, Foto, Bankverbindung in der Verwaltung unter „Raum und Studio“ eintragen. Beispielkurse löschen.

Das ältere Gerüst in `../yoga-mit-pfoten` (Next.js/Supabase) ist unverändert und wird hierfür nicht gebraucht.
