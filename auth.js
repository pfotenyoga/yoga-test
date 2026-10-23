'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('./util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(pw, stored) {
  const [v, saltHex, keyHex] = String(stored).split('$');
  if (v !== 's1' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, SCRYPT);
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

let dummyHash = null;
/** Rechnet auch bei unbekannter E-Mail, damit die Antwortzeit nichts verrät */
async function burnPasswordCheck(pw) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-passwort');
  await verifyPassword(pw, dummyHash);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function createSession(db, userId) {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}

function getSessionUser(db, token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(sha(token));
  if (!row) return null;
  if (row.s_exp < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
    return null;
  }
  return row;
}

function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

function destroyAllSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

function cookieHeader(name, value, { maxAgeSec, secure }) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`, secure ? 'Secure' : ''].filter(Boolean).join('; ');
}

/** Einmal-Token für E-Mail-Bestätigung oder Passwort-Reset. In der Datenbank liegt nur der Hash. */
function createToken(db, userId, kind, ttlMs) {
  db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
  const token = newToken();
  db.prepare('INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(sha(token), userId, kind, Date.now() + ttlMs);
  return token;
}

function consumeToken(db, token, kind) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM tokens WHERE token_hash = ? AND kind = ?').get(sha(token), kind);
  if (!row) return null;
  db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(sha(token));
  return row.expires_at >= Date.now() ? row.user_id : null;
}

/** Einfache Begrenzung pro Schlüssel (z. B. Adresse des Besuchers) */
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || e.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
    } else {
      e.n += 1;
      if (e.n > max) throw new HttpError(429, 'zu_viele_versuche', 'Zu viele Versuche. Bitte warte einige Minuten.');
    }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  createSession,
  getSessionUser,
  destroySession,
  destroyAllSessions,
  parseCookies,
  cookieHeader,
  createToken,
  consumeToken,
  makeLimiter,
  SESSION_DAYS,
};
