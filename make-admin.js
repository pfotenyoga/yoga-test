'use strict';
// Macht ein bestehendes Konto zum Admin:  npm run make-admin -- name@beispiel.de
const path = require('node:path');
const { loadEnv } = require('../server.js');
const { openDb } = require('../lib/db.js');

loadEnv(path.join(__dirname, '..', '.env'));
const email = (process.argv[2] || '').trim();
if (!email) { console.error('Bitte E-Mail angeben: npm run make-admin -- name@beispiel.de'); process.exit(1); }
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = openDb(path.join(dir, 'yoga.db'));
const r = db.prepare("UPDATE users SET role = 'admin', email_verified = 1, trainer_requested = 0 WHERE email = ?").run(email);
if (!r.changes) { console.error('Kein Konto mit dieser E-Mail gefunden. Erst registrieren, dann den Befehl ausführen.'); process.exit(1); }
console.log(email + ' ist jetzt Admin.');
