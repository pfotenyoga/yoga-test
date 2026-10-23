'use strict';

const TYPES = ['welpen', 'hund', 'ohne'];
const LEVELS = ['Alle Level', 'Einsteiger', 'Fortgeschritten'];
const PAY_METHODS = ['online', 'paypal', 'bar', 'karte', 'ueberweisung'];
/** Für neue Buchungen wählbar. Die übrigen bleiben nur für alte Buchungen erhalten. */
const PAY_ENABLED = ['online', 'paypal', 'bar'];
const ROLES = ['customer', 'trainer', 'admin'];
const TZ = 'Europe/Madrid';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function tzOffset(ms, tz) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(ms))
    .forEach((p) => {
      parts[p.type] = Number(p.value);
    });
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

/** Wandelt Datum und Uhrzeit in Spanien (YYYY-MM-DD, HH:MM) in Millisekunden um */
function zonedMs(date, time, tz = TZ) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - tzOffset(guess, tz);
  return guess;
}

function todayISO(tz = TZ) {
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function requirements(cancelHours) {
  const cancel = `Ich akzeptiere die Stornobedingungen: kostenlos bis ${cancelHours} Stunden vor Beginn. Danach oder bei Nichterscheinen ist der volle Kurspreis fällig.`;
  return {
    welpen: [
      'Ich ziehe die Schuhe aus und desinfiziere die Hände, bevor ich die Welpen berühre.',
      'Ich lasse die Welpen jederzeit zur Ruhe kommen und folge den Anweisungen vor Ort.',
      cancel,
    ],
    hund: [
      'Der Impfschutz meines Hundes ist aktuell.',
      'Für meinen Hund besteht eine Haftpflichtversicherung.',
      'Mein Hund ist verträglich mit Menschen und anderen Hunden. Läufige Hündinnen und kranke Tiere bleiben zu Hause.',
      cancel,
    ],
    ohne: [cancel],
  };
}

function text(v, max, { required = false, label = 'Feld' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, 'ungueltig', `${label} fehlt.`);
  if (s.length > max) throw new HttpError(400, 'ungueltig', `${label} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
}

function intIn(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'ungueltig', `${label}: Zahl zwischen ${min} und ${max} erwartet.`);
  return n;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Prüft die Angaben zu einem Kurs und gibt bereinigte Werte zurück */
function validateCourse(b, allowedTypes = TYPES) {
  b = b || {};
  const type = b.type;
  if (!allowedTypes.includes(type)) throw new HttpError(400, 'ungueltig', 'Diese Kursart ist hier nicht erlaubt.');
  if (!isValidDate(b.date)) throw new HttpError(400, 'ungueltig', 'Datum ungültig.');
  if (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) throw new HttpError(400, 'ungueltig', 'Uhrzeit ungültig.');
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0 || price > 500) throw new HttpError(400, 'ungueltig', 'Preis: Zahl zwischen 0 und 500 erwartet.');
  const level = LEVELS.includes(b.level) ? b.level : 'Alle Level';
  const status = b.status === 'abgesagt' ? 'abgesagt' : 'aktiv';
  return {
    title: text(b.title, 80, { required: true, label: 'Titel' }),
    type,
    date: b.date,
    time: b.time,
    starts_at: zonedMs(b.date, b.time),
    dur: intIn(b.dur, 15, 240, 'Dauer'),
    cap: intIn(b.cap, 1, 60, 'Plätze'),
    price_cents: Math.round(price * 100),
    level,
    description: text(b.description, 600, { label: 'Beschreibung' }),
    status,
  };
}

function isEmail(s) {
  return typeof s === 'string' && s.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/** Nimmt „name“, „paypal.me/name“ oder den ganzen Link und gibt nur den Namen zurück ('' wenn leer). */
function paypalName(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?paypal\.me\/([A-Za-z0-9._-]{1,40})\/?(?:[\d.,]*[A-Za-z]{0,3})?$/i) || s.match(/^([A-Za-z0-9._-]{1,40})$/);
  if (!m) throw new HttpError(400, 'ungueltig', 'PayPal: bitte nur den Namen oder den Link von paypal.me eintragen.');
  return m[1];
}
function paypalLink(name, cents) {
  return `https://www.paypal.me/${name}/${(cents / 100).toFixed(2)}EUR`;
}

module.exports = { paypalName, paypalLink, TYPES, LEVELS, PAY_METHODS, PAY_ENABLED, ROLES, TZ, HttpError, zonedMs, todayISO, esc, requirements, text, intIn, validateCourse, isEmail, isValidDate };
