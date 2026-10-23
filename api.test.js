'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../lib/app');

let app, base, dir;
const WEBHOOK_SECRET = 'whsec_testgeheimnis';

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoga-test-'));
  app = createApp({
    dataDir: dir,
    dbFile: path.join(dir, 'test.db'),
    siteUrl: 'http://localhost',
    adminEmail: 'chefin@example.com',
    cancelHours: 24,
    resendKey: '',
    mailFrom: 'x',
    stripeSecret: '',
    stripeWebhookSecret: WEBHOOK_SECRET,
    trustProxy: false,
    autoVerify: false,
    logMail: false,
    rateScale: 1000,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Kleiner Client mit eigenem Cookie-Speicher pro Person */
function client() {
  let sid = '';
  const c = {
    async req(method, url, body, extra = {}) {
      const headers = { ...(extra.headers || {}) };
      if (sid) headers.Cookie = 'sid=' + sid;
      let payload;
      if (extra.raw) payload = extra.raw;
      else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const s of set) {
        const m = s.match(/^sid=([^;]*)/);
        if (m) sid = decodeURIComponent(m[1]);
      }
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data, headers: res.headers };
    },
    get: (u) => c.req('GET', u),
    post: (u, b = {}) => c.req('POST', u, b),
    put: (u, b = {}) => c.req('PUT', u, b),
    del: (u) => c.req('DELETE', u),
  };
  return c;
}

function lastMail(to) {
  return app.db.prepare('SELECT * FROM outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1').get(to);
}
function mailCount(to) {
  return app.db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE to_email = ?').get(to).n;
}
function linkFrom(mail, re) {
  const m = mail.html.match(re);
  assert.ok(m, 'Link in der Mail nicht gefunden');
  return m[1].replace(/&amp;/g, '&');
}

async function registerVerified(email, name = 'Test') {
  const c = client();
  const r = await c.post('/api/register', { name, email, password: 'sicheres-passwort' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const link = linkFrom(lastMail(email), /href="([^"]*verify-email[^"]*)"/);
  const v = await client().get(new URL(link).pathname + new URL(link).search);
  assert.equal(v.status, 302);
  return c;
}

/** Datum und Uhrzeit in Spanien, ms Millisekunden von jetzt */
function madridIn(ms) {
  const d = new Date(Date.now() + ms);
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d)
    .forEach((x) => (p[x.type] = x.value));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const inDays = (n) => madridIn(n * 864e5);

const course = (over = {}) => ({ title: 'Testkurs', type: 'ohne', ...inDays(5), time: '18:00', dur: 60, cap: 2, price: 12, level: 'Alle Level', description: '', status: 'aktiv', ...over });

let admin;

test('Admin entsteht nur über bestätigte ADMIN_EMAIL', async () => {
  const c = client();
  await c.post('/api/register', { name: 'Chefin', email: 'chefin@example.com', password: 'sicheres-passwort' });
  let me = await c.get('/api/me');
  assert.equal(me.data.user.role, 'customer', 'vor der Bestätigung noch kein Admin');
  const link = linkFrom(lastMail('chefin@example.com'), /href="([^"]*verify-email[^"]*)"/);
  await client().get(new URL(link).pathname + new URL(link).search);
  me = await c.get('/api/me');
  assert.equal(me.data.user.role, 'admin');
  admin = c;
});

test('Fremde Registrierung mit Admin-Wunsch bleibt Kunde', async () => {
  const c = client();
  const r = await c.post('/api/register', { name: 'X', email: 'x@example.com', password: 'sicheres-passwort', role: 'admin' });
  assert.equal(r.data.user.role, 'customer');
});

test('Registrierung prüft Eingaben und doppelte E-Mail', async () => {
  const c = client();
  assert.equal((await c.post('/api/register', { name: 'A', email: 'kaputt', password: 'sicheres-passwort' })).status, 400);
  assert.equal((await c.post('/api/register', { name: 'A', email: 'a@example.com', password: 'kurz' })).status, 400);
  assert.equal((await c.post('/api/register', { name: '', email: 'a@example.com', password: 'sicheres-passwort' })).status, 400);
  assert.equal((await c.post('/api/register', { name: 'A', email: 'chefin@example.com', password: 'sicheres-passwort' })).status, 409);
});

test('Zugriff: ohne Anmeldung 401, falsche Rolle 403', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/admin/overview')).status, 401);
  assert.equal((await anon.get('/api/bookings/mine')).status, 401);
  const cust = await registerVerified('kunde1@example.com');
  assert.equal((await cust.get('/api/admin/overview')).status, 403);
  assert.equal((await cust.post('/api/admin/courses', course())).status, 403);
  assert.equal((await cust.get('/api/trainer/overview')).status, 403);
  assert.equal((await cust.post('/api/proposals', { kind: 'profile', data: { name: 'x' } })).status, 403);
  assert.equal((await cust.post('/api/admin/users/1/role', { role: 'admin' })).status, 403);
});

test('Fremde Herkunft (Origin) wird abgelehnt', async () => {
  const c = client();
  const r = await c.req('POST', '/api/login', { email: 'a@b.de', password: 'x' }, { headers: { Origin: 'https://boese-seite.example' } });
  assert.equal(r.status, 403);
});

test('Login: falsches Passwort 401, richtiges ok, Logout beendet die Sitzung', async () => {
  const c = client();
  assert.equal((await c.post('/api/login', { email: 'chefin@example.com', password: 'falsch-falsch' })).status, 401);
  assert.equal((await c.post('/api/login', { email: 'gibtsnicht@example.com', password: 'falsch-falsch' })).status, 401);
  const ok = await c.post('/api/login', { email: 'CHEFIN@example.com', password: 'sicheres-passwort' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/me')).data.user.email, 'chefin@example.com');
  await c.post('/api/logout');
  assert.equal((await c.get('/api/me')).data.user, null);
});

test('Passwort vergessen und zurücksetzen', async () => {
  const c = await registerVerified('vergesslich@example.com');
  const anon = client();
  const before = mailCount('unbekannt@example.com');
  assert.equal((await anon.post('/api/forgot', { email: 'unbekannt@example.com' })).status, 200);
  assert.equal(mailCount('unbekannt@example.com'), before, 'für unbekannte Adressen keine Mail');
  await anon.post('/api/forgot', { email: 'vergesslich@example.com' });
  const link = linkFrom(lastMail('vergesslich@example.com'), /href="([^"]*passwort-neu[^"]*)"/);
  const token = new URL(link).hash.split('token=')[1];
  assert.equal((await anon.post('/api/reset', { token, password: 'kurz' })).status, 400);
  assert.equal((await anon.post('/api/reset', { token, password: 'neues-passwort-1' })).status, 200);
  assert.equal((await anon.post('/api/reset', { token, password: 'neues-passwort-2' })).status, 400, 'Link nur einmal nutzbar');
  assert.equal((await c.get('/api/me')).data.user, null, 'alte Sitzungen sind beendet');
  assert.equal((await client().post('/api/login', { email: 'vergesslich@example.com', password: 'sicheres-passwort' })).status, 401);
  assert.equal((await client().post('/api/login', { email: 'vergesslich@example.com', password: 'neues-passwort-1' })).status, 200);
});

test('Buchung braucht bestätigte E-Mail', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Nur bestätigt' }))).data.id;
  const c = client();
  await c.post('/api/register', { name: 'Neu', email: 'unbestaetigt@example.com', password: 'sicheres-passwort' });
  const r = await c.post('/api/bookings', { course_id: cid, first_name: 'Neu', seats: 1, pay_method: 'bar', confirmed: true });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'nicht_bestaetigt');
});

test('Buchung, Warteliste, Nachrücken und Stornofrist', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Zwei Plätze', cap: 2 }))).data.id;
  const a = await registerVerified('buchung-a@example.com');
  const b = await registerVerified('buchung-b@example.com');
  const body = (extra) => ({ course_id: cid, first_name: 'Vorname', seats: 1, pay_method: 'bar', confirmed: true, ...extra });

  assert.equal((await a.post('/api/bookings', body({ confirmed: false }))).status, 400);
  assert.equal((await a.post('/api/bookings', body({ pay_method: 'online' }))).status, 400, 'online ohne Stripe nicht möglich');
  const r1 = await a.post('/api/bookings', body({ seats: 2 }));
  assert.equal(r1.data.status, 'ok');
  assert.equal((await a.post('/api/bookings', body())).status, 409, 'nicht zweimal buchen');
  const r2 = await b.post('/api/bookings', body());
  assert.equal(r2.data.status, 'wait', 'ausgebucht: Warteliste');
  assert.match(lastMail('buchung-a@example.com').subject, /Buchung bestätigt/);
  assert.match(lastMail('buchung-b@example.com').subject, /Warteliste/);

  const list = (await client().get('/api/courses')).data.courses;
  assert.equal(list.find((c) => c.id === cid).taken, 2);

  const mine = (await b.get('/api/bookings/mine')).data.bookings;
  assert.equal(mine[0].status, 'wait');

  assert.equal((await b.post(`/api/bookings/${r1.data.booking_id}/cancel`)).status, 404, 'fremde Buchung nicht stornierbar');
  assert.equal((await a.post(`/api/bookings/${r1.data.booking_id}/cancel`)).status, 200);
  assert.equal((await b.get('/api/bookings/mine')).data.bookings[0].status, 'ok', 'Warteliste rückt nach');
  assert.match(lastMail('buchung-b@example.com').subject, /Platz frei/);
  const after = (await client().get('/api/courses')).data.courses.find((c) => c.id === cid);
  assert.equal(after.taken, 1);
  assert.equal((await a.post('/api/bookings', body())).data.status, 'ok', 'nach Storno erneut buchbar');
});

test('Gleichzeitige Buchungen überbuchen den Kurs nicht', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Rennen', cap: 3 }))).data.id;
  const people = await Promise.all(['r1', 'r2', 'r3', 'r4', 'r5'].map((n) => registerVerified(`${n}@example.com`)));
  const res = await Promise.all(people.map((p) => p.post('/api/bookings', { course_id: cid, first_name: 'R', seats: 1, pay_method: 'bar', confirmed: true })));
  assert.equal(res.filter((r) => r.data.status === 'ok').length, 3);
  assert.equal(res.filter((r) => r.data.status === 'wait').length, 2);
  assert.equal((await client().get('/api/courses')).data.courses.find((c) => c.id === cid).taken, 3);
});

test('Stornieren kurz vor Beginn ist gesperrt', async () => {
  const soon = madridIn(3 * 3600e3);
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Gleich', ...soon, cap: 5 }))).data.id;
  const c = await registerVerified('spaet@example.com');
  const r = await c.post('/api/bookings', { course_id: cid, first_name: 'S', seats: 1, pay_method: 'bar', confirmed: true });
  assert.equal(r.data.status, 'ok');
  const cancel = await c.post(`/api/bookings/${r.data.booking_id}/cancel`);
  assert.equal(cancel.status, 409);
  assert.equal(cancel.data.error, 'zu_spaet');
});

test('Vergangene Kurse sind nicht buchbar, Hundekurs braucht Hundenamen', async () => {
  const past = (await admin.post('/api/admin/courses', course({ title: 'Gestern', ...inDays(-2) }))).data.id;
  const hund = (await admin.post('/api/admin/courses', course({ title: 'Hundekurs', type: 'hund', cap: 4 }))).data.id;
  const c = await registerVerified('hund@example.com');
  assert.equal((await c.post('/api/bookings', { course_id: past, first_name: 'H', seats: 1, pay_method: 'bar', confirmed: true })).status, 409);
  assert.equal((await c.post('/api/bookings', { course_id: hund, first_name: 'H', seats: 1, pay_method: 'bar', confirmed: true })).status, 400);
  const ok = await c.post('/api/bookings', { course_id: hund, first_name: 'H', seats: 1, pay_method: 'bar', confirmed: true, dog_name: 'Bello' });
  assert.equal(ok.data.status, 'ok');
  assert.equal((await c.get('/api/bookings/mine')).data.bookings[0].dog_name, 'Bello');
});

test('Absage eines Kurses benachrichtigt Gebuchte', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Wird abgesagt', cap: 5 }))).data.id;
  const c = await registerVerified('absage@example.com');
  await c.post('/api/bookings', { course_id: cid, first_name: 'A', seats: 1, pay_method: 'bar', confirmed: true });
  const upd = await admin.put(`/api/admin/courses/${cid}`, course({ title: 'Wird abgesagt', status: 'abgesagt' }));
  assert.equal(upd.status, 200);
  assert.match(lastMail('absage@example.com').subject, /abgesagt/);
});

test('Trainer-Ablauf: Anfrage, Freigabe, Vorschlag, Freigabe der Änderung', async () => {
  const t = await registerVerified('trainerin@example.com', 'Lena');
  assert.equal((await t.post('/api/proposals', { kind: 'profile', data: { name: 'x' } })).status, 403, 'Kunde darf noch nichts vorschlagen');
  assert.equal((await t.post('/api/trainer-request', { bio: 'Ausbildung in Hatha', dog_ok: true })).status, 200);

  const ov = (await admin.get('/api/admin/overview')).data;
  const req = ov.trainerRequests.find((r) => r.email === 'trainerin@example.com');
  assert.ok(req);
  assert.equal((await admin.post(`/api/admin/trainer-requests/${req.id}`, { decision: 'approve' })).status, 200);
  assert.equal((await t.get('/api/me')).data.user.role, 'trainer');

  // Welpenkurse darf nur der Admin anlegen
  assert.equal((await t.post('/api/proposals', { kind: 'course', data: course({ type: 'welpen' }) })).status, 400);
  const prop = await t.post('/api/proposals', { kind: 'course', data: course({ title: 'Yoga mit Hund', type: 'hund', cap: 6 }) });
  assert.equal(prop.status, 200);
  assert.equal((await client().get('/api/courses')).data.courses.some((c) => c.title === 'Yoga mit Hund'), false, 'noch nicht live');

  const pending = (await admin.get('/api/admin/overview')).data.proposals.find((p) => p.id === prop.data.id);
  assert.equal(pending.trainer_name, 'Lena');
  assert.equal((await admin.post(`/api/admin/proposals/${prop.data.id}`, { decision: 'approve' })).status, 200);
  const live = (await client().get('/api/courses')).data.courses.find((c) => c.title === 'Yoga mit Hund');
  assert.ok(live);
  assert.equal(live.trainer_name, 'Lena');
  assert.equal((await admin.post(`/api/admin/proposals/${prop.data.id}`, { decision: 'approve' })).status, 404, 'nicht doppelt freigeben');

  // Änderung am eigenen Kurs: bis zur Freigabe bleibt die alte Version
  const change = await t.post('/api/proposals', { kind: 'course', course_id: live.id, data: course({ title: 'Yoga mit Hund neu', type: 'hund', cap: 6 }) });
  assert.equal((await client().get('/api/courses')).data.courses.find((c) => c.id === live.id).title, 'Yoga mit Hund');
  assert.equal((await admin.post(`/api/admin/proposals/${change.data.id}`, { decision: 'reject', reply: 'Bitte anderer Titel' })).status, 200);
  assert.equal((await client().get('/api/courses')).data.courses.find((c) => c.id === live.id).title, 'Yoga mit Hund');
  assert.match(lastMail('trainerin@example.com').html, /Bitte anderer Titel/);

  // Fremde Kurse sind tabu
  const fremd = (await admin.post('/api/admin/courses', course({ title: 'Fremder Kurs' }))).data.id;
  assert.equal((await t.post('/api/proposals', { kind: 'course', course_id: fremd, data: course({ type: 'hund' }) })).status, 403);

  // Profil: Vorschlag, Freigabe, danach sichtbar
  const pp = await t.post('/api/proposals', { kind: 'profile', data: { name: 'Lena Muster', styles: 'Hatha, Yin', bio: 'Neuer Text', dog_ok: true } });
  assert.equal((await client().get('/api/trainers')).data.trainers.find((x) => x.name === 'Lena Muster'), undefined);
  await admin.post(`/api/admin/proposals/${pp.data.id}`, { decision: 'approve' });
  const tr = (await client().get('/api/trainers')).data.trainers.find((x) => x.name === 'Lena Muster');
  assert.equal(tr.styles, 'Hatha, Yin');
  assert.equal(tr.dog_ok, true);
  assert.equal(JSON.stringify(tr).includes('@'), false, 'keine E-Mail im öffentlichen Profil');
});

test('Rollen ändern: Admin sperrt sich nicht selbst aus', async () => {
  const me = (await admin.get('/api/me')).data.user;
  assert.equal((await admin.post(`/api/admin/users/${me.id}/role`, { role: 'customer' })).status, 400);
  const users = (await admin.get('/api/admin/overview')).data.users;
  const k = users.find((u) => u.email === 'kunde1@example.com');
  assert.equal((await admin.post(`/api/admin/users/${k.id}/role`, { role: 'superuser' })).status, 400);
  assert.equal((await admin.post(`/api/admin/users/${k.id}/role`, { role: 'trainer' })).status, 200);
});

test('Admin verwaltet Buchungen: bezahlt markieren, entfernen', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Verwaltung', cap: 1 }))).data.id;
  const c = await registerVerified('verwaltung@example.com');
  const d = await registerVerified('verwaltung2@example.com');
  await c.post('/api/bookings', { course_id: cid, first_name: 'V', seats: 1, pay_method: 'bar', confirmed: true });
  await d.post('/api/bookings', { course_id: cid, first_name: 'W', seats: 1, pay_method: 'bar', confirmed: true });
  const bs = (await admin.get('/api/admin/overview')).data.bookings.filter((b) => b.course_id === cid);
  assert.equal(bs.length, 2);
  const first = bs.find((b) => b.first_name === 'V');
  assert.equal((await admin.post(`/api/admin/bookings/${first.id}`, { action: 'paid' })).status, 200);
  assert.equal((await c.get('/api/bookings/mine')).data.bookings[0].pay_status, 'bezahlt');
  assert.equal((await admin.post(`/api/admin/bookings/${first.id}`, { action: 'remove' })).status, 200);
  assert.equal((await d.get('/api/bookings/mine')).data.bookings[0].status, 'ok', 'Wartende rückt nach');
});

test('Stripe-Webhook: Signatur wird geprüft, Zahlung wird verbucht', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Bezahlt', cap: 3 }))).data.id;
  const c = await registerVerified('zahler@example.com');
  const bk = await c.post('/api/bookings', { course_id: cid, first_name: 'Z', seats: 1, pay_method: 'bar', confirmed: true });
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { booking_id: String(bk.data.booking_id) } } } });
  const sign = (secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${event}`).digest('hex')}`;
  const send = (sig) => client().req('POST', '/api/stripe/webhook', undefined, { raw: Buffer.from(event), headers: { 'Stripe-Signature': sig, 'Content-Type': 'application/json' } });

  assert.equal((await send(sign('falsches-geheimnis'))).status, 400);
  assert.equal((await send(sign(WEBHOOK_SECRET, 1000))).status, 400, 'zu alte Signatur');
  assert.equal((await c.get('/api/bookings/mine')).data.bookings[0].pay_status, 'offen');
  assert.equal((await send(sign(WEBHOOK_SECRET))).status, 200);
  assert.equal((await c.get('/api/bookings/mine')).data.bookings[0].pay_status, 'bezahlt');
  assert.match(lastMail('zahler@example.com').subject, /Zahlung erhalten/);
});

test('Raum: Texte speichern, Foto nur mit echtem Bild', async () => {
  const save = await admin.put('/api/admin/room', { studio_name: 'Mein Studio', tagline: 'T', room_title: 'Raum', body: 'Hell', facts: 'Größe: 40 m²', rules: 'Schuhe aus', pay_info: 'ES00 0000' });
  assert.equal(save.status, 200);
  assert.equal((await client().get('/api/room')).data.studio_name, 'Mein Studio');
  assert.equal((await registerVerified('raum@example.com').then((c) => c.put('/api/admin/room', { studio_name: 'Hack' }))).status, 403);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
  const up = await admin.req('POST', '/api/admin/room/photo', undefined, { raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 200);
  const served = await fetch(base + up.data.photo_url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  const bad = await admin.req('POST', '/api/admin/room/photo', undefined, { raw: Buffer.from('<script>alert(1)</script>'), headers: { 'Content-Type': 'image/png' } });
  assert.equal(bad.status, 415);
});

test('Statische Dateien: kein Zugriff außerhalb von public', async () => {
  const r = await fetch(base + '/..%2f..%2fpackage.json');
  assert.notEqual(r.status, 200);
  const r2 = await fetch(base + '/uploads/..%2f..%2fyoga.db');
  assert.notEqual(r2.status, 200);
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/);
});

test('Passwörter liegen nur als Hash in der Datenbank', async () => {
  const rows = app.db.prepare('SELECT pass_hash FROM users').all();
  assert.ok(rows.length > 3);
  rows.forEach((r) => assert.match(r.pass_hash, /^s1\$[0-9a-f]{32}\$[0-9a-f]{128}$/));
  const tokens = app.db.prepare('SELECT token_hash FROM sessions').all();
  tokens.forEach((t) => assert.match(t.token_hash, /^[0-9a-f]{64}$/));
});

test('Zu viele Anmeldeversuche werden gebremst', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'yoga-limit-'));
  const a2 = createApp({ dataDir: d2, dbFile: path.join(d2, 't.db'), siteUrl: 'http://localhost', cancelHours: 24, mailFrom: 'x', trustProxy: false, logMail: false });
  await new Promise((r) => a2.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${a2.server.address().port}/api/login`;
  const codes = [];
  for (let i = 0; i < 13; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.de', password: 'falsch-falsch' }) });
    codes.push(r.status);
  }
  assert.equal(codes[0], 401);
  assert.equal(codes[12], 429);
  await a2.close();
  fs.rmSync(d2, { recursive: true, force: true });
});

test('Englisch: Mails folgen der Sprache des Kontos und lassen sich umschalten', async () => {
  const en = client();
  const r = await en.req('POST', '/api/register', { name: 'Eva', email: 'eva@example.com', password: 'sicheres-passwort' }, { headers: { 'X-Lang': 'en' } });
  assert.equal(r.status, 200);
  let m = lastMail('eva@example.com');
  assert.equal(m.subject, 'Please confirm your email address');
  assert.match(m.html, /Confirm email address/);
  assert.doesNotMatch(m.html, /bestätigen/);
  const link = new URL(linkFrom(m, /href="([^"]*verify-email[^"]*)"/));
  await client().get(link.pathname + link.search);

  const cr = await admin.post('/api/admin/courses', course({ title: 'English test', cap: 3 }));
  assert.equal(cr.status, 200, JSON.stringify(cr.data));
  const b = await en.post('/api/bookings', { course_id: cr.data.id, first_name: 'Eva', seats: 1, pay_method: 'bar', confirmed: true });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  m = lastMail('eva@example.com');
  assert.equal(m.subject, 'Booking confirmed: English test');
  assert.match(m.html, /Your booking is confirmed/);
  assert.match(m.html, /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d+ [A-Z][a-z]+ \d{4}/);
  assert.doesNotMatch(m.html, / Uhr|Plätze|stornieren/);

  const sw = await en.post('/api/me/lang', { lang: 'de' });
  assert.equal(sw.status, 200);
  await en.post(`/api/bookings/${b.data.booking_id}/cancel`);
  assert.equal(lastMail('eva@example.com').subject, 'Storniert: English test');
});

test('Englisch: Übersetzung deckt Fehlermeldungen und Muster ab', () => {
  const { tr } = require('../public/en.js');
  assert.equal(tr('Diesen Kurs gibt es nicht.'), 'This course does not exist.');
  assert.equal(tr('Stornieren ist nur bis 24 Stunden vor Beginn möglich.'), 'Cancelling is only possible up to 24 hours before the start.');
  assert.equal(tr('Noch 3 von 8 Plätzen frei'), '3 of 8 spots left');
  assert.equal(tr(' Welpenyoga '), ' Puppy yoga ');
  assert.equal(tr('Unbekannter Text bleibt'), 'Unbekannter Text bleibt');
  assert.equal(tr('Montag, 26. Oktober 2026, 18:00 Uhr'), 'Monday, 26 October 2026, 18:00');
});

test('PayPal: nur mit hinterlegtem PayPal.me, Link in der Mail, Zahlungsbestätigung bei „bezahlt“', async () => {
  const c = await registerVerified('paula@example.com', 'Paula');
  const cr = await admin.post('/api/admin/courses', course({ title: 'PayPal Kurs', price: 12.5, cap: 3 }));
  const book = (seats = 1) => c.post('/api/bookings', { course_id: cr.data.id, first_name: 'Paula', seats, pay_method: 'paypal', confirmed: true });

  const no = await book();
  assert.equal(no.status, 400, 'ohne PayPal.me nicht wählbar');

  const bad = await admin.put('/api/admin/room', { studio_name: 'Studio', paypal_me: 'https://evil.example/x' });
  assert.equal(bad.status, 400);
  const room0 = (await client().get('/api/room')).data;
  const ok = await admin.put('/api/admin/room', { studio_name: room0.studio_name, tagline: '', room_title: '', body: '', facts: '', rules: '', pay_info: '', paypal_me: 'https://www.paypal.me/yogapfoten' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await client().get('/api/room')).data.paypal_me, 'yogapfoten');

  const yes = await book(2);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  let m = lastMail('paula@example.com');
  assert.match(m.html, /https:\/\/www\.paypal\.me\/yogapfoten\/25\.00EUR/);
  assert.match(m.html, /#buchungen/);

  const before = mailCount('paula@example.com');
  const paid = await admin.post(`/api/admin/bookings/${yes.data.booking_id}`, { action: 'paid' });
  assert.equal(paid.status, 200);
  m = lastMail('paula@example.com');
  assert.equal(m.subject, 'Zahlung erhalten: PayPal Kurs');
  assert.equal(mailCount('paula@example.com'), before + 1);
  await admin.post(`/api/admin/bookings/${yes.data.booking_id}`, { action: 'paid' });
  assert.equal(mailCount('paula@example.com'), before + 1, 'zweites Markieren schickt keine zweite Mail');
});

test('Ältere Datenbank ohne PayPal wird beim Start umgebaut', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { openDb } = require('../lib/db');
  const f = path.join(dir, 'alt.db');
  const old = new DatabaseSync(f);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', email_verified INTEGER NOT NULL DEFAULT 0, trainer_requested INTEGER NOT NULL DEFAULT 0, bio TEXT NOT NULL DEFAULT '', styles TEXT NOT NULL DEFAULT '', dog_ok INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE courses (id INTEGER PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, starts_at INTEGER NOT NULL, dur INTEGER NOT NULL DEFAULT 60, cap INTEGER NOT NULL DEFAULT 8, price_cents INTEGER NOT NULL DEFAULT 0, level TEXT NOT NULL DEFAULT 'Alle Level', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aktiv', trainer_id INTEGER, example INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, first_name TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 1, dog_name TEXT NOT NULL DEFAULT '', pay_method TEXT NOT NULL CHECK (pay_method IN ('online','bar','karte','ueberweisung')), pay_status TEXT NOT NULL DEFAULT 'offen', status TEXT NOT NULL DEFAULT 'ok', stripe_session_id TEXT, created_at INTEGER NOT NULL, UNIQUE (course_id, user_id));
    INSERT INTO users (id,email,pass_hash,created_at) VALUES (1,'a@b.de','x',1);
    INSERT INTO courses (id,title,type,date,time,starts_at,created_at) VALUES (1,'K','ohne','2030-01-01','10:00',1,1);
    INSERT INTO bookings (course_id,user_id,first_name,pay_method,created_at) VALUES (1,1,'A','bar',1);`);
  old.close();
  const db = openDb(f);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 1, 'alte Buchung bleibt erhalten');
  db.prepare("INSERT INTO courses (id,title,type,date,time,starts_at,created_at) VALUES (2,'K2','ohne','2030-01-02','10:00',1,1)").run();
  db.prepare("INSERT INTO bookings (course_id,user_id,first_name,pay_method,created_at) VALUES (2,1,'A','paypal',1)").run();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 2);
  db.close();
});

test('Rechtliche Texte: nur Admin darf speichern, alle dürfen lesen', async () => {
  const kunde = await registerVerified('recht@example.com', 'Rita');
  const body = { imprint: 'Anbieter: Testfrau', imprint_en: 'Provider: Test', privacy: 'Daten\n\nMehr Daten', privacy_en: '', terms: 'AGB Text', terms_en: '' };
  assert.equal((await kunde.put('/api/admin/legal', body)).status, 403);
  assert.equal((await client().put('/api/admin/legal', body)).status, 401);
  const ok = await admin.put('/api/admin/legal', body);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const r = (await client().get('/api/room')).data;
  assert.equal(r.legal.imprint, 'Anbieter: Testfrau');
  assert.equal(r.legal.imprint_en, 'Provider: Test');
  assert.equal(r.legal.privacy, 'Daten\n\nMehr Daten');
  const long = await admin.put('/api/admin/legal', { ...body, terms: 'x'.repeat(20001) });
  assert.equal(long.status, 400);
});

test('Serie: täglich oder wöchentlich bis zum Enddatum, mit Grenzen', async () => {
  const start = inDays(30).date;
  const plus = (n) => new Date(new Date(start + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
  const day = await admin.post('/api/admin/courses', course({ title: 'Serie täglich', date: start, repeat: { every: 'day', until: plus(6) } }));
  assert.equal(day.status, 200, JSON.stringify(day.data));
  assert.equal(day.data.count, 7);
  const week = await admin.post('/api/admin/courses', course({ title: 'Serie wöchentlich', date: start, repeat: { every: 'week', until: plus(21) } }));
  assert.equal(week.data.count, 4);
  const list = (await client().get('/api/courses')).data.courses;
  assert.equal(list.filter((c) => c.title === 'Serie täglich').length, 7);
  assert.equal((await admin.post('/api/admin/courses', course({ date: start, repeat: { every: 'day', until: plus(90) } }))).status, 400, 'mehr als 60 Termine');
  assert.equal((await admin.post('/api/admin/courses', course({ date: start, repeat: { every: 'day', until: plus(-1) } }))).status, 400, 'Enddatum vor Start');
  assert.equal((await admin.post('/api/admin/courses', course({ date: start, repeat: { every: 'month', until: plus(10) } }))).status, 400);
});

test('Überweisung und Karte vor Ort sind nicht mehr wählbar', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Zahlarten', cap: 5 }))).data.id;
  const c = await registerVerified('zahlart@example.com');
  for (const pm of ['ueberweisung', 'karte']) {
    assert.equal((await c.post('/api/bookings', { course_id: cid, first_name: 'Z', seats: 1, pay_method: pm, confirmed: true })).status, 400);
  }
  assert.equal((await c.post('/api/bookings', { course_id: cid, first_name: 'Z', seats: 1, pay_method: 'bar', confirmed: true })).status, 200);
  assert.match(lastMail('zahlart@example.com').body || lastMail('zahlart@example.com').html || JSON.stringify(lastMail('zahlart@example.com')), /Nichterscheinen/);
});

test('Nicht erschienen: erst nach Kursbeginn, Mail mit vollem Preis, nur einmal', async () => {
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Schwänzer', cap: 5, price_cents: 2000 }))).data.id;
  const c = await registerVerified('schwaenzer@example.com');
  const bk = await c.post('/api/bookings', { course_id: cid, first_name: 'S', seats: 2, pay_method: 'bar', confirmed: true });
  const id = bk.data.booking_id;
  assert.equal((await admin.post(`/api/admin/bookings/${id}`, { action: 'noshow' })).status, 400, 'vor Kursbeginn nicht möglich');
  app.db.prepare('UPDATE courses SET starts_at = ? WHERE id = ?').run(Date.now() - 3600e3, cid);
  const n = mailCount('schwaenzer@example.com');
  assert.equal((await admin.post(`/api/admin/bookings/${id}`, { action: 'noshow' })).status, 200);
  assert.equal(mailCount('schwaenzer@example.com'), n + 1);
  assert.match(JSON.stringify(lastMail('schwaenzer@example.com')), /volle Preis fällig: 24/);
  assert.equal((await c.get('/api/bookings/mine')).data.bookings[0].no_show, true);
  await admin.post(`/api/admin/bookings/${id}`, { action: 'noshow' });
  assert.equal(mailCount('schwaenzer@example.com'), n + 1, 'keine zweite Mail');
  assert.equal((await admin.post(`/api/admin/bookings/${id}`, { action: 'showed' })).status, 200);
  assert.equal((await c.get('/api/bookings/mine')).data.bookings[0].no_show, false);
});

test('Galerie: nur Admin, nur echte Bilder, Löschen, Limit 12', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const up = (cl, buf) => cl.req('POST', '/api/admin/gallery', undefined, { raw: buf, headers: { 'Content-Type': 'image/png' } });
  const k = await registerVerified('galerie-kunde@example.com');
  assert.equal((await up(k, png)).status, 403);
  assert.equal((await up(admin, Buffer.from('<script>x</script>'))).status, 415);
  const first = await up(admin, png);
  assert.equal(first.status, 200);
  assert.equal((await client().get('/api/room')).data.gallery.some((g) => g.url === first.data.url), true);
  assert.equal((await admin.req('DELETE', '/api/admin/gallery/' + first.data.id)).status, 200);
  assert.equal((await client().get('/api/room')).data.gallery.some((g) => g.url === first.data.url), false);
  let last;
  for (let i = 0; i < 13; i++) last = await up(admin, png);
  assert.equal(last.status, 400, 'mehr als 12 Fotos nicht erlaubt');
});

test('Gutschein: Betrag wird abgezogen, bei Storno zurückgegeben, Admin legt an', async () => {
  const k = await registerVerified('gutschein@example.com');
  assert.equal((await k.post('/api/admin/vouchers', { euro: 20 })).status, 403);
  const code = (await admin.post('/api/admin/vouchers', { euro: 30, note: 'Test' })).data.code;
  assert.match(code, /^PFOTE-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Mit Gutschein', cap: 5, price_cents: 2000 }))).data.id;
  assert.equal((await k.post('/api/bookings', { course_id: cid, first_name: 'G', seats: 1, pay_method: 'bar', confirmed: true, voucher: 'FALSCH' })).status, 400);
  const ok = await k.post('/api/bookings', { course_id: cid, first_name: 'G', seats: 1, pay_method: 'bar', confirmed: true, voucher: code.toLowerCase() });
  assert.equal(ok.status, 200);
  const mine = (await k.get('/api/bookings/mine')).data.bookings[0];
  assert.equal(mine.voucher_cents, 1200);
  assert.equal(mine.pay_status, 'bezahlt', 'voller Preis gedeckt');
  const left = () => app.db.prepare('SELECT cents_left FROM vouchers WHERE code = ?').get(code).cents_left;
  assert.equal(left(), 1800);
  assert.equal((await k.post(`/api/bookings/${mine.id}/cancel`, {})).status, 200);
  assert.equal(left(), 3000, 'Betrag zurück auf dem Gutschein');
  const csv = await admin.get('/api/admin/vouchers');
  assert.equal(csv.data.vouchers.length >= 1, true);
});

test('Kalenderdatei, Erinnerung und Newsletter-Liste', async () => {
  const k = await registerVerified('erinnerung@example.com');
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Morgenyoga', cap: 5, ...inDays(1) }))).data.id;
  const bk = await k.post('/api/bookings', { course_id: cid, first_name: 'E', seats: 1, pay_method: 'bar', confirmed: true });
  const ics = await k.req('GET', `/api/bookings/${bk.data.booking_id}/ics`);
  assert.equal(ics.status, 200);
  app.db.prepare('UPDATE bookings SET created_at = created_at - 5 * 86400000 WHERE id = ?').run(bk.data.booking_id);
  app.db.prepare('UPDATE courses SET starts_at = ? WHERE id = ?').run(Date.now() + 20 * 3600e3, cid);
  const n = mailCount('erinnerung@example.com');
  assert.equal(app.runReminders() >= 1, true);
  assert.equal(mailCount('erinnerung@example.com'), n + 1);
  assert.match(lastMail('erinnerung@example.com').subject, /Morgen/);
  app.runReminders();
  assert.equal(mailCount('erinnerung@example.com'), n + 1, 'nur einmal');
  await k.post('/api/me/newsletter', { newsletter: true });
  const csv = await admin.req('GET', '/api/admin/newsletter.csv');
  assert.equal(csv.status, 200);
});

test('Abo: Guthaben beim Buchen, Gästeticket, Storno gibt es zurück, falsche Kursart abgelehnt', async () => {
  const k = await registerVerified('abo-kunde@example.com');
  const plans = (await client().get('/api/plans')).data.plans;
  assert.equal(plans.length, 4);
  const start = plans.find((p) => p.slug === 'start');
  assert.equal((await k.post('/api/admin/memberships', { email: 'abo-kunde@example.com', plan_id: start.id })).status, 403);
  assert.equal((await admin.post('/api/admin/memberships', { email: 'abo-kunde@example.com', plan_id: start.id })).status, 200);
  let m = (await k.get('/api/memberships/mine')).data.memberships[0];
  assert.equal(m.credits_left, 4);
  assert.equal(m.guests_left, 1);
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Abo-Kurs', cap: 5, type: 'ohne' }))).data.id;
  const bk = await k.post('/api/bookings', { course_id: cid, first_name: 'A', seats: 2, pay_method: 'bar', confirmed: true, use_membership: true });
  assert.equal(bk.status, 200, JSON.stringify(bk.data));
  const mine = (await k.get('/api/bookings/mine')).data.bookings[0];
  assert.equal(mine.pay_status, 'bezahlt', 'Abo und Gästeticket decken beide Plätze');
  m = (await k.get('/api/memberships/mine')).data.memberships[0];
  assert.equal(m.credits_left, 3);
  assert.equal(m.guests_left, 0);
  assert.equal((await k.post(`/api/bookings/${mine.id}/cancel`, {})).status, 200);
  m = (await k.get('/api/memberships/mine')).data.memberships[0];
  assert.equal(m.credits_left, 4, 'Guthaben zurück');
  assert.equal(m.guests_left, 1);
  const welpen = (await admin.post('/api/admin/courses', course({ title: 'Welpen-Abo', cap: 5, type: 'welpen' }))).data.id;
  assert.equal((await k.post('/api/bookings', { course_id: welpen, first_name: 'A', seats: 1, pay_method: 'bar', confirmed: true, use_membership: true })).status, 400, 'Start-Abo gilt nicht für Welpenyoga');
  assert.equal((await k.post(`/api/memberships/${m.id}/cancel`, {})).status, 200);
  assert.equal((await k.get('/api/memberships/mine')).data.memberships[0].status, 'gekuendigt');
});

test('Abo über Stripe: Kauf wird verbucht, Verlängerung setzt Guthaben zurück, Ende beendet es', async () => {
  const k = await registerVerified('abo-stripe@example.com');
  const uid = app.db.prepare('SELECT id FROM users WHERE email = ?').get('abo-stripe@example.com').id;
  const plan = (await client().get('/api/plans')).data.plans.find((p) => p.slug === 'flat');
  const send = (type, object) => {
    const body = JSON.stringify({ type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')}`;
    return client().req('POST', '/api/stripe/webhook', undefined, { raw: Buffer.from(body), headers: { 'Stripe-Signature': sig, 'Content-Type': 'application/json' } });
  };
  const session = { id: 'cs_1', payment_status: 'paid', subscription: 'sub_123', metadata: { plan_id: String(plan.id), user_id: String(uid) } };
  assert.equal((await send('checkout.session.completed', session)).status, 200);
  assert.equal((await send('checkout.session.completed', session)).status, 200);
  assert.equal((await k.get('/api/memberships/mine')).data.memberships.length, 1, 'nur einmal angelegt');
  assert.match(lastMail('abo-stripe@example.com').subject, /Abo ist aktiv/);
  app.db.prepare("UPDATE memberships SET credits_left = 1 WHERE stripe_sub_id = 'sub_123'").run();
  await send('invoice.paid', { subscription: 'sub_123', billing_reason: 'subscription_cycle' });
  assert.equal((await k.get('/api/memberships/mine')).data.memberships[0].credits_left, 12);
  await send('customer.subscription.deleted', { id: 'sub_123' });
  assert.equal((await k.get('/api/memberships/mine')).data.memberships.length, 0);
});

test('Einladung: beide bekommen einen Gutschein nach der ersten Buchung', async () => {
  const a = await registerVerified('einlader@example.com', 'Einlader');
  const info = (await a.get('/api/me/referral')).data;
  assert.match(info.code, /^[A-Z0-9]{6}$/);
  const f = client();
  assert.equal((await f.post('/api/register', { name: 'Freundin', email: 'freundin@example.com', password: 'sicheres-passwort', ref: info.code.toLowerCase() })).status, 200);
  const link = linkFrom(lastMail('freundin@example.com'), /href="([^"]*verify-email[^"]*)"/);
  await client().get(new URL(link).pathname + new URL(link).search);
  const before = app.db.prepare('SELECT COUNT(*) AS n FROM vouchers').get().n;
  const cid = (await admin.post('/api/admin/courses', course({ title: 'Einladungs-Kurs', cap: 5 }))).data.id;
  assert.equal((await f.post('/api/bookings', { course_id: cid, first_name: 'F', seats: 1, pay_method: 'bar', confirmed: true })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM vouchers').get().n, before + 2);
  assert.match(lastMail('freundin@example.com').subject, /Willkommens-Gutschein|Buchung bestätigt/);
  assert.equal(mailCount('einlader@example.com') >= 2, true);
  const cid2 = (await admin.post('/api/admin/courses', course({ title: 'Zweiter Kurs', cap: 5 }))).data.id;
  await f.post('/api/bookings', { course_id: cid2, first_name: 'F', seats: 1, pay_method: 'bar', confirmed: true });
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM vouchers').get().n, before + 2, 'nur einmal belohnt');
  assert.equal((await a.get('/api/me/referral')).data.rewarded, 1);
});

test('Welpen-Paket gilt bis zu einem festen Datum, Basic-Abo ist unbegrenzt', async () => {
  const plans = (await client().get('/api/plans')).data.plans;
  const vip = plans.find((p) => p.slug === 'vip');
  const basic = plans.find((p) => p.slug === 'basic');
  assert.equal(vip.valid_until, '2026-12-31');
  assert.equal(basic.credits, 99);
  assert.deepEqual(basic.types, ['ohne']);
  const k = await registerVerified('paket@example.com');
  assert.equal((await admin.post('/api/admin/memberships', { email: 'paket@example.com', plan_id: vip.id })).status, 200);
  const m = (await k.get('/api/memberships/mine')).data.memberships[0];
  assert.equal(new Date(m.period_end).toISOString().slice(0, 10) >= '2026-12-31', true);
  assert.equal(new Date(m.period_end).toISOString().slice(0, 10) <= '2027-01-01', true);
  const put = (body) => admin.req('PUT', '/api/admin/plans/' + vip.id, body);
  assert.equal((await put({ name: 'Welpen-VIP', price_euro: 125, credits: 3, guests: 0, description: '', active: true, valid_until: 'kein-datum' })).status, 400);
  assert.equal((await put({ name: 'Welpen-VIP', price_euro: 125, credits: 3, guests: 0, description: '', active: true, valid_until: '2020-01-01' })).status, 200);
  assert.equal((await k.post(`/api/plans/${vip.id}/buy`, {})).status, 409, 'abgelaufenes Paket nicht kaufbar');
  await put({ name: 'Welpen-VIP', price_euro: 125, credits: 3, guests: 0, description: '', active: true, valid_until: '2026-12-31' });
});

test('Geschichten: nur Admin, Einwilligung nötig, Fotos prüfen', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const up = (cl) => cl.req('POST', '/api/admin/story-photo', undefined, { raw: png, headers: { 'Content-Type': 'image/png' } });
  const k = await registerVerified('story-kunde@example.com');
  assert.equal((await up(k)).status, 403);
  assert.equal((await admin.req('POST', '/api/admin/story-photo', undefined, { raw: Buffer.from('<x>'), headers: { 'Content-Type': 'image/png' } })).status, 415);
  const a = (await up(admin)).data.file, b = (await up(admin)).data.file;
  assert.equal((await admin.post('/api/admin/stories', { before: a, after: b, caption: 'x', weeks: 12 })).status, 400, 'ohne Einwilligung');
  assert.equal((await admin.post('/api/admin/stories', { before: '../etc/passwd', after: b, consent: true })).status, 400);
  const ok = await admin.post('/api/admin/stories', { before: a, after: b, caption: 'Anna, 12 Wochen', weeks: 12, consent: true });
  assert.equal(ok.status, 200);
  assert.equal((await client().get('/api/room')).data.stories[0].caption, 'Anna, 12 Wochen');
  assert.equal((await admin.req('DELETE', '/api/admin/stories/' + ok.data.id)).status, 200);
  assert.equal((await client().get('/api/room')).data.stories.length, 0);
});
