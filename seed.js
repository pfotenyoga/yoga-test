'use strict';
// Legt Beispieldaten an (als Beispiel markiert):  npm run seed
// Beispielkurse neu anlegen (eigene Kurse bleiben):  npm run seed -- --neu
// Läuft nur, wenn noch keine Kurse existieren. Beispielkurse kannst du in der Verwaltung ändern oder löschen.
const path = require('node:path');
const { loadEnv } = require('../server.js');
const { openDb } = require('../lib/db.js');
const { zonedMs } = require('../lib/util.js');

loadEnv(path.join(__dirname, '..', '.env'));
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = openDb(path.join(dir, 'yoga.db'));
if (process.argv.includes('--neu')) {
  // Ersetzt nur die als Beispiel markierten Kurse (samt ihren Buchungen), eigene Kurse bleiben
  const r = db.prepare('DELETE FROM courses WHERE example = 1').run();
  console.log(r.changes + ' alte Beispielkurse entfernt.');
}
if (db.prepare('SELECT COUNT(*) n FROM courses').get().n) { console.log('Es gibt schon Kurse, nichts geändert. (Mit „npm run seed -- --neu“ werden nur die Beispielkurse ersetzt.)'); process.exit(0); }

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const ins = db.prepare(`INSERT INTO courses (title,type,date,time,starts_at,dur,cap,price_cents,level,description,status,trainer_id,example,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?, 'aktiv', NULL, 1, ?)`);
const rows = [];
// Welpenyoga: ab 1. Dezember 2026, vier Wochen, einmal täglich. 45 Min. Yoga + 45 Min. Kuscheln, Essen und Trinken
const start = new Date('2026-12-01T12:00:00Z');
for (let i = 0; i < 28; i++) {
  const d = iso(new Date(start.getTime() + i * 864e5));
  rows.push(['Welpenyoga', 'welpen', d, '10:00', 90, 15, 5000, 'Alle Level', '45 Min. Yoga mit den Welpen, danach 45 Min. gemeinsames Kuscheln mit Essen und Trinken. Speisen und Getränke bringen wir mit.']);
}
for (let i = 1; i <= 6; i++) {
  rows.push(['Yoga mit deinem Hund', 'hund', plus(i * 4), '18:00', 60, 8, 1800, 'Alle Level', 'Du bringst deinen Hund mit. Impfschutz und Haftpflicht sind Voraussetzung.']);
  rows.push(['Yoga', 'ohne', plus(i * 3), '19:00', 75, 15, 2000, 'Alle Level', 'Yoga in der Gruppe, ohne Hund.']);
}
for (const r of rows) ins.run(r[0], r[1], r[2], r[3], zonedMs(r[2], r[3]), r[4], r[5], r[6], r[7], r[8], Date.now());
db.prepare("UPDATE room SET body = ?, facts = ?, rules = ?, pay_info = ? WHERE id = 1 AND body = ''").run(
  'Ein heller Raum mit Holzboden und viel Platz für Matten und Hunde. (Beispieltext, bitte anpassen.)',
  'Größe: 40 m²\nPlätze: bis 10\nBoden: Holz, rutschfeste Matten',
  'Hunde müssen geimpft und haftpflichtversichert sein.\nBitte pünktlich kommen.',
  'Bankverbindung bitte in der Verwaltung eintragen.');
console.log(rows.length + ' Beispielkurse angelegt.');
