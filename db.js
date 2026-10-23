'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const BOOKINGS = `
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 6),
  dog_name TEXT NOT NULL DEFAULT '',
  pay_method TEXT NOT NULL CHECK (pay_method IN ('online','paypal','bar','karte','ueberweisung')),
  pay_status TEXT NOT NULL DEFAULT 'offen' CHECK (pay_status IN ('offen','bezahlt')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','wait','storniert')),
  stripe_session_id TEXT,
  created_at INTEGER NOT NULL,
  no_show INTEGER NOT NULL DEFAULT 0,
  voucher_code TEXT NOT NULL DEFAULT '',
  voucher_cents INTEGER NOT NULL DEFAULT 0,
  reminded INTEGER NOT NULL DEFAULT 0,
  member_cents INTEGER NOT NULL DEFAULT 0,
  credit_used INTEGER NOT NULL DEFAULT 0,
  guest_used INTEGER NOT NULL DEFAULT 0,
  membership_id INTEGER,
  UNIQUE (course_id, user_id)
);
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','trainer','admin')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  trainer_requested INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  styles TEXT NOT NULL DEFAULT '',
  dog_ok INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL DEFAULT 'de',
  newsletter INTEGER NOT NULL DEFAULT 0,
  ref_code TEXT,
  referred_by INTEGER,
  ref_rewarded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('welpen','hund','ohne')),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  dur INTEGER NOT NULL DEFAULT 60,
  cap INTEGER NOT NULL DEFAULT 8 CHECK (cap >= 1),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  level TEXT NOT NULL DEFAULT 'Alle Level',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','abgesagt')),
  trainer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  example INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS courses_starts ON courses(starts_at);
${BOOKINGS}
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('course','profile')),
  trainer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reply TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE TABLE IF NOT EXISTS room (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  studio_name TEXT NOT NULL DEFAULT 'Yoga mit Pfoten',
  tagline TEXT NOT NULL DEFAULT 'Yoga in kleinen Gruppen, mit oder ohne Hund.',
  room_title TEXT NOT NULL DEFAULT 'Der Raum',
  body TEXT NOT NULL DEFAULT '',
  facts TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  pay_info TEXT NOT NULL DEFAULT '',
  paypal_me TEXT NOT NULL DEFAULT '',
  legal_imprint TEXT NOT NULL DEFAULT '',
  legal_imprint_en TEXT NOT NULL DEFAULT '',
  legal_privacy TEXT NOT NULL DEFAULT '',
  legal_privacy_en TEXT NOT NULL DEFAULT '',
  legal_terms TEXT NOT NULL DEFAULT '',
  legal_terms_en TEXT NOT NULL DEFAULT '',
  photo_file TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  directions TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  faq TEXT NOT NULL DEFAULT '',
  reviews TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO room (id) VALUES (1);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('monthly','pack')),
  price_cents INTEGER NOT NULL,
  intro_cents INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL,
  guests INTEGER NOT NULL DEFAULT 0,
  types TEXT NOT NULL,
  valid_days INTEGER NOT NULL DEFAULT 30,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  credits_left INTEGER NOT NULL,
  guests_left INTEGER NOT NULL DEFAULT 0,
  period_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','gekuendigt','beendet')),
  stripe_sub_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  cents_total INTEGER NOT NULL,
  cents_left INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  before_file TEXT NOT NULL,
  after_file TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  weeks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
`;

const DEFAULT_FAQ = 'Was ziehe ich an?\nBequeme Kleidung, in der du dich frei bewegen kannst. Matten stellen wir.\n\nDarf mein eigener Hund mitkommen?\nIn den Kursen „Mit eigenem Hund“ ja. Dein Hund braucht Impfschutz und eine Haftpflichtversicherung und muss sich mit anderen Hunden vertragen.\n\nMuss ich Yoga können?\nNein. Die Kurse sind für alle Level offen, das Niveau steht bei jedem Kurs.\n\nWie läuft das Welpenyoga ab?\nEtwa 45 Minuten Yoga, danach 45 Minuten gemeinsames Kuscheln mit den Welpen sowie Essen und Trinken von uns. Die Welpen bestimmen das Tempo.\n\nKann ich Freundinnen mitbuchen?\nJa, du kannst bis zu 4 Plätze in einer Buchung nehmen.\n\nKann ich stornieren?\nJa, kostenlos bis zur Frist, die bei der Buchung steht. Danach oder bei Nichterscheinen ist der volle Kurspreis fällig.';

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRefCode(db) {
  for (;;) {
    const c = Array.from({ length: 6 }, () => REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)]).join('');
    if (!db.prepare('SELECT 1 FROM users WHERE ref_code = ?').get(c)) return c;
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room'").get();
  db.exec(SCHEMA);
  if (fresh) db.prepare('UPDATE room SET faq = ? WHERE id = 1').run(DEFAULT_FAQ);
  try { db.exec("ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'de'"); } catch (e) { /* Spalte gibt es schon */ }
  try { db.exec("ALTER TABLE room ADD COLUMN paypal_me TEXT NOT NULL DEFAULT ''"); } catch (e) { /* Spalte gibt es schon */ }
  for (const c of ['legal_imprint', 'legal_imprint_en', 'legal_privacy', 'legal_privacy_en', 'legal_terms', 'legal_terms_en']) {
    try { db.exec(`ALTER TABLE room ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch (e) { /* Spalte gibt es schon */ }
  }
  try { db.exec('ALTER TABLE bookings ADD COLUMN no_show INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* Spalte gibt es schon */ }
  const addCol = (table, col, def) => { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); return true; } catch (e) { return false; } };
  addCol('users', 'newsletter', 'INTEGER NOT NULL DEFAULT 0');
  addCol('bookings', 'voucher_code', "TEXT NOT NULL DEFAULT ''");
  addCol('bookings', 'voucher_cents', 'INTEGER NOT NULL DEFAULT 0');
  addCol('bookings', 'reminded', 'INTEGER NOT NULL DEFAULT 0');
  for (const c of ['address', 'directions', 'instagram', 'reviews']) addCol('room', c, "TEXT NOT NULL DEFAULT ''");
  if (addCol('room', 'faq', "TEXT NOT NULL DEFAULT ''")) db.prepare('UPDATE room SET faq = ? WHERE id = 1').run(DEFAULT_FAQ);
  addCol('bookings', 'member_cents', 'INTEGER NOT NULL DEFAULT 0');
  addCol('bookings', 'credit_used', 'INTEGER NOT NULL DEFAULT 0');
  addCol('bookings', 'guest_used', 'INTEGER NOT NULL DEFAULT 0');
  addCol('bookings', 'membership_id', 'INTEGER');
  addCol('users', 'ref_code', 'TEXT');
  addCol('users', 'referred_by', 'INTEGER');
  addCol('users', 'ref_rewarded', 'INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('SELECT 1 FROM plans').get()) {
    const ins = db.prepare('INSERT INTO plans (slug, name, kind, price_cents, intro_cents, credits, guests, types, valid_days, description, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    ins.run('start', 'Pfoten-Start', 'monthly', 5900, 3900, 4, 1, 'hund,ohne', 30, 'Zum Ausprobieren: Der erste Monat kostet nur 39 €.', 1);
    ins.run('flat', 'Pfoten-Flat', 'monthly', 8900, 0, 12, 2, 'hund,ohne', 30, 'Für Stammgäste, die fast jede Woche kommen: etwa 3 Kurse pro Woche.', 2);
    ins.run('vip', 'Welpen-VIP', 'pack', 12500, 0, 3, 0, 'welpen', 90, 'Zum Start im Dezember: Du sparst 25 € gegenüber den Einzelterminen.', 3);
    db.prepare("UPDATE plans SET valid_until = '2026-12-31' WHERE slug = 'vip'").run();
  }
  if (addCol('plans', 'valid_until', "TEXT NOT NULL DEFAULT ''")) db.prepare("UPDATE plans SET valid_until = '2026-12-31' WHERE slug = 'vip'").run();
  if (!db.prepare("SELECT 1 FROM plans WHERE slug = 'basic'").get()) {
    db.prepare('INSERT INTO plans (slug, name, kind, price_cents, intro_cents, credits, guests, types, valid_days, description, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('basic', 'Pfoten-Basic', 'monthly', 3900, 1900, 99, 0, 'ohne', 30, 'Der Preis-Hit: so oft du magst zum Yoga ohne Hund, für weniger als zwei Einzelstunden im Monat.', 0);
  }
  db.prepare("UPDATE plans SET description = 'Zum Start im Dezember: Du sparst 25 € gegenüber den Einzelterminen.' WHERE slug = 'vip' AND description LIKE '%90 Tage%'").run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users (ref_code)');
  for (const u of db.prepare('SELECT id FROM users WHERE ref_code IS NULL').all()) db.prepare('UPDATE users SET ref_code = ? WHERE id = ?').run(newRefCode(db), u.id);
  const bk = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'").get();
  if (bk && !bk.sql.includes("'paypal'")) {
    // Ältere Datenbank: Zahlungsart PayPal erlauben, indem die Tabelle neu aufgebaut wird
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec('ALTER TABLE bookings RENAME TO bookings_old');
      db.exec(BOOKINGS);
      db.exec('INSERT INTO bookings (id, course_id, user_id, first_name, seats, dog_name, pay_method, pay_status, status, stripe_session_id, created_at) SELECT id, course_id, user_id, first_name, seats, dog_name, pay_method, pay_status, status, stripe_session_id, created_at FROM bookings_old');
      db.exec('DROP TABLE bookings_old');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return db;
}

/** Führt fn in einer Transaktion aus. Bei einem Fehler wird alles zurückgenommen. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { newRefCode, openDb, transaction };
