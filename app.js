(function () {
'use strict';

/* ---------- Konstanten ---------- */
var TYPES = {
  welpen: { label: 'Welpenyoga', cls: 'pup', blurb: 'Kleine Termine mit den Welpen des Studios. Die Welpen bestimmen das Tempo und dürfen sich jederzeit zurückziehen.' },
  hund: { label: 'Mit eigenem Hund', cls: 'dog', blurb: 'Du bringst deinen Hund mit. Impfschutz, Haftpflicht und Verträglichkeit sind Voraussetzung.' },
  ohne: { label: 'Ohne Hund', cls: 'nodog', blurb: 'Yoga ohne Tiere im Raum.' }
};
var LEVELS = ['Alle Level', 'Einsteiger', 'Fortgeschritten'];
var PAY = { online: 'Online bezahlen', paypal: 'PayPal', bar: 'Bar vor Ort', karte: 'Karte vor Ort', ueberweisung: 'Überweisung' };
var PAY_NOW = ['online', 'paypal', 'bar'];
var ROLE_LABEL = { customer: 'Kunde', trainer: 'Trainer/in', admin: 'Admin' };
var COURSE_LABELS = { title: 'Titel', type: 'Kursart', date: 'Datum', time: 'Uhrzeit', dur: 'Dauer', cap: 'Plätze', price: 'Preis', level: 'Niveau', description: 'Beschreibung', status: 'Status' };
var PROFILE_LABELS = { name: 'Name', styles: 'Yoga-Stile', bio: 'Über mich', dog_ok: 'Erfahrung mit Hunden' };
var NEEDS_USER = ['buchungen', 'konto', 'trainer', 'admin'];
var PUBLIC_ROUTES = ['kurse', 'kalender', 'warum', 'abos', 'einladen', 'team', 'raum', 'buchungen', 'konto', 'trainer', 'admin', 'login', 'registrieren', 'passwort-vergessen', 'passwort-neu', 'rechtliches'];

var S = {
  ready: false, user: null, config: { stripe: false, cancel_hours: 24, requirements: { welpen: [], hund: [], ohne: [] } },
  courses: [], room: null, trainers: [], mine: [], adm: null, tr: null, plans: [], members: [], referral: null,
  filter: 'all', calMonth: null, calDay: null, adminTab: 'freigaben', trainerTab: 'profil',
  editing: null, formDirty: false, next: null, heroSeen: false, error: '', lang: 'de'
};
function LOC() { return S.lang === 'en' ? 'en-GB' : 'de-DE'; }
function initLang() {
  var l = '';
  try { l = localStorage.getItem('lang') || ''; } catch (e) {}
  if (l !== 'de' && l !== 'en') l = /^de/i.test(navigator.language || '') ? 'de' : 'en';
  S.lang = l; document.documentElement.lang = l;
}
function setLang(l) {
  if (l === S.lang) return;
  S.lang = l; document.documentElement.lang = l;
  try { localStorage.setItem('lang', l); } catch (e) {}
  if (S.user) api('POST', '/api/me/lang', { lang: l }).catch(function () {});
  closeModal(); S.formDirty = false; S.editing = null;
  render();
}

/* ---------- Helfer ---------- */
function $(s) { return document.querySelector(s); }
function h(tag, attrs) {
  var e = document.createElement(tag), val;
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (v == null || v === false) return;
    if (k === 'class') e.className = v;
    else if (k === 'value') val = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'disabled') e.disabled = !!v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  });
  for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
  if (val !== undefined) e.value = val;
  return e;
}
function add(e, c) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
  e.append(c.nodeType ? c : document.createTextNode(String(c)));
}
function toast(msg) {
  var t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4200);
}
function todayISO() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); }
function dparts(iso) {
  var d = new Date(iso + 'T12:00:00Z'), o = { timeZone: 'UTC' };
  return {
    wd: d.toLocaleDateString(LOC(), Object.assign({ weekday: 'short' }, o)), day: d.getUTCDate(),
    mon: d.toLocaleDateString(LOC(), Object.assign({ month: 'short' }, o)),
    full: d.toLocaleDateString(LOC(), Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, o))
  };
}
function euro(cents) {
  return (cents / 100).toLocaleString(LOC(), { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
function fmtVal(k, v) {
  if (v == null || v === '') return '–';
  if (k === 'type') return (TYPES[v] || {}).label || v;
  if (k === 'price') return euro(Number(v) * 100);
  if (k === 'dur') return v + ' Min.';
  if (k === 'dog_ok') return v ? 'Ja' : 'Nein';
  return String(v);
}
function fld(label, ctrl, hint) { return h('label', { class: 'fld' }, h('span', { class: 'fl' }, label), ctrl, hint ? h('small', null, hint) : null); }

/* ---------- Schnittstelle ---------- */
function api(method, url, body, raw) {
  var init = { method: method, headers: { 'X-Lang': S.lang }, credentials: 'same-origin' };
  if (raw) { init.headers['Content-Type'] = raw.type || 'application/octet-stream'; init.body = raw; }
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  return fetch(url, init).then(function (res) {
    return res.json().catch(function () { return null; }).then(function (data) {
      if (!res.ok) {
        var err = new Error((data && data.message) || 'Das hat nicht geklappt. Bitte versuche es noch einmal.');
        err.code = data && data.error; err.status = res.status;
        if (res.status === 401 && S.user) { S.user = null; S.mine = []; render(); }
        throw err;
      }
      return data;
    });
  });
}
/** Führt eine Aktion aus, meldet Fehler als Hinweis und lädt danach alles neu */
function act(fn, okMsg) {
  return Promise.resolve().then(fn).then(function (r) {
    if (okMsg) toast(okMsg);
    return reload().then(function () { return r; });
  }).catch(function (e) { toast(e.message); throw e; });
}
function loadPublic() {
  return Promise.all([api('GET', '/api/courses'), api('GET', '/api/room'), api('GET', '/api/trainers'), api('GET', '/api/plans')]).then(function (r) {
    S.courses = r[0].courses; S.room = r[1]; S.trainers = r[2].trainers; S.plans = r[3].plans;
  });
}
function loadUserData() {
  if (!S.user) { S.mine = []; S.adm = null; S.tr = null; S.members = []; S.referral = null; return Promise.resolve(); }
  var jobs = [api('GET', '/api/bookings/mine').then(function (r) { S.mine = r.bookings; }),
    api('GET', '/api/memberships/mine').then(function (r) { S.members = r.memberships; }),
    api('GET', '/api/me/referral').then(function (r) { S.referral = r; })];
  if (S.user.role === 'admin') jobs.push(api('GET', '/api/admin/overview').then(function (r) { S.adm = r; }));
  if (S.user.role === 'trainer') jobs.push(api('GET', '/api/trainer/overview').then(function (r) { S.tr = r; }));
  return Promise.all(jobs);
}
function reload() {
  S.formDirty = false; S.editing = S.editing && S.editing.keep ? S.editing : null;
  return Promise.all([loadPublic(), loadUserData()]).then(function () { render(); });
}

/* ---------- Routing ---------- */
function currentRoute() {
  var raw = location.hash.replace(/^#/, ''), i = raw.indexOf('?');
  var name = i < 0 ? raw : raw.slice(0, i), q = new URLSearchParams(i < 0 ? '' : raw.slice(i + 1));
  if (PUBLIC_ROUTES.indexOf(name) < 0) name = 'kurse';
  return { name: name, q: q };
}
function go(name, query) {
  S.formDirty = false; S.editing = null;
  location.hash = '#' + name + (query ? '?' + query : '');
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', function () { S.formDirty = false; S.editing = null; render(); });

/* ---------- Rahmen ---------- */
function pendingCount() { return S.adm ? S.adm.proposals.length + S.adm.trainerRequests.length : 0; }
function renderNav(r) {
  var nav = $('#nav'); nav.replaceChildren();
  var tabs = [['kurse', 'Kurse'], ['kalender', 'Kalender'], ['warum', 'Warum Yoga'], ['abos', 'Abos'], ['team', 'Team'], ['raum', 'Der Raum'], ['einladen', 'Freundin einladen']];
  if (S.user) tabs.push(['buchungen', 'Meine Buchungen']);
  if (S.user && S.user.role === 'trainer') tabs.push(['trainer', 'Für Trainer']);
  if (S.user && S.user.role === 'customer') tabs.push(['trainer', 'Trainer werden']);
  if (S.user && S.user.role === 'admin') tabs.push(['admin', 'Verwaltung']);
  tabs.forEach(function (t) {
    var n = t[0] === 'admin' ? pendingCount() : 0;
    nav.append(h('button', { type: 'button', class: t[0] === 'einladen' ? 'invite' : null, 'aria-current': r.name === t[0] ? 'page' : null, onclick: function () { go(t[0]); } }, t[1], n ? h('span', { class: 'count' }, n) : null, t[0] === 'einladen' ? h('span', { class: 'badge' }, euro(S.config.referral_cents || 1000)) : null));
  });
  nav.append(h('span', { class: 'spacer' }));
  nav.append(h('span', { class: 'lang', role: 'group', 'aria-label': 'Sprache / Language' }, ['de', 'en'].map(function (l) {
    return h('button', { type: 'button', lang: l, 'aria-pressed': String(S.lang === l), onclick: function () { setLang(l); } }, l.toUpperCase());
  })));
  nav.append(S.user
    ? h('button', { type: 'button', class: 'account', 'aria-current': r.name === 'konto' ? 'page' : null, onclick: function () { go('konto'); } }, S.user.name || 'Konto')
    : h('button', { type: 'button', class: 'account', 'aria-current': r.name === 'login' ? 'page' : null, onclick: function () { go('login'); } }, 'Anmelden'));
}
function renderFoot() {
  var f = $('#foot'); f.replaceChildren.apply(f, [
    h('span', null, (S.room && S.room.studio_name) || 'Yoga mit Pfoten'),
    h('a', { href: '#rechtliches' }, 'Impressum, Datenschutz, AGB'),
    S.room && S.room.instagram ? h('a', { href: 'https://www.instagram.com/' + encodeURIComponent(S.room.instagram), target: '_blank', rel: 'noopener noreferrer' }, 'Instagram') : null,
    h('button', { type: 'button', class: 'linkbtn', onclick: function () { go('einladen'); } }, 'Freundin einladen und 10 € sparen')
  ].filter(Boolean));
}

function render() {
  S.formDirty = false;
  var r = currentRoute(), v = $('#view');
  document.title = (S.room && S.room.studio_name) || 'Yoga mit Pfoten';
  if (S.room) { $('#studio').textContent = S.room.studio_name; $('#tagline').textContent = S.room.tagline; }
  if (!S.ready) { v.replaceChildren(h('p', { class: 'muted' }, S.error || 'Lädt …')); return; }
  if (NEEDS_USER.indexOf(r.name) > -1 && !S.user) { S.next = r.name; location.replace('#login'); return; }
  renderNav(r); renderFoot();
  v.replaceChildren();
  if (S.user && !S.user.email_verified) {
    v.append(h('div', { class: 'banner' }, h('span', null, 'Bitte bestätige deine E-Mail-Adresse, damit du Kurse buchen kannst. Wir haben dir einen Link geschickt.'),
      h('button', { type: 'button', class: 'btn sm', onclick: function () { api('POST', '/api/resend-verification', {}).then(function () { toast('Link ist unterwegs.'); }).catch(function (e) { toast(e.message); }); } }, 'Link erneut senden')));
  }
  var views = { kurse: viewKurse, kalender: viewKalender, abos: viewAbos, warum: viewWarum, einladen: viewEinladen, team: viewTeam, raum: viewRaum, buchungen: viewBuchungen, konto: viewKonto, trainer: viewTrainer, admin: viewAdmin,
    login: viewLogin, registrieren: viewRegister, 'passwort-vergessen': viewForgot, 'passwort-neu': viewReset, rechtliches: viewLegal };
  views[r.name](v, r);
}
function afterInput(form) { form.addEventListener('input', function () { S.formDirty = true; }); return form; }

/* ---------- Konto: Anmelden, Registrieren ---------- */
function authDone(res) {
  S.user = res.user;
  api('POST', '/api/me/lang', { lang: S.lang }).catch(function () {});
  return loadUserData().then(function () { var n = S.next || 'kurse'; S.next = null; go(n); toast('Willkommen, ' + (S.user.name || 'schön dass du da bist') + '.'); });
}
function viewLogin(v) {
  var email = h('input', { id: 'li-email', type: 'email', required: true, autocomplete: 'email' });
  var pw = h('input', { id: 'li-pw', type: 'password', required: true, autocomplete: 'current-password' });
  var msg = h('p', { class: 'small', role: 'alert' });
  v.append(afterInput(h('form', { class: 'panel narrow stack', onsubmit: function (e) {
    e.preventDefault(); msg.textContent = '';
    api('POST', '/api/login', { email: email.value, password: pw.value }).then(authDone).catch(function (err) { msg.textContent = err.message; });
  } },
    h('h2', null, 'Anmelden'),
    fld('E-Mail', email), fld('Passwort', pw), msg,
    h('button', { type: 'submit', class: 'btn primary' }, 'Anmelden'),
    h('p', { class: 'small' }, h('a', { href: '#passwort-vergessen' }, 'Passwort vergessen?')),
    h('p', { class: 'small' }, 'Noch kein Konto? ', h('a', { href: '#registrieren' }, 'Jetzt registrieren')))));
}
function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
function viewRegister(v, r) {
  var refCode = ((r && r.q.get('ref')) || lsGet('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); lsSet('ref', refCode);
  var name = h('input', { id: 'rg-name', type: 'text', required: true, maxlength: 60, autocomplete: 'name' });
  var email = h('input', { id: 'rg-email', type: 'email', required: true, autocomplete: 'email' });
  var pw = h('input', { id: 'rg-pw', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  var news = h('input', { id: 'rg-news', type: 'checkbox' });
  var msg = h('p', { class: 'small', role: 'alert' });
  v.append(afterInput(h('form', { class: 'panel narrow stack', onsubmit: function (e) {
    e.preventDefault(); msg.textContent = '';
    api('POST', '/api/register', { name: name.value, email: email.value, password: pw.value, newsletter: news.checked, ref: refCode }).then(function (res) { lsSet('ref', ''); return authDone(res); }).catch(function (err) { msg.textContent = err.message; });
  } },
    h('h2', null, 'Konto anlegen'),
    refCode ? h('div', { class: 'banner ok' }, 'Du wurdest eingeladen! Nach deiner ersten Buchung schenken wir dir ' + euro(S.config.referral_cents || 1000) + '.') : null,
    h('p', { class: 'muted' }, 'Mit einem Konto buchst du Kurse und siehst deine Termine. Wir schicken dir einen Link zur Bestätigung deiner E-Mail-Adresse.'),
    fld('Name', name), fld('E-Mail', email), fld('Passwort', pw, 'Mindestens 8 Zeichen.'),
    h('label', { class: 'check' }, news, h('span', null, 'Ich möchte per E-Mail von neuen Kursen und Welpen-Terminen erfahren. Das kann ich jederzeit im Konto ändern.')), msg,
    h('button', { type: 'submit', class: 'btn primary' }, 'Konto anlegen'),
    h('p', { class: 'small' }, 'Schon ein Konto? ', h('a', { href: '#login' }, 'Anmelden')))));
}
function viewForgot(v) {
  var email = h('input', { id: 'fg-email', type: 'email', required: true, autocomplete: 'email' });
  var done = h('p', { class: 'banner ok', hidden: true }, 'Wenn es ein Konto mit dieser Adresse gibt, ist ein Link zum Zurücksetzen unterwegs.');
  v.append(afterInput(h('form', { class: 'panel narrow stack', onsubmit: function (e) {
    e.preventDefault();
    api('POST', '/api/forgot', { email: email.value }).then(function () { done.hidden = false; }).catch(function (err) { toast(err.message); });
  } },
    h('h2', null, 'Passwort vergessen'),
    fld('E-Mail', email), done,
    h('button', { type: 'submit', class: 'btn primary' }, 'Link senden'),
    h('p', { class: 'small' }, h('a', { href: '#login' }, 'Zurück zur Anmeldung')))));
}
function viewReset(v, r) {
  var token = r.q.get('token') || '';
  var pw = h('input', { id: 'rs-pw', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  var msg = h('p', { class: 'small', role: 'alert' });
  v.append(afterInput(h('form', { class: 'panel narrow stack', onsubmit: function (e) {
    e.preventDefault(); msg.textContent = '';
    api('POST', '/api/reset', { token: token, password: pw.value }).then(function () { toast('Passwort geändert. Bitte melde dich an.'); S.user = null; go('login'); }).catch(function (err) { msg.textContent = err.message; });
  } },
    h('h2', null, 'Neues Passwort festlegen'),
    fld('Neues Passwort', pw, 'Mindestens 8 Zeichen.'), msg,
    h('button', { type: 'submit', class: 'btn primary' }, 'Passwort speichern'))));
}
function viewKonto(v, r) {
  var u = S.user;
  if (r.q.get('verifiziert')) v.append(h('div', { class: 'banner ok' }, 'Danke, deine E-Mail-Adresse ist bestätigt.'));
  if (r.q.get('fehler')) v.append(h('div', { class: 'banner bad' }, 'Der Link ist abgelaufen oder wurde schon benutzt. Du kannst oben einen neuen anfordern.'));
  var name = h('input', { id: 'ko-name', type: 'text', required: true, maxlength: 60, value: u.name });
  v.append(h('h2', null, 'Mein Konto'));
  v.append(afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault();
    api('POST', '/api/me', { name: name.value }).then(function (res) { S.user = res.user; S.formDirty = false; toast('Gespeichert.'); render(); }).catch(function (err) { toast(err.message); });
  } },
    h('div', { class: 'row' }, h('span', { class: 'chip grey' }, ROLE_LABEL[u.role]), h('span', { class: 'chip ' + (u.email_verified ? 'ok' : 'warn') }, u.email_verified ? 'E-Mail bestätigt' : 'E-Mail nicht bestätigt')),
    h('p', { class: 'muted' }, u.email),
    fld('Name', name),
    h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Speichern')))));
  var nl = h('input', { id: 'ko-news', type: 'checkbox', checked: !!u.newsletter });
  nl.addEventListener('change', function () { api('POST', '/api/me/newsletter', { newsletter: nl.checked }).then(function () { u.newsletter = nl.checked; toast(nl.checked ? 'Du bekommst unsere Neuigkeiten.' : 'Du bekommst keine Neuigkeiten mehr.'); }).catch(function (err) { toast(err.message); }); });
  v.append(h('div', { class: 'panel' }, h('label', { class: 'check' }, nl, h('span', null, 'Neuigkeiten zu Kursen und Welpen-Terminen per E-Mail'))));
  var oldp = h('input', { id: 'ko-old', type: 'password', required: true, autocomplete: 'current-password' });
  var newp = h('input', { id: 'ko-new', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  v.append(afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault();
    api('POST', '/api/me/password', { old_password: oldp.value, new_password: newp.value }).then(function () { S.formDirty = false; toast('Passwort geändert.'); render(); }).catch(function (err) { toast(err.message); });
  } },
    h('h3', null, 'Passwort ändern'),
    h('div', { class: 'grid2' }, fld('Altes Passwort', oldp), fld('Neues Passwort', newp)),
    h('div', null, h('button', { type: 'submit', class: 'btn' }, 'Passwort ändern')))));
  v.append(h('div', null, h('button', { type: 'button', class: 'btn', onclick: function () {
    api('POST', '/api/logout', {}).then(function () { S.user = null; S.mine = []; S.adm = null; S.tr = null; go('kurse'); toast('Du bist abgemeldet.'); });
  } }, 'Abmelden')));
}

/* ---------- Kurse ---------- */
function paw() {
  var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'paw'); s.setAttribute('aria-hidden', 'true');
  [[22, 38], [42, 22], [62, 22], [80, 38]].forEach(function (p) {
    var e = document.createElementNS(ns, 'ellipse'); e.setAttribute('cx', p[0]); e.setAttribute('cy', p[1]); e.setAttribute('rx', 11); e.setAttribute('ry', 14); e.setAttribute('fill', 'currentColor'); s.append(e);
  });
  var b = document.createElementNS(ns, 'path');
  b.setAttribute('d', 'M50 48c-16 0-30 18-30 30 0 9 8 12 16 10 8-2 10-3 14-3s6 1 14 3c8 2 16-1 16-10 0-12-14-30-30-30z'); b.setAttribute('fill', 'currentColor'); s.append(b);
  return s;
}
function svgEl(tag, attrs, kids) {
  var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  (kids || []).forEach(function (c) { e.append(c); });
  return e;
}
function typeIcon(k) {
  var s = svgEl('svg', { viewBox: '0 0 48 48', class: 'ticon', 'aria-hidden': 'true' });
  if (k === 'ohne') {
    [[24, 8, 0], [24, 8, -34], [24, 8, 34]].forEach(function (p) {
      s.append(svgEl('path', { d: 'M24 40C16 32 16 18 24 8c8 10 8 24 0 32z', fill: 'currentColor', opacity: p[2] ? '.55' : '1', transform: 'rotate(' + p[2] + ' 24 40)' }));
    });
    s.append(svgEl('path', { d: 'M8 42h32', stroke: 'currentColor', 'stroke-width': '3', 'stroke-linecap': 'round' }));
  } else {
    var paws = k === 'welpen' ? [[0, 0, 1]] : [[-7, 3, 1], [8, -4, 0.7]];
    paws.forEach(function (p) {
      var g = svgEl('g', { transform: 'translate(' + p[0] + ' ' + p[1] + ') scale(' + (k === 'welpen' ? 1 : 0.78) + ')', opacity: String(p[2]), fill: 'currentColor' });
      [[10, 20], [19, 11], [29, 11], [38, 20]].forEach(function (e) { g.append(svgEl('ellipse', { cx: e[0], cy: e[1], rx: 4.6, ry: 6 })); });
      g.append(svgEl('path', { d: 'M24 25c-8 0-14 8-14 14 0 4 4 5 8 4 4-1 5-1.5 6-1.5s2 .5 6 1.5c4 1 8 0 8-4 0-6-6-14-14-14z' }));
      s.append(g);
    });
  }
  return s;
}
function typeStats(k, up) {
  var cs = up.filter(function (c) { return (k === 'all' || c.type === k) && c.status !== 'abgesagt'; });
  if (!cs.length) return null;
  var left = cs.reduce(function (n, c) { return n + Math.max(0, c.cap - c.taken); }, 0);
  var min = cs.reduce(function (m, c) { return Math.min(m, c.price_cents); }, Infinity);
  return { n: cs.length, left: left, min: min, next: cs[0], dur: cs[0].dur };
}
function heroBlock(pup, t0) {
  var intro = !S.heroSeen; S.heroSeen = true;
  var next = pup[0], days = next ? Math.round((new Date(next.date + 'T00:00:00Z') - new Date(t0 + 'T00:00:00Z')) / 864e5) : null;
  var left = pup.reduce(function (n, c) { return n + Math.max(0, c.cap - c.taken); }, 0);
  var count = next ? h('div', { class: 'count' },
    days > 0 ? [h('b', null, String(days)), h('span', null, days === 1 ? 'Tag bis zum ersten Welpenyoga' : 'Tage bis zum ersten Welpenyoga')] : [h('b', null, 'Jetzt'), h('span', null, 'läuft das Welpenyoga')],
    h('span', { class: 'small' }, left + ' freie Plätze in ' + pup.length + (pup.length === 1 ? ' Termin' : ' Terminen')),
    h('button', { type: 'button', class: 'btn primary', onclick: function () { S.filter = 'welpen'; render(); } }, 'Welpen-Termine ansehen')) : null;
  return h('section', { class: 'hero' + (intro ? ' rise' : '') + (S.room && S.room.photo_url ? ' hasphoto' : ''), style: S.room && S.room.photo_url ? 'background-image:linear-gradient(100deg,rgba(14,38,34,.92) 0%,rgba(14,38,34,.72) 55%,rgba(14,38,34,.35) 100%),url(' + S.room.photo_url + ')' : null }, paw(),
    h('div', { class: 'txt' }, h('p', { class: 'kick' }, (S.room && S.room.studio_name) || 'Yoga mit Pfoten'),
      h('h2', null, 'Yoga, bei dem der Hund mitmacht.'),
      h('p', { class: 'lead' }, 'Welpenyoga mit unseren Welpen, Kurse mit deinem eigenen Hund und klassisches Yoga ohne Fell. Such dir deinen Termin aus.'),
      h('div', { class: 'row heroact' },
        h('button', { type: 'button', class: 'btn primary lg', onclick: function () { var t = document.querySelector('.tiles'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Kurs finden'),
        h('button', { type: 'button', class: 'btn ghost lg', onclick: function () { go('raum'); } }, 'Den Raum ansehen'))),
    count);
}
function myBooking(cid) { return S.mine.find(function (b) { return b.course_id === cid; }); }
function courseCard(c) {
  var t = TYPES[c.type] || TYPES.ohne, left = Math.max(0, c.cap - c.taken), mine = myBooking(c.id), d = dparts(c.date), off = c.status === 'abgesagt';
  var act = [h('b', null, euro(c.price_cents))];
  if (off) act.push(h('span', { class: 'chip bad' }, 'Abgesagt'));
  else if (c.starts_at < Date.now()) act.push(h('span', { class: 'chip grey' }, 'Vorbei'));
  else if (mine) act.push(h('span', { class: 'chip ' + (mine.status === 'ok' ? 'ok' : 'warn') }, mine.status === 'ok' ? 'Gebucht' : 'Auf der Warteliste'));
  else if (!S.user) act.push(h('button', { type: 'button', class: 'btn primary sm', onclick: function () { S.next = 'kurse'; go('login'); } }, 'Anmelden zum Buchen'));
  else act.push(h('button', { type: 'button', class: 'btn primary sm', onclick: function () { openBooking(c); } }, left > 0 ? 'Buchen' : 'Warteliste'));
  return h('article', { class: 'card' },
    h('div', { class: 'date ' + t.cls, 'aria-hidden': 'true' }, h('span', null, d.wd), h('b', null, d.day), h('span', null, d.mon)),
    h('div', { class: 'info' }, h('span', { class: 'chip ' + t.cls }, t.label), h('h3', null, c.title),
      h('div', { class: 'meta' }, h('span', null, c.time + ' Uhr · ' + c.dur + ' Min.'), h('span', null, 'mit ' + c.trainer_name), h('span', null, c.level),
        off ? null : h('span', { class: left === 0 ? 'full' : left <= 3 ? 'low' : null }, left > 0 ? (left <= 3 ? 'Nur noch ' + left + (left === 1 ? ' Platz' : ' Plätze') + ' frei' : 'Noch ' + left + ' von ' + c.cap + ' Plätzen frei') : 'Ausgebucht'), c.example ? h('span', null, 'Beispieltermin') : null),
      off ? null : h('div', { class: 'bar' + (left === 0 ? ' full' : left <= 3 ? ' low' : ''), 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.min(100, Math.round(c.taken / c.cap * 100)) + '%' })),
      c.description ? h('p', { class: 'small' }, c.description) : null),
    h('div', { class: 'act' }, act));
}
function viewKurse(v) {
  var t0 = todayISO();
  var up = S.courses.filter(function (c) { return c.date >= t0; });
  var pup = up.filter(function (c) { return c.type === 'welpen' && c.status !== 'abgesagt'; });
  v.append(heroBlock(pup, t0));
  v.append(h('section', { class: 'invitebar' }, h('div', null, h('strong', null, 'Bring eine Freundin mit'), h('span', null, 'Ihr bekommt beide ' + euro(S.config.referral_cents || 1000) + ' Gutschein, sobald sie ihren ersten Kurs gebucht hat.')),
    h('button', { type: 'button', class: 'btn primary', onclick: function () { go('einladen'); } }, 'Jetzt einladen')));
  v.append(h('ul', { class: 'trust' }, [['Kleine Gruppen', 'Persönlich und entspannt'], ['Unsere eigenen Welpen', 'Aufgewachsen im Studio'], ['Kostenlos stornieren', 'Bis ' + S.config.cancel_hours + ' Std. vorher'], ['Einfach bezahlen', 'Karte, PayPal oder bar']].map(function (x) { return h('li', null, h('strong', null, x[0]), h('span', null, x[1])); })));
  var opts = ['all'].concat(Object.keys(TYPES));
  v.append(h('div', { class: 'tiles', role: 'group', 'aria-label': 'Kursart' }, opts.map(function (k) {
    var T = k === 'all' ? { label: 'Alle Kurse', cls: 'all', blurb: 'Alle Termine nach Datum.' } : TYPES[k], st = typeStats(k, up);
    return h('button', { type: 'button', class: 'tile ' + T.cls + (S.filter === k ? ' on' : ''), 'aria-pressed': String(S.filter === k),
      onclick: function () { S.filter = k; render(); } },
      k === 'all' ? null : typeIcon(k), h('strong', null, T.label), h('span', { class: 'tb' }, T.blurb),
      st ? h('span', { class: 'tm' }, (k === 'all' ? '' : 'ab ' + euro(st.min) + ' · ' + st.dur + ' Min. · ') + st.n + (st.n === 1 ? ' Termin' : ' Termine') + (st.left <= 3 && k !== 'all' ? ' · nur noch ' + st.left + ' Plätze' : '')) : h('span', { class: 'tm' }, 'Bald neue Termine'));
  })));
  var list = up.filter(function (c) { return S.filter === 'all' || c.type === S.filter; });
  var voices = blocks(S.room && S.room.reviews).slice(0, 6);
  if (voices.length) { v.append(h('h3', null, 'Das sagen unsere Gäste')); v.append(h('div', { class: 'voices' }, voices.map(function (q) { return h('figure', null, h('blockquote', null, q[0]), h('figcaption', null, q[1])); }))); }
  if (!list.length) { v.append(h('div', { class: 'panel' }, h('h3', null, 'Keine Termine in dieser Kursart'), h('p', { class: 'muted' }, 'Schau bald wieder vorbei, neue Termine kommen laufend dazu.'))); return; }
  var last = '', box = null, days = 0, LIMIT = 10, hidden = 0;
  list.forEach(function (c) {
    if (c.date !== last) { last = c.date; days++; if (days <= LIMIT || S.showAll) { v.append(h('div', { class: 'dayhead' }, dparts(c.date).full)); box = h('div', { class: 'list' }); v.append(box); } }
    if (days <= LIMIT || S.showAll) box.append(courseCard(c)); else hidden++;
  });
  if (hidden) v.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { S.showAll = true; render(); } }, 'Alle Termine anzeigen (' + hidden + ' weitere)')));
}

/* ---------- Buchen ---------- */
function closeModal() { var m = $('#modal'); m.hidden = true; m.replaceChildren(); document.removeEventListener('keydown', escClose); }
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function openBooking(c) {
  if (!S.user.email_verified) { toast('Bitte bestätige zuerst deine E-Mail-Adresse.'); return; }
  var t = TYPES[c.type] || TYPES.ohne, left = Math.max(0, c.cap - c.taken), wait = left < 1, max = wait ? Math.min(c.cap, 1) : Math.min(left, 4);
  var reqs = S.config.requirements[c.type] || [];
  var name = h('input', { id: 'bk-name', type: 'text', required: true, maxlength: 40, autocomplete: 'given-name', value: (S.user.name || '').split(' ')[0] });
  var seats = h('select', { id: 'bk-seats' }, Array.from({ length: max }, function (_, i) { return h('option', { value: i + 1 }, String(i + 1)); }));
  var dog = c.type === 'hund' ? h('input', { id: 'bk-dog', type: 'text', required: true, maxlength: 40 }) : null;
  var methods = (S.config.stripe ? ['online'] : []).concat(S.room && S.room.paypal_me ? ['paypal'] : [], ['bar']);
  var pay = h('select', { id: 'bk-pay' }, methods.map(function (k) { return h('option', { value: k }, PAY[k]); }));
  var mem = wait ? null : S.members.filter(function (m) { return m.status !== 'beendet' && !m.expired && m.credits_left > 0 && m.types.indexOf(c.type) > -1; })[0];
  var useM = mem ? h('input', { id: 'bk-abo', type: 'checkbox', checked: true }) : null;
  var voucher = h('input', { id: 'bk-voucher', type: 'text', maxlength: 20, autocomplete: 'off', placeholder: 'PFOTE-XXXX-XXXX' });
  var payNote = h('p', { class: 'small muted' });
  function payText() {
    var n = Number(seats.value) || 1, total = c.price_cents * n, info = (S.room && S.room.pay_info) || '';
    if (useM && useM.checked) { var cov = (1 + Math.min(n - 1, mem.guests_left)) * c.price_cents; if (cov >= total) { payNote.textContent = 'Dein Abo deckt alles ab. Du musst nichts bezahlen.'; return; } total -= cov; }
    payNote.textContent = 'Gesamtpreis: ' + euro(total) + '. ' + (pay.value === 'online' ? 'Nach dem Buchen geht es direkt zur Bezahlseite.' : pay.value === 'paypal' ? 'Nach dem Buchen bekommst du den PayPal-Link und zahlst direkt dort.' : 'Du bezahlst bar vor Ort. Nicht erschienen oder zu spät storniert: Der volle Kurspreis wird fällig.');
  }
  pay.addEventListener('change', payText); seats.addEventListener('change', payText); if (useM) useM.addEventListener('change', payText); payText();
  var legalBox = h('label', { class: 'check' }, h('input', { id: 'bk-legal', type: 'checkbox', required: true }), h('span', null, 'Ich habe die ', h('a', { href: '#rechtliches', target: '_blank' }, 'AGB und die Datenschutzerklärung'), ' gelesen und akzeptiere sie.'));
  var boxes = reqs.map(function (r, i) { return h('label', { class: 'check' }, h('input', { id: 'bk-chk' + i, type: 'checkbox', required: true }), h('span', null, r)); });
  var msg = h('p', { class: 'small', role: 'alert' });
  var btn = h('button', { type: 'submit', class: 'btn primary' }, wait ? 'Auf die Warteliste setzen' : 'Verbindlich buchen');
  var form = h('form', { class: 'stack', onsubmit: function (e) {
    e.preventDefault(); msg.textContent = ''; btn.disabled = true;
    api('POST', '/api/bookings', { course_id: c.id, first_name: name.value, seats: Number(seats.value), dog_name: dog ? dog.value : '', pay_method: pay.value, confirmed: true, voucher: voucher.value.trim(), use_membership: !!(useM && useM.checked) }).then(function (res) {
      closeModal();
      if (res.pay_url) { window.location.href = res.pay_url; return; }
      toast(res.status === 'ok' && pay.value === 'paypal' ? 'Gebucht. Bezahle jetzt unter „Meine Buchungen“ mit PayPal.' : res.status === 'wait' ? 'Du stehst auf der Warteliste. Wir schreiben dir, sobald ein Platz frei wird.' : res.pay_error ? 'Gebucht. Die Zahlungsseite ist gerade nicht erreichbar, du kannst unter „Meine Buchungen“ erneut bezahlen.' : 'Gebucht. Eine Bestätigung ist unterwegs.');
      return reload().then(function () { go('buchungen'); });
    }).catch(function (err) { btn.disabled = false; msg.textContent = err.message; });
  } },
    h('div', { class: 'grid2' }, fld('Vorname', name), fld('Plätze', seats, 'Du kannst auch für Freundinnen mitbuchen, bis zu 4 Plätze.')),
    dog ? fld('Name des Hundes', dog) : null,
    useM ? h('label', { class: 'check abo' }, useM, h('span', null, 'Mit Abo buchen (' + mem.plan_name + ': ' + (mem.credits_left >= 50 ? 'unbegrenzt' : 'noch ' + mem.credits_left + (mem.credits_left === 1 ? ' Kurs' : ' Kurse')) + (mem.guests_left ? ', ' + mem.guests_left + (mem.guests_left === 1 ? ' Gästeticket' : ' Gästetickets') : '') + ')')) : null,
    fld('Zahlungsart', pay), payNote,
    wait ? null : fld('Gutschein-Code (optional)', voucher, 'Der Betrag wird gleich abgezogen.'),
    h('div', { class: 'list' }, boxes.concat([legalBox])), msg,
    h('div', { class: 'row' }, btn, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Abbrechen')));
  var m = $('#modal');
  m.replaceChildren(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Kurs buchen' },
    h('span', { class: 'chip ' + t.cls }, t.label), h('h2', null, c.title),
    h('p', { class: 'muted' }, dparts(c.date).full + ', ' + c.time + ' Uhr' + (wait ? '. Der Kurs ist ausgebucht, du rückst nach, sobald ein Platz frei wird.' : '')), form));
  m.hidden = false; m.onclick = function (e) { if (e.target === m) closeModal(); };
  document.addEventListener('keydown', escClose); name.focus();
}

/* ---------- Kalender ---------- */
function deleteBtn(c) {
  var b = h('button', { type: 'button', class: 'btn sm danger', onclick: function () {
    if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Wirklich löschen?'; return; }
    act(function () { return api('DELETE', '/api/admin/courses/' + c.id); }, 'Kurs gelöscht.').catch(function () {});
  } }, 'Löschen');
  return b;
}
function adminActions(card, c) {
  card.querySelector('.act').replaceChildren(h('b', null, euro(c.price_cents)),
    h('button', { type: 'button', class: 'btn sm', onclick: function () { S.editing = { course: c }; render(); } }, 'Bearbeiten'), deleteBtn(c));
  return card;
}
function viewKalender(v) {
  if (S.user && S.user.role === 'admin' && S.editing) { v.append(adminCourseForm()); return; }
  var t0 = todayISO(), ym = S.calMonth || t0.slice(0, 7), pr = ym.split('-'), y = +pr[0], m = +pr[1] - 1;
  var first = new Date(Date.UTC(y, m, 1)), offset = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function shift(n) { var d = new Date(Date.UTC(y, m + n, 1)); S.calMonth = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); S.calDay = null; render(); }
  var by = {};
  S.courses.forEach(function (c) { (by[c.date] = by[c.date] || []).push(c); });
  var sel = S.calDay;
  if (!sel || sel.slice(0, 7) !== ym) {
    var cand = Object.keys(by).filter(function (k) { return k.slice(0, 7) === ym && k >= t0; }).sort()[0];
    sel = cand || (ym === t0.slice(0, 7) ? t0 : ym + '-01');
  }
  var isAdmin = S.user && S.user.role === 'admin';
  v.append(h('div', { class: 'calhead' }, h('h2', null, first.toLocaleDateString(LOC(), { month: 'long', year: 'numeric', timeZone: 'UTC' })),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Vorheriger Monat', onclick: function () { shift(-1); } }, '‹'),
      h('button', { type: 'button', class: 'btn sm', onclick: function () { S.calMonth = t0.slice(0, 7); S.calDay = t0; render(); } }, 'Heute'),
      h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Nächster Monat', onclick: function () { shift(1); } }, '›'))));
  v.append(h('div', { class: 'legend' }, Object.keys(TYPES).map(function (k) { return h('span', null, h('i', { class: 'dot ' + TYPES[k].cls }), TYPES[k].label); }).concat([h('span', null, h('i', { class: 'dot full' }), 'ausgebucht')])));
  var grid = h('div', { class: 'cal' });
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach(function (d) { grid.append(h('div', { class: 'wd' }, d)); });
  for (var i = 0; i < offset; i++) grid.append(h('div', { class: 'cell blank', 'aria-hidden': 'true' }));
  Array.from({ length: days }, function (_, k) { return k + 1; }).forEach(function (d) {
    var iso = ym + '-' + String(d).padStart(2, '0'), cs = by[iso] || [];
    grid.append(h('button', { type: 'button', class: 'cell' + (iso === t0 ? ' today' : '') + (iso === sel ? ' sel' : ''), 'aria-pressed': String(iso === sel),
      'aria-label': d + (S.lang === 'en' ? ' ' : '. ') + first.toLocaleDateString(LOC(), { month: 'long', timeZone: 'UTC' }) + ', ' + (cs.length ? cs.length + (cs.length === 1 ? ' Kurs' : ' Kurse') : 'keine Kurse'),
      onclick: function () { S.calDay = iso; render(); } },
      h('span', { class: 'n' }, d),
      h('span', { class: 'dots' }, cs.slice(0, 6).map(function (c) { return h('i', { class: 'dot ' + (TYPES[c.type] || TYPES.ohne).cls + (c.status === 'abgesagt' ? ' off' : c.taken >= c.cap ? ' full' : '') }); })),
      cs.length > 6 ? h('span', { class: 'small muted' }, '+' + (cs.length - 6)) : null));
  });
  v.append(grid);
  var list = by[sel] || [];
  v.append(h('div', { class: 'row between' }, h('h3', null, dparts(sel).full),
    isAdmin ? h('button', { type: 'button', class: 'btn primary sm', onclick: function () { S.editing = { course: null, preset: { date: sel } }; render(); } }, 'Kurs an diesem Tag anlegen') : null));
  if (!list.length) { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'An diesem Tag gibt es keine Kurse.'))); return; }
  var box = h('div', { class: 'list' }); v.append(box);
  list.forEach(function (c) { var card = courseCard(c); box.append(isAdmin ? adminActions(card, c) : card); });
}

/* ---------- Abos ---------- */
function fmtD(ms) { return new Date(ms).toLocaleDateString(LOC(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }); }
function viewAbos(v, r) {
  var ref = S.config.referral_cents || 1000;
  v.append(h('div', { class: 'pagehead' }, h('h2', null, 'Abos und Pakete'), h('p', { class: 'muted' }, 'Mehr Yoga für weniger Geld. Du buchst wie immer, das Guthaben wird dabei automatisch abgezogen.')));
  if (r.q.get('gekauft')) {
    v.append(h('div', { class: 'banner ok' }, 'Danke! Dein Abo wird gerade freigeschaltet. Das dauert meist nur wenige Sekunden.'));
    setTimeout(function () { if (currentRoute().name === 'abos') reload(); }, 3500);
  }
  var mine = S.members.filter(function (m) { return !m.expired; });
  if (S.user && mine.length) {
    v.append(h('div', { class: 'panel' }, h('h3', null, 'Dein Guthaben'), mine.map(function (m) {
      var confirm = false;
      var btn = h('button', { type: 'button', class: 'btn sm danger' }, 'Kündigen');
      btn.onclick = function () {
        if (!confirm) { confirm = true; btn.textContent = 'Wirklich kündigen?'; return; }
        act(function () { return api('POST', '/api/memberships/' + m.id + '/cancel', {}); }, 'Abo gekündigt. Du kannst dein Guthaben bis zum Ende nutzen.').catch(function () {});
      };
      return h('div', { class: 'row between mship' },
        h('div', null, h('b', null, m.plan_name), ' ', m.status === 'gekuendigt' ? h('span', { class: 'chip warn' }, 'Gekündigt') : h('span', { class: 'chip ok' }, 'Aktiv'),
          h('div', { class: 'small muted' }, (m.credits_left >= 50 ? 'Unbegrenzt Kurse' : 'Noch ' + m.credits_left + (m.credits_left === 1 ? ' Kurs' : ' Kurse')) + (m.guests_left ? ' · ' + m.guests_left + (m.guests_left === 1 ? ' Gästeticket' : ' Gästetickets') : '') + ' · gültig bis ' + fmtD(m.period_end))),
        m.kind === 'monthly' && m.status === 'aktiv' ? btn : null);
    })));
  }
  var first = !S.members.length;
  v.append(h('div', { class: 'plans' }, S.plans.map(function (p) {
    var monthly = p.kind === 'monthly', intro = monthly && p.intro_cents > 0 && first;
    var types = p.types.map(function (t) { return (TYPES[t] || TYPES.ohne).label; }).join(' und ');
    var owned = S.members.some(function (m) { return !m.expired && m.status === 'aktiv' && m.plan_name === p.name; });
    var btn = h('button', { type: 'button', class: 'btn primary lg', disabled: owned, onclick: function () {
      if (!S.user) { S.next = 'abos'; go('login'); return; }
      btn.disabled = true;
      api('POST', '/api/plans/' + p.id + '/buy', {}).then(function (res) {
        if (res.pay_url) { window.location.href = res.pay_url; return; }
        btn.disabled = false; toast('Danke! Wir haben deine Anfrage bekommen und melden uns bei dir.');
      }).catch(function (e) { btn.disabled = false; toast(e.message); });
    } }, owned ? 'Du hast dieses Abo' : !S.user ? 'Anmelden und starten' : monthly ? 'Jetzt abonnieren' : 'Jetzt kaufen');
    return h('article', { class: 'plan' + (intro ? ' hot' : '') },
      p.slug === 'basic' ? h('span', { class: 'chip pup' }, 'Bestpreis') : null,
      intro ? h('span', { class: 'chip ok' }, 'Erster Monat nur ' + euro(p.intro_cents)) : null,
      h('h3', null, p.name),
      h('div', { class: 'price' }, h('b', null, euro(p.price_cents)), h('span', null, monthly ? ' pro Monat' : ' einmalig')),
      h('ul', { class: 'plain' },
        h('li', null, p.credits >= 99 ? 'So viele Kurse du magst: ' + types : p.credits + (p.credits === 1 ? ' Kurs' : ' Kurse') + (monthly ? ' pro Monat' : ' nach Wahl') + ': ' + types),
        p.guests ? h('li', null, p.guests + (p.guests === 1 ? ' Gästeticket' : ' Gästetickets') + (monthly ? ' pro Monat' : '') + ' für Freundinnen') : null,
        h('li', null, monthly ? 'Jeden Monat kündbar, mit einem Klick' : p.valid_until ? 'Gültig bis ' + fmtD(Date.parse(p.valid_until + 'T12:00:00Z')) + ', kein Abo' : p.valid_days + ' Tage gültig, kein Abo')),
      p.description ? h('p', { class: 'small muted' }, p.description) : null,
      btn);
  })));
  v.append(h('h3', null, 'So funktionieren die Abos'));
  v.append(h('div', { class: 'faq' }, [
    ['Was ist ein Abo?', 'Du zahlst jeden Monat einen festen Betrag und bekommst dafür Kurse. Dein Abo läuft von selbst weiter, bis du es kündigst. Das geht jederzeit mit einem Klick unter „Abos“. Danach wird nichts mehr abgebucht.'],
    ['Was ist das Guthaben?', 'Dein Abo enthält eine Zahl an Kursen, zum Beispiel vier im Monat. Beim Buchen wählst du „Mit Abo buchen“, dann wird ein Kurs davon abgezogen. Am Ende des Monats startet dein Guthaben neu. Was übrig ist, verfällt.'],
    ['Was ist ein Gästeticket?', 'Damit nimmst du eine Freundin oder einen Freund gratis mit. Du buchst zwei Plätze, und das Gästeticket bezahlt den zweiten.'],
    ['Was ist das Pfoten-Basic?', 'Die Flatrate zum kleinen Preis, wie im Fitnessstudio: Du zahlst einen niedrigen Betrag im Monat und gehst so oft zum Yoga ohne Hund, wie du magst. Für die Kurse mit Hund und das Welpenyoga ist es nicht gedacht, dort sind die Plätze begrenzt.'],
    ['Wie läuft das Welpen-VIP?', 'Das ist ein Paket, kein Abo. Du zahlst einmal und bekommst drei Welpenyoga-Termine nach Wahl, gültig bis zum Ende der Welpenzeit. Es läuft nicht weiter und muss nicht gekündigt werden.'],
    ['Was, wenn ich nicht komme?', 'Du kannst bis zur Frist, die bei der Buchung steht, kostenlos stornieren. Dein Guthaben bekommst du dann zurück. Danach oder bei Nichterscheinen verfällt der Kurs aus deinem Guthaben.']
  ].map(function (q) { return h('details', null, h('summary', null, q[0]), h('p', { class: 'prose' }, q[1])); })));
  v.append(h('p', { class: 'small muted' }, 'Das Guthaben verfällt am Ende des Zeitraums. Wer zu spät storniert oder nicht erscheint, verliert den Kurs aus dem Guthaben. Du kannst jederzeit unter „Abos“ kündigen. Danach wird nichts mehr abgebucht.'));
  v.append(h('section', { class: 'invitebar' }, h('div', null, h('strong', null, 'Noch günstiger mit einer Freundin'), h('span', null, 'Ihr bekommt beide ' + euro(ref) + ' Gutschein, wenn sie ihren ersten Kurs bucht.')),
    h('button', { type: 'button', class: 'btn primary', onclick: function () { go('einladen'); } }, 'Freundin einladen')));
}

/* ---------- Warum Yoga ---------- */
function svgPuppyScene() {
  var s = svgEl('svg', { viewBox: '0 0 400 260', class: 'illo', role: 'img', 'aria-label': 'Illustration: ein Welpe sitzt auf einer Yogamatte' });
  function el(t, a) { var e = svgEl(t, a); s.append(e); return e; }
  el('circle', { cx: 318, cy: 66, r: 36, fill: '#FFD08A' });
  el('path', { d: 'M0 196 Q100 142 210 184 T400 170 V260 H0Z', fill: '#BFE3D0' });
  el('path', { d: 'M0 222 Q120 186 230 214 T400 204 V260 H0Z', fill: '#9ED2B8' });
  [[46, 150], [70, 160]].forEach(function (p) { el('path', { d: 'M' + p[0] + ' ' + (p[1] + 40) + 'c-14-12-14-30 0-44 14 14 14 32 0 44z', fill: '#7FC4A6' }); });
  el('rect', { x: 84, y: 214, width: 232, height: 16, rx: 8, fill: '#7C6BD6' });
  el('ellipse', { cx: 206, cy: 196, rx: 36, ry: 34, fill: '#F2C48D' });
  el('path', { d: 'M238 204c24 2 30-20 18-30', fill: 'none', stroke: '#F2C48D', 'stroke-width': 10, 'stroke-linecap': 'round' });
  el('ellipse', { cx: 190, cy: 222, rx: 14, ry: 8, fill: '#FBE6CC' });
  el('ellipse', { cx: 222, cy: 222, rx: 14, ry: 8, fill: '#FBE6CC' });
  el('ellipse', { cx: 182, cy: 138, rx: 11, ry: 20, fill: '#C98E55', transform: 'rotate(18 182 138)' });
  el('ellipse', { cx: 230, cy: 138, rx: 11, ry: 20, fill: '#C98E55', transform: 'rotate(-18 230 138)' });
  el('circle', { cx: 206, cy: 148, r: 28, fill: '#F2C48D' });
  el('ellipse', { cx: 206, cy: 160, rx: 13, ry: 9, fill: '#FBE6CC' });
  el('ellipse', { cx: 206, cy: 155, rx: 5, ry: 3.5, fill: '#3A2A20' });
  el('circle', { cx: 195, cy: 144, r: 3.4, fill: '#3A2A20' });
  el('circle', { cx: 217, cy: 144, r: 3.4, fill: '#3A2A20' });
  el('path', { d: 'M201 164q5 8 10 0', fill: '#F58AA5' });
  return s;
}
function benefitIcon(k) {
  var s = svgEl('svg', { viewBox: '0 0 48 48', class: 'bicon', 'aria-hidden': 'true' });
  function el(t, a) { var e = svgEl(t, a); e.setAttribute('fill', a.fill || 'none'); if (!a.fill) { e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', '3.2'); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); } s.append(e); }
  if (k === 'flex') { el('circle', { cx: 30, cy: 11, r: 4.5, fill: 'currentColor' }); el('path', { d: 'M12 40c4-14 12-18 20-14M32 26l6 14M18 28l-6-6' }); }
  else if (k === 'strong') { el('path', { d: 'M8 24h6M34 24h6M14 17v14M34 17v14M14 24h20' }); }
  else if (k === 'calm') { el('path', { d: 'M12 30c3-4 6-4 9 0s6 4 9 0 6-4 6 0M12 38c3-4 6-4 9 0s6 4 9 0' }); el('circle', { cx: 24, cy: 15, r: 6 }); }
  else if (k === 'sleep') { el('path', { d: 'M30 10a14 14 0 1 0 8 24A12 12 0 0 1 30 10z' }); }
  else if (k === 'back') { [10, 17, 24, 31, 38].forEach(function (y, i) { el('ellipse', { cx: 24 + (i === 2 ? 2 : i === 1 || i === 3 ? 1 : 0), cy: y, rx: 6, ry: 3, fill: 'currentColor', opacity: 0.45 + i * 0.1 }); }); }
  else if (k === 'spark') { el('path', { d: 'M24 6v10M24 32v10M6 24h10M32 24h10M12 12l6 6M30 30l6 6M36 12l-6 6M18 30l-6 6' }); }
  else if (k === 'heart') { el('path', { d: 'M24 40S8 30 8 19a8 8 0 0 1 16-2 8 8 0 0 1 16 2c0 11-16 21-16 21z' }); }
  else if (k === 'paw') { [[13, 20], [20, 12], [28, 12], [35, 20]].forEach(function (p) { el('ellipse', { cx: p[0], cy: p[1], rx: 3.4, ry: 4.6, fill: 'currentColor' }); }); el('path', { d: 'M24 24c-7 0-12 7-12 12 0 3 3 4 6 3 3-1 4-1.4 6-1.4s3 .4 6 1.4c3 1 6 0 6-3 0-5-5-12-12-12z', fill: 'currentColor' }); }
  else if (k === 'smile') { el('circle', { cx: 24, cy: 24, r: 16 }); el('path', { d: 'M16 27c2 5 14 5 16 0M18 19v1M30 19v1' }); }
  else { el('circle', { cx: 24, cy: 24, r: 14 }); }
  return s;
}
function postureIllo() {
  var s = svgEl('svg', { viewBox: '0 0 360 220', class: 'illo posture', role: 'img', 'aria-label': 'Illustration: gebeugte Haltung links, aufrechte Haltung rechts' });
  function el(t, a) { var e = svgEl(t, a); s.append(e); return e; }
  function line(d, col, w) { el('path', { d: d, fill: 'none', stroke: col, 'stroke-width': w || 13, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); }
  el('rect', { x: 0, y: 0, width: 360, height: 220, rx: 24, fill: '#EFE9FB' });
  el('rect', { x: 180, y: 0, width: 180, height: 220, rx: 24, fill: '#DDF1E8' });
  el('rect', { x: 180, y: 0, width: 30, height: 220, fill: '#DDF1E8' });
  // links: gebeugt
  line('M88 196 L88 140 Q86 108 100 88', '#7C6BD6'); line('M88 196 L70 206', '#7C6BD6'); el('circle', { cx: 116, cy: 72, r: 15, fill: '#7C6BD6' }); line('M100 100 L124 124', '#7C6BD6', 10);
  // rechts: aufrecht
  line('M268 196 L268 108', '#1F8F6A'); line('M268 196 L250 206', '#1F8F6A'); el('circle', { cx: 268, cy: 78, r: 15, fill: '#1F8F6A' }); line('M268 112 L292 150', '#1F8F6A', 10);
  el('path', { d: 'M150 110h50', stroke: '#8A8AA0', 'stroke-width': 3, 'stroke-dasharray': '4 6', fill: 'none' });
  return s;
}
function weekIndex(ms) { return Math.floor((ms - Date.UTC(1970, 0, 5)) / (7 * 864e5)); }
function progressStats() {
  var now = Date.now();
  var done = S.mine.filter(function (b) { return b.status === 'ok' && b.starts_at < now && !b.no_show; });
  var total = done.reduce(function (n, b) { return n + 1; }, 0), month = todayISO().slice(0, 7);
  var thisMonth = done.filter(function (b) { return b.date.slice(0, 7) === month; }).length;
  var weeks = {}; done.forEach(function (b) { weeks[weekIndex(b.starts_at)] = 1; });
  var cw = weekIndex(now), w = weeks[cw] ? cw : cw - 1, streak = 0;
  while (weeks[w]) { streak++; w--; }
  var levels = [[1, 'Starter'], [5, 'Dabei'], [10, 'Stammgast'], [25, 'Pfoten-Profi'], [50, 'Legende']];
  var cur = null, next = null;
  levels.forEach(function (l) { if (total >= l[0]) cur = l; else if (!next) next = l; });
  return { total: total, thisMonth: thisMonth, streak: streak, levels: levels, cur: cur, next: next };
}
function progressRing(pct) {
  var r = 44, c = 2 * Math.PI * r, s = svgEl('svg', { viewBox: '0 0 110 110', class: 'ring', 'aria-hidden': 'true' });
  s.append(svgEl('circle', { cx: 55, cy: 55, r: r, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.15', 'stroke-width': 10 }));
  s.append(svgEl('circle', { cx: 55, cy: 55, r: r, fill: 'none', stroke: 'currentColor', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-dasharray': (c * pct).toFixed(1) + ' ' + c.toFixed(1), transform: 'rotate(-90 55 55)' }));
  return s;
}
function progressPanel(full) {
  var st = progressStats();
  if (!S.user) {
    return h('div', { class: 'panel progress' }, h('h3', null, 'Dein Fortschritt'), h('p', { class: 'muted' }, 'Mit einem Konto zählen wir deine Kurse mit, zeigen dir deine Serie und schalten Stufen frei, von Starter bis Legende.'),
      h('div', null, h('button', { type: 'button', class: 'btn primary', onclick: function () { S.next = 'warum'; go('registrieren'); } }, 'Konto anlegen und starten')));
  }
  var base = st.cur ? st.cur[0] : 0, goal = st.next ? st.next[0] : base, pct = st.next ? (st.total - base) / (goal - base) : 1;
  var line = !st.total ? 'Dein erster Kurs wartet auf dich. Danach startet deine Serie.'
    : st.next ? 'Noch ' + (goal - st.total) + (goal - st.total === 1 ? ' Kurs' : ' Kurse') + ' bis „' + st.next[1] + '“.' : 'Du bist eine Legende. Danke, dass du da bist.';
  return h('div', { class: 'panel progress' },
    h('div', { class: 'row between' }, h('h3', null, 'Dein Fortschritt'), st.cur ? h('span', { class: 'chip ok' }, st.cur[1]) : null),
    h('div', { class: 'pstats' },
      h('div', { class: 'pring' }, progressRing(pct), h('b', null, String(st.total)), h('span', null, st.total === 1 ? 'Kurs' : 'Kurse')),
      h('div', { class: 'pnums' },
        h('div', null, h('b', null, String(st.streak)), h('span', null, st.streak === 1 ? 'Woche in Folge' : 'Wochen in Folge')),
        h('div', null, h('b', null, String(st.thisMonth)), h('span', null, 'in diesem Monat')))),
    h('p', { class: 'small' }, line),
    full ? h('div', { class: 'badges' }, st.levels.map(function (l) { return h('span', { class: 'badge-lvl' + (st.total >= l[0] ? ' on' : '') }, l[1] + ' · ' + l[0]); })) : null);
}
function compareSlider(story) {
  var wrap = h('figure', { class: 'cmp', style: '--pos:50%' });
  var after = h('img', { src: story.after_url, alt: 'Nachher', loading: 'lazy' }), before = h('img', { class: 'cb', src: story.before_url, alt: 'Vorher', loading: 'lazy' });
  var range = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Vorher-Nachher-Regler' });
  range.addEventListener('input', function () { wrap.style.setProperty('--pos', range.value + '%'); });
  wrap.append(after, before, h('span', { class: 'tag l' }, 'Vorher'), h('span', { class: 'tag r' }, 'Nachher'), h('i', { class: 'knob', 'aria-hidden': 'true' }), range,
    h('figcaption', null, story.caption || '', story.weeks ? (story.caption ? ' · ' : '') + story.weeks + ' Wochen' : ''));
  return wrap;
}
function viewWarum(v) {
  var r = S.room || {};
  v.append(h('section', { class: 'why-hero' },
    h('div', { class: 'txt' }, h('p', { class: 'kick' }, 'Warum Yoga mit Pfoten'), h('h2', null, 'Mehr Ruhe. Mehr Kraft. Mehr Lächeln.'),
      h('p', { class: 'lead' }, 'Du kommst für das Yoga und bleibst wegen des Gefühls danach. Und manchmal sitzt ein Welpe auf deiner Matte.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary lg', onclick: function () { go('kurse'); } }, 'Kurs finden'), h('button', { type: 'button', class: 'btn ghost lg', onclick: function () { go('abos'); } }, 'Abos ansehen'))),
    svgPuppyScene()));
  v.append(h('h3', { class: 'sec' }, 'Was Yoga mit dir macht'));
  v.append(h('div', { class: 'benefits' }, [
    ['flex', 'Du wirst beweglicher', 'Regelmäßiges Dehnen und Halten macht Muskeln und Gelenke geschmeidiger. Viele merken nach einigen Wochen, dass Bücken und Strecken leichter fallen.'],
    ['strong', 'Kraft und Haltung', 'Viele Übungen arbeiten mit dem eigenen Körpergewicht und stärken die tiefe Muskulatur, die dich aufrecht hält.'],
    ['calm', 'Ruhe im Kopf', 'Bewusst atmen und langsam bewegen holt dich aus dem Gedankenkarussell. Studien sehen kleine bis mittlere Effekte auf Stress und Stimmung.'],
    ['sleep', 'Besser abschalten', 'Wer abends zur Ruhe kommt, schläft oft leichter ein. Viele Teilnehmende berichten von erholsameren Nächten.'],
    ['back', 'Ein entspannterer Rücken', 'Bei chronischen Rückenschmerzen im unteren Rücken zeigt ein Cochrane-Review kleine bis mittlere Verbesserungen durch Yoga.'],
    ['spark', 'Mehr Energie', 'Nach einer Stunde fühlst du dich meist wacher, leichter und stolz, dass du dir die Zeit genommen hast.']
  ].map(function (b) { return h('article', { class: 'benefit' }, benefitIcon(b[0]), h('h4', null, b[1]), h('p', null, b[2])); })));

  v.append(h('h3', { class: 'sec' }, 'Und was machen die Tiere?'));
  v.append(h('div', { class: 'benefits animals' }, [
    ['heart', 'Streicheln beruhigt', 'In Studien sinken Stresshormone wie Cortisol, wenn Menschen Hunde streicheln oder mit ihnen spielen. Schon rund zehn Minuten können reichen.'],
    ['paw', 'Nähe, die guttut', 'Der Kontakt mit Hunden kann das Bindungshormon Oxytocin erhöhen. Das ist das Hormon für Vertrauen und Verbundenheit.'],
    ['spark', 'Ganz im Moment', 'Ein Welpe plant nichts und grübelt nicht. Das steckt an: Handy weg, Sorgen leise, Aufmerksamkeit ganz bei dir.'],
    ['smile', 'Lachen inklusive', 'Welpen sind verspielt und herrlich unberechenbar. Wer lacht, lässt Anspannung los. Das merkst du schon nach den ersten Minuten.']
  ].map(function (b) { return h('article', { class: 'benefit' }, benefitIcon(b[0]), h('h4', null, b[1]), h('p', null, b[2])); })));
  v.append(h('p', { class: 'small muted' }, 'Die Studien zu Tieren zeigen eher Hinweise als Beweise. Aber du musst sie nicht lesen, um den Unterschied zu spüren.'));

  v.append(h('h3', { class: 'sec' }, 'Und meine Figur?'));
  v.append(h('div', { class: 'panel why-figure' }, postureIllo(),
    h('div', { class: 'stack' },
      h('h4', null, 'Du veränderst, wie du stehst und dich fühlst'),
      h('p', null, 'Ehrlich gesagt: Yoga ist kein Abnehm-Programm. Studien finden insgesamt keinen sicheren Effekt auf das Gewicht. Was sich dafür oft ändert, sieht man auf keiner Waage: aufrechtere Haltung, mehr Kraft und Beweglichkeit und ein besseres Gefühl im eigenen Körper.'),
      h('p', { class: 'small muted' }, 'Die Zeichnung ist eine Illustration, kein Foto.'))));
  var stories = r.stories || [];
  if (stories.length) {
    v.append(h('h3', { class: 'sec' }, 'Vorher und nachher: echte Gäste'));
    v.append(h('p', { class: 'small muted' }, 'Ziehe den Regler. Die Fotos sind mit Erlaubnis der Gäste hier, jede Veränderung ist individuell.'));
    v.append(h('div', { class: 'stories' }, stories.map(compareSlider)));
  }

  v.append(h('h3', { class: 'sec' }, 'Deine Reise, Woche für Woche'));
  v.append(h('ol', { class: 'journey' }, [
    ['Woche 1', 'Ankommen', 'Alles ist neu: der Raum, die Atmung, die ersten Haltungen. Ein bisschen Muskelkater ist normal und ein gutes Zeichen.'],
    ['Woche 2 bis 4', 'Beweglicher', 'Dehnungen fallen leichter. Viele schlafen besser und spüren den Alltagsstress weniger.'],
    ['Woche 6 bis 8', 'Stärker', 'Haltung und Gleichgewicht werden sicherer. Du hältst Positionen länger und bist stolz darauf.'],
    ['Ab 3 Monaten', 'Deine Routine', 'Yoga ist ein fester Termin, auf den du dich freust. Die Ruhe nimmst du in den Alltag mit.'],
    ['Ab 6 Monaten', 'Dein Ding', 'Du kennst deinen Körper besser, merkst früher, wenn etwas zwickt, und probierst Neues aus.']
  ].map(function (j) { return h('li', null, h('span', { class: 'when' }, j[0]), h('strong', null, j[1]), h('p', null, j[2])); })));
  v.append(h('p', { class: 'small muted' }, 'Das sind typische Erfahrungen, kein Versprechen. Jeder Körper ist anders, und das ist völlig in Ordnung.'));

  v.append(h('h3', { class: 'sec' }, 'So bleibst du dran'));
  v.append(progressPanel(true));
  v.append(h('div', { class: 'benefits tips' },
    h('article', { class: 'benefit' }, benefitIcon('spark'), h('h4', null, 'Feste Termine'), h('p', null, 'Mit einem Abo hast du jede Woche deinen Platz und sparst Geld.'), h('button', { type: 'button', class: 'btn sm', onclick: function () { go('abos'); } }, 'Abos ansehen')),
    h('article', { class: 'benefit' }, benefitIcon('heart'), h('h4', null, 'Zu zweit macht es mehr Spaß'), h('p', null, 'Bring eine Freundin mit. Ihr bekommt beide ' + euro(S.config.referral_cents || 1000) + '.'), h('button', { type: 'button', class: 'btn sm', onclick: function () { go('einladen'); } }, 'Freundin einladen')),
    h('article', { class: 'benefit' }, benefitIcon('paw'), h('h4', null, 'Kleine Ziele'), h('p', null, 'Starter, Dabei, Stammgast: Mit jedem Kurs schaltest du eine Stufe frei.'), h('button', { type: 'button', class: 'btn sm', onclick: function () { go('kurse'); } }, 'Nächsten Kurs buchen'))));

  if (r.gallery && r.gallery.length) {
    v.append(h('h3', { class: 'sec' }, 'Einblicke'));
    v.append(h('div', { class: 'gallery' }, r.gallery.slice(0, 6).map(function (g, i) { return h('button', { type: 'button', class: 'gitem', 'aria-label': 'Foto ' + (i + 1) + ' vergrößern', onclick: function () { openPhoto(r.gallery, i); } }, h('img', { src: g.url, alt: 'Foto ' + (i + 1) + ' vom Studio', loading: 'lazy' })); })));
  }
  v.append(h('details', { class: 'sources' }, h('summary', null, 'Quellen'),
    h('ul', { class: 'plain small' },
      h('li', null, h('a', { href: 'https://opus.lib.uts.edu.au/handle/10453/43709', target: '_blank', rel: 'noopener noreferrer' }, 'Yoga und Gewicht: Übersichtsarbeit und Meta-Analyse, Preventive Medicine, 2016')),
      h('li', null, h('a', { href: 'https://russia.cochrane.org/news/yoga-may-have-health-benefits-people-chronic-non-specific-lower-back-pain', target: '_blank', rel: 'noopener noreferrer' }, 'Yoga bei chronischen Rückenschmerzen: Cochrane-Review')),
      h('li', null, h('a', { href: 'https://www.endocrinology.org/news/item/21174/new-study-suggests-interacting-with-dogs-can-reduce-cortisol-levels', target: '_blank', rel: 'noopener noreferrer' }, 'Hunde und Cortisol: Society for Endocrinology')),
      h('li', null, h('a', { href: 'https://www.ctpublic.org/2023-08-03/petting-other-peoples-dogs-even-briefly-can-boost-your-health', target: '_blank', rel: 'noopener noreferrer' }, 'Hunde streicheln und Stress: NPR, 2023')))));
}

/* ---------- Freundin einladen ---------- */
function viewEinladen(v) {
  var ref = S.config.referral_cents || 1000, info = S.referral;
  v.append(h('section', { class: 'invite-hero' },
    h('p', { class: 'kick' }, 'Einladen lohnt sich'),
    h('h2', null, 'Bring eine Freundin mit. Ihr bekommt beide ' + euro(ref) + '.'),
    h('p', { class: 'lead' }, 'Yoga macht zu zweit mehr Spaß, und Welpen sowieso. Sobald deine Freundin ihren ersten Kurs gebucht hat, bekommt ihr beide einen Gutschein.')));
  v.append(h('ol', { class: 'steps' },
    h('li', null, h('strong', null, 'Code teilen'), h('span', null, 'Schick deiner Freundin deinen Link oder deinen Code.')),
    h('li', null, h('strong', null, 'Sie bucht'), h('span', null, 'Sie legt ein Konto an und bucht ihren ersten Kurs.')),
    h('li', null, h('strong', null, 'Ihr spart'), h('span', null, 'Ihr bekommt beide ' + euro(ref) + ' Gutschein per Mail.'))));
  if (!S.user) {
    v.append(h('div', { class: 'panel' }, h('h3', null, 'Hol dir deinen Einladungscode'), h('p', { class: 'muted' }, 'Mit einem Konto bekommst du sofort deinen persönlichen Code und Link.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: function () { S.next = 'einladen'; go('registrieren'); } }, 'Konto anlegen'),
        h('button', { type: 'button', class: 'btn', onclick: function () { S.next = 'einladen'; go('login'); } }, 'Ich habe schon ein Konto'))));
  } else if (info) {
    var text = 'Komm mit zum Yoga mit Pfoten! Mit meinem Link bekommst du ' + euro(ref) + ' geschenkt: ' + info.link;
    v.append(h('div', { class: 'panel' }, h('h3', null, 'Dein Einladungscode'),
      h('div', { class: 'invite-code', 'aria-label': 'Dein Code' }, info.code),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: function () { (navigator.clipboard ? navigator.clipboard.writeText(info.link) : Promise.reject()).then(function () { toast('Link kopiert.'); }).catch(function () { window.prompt('Kopiere diesen Link:', info.link); }); } }, 'Link kopieren'),
        h('a', { class: 'btn', target: '_blank', rel: 'noopener noreferrer', href: 'https://wa.me/?text=' + encodeURIComponent(text) }, 'Per WhatsApp senden'),
        navigator.share ? h('button', { type: 'button', class: 'btn', onclick: function () { navigator.share({ title: 'Yoga mit Pfoten', text: text }).catch(function () {}); } }, 'Teilen') : null),
      h('p', { class: 'small muted' }, info.joined + (info.joined === 1 ? ' Freundin hat sich angemeldet' : ' Freundinnen haben sich angemeldet') + ', ' + info.rewarded + (info.rewarded === 1 ? ' hat' : ' haben') + ' schon gebucht. Deine Gutscheine kommen per Mail.')));
  }
  v.append(h('p', { class: 'small muted' }, 'Der Gutschein gilt bei der nächsten Buchung und wird einmal pro eingeladener Person vergeben. Nur für neue Konten.'));
}

/* ---------- Team und Raum ---------- */
function viewTeam(v) {
  v.append(h('h2', null, 'Unser Team'));
  if (!S.trainers.length) { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Hier erscheinen bald die Trainerinnen und Trainer.'))); return; }
  v.append(h('div', { class: 'team' }, S.trainers.map(function (t) {
    return h('article', { class: 'panel' }, h('h3', null, t.name), t.styles ? h('p', { class: 'muted small' }, t.styles) : null,
      t.dog_ok ? h('span', { class: 'chip dog' }, 'Erfahrung mit Hunden') : null, t.bio ? h('p', { class: 'prose' }, t.bio) : null);
  })));
}
function shareBtn(text, label) {
  var url = window.location.origin + '/';
  return h('button', { type: 'button', class: 'btn sm', onclick: function () {
    var msg = 'Komm mit zum Yoga mit Pfoten: ' + text;
    if (navigator.share) { navigator.share({ title: 'Yoga mit Pfoten', text: msg, url: url }).catch(function () {}); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(msg + ' ' + url), '_blank', 'noopener');
  } }, label || 'Teilen');
}
function blocks(txt) {
  return String(txt || '').split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(Boolean).map(function (b) { var i = b.indexOf('\n'); return i < 0 ? [b, ''] : [b.slice(0, i).trim(), b.slice(i + 1).trim()]; });
}
function openPhoto(list, i) {
  var m = $('#modal'), img = h('img', { class: 'lbimg', alt: '' });
  function show(n) { i = (n + list.length) % list.length; img.src = list[i].url; img.alt = 'Foto ' + (i + 1) + ' von ' + list.length; }
  function key(e) { if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); }
  function shut() { document.removeEventListener('keydown', key); closeModal(); }
  show(i);
  m.replaceChildren(h('div', { class: 'lightbox' }, img,
    h('div', { class: 'row between' },
      h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Vorheriges Foto', onclick: function () { show(i - 1); } }, '‹'),
      h('button', { type: 'button', class: 'btn sm', onclick: shut }, 'Schließen'),
      h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Nächstes Foto', onclick: function () { show(i + 1); } }, '›'))));
  m.hidden = false; document.addEventListener('keydown', key); document.addEventListener('keydown', escClose);
}
function viewRaum(v) {
  var r = S.room || {};
  var facts = (r.facts || '').split('\n').map(function (l) { var i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; }).filter(Boolean);
  var rules = (r.rules || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  v.append(r.photo_url ? h('img', { class: 'photo', src: r.photo_url, alt: 'Foto vom Yogaraum' }) : h('div', { class: 'photo', role: 'img', 'aria-label': 'Foto folgt' }, 'Foto folgt'));
  v.append(h('div', { class: 'panel' }, h('h2', null, r.room_title || 'Der Raum'), h('p', { class: 'prose' }, r.body || 'Hier stellt das Studio seinen Raum vor.'),
    facts.length ? h('dl', { class: 'facts' }, facts.map(function (f) { return [h('dt', null, f[0]), h('dd', null, f[1])]; })) : null));
  if (r.gallery && r.gallery.length) {
    v.append(h('h3', null, 'Einblicke'));
    v.append(h('div', { class: 'gallery' }, r.gallery.map(function (g, i) {
      return h('button', { type: 'button', class: 'gitem', 'aria-label': 'Foto ' + (i + 1) + ' vergrößern', onclick: function () { openPhoto(r.gallery, i); } }, h('img', { src: g.url, alt: 'Foto ' + (i + 1) + ' vom Studio', loading: 'lazy' }));
    })));
  }
  if (r.address || r.directions || r.instagram) {
    v.append(h('div', { class: 'panel' }, h('h3', null, 'So findest du uns'),
      r.address ? h('p', null, h('b', null, r.address)) : null,
      r.directions ? h('p', { class: 'prose' }, r.directions) : null,
      h('div', { class: 'row' },
        r.address ? h('a', { class: 'btn sm primary', target: '_blank', rel: 'noopener noreferrer', href: 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(r.address) }, 'Auf der Karte öffnen') : null,
        r.address ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener noreferrer', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.address) }, 'In Google Maps') : null,
        r.instagram ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener noreferrer', href: 'https://www.instagram.com/' + encodeURIComponent(r.instagram) }, 'Instagram @' + r.instagram) : null)));
  }
  var faq = blocks(r.faq);
  if (faq.length) {
    v.append(h('h3', null, 'Häufige Fragen'));
    v.append(h('div', { class: 'faq' }, faq.map(function (q) { return h('details', null, h('summary', null, q[0]), h('p', { class: 'prose' }, q[1])); })));
  }
  if (rules.length) v.append(h('div', { class: 'panel' }, h('h3', null, 'Gut zu wissen'), h('ul', { class: 'plain' }, rules.map(function (x) { return h('li', null, x); }))));
  v.append(h('div', null, h('button', { type: 'button', class: 'btn primary', onclick: function () { go('kurse'); } }, 'Kurse ansehen')));
}

/* ---------- Meine Buchungen ---------- */
function viewBuchungen(v, r) {
  if (r.q.get('bezahlt')) v.append(h('div', { class: 'banner ok' }, 'Danke. Sobald die Zahlung bei uns eingegangen ist, steht sie hier als bezahlt.'));
  v.append(h('h2', null, 'Meine Buchungen'));
  if (progressStats().total > 0) v.append(progressPanel(false));
  if (!S.mine.length) { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Du hast noch nichts gebucht.'), h('div', null, h('button', { type: 'button', class: 'btn primary', onclick: function () { go('kurse'); } }, 'Kurse ansehen')))); return; }
  var box = h('div', { class: 'list' }); v.append(box);
  S.mine.forEach(function (b) {
    var t = TYPES[b.type] || TYPES.ohne, hrs = (b.starts_at - Date.now()) / 36e5, past = hrs < 0, canCancel = hrs >= S.config.cancel_hours;
    var buttons = [];
    if (!past && b.status === 'ok' && b.pay_method === 'online' && b.pay_status === 'offen') {
      buttons.push(h('button', { type: 'button', class: 'btn primary sm', onclick: function () {
        api('POST', '/api/bookings/' + b.id + '/pay', {}).then(function (res) { window.location.href = res.pay_url; }).catch(function (e) { toast(e.message); });
      } }, 'Jetzt bezahlen'));
    }
    if (!past && b.status === 'ok' && b.pay_method === 'paypal' && b.pay_status === 'offen' && S.room && S.room.paypal_me) {
      buttons.push(h('a', { class: 'btn primary sm', target: '_blank', rel: 'noopener noreferrer',
        href: 'https://www.paypal.me/' + encodeURIComponent(S.room.paypal_me) + '/' + (Math.max(0, b.price_cents * b.seats - (b.voucher_cents || 0) - (b.member_cents || 0)) / 100).toFixed(2) + 'EUR' }, 'Mit PayPal bezahlen'));
    }
    if (!past && b.status === 'ok') buttons.push(h('a', { class: 'btn sm', href: '/api/bookings/' + b.id + '/ics', download: 'kurs.ics' }, 'Zum Kalender'));
    if (!past && b.status === 'ok') buttons.push(shareBtn(b.title + ' am ' + dparts(b.date).full + ', ' + b.time + ' Uhr', 'Freundin einladen'));
    if (!past) buttons.push(h('button', { type: 'button', class: 'btn sm danger', disabled: !canCancel, onclick: function () {
      act(function () { return api('POST', '/api/bookings/' + b.id + '/cancel', {}); }, 'Buchung storniert.').catch(function () {});
    } }, 'Stornieren'));
    box.append(h('article', { class: 'card nodate' },
      h('div', { class: 'info' }, h('span', { class: 'chip ' + t.cls }, t.label), h('h3', null, b.title),
        h('div', { class: 'meta' }, h('span', null, dparts(b.date).full + ', ' + b.time + ' Uhr'), h('span', null, b.seats + (b.seats === 1 ? ' Platz' : ' Plätze')), b.dog_name ? h('span', null, 'Hund: ' + b.dog_name) : null, h('span', null, euro(b.price_cents * b.seats))),
        h('div', { class: 'row' }, h('span', { class: 'chip ' + (past ? 'grey' : b.status === 'ok' ? 'ok' : 'warn') }, past ? 'Vorbei' : b.status === 'ok' ? 'Gebucht' : 'Warteliste'),
          h('span', { class: 'chip ' + (b.pay_status === 'bezahlt' ? 'ok' : 'grey') }, PAY[b.pay_method] + ' · ' + (b.pay_status === 'bezahlt' ? 'bezahlt' : 'offen')),
          b.course_status === 'abgesagt' ? h('span', { class: 'chip bad' }, 'Kurs abgesagt') : null,
          b.voucher_cents ? h('span', { class: 'chip ok' }, 'Gutschein −' + euro(b.voucher_cents)) : null,
          b.member_cents ? h('span', { class: 'chip ok' }, 'Abo −' + euro(b.member_cents)) : null,
          b.no_show ? h('span', { class: 'chip bad' }, 'Nicht erschienen · voller Preis fällig') : null),
        b.pay_method === 'ueberweisung' && b.pay_status === 'offen' && S.room && S.room.pay_info ? h('p', { class: 'small muted' }, 'Überweisung an: ' + S.room.pay_info) : null),
      h('div', { class: 'act' }, buttons, !past && !canCancel ? h('span', { class: 'small muted' }, 'Stornieren nur bis ' + S.config.cancel_hours + ' Std. vorher') : null)));
  });
}

/* ---------- Kursformular ---------- */
function courseForm(init, o) {
  var p = o.prefix;
  var d = Object.assign({ title: '', type: o.types[0], date: '', time: '18:00', dur: 60, cap: 8, price: 12, level: 'Alle Level', description: '', status: 'aktiv', trainer_id: '' }, init || {});
  if (d.price_cents != null) d.price = d.price_cents / 100;
  var C = {};
  C.title = h('input', { id: p + '-title', type: 'text', value: d.title, required: true, maxlength: 80 });
  C.type = h('select', { id: p + '-type', value: d.type }, o.types.map(function (k) { return h('option', { value: k }, TYPES[k].label); }));
  C.date = h('input', { id: p + '-date', type: 'date', value: d.date, required: true });
  C.time = h('input', { id: p + '-time', type: 'time', value: d.time, required: true });
  C.dur = h('input', { id: p + '-dur', type: 'number', min: 15, max: 240, step: 5, value: d.dur });
  C.cap = h('input', { id: p + '-cap', type: 'number', min: 1, max: 60, value: d.cap });
  C.price = h('input', { id: p + '-price', type: 'number', min: 0, max: 500, step: 0.5, value: d.price });
  C.level = h('select', { id: p + '-level', value: d.level }, LEVELS.map(function (l) { return h('option', { value: l }, l); }));
  C.status = h('select', { id: p + '-status', value: d.status }, [h('option', { value: 'aktiv' }, 'Findet statt'), h('option', { value: 'abgesagt' }, 'Abgesagt')]);
  C.desc = h('textarea', { id: p + '-desc', maxlength: 600 }, d.description);
  if (o.repeat) {
    C.every = h('select', { id: p + '-every' }, [h('option', { value: '' }, 'Nicht wiederholen'), h('option', { value: 'day' }, 'Jeden Tag'), h('option', { value: 'week' }, 'Jede Woche')]);
    C.until = h('input', { id: p + '-until', type: 'date' });
  }
  if (o.trainers) C.trainer = h('select', { id: p + '-trainer', value: d.trainer_id == null ? '' : String(d.trainer_id) },
    [h('option', { value: '' }, 'Studioleitung / kein Trainer')].concat(o.trainers.map(function (t) { return h('option', { value: String(t.id) }, t.name); })));
  var msg = h('p', { class: 'small', role: 'alert' });
  return afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault(); msg.textContent = '';
    var data = { title: C.title.value, type: C.type.value, date: C.date.value, time: C.time.value, dur: Number(C.dur.value), cap: Number(C.cap.value), price: Number(C.price.value), level: C.level.value, description: C.desc.value, status: C.status.value };
    if (C.every && C.every.value) {
      if (!C.until.value) { msg.textContent = 'Bitte ein Enddatum für die Wiederholung wählen.'; return; }
      data.repeat = { every: C.every.value, until: C.until.value };
    }
    if (C.trainer) data.trainer_id = C.trainer.value ? Number(C.trainer.value) : null;
    Promise.resolve(o.onSubmit(data)).catch(function (err) { msg.textContent = err.message; });
  } },
    h('h3', null, o.heading),
    fld('Titel', C.title),
    h('div', { class: 'grid2' }, fld('Kursart', C.type), fld('Niveau', C.level)),
    h('div', { class: 'grid2' }, fld('Datum', C.date), fld('Uhrzeit', C.time)),
    h('div', { class: 'grid2' }, fld('Dauer (Min.)', C.dur), fld('Plätze', C.cap), fld('Preis pro Platz (€)', C.price)),
    C.trainer ? fld('Trainer/in', C.trainer) : null,
    C.every ? h('div', { class: 'grid2' }, fld('Wiederholen', C.every), fld('Wiederholen bis (Datum)', C.until)) : null,
    fld('Beschreibung', C.desc), fld('Status', C.status), msg,
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, o.submitLabel),
      h('button', { type: 'button', class: 'btn', onclick: function () { S.editing = null; render(); } }, 'Abbrechen'))));
}
function adminCourseForm() {
  var ed = S.editing, isEdit = ed.course && ed.course.id;
  return courseForm(ed.course || ed.preset, { prefix: 'ac', repeat: !isEdit, types: ['welpen', 'hund', 'ohne'], trainers: S.adm ? S.adm.trainers : [],
    heading: isEdit ? 'Kurs bearbeiten' : 'Neuer Kurs', submitLabel: 'Speichern',
    onSubmit: function (data) {
      return act(function () { return isEdit ? api('PUT', '/api/admin/courses/' + ed.course.id, data) : api('POST', '/api/admin/courses', data); }, data.repeat ? 'Serie angelegt.' : 'Gespeichert.').then(function () { S.editing = null; render(); });
    } });
}

/* ---------- Trainer ---------- */
function viewTrainer(v) {
  var u = S.user;
  if (u.role === 'admin') { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Als Admin pflegst du Kurse direkt unter „Verwaltung“.'))); return; }
  if (u.role === 'customer') {
    v.append(h('h2', null, 'Trainer werden'));
    if (u.trainer_requested) { v.append(h('div', { class: 'panel' }, h('h3', null, 'Anfrage eingereicht'), h('p', { class: 'muted' }, 'Die Studioleitung prüft deine Anfrage. Danach kannst du hier dein Profil und deine Kurse pflegen.'))); return; }
    var bio = h('textarea', { id: 'tq-bio', maxlength: 700 });
    var dogOk = h('input', { id: 'tq-dog', type: 'checkbox' });
    v.append(afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
      e.preventDefault();
      api('POST', '/api/trainer-request', { bio: bio.value, dog_ok: dogOk.checked }).then(function () { return api('GET', '/api/me'); }).then(function (res) { S.user = res.user; S.formDirty = false; toast('Anfrage gesendet.'); render(); }).catch(function (err) { toast(err.message); });
    } },
      h('p', { class: 'muted' }, 'Als Trainer/in pflegst du dein Profil und schlägst Kurse vor. Die Studioleitung gibt jede Änderung frei, bis dahin bleibt die alte Version sichtbar.'),
      fld('Über dich und deine Ausbildung', bio),
      h('label', { class: 'check' }, dogOk, h('span', null, 'Ich habe Erfahrung mit Hunden oder eine Zusatzqualifikation.')),
      h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Anfrage senden')))));
    return;
  }
  var tr = S.tr || { courses: [], proposals: [] };
  v.append(h('h2', null, 'Für Trainer'));
  v.append(h('div', { class: 'sub', role: 'group', 'aria-label': 'Trainerbereich' }, [['profil', 'Mein Profil'], ['kurse', 'Meine Kurse']].map(function (t) {
    return h('button', { type: 'button', 'aria-pressed': String(S.trainerTab === t[0]), onclick: function () { S.trainerTab = t[0]; S.editing = null; render(); } }, t[1]);
  })));
  if (S.trainerTab === 'profil') trainerProfile(v, tr); else trainerCourses(v, tr);
  if (tr.proposals.length) {
    v.append(h('h3', null, 'Deine Einreichungen'));
    var box = h('div', { class: 'list' }); v.append(box);
    tr.proposals.slice(0, 8).forEach(function (p) {
      box.append(h('div', { class: 'panel' },
        h('div', { class: 'row' }, h('b', null, p.kind === 'course' ? (p.data.title || 'Kurs') : 'Profiländerung'),
          h('span', { class: 'chip ' + (p.status === 'pending' ? 'warn' : p.status === 'approved' ? 'ok' : 'bad') }, p.status === 'pending' ? 'Wartet auf Freigabe' : p.status === 'approved' ? 'Freigegeben' : 'Abgelehnt')),
        p.reply ? h('p', { class: 'small' }, 'Antwort der Studioleitung: ' + p.reply) : null));
    });
  }
}
function trainerProfile(v, tr) {
  var u = S.user, pending = tr.proposals.some(function (p) { return p.kind === 'profile' && p.status === 'pending'; });
  var name = h('input', { id: 'tp-name', type: 'text', value: u.name, required: true, maxlength: 60 });
  var styles = h('input', { id: 'tp-styles', type: 'text', value: u.styles, maxlength: 120 });
  var bio = h('textarea', { id: 'tp-bio', maxlength: 700 }, u.bio);
  var dogOk = h('input', { id: 'tp-dog', type: 'checkbox', checked: u.dog_ok });
  v.append(afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault();
    act(function () { return api('POST', '/api/proposals', { kind: 'profile', data: { name: name.value, styles: styles.value, bio: bio.value, dog_ok: dogOk.checked } }); }, 'Zur Freigabe eingereicht.').catch(function () {});
  } },
    h('h3', null, 'Mein Profil'), h('p', { class: 'muted small' }, 'Bis zur Freigabe bleibt das bisherige Profil sichtbar.'),
    fld('Name', name), fld('Yoga-Stile', styles), fld('Über mich', bio),
    h('label', { class: 'check' }, dogOk, h('span', null, 'Erfahrung mit Hunden oder Zusatzqualifikation')),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, pending ? 'Neue Fassung einreichen' : 'Änderung einreichen'), pending ? h('span', { class: 'small muted' }, 'Eine frühere Änderung wartet noch. Sie wird ersetzt.') : null))));
}
function trainerCourses(v, tr) {
  if (S.editing) {
    var ed = S.editing;
    v.append(courseForm(ed.course, { prefix: 'tc', types: ['hund', 'ohne'], heading: ed.course ? 'Änderung vorschlagen' : 'Neuen Kurs vorschlagen', submitLabel: 'Zur Freigabe einreichen',
      onSubmit: function (data) {
        return act(function () { return api('POST', '/api/proposals', { kind: 'course', course_id: ed.course ? ed.course.id : undefined, data: data }); }, 'Zur Freigabe eingereicht.').then(function () { S.editing = null; render(); });
      } }));
    return;
  }
  v.append(h('div', null, h('button', { type: 'button', class: 'btn primary', onclick: function () { S.editing = { course: null }; render(); } }, 'Neuen Kurs vorschlagen')));
  if (!tr.courses.length) { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Du hast noch keine freigegebenen Kurse. Schlage deinen ersten Kurs vor.'))); return; }
  var box = h('div', { class: 'list' }); v.append(box);
  tr.courses.forEach(function (c) {
    var pend = tr.proposals.some(function (p) { return p.kind === 'course' && p.course_id === c.id && p.status === 'pending'; });
    var card = courseCard(c);
    card.querySelector('.act').replaceChildren(h('b', null, euro(c.price_cents)),
      pend ? h('span', { class: 'chip warn' }, 'Änderung wartet') : h('button', { type: 'button', class: 'btn sm', onclick: function () { S.editing = { course: c }; render(); } }, 'Ändern'));
    box.append(card);
  });
}

/* ---------- Verwaltung ---------- */
function viewAdmin(v) {
  var u = S.user;
  if (u.role !== 'admin') { v.append(h('div', { class: 'banner bad' }, 'Dieser Bereich ist nur für die Studioleitung.')); return; }
  var a = S.adm || { proposals: [], trainerRequests: [], bookings: [], users: [], mails: [], trainers: [] };
  var tabs = [['freigaben', 'Freigaben', pendingCount()], ['kurse', 'Kurse'], ['buchungen', 'Buchungen'], ['nutzer', 'Konten'], ['abos', 'Abos'], ['gutscheine', 'Gutscheine'], ['raum', 'Raum und Studio'], ['rechtliches', 'Rechtliches'], ['mails', 'Mails']];
  v.append(h('h2', null, 'Verwaltung'));
  v.append(h('div', { class: 'sub', role: 'group', 'aria-label': 'Verwaltung' }, tabs.map(function (t) {
    return h('button', { type: 'button', 'aria-pressed': String(S.adminTab === t[0]), onclick: function () { S.adminTab = t[0]; S.editing = null; render(); } }, t[1], t[2] ? h('span', { class: 'count' }, '(' + t[2] + ')') : null);
  })));
  ({ freigaben: adminFreigaben, kurse: adminKurse, buchungen: adminBuchungen, nutzer: adminNutzer, gutscheine: adminGutscheine, abos: adminAbos, raum: function (v, a) { adminRaum(v, a); adminStories(v); }, rechtliches: adminRecht, mails: adminMails })[S.adminTab](v, a);
}
function diffRows(p) {
  var labels = p.kind === 'course' ? COURSE_LABELS : PROFILE_LABELS, cur = p.current;
  var rows = Object.keys(labels).filter(function (k) { return !cur || String(cur[k] == null ? '' : cur[k]) !== String(p.data[k] == null ? '' : p.data[k]); }).map(function (k) {
    return h('li', null, h('b', null, labels[k] + ': '), cur && cur[k] != null && cur[k] !== '' ? [h('s', null, fmtVal(k, cur[k])), ' → '] : null, fmtVal(k, p.data[k]));
  });
  return rows.length ? rows : [h('li', null, 'Keine Unterschiede')];
}
function adminFreigaben(v, a) {
  if (!a.proposals.length && !a.trainerRequests.length) { v.append(h('div', { class: 'panel' }, h('h3', null, 'Alles erledigt'), h('p', { class: 'muted' }, 'Es warten keine Freigaben.'))); return; }
  a.trainerRequests.forEach(function (r) {
    v.append(h('div', { class: 'panel' },
      h('div', { class: 'row' }, h('b', null, r.name), h('span', { class: 'chip warn' }, 'Trainer-Anfrage'), h('span', { class: 'small muted' }, r.email)),
      r.bio ? h('p', { class: 'prose small' }, r.bio) : null,
      h('p', { class: 'small muted' }, r.dog_ok ? 'Gibt Erfahrung mit Hunden an.' : 'Keine Hundeerfahrung angegeben.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary sm', onclick: function () { act(function () { return api('POST', '/api/admin/trainer-requests/' + r.id, { decision: 'approve' }); }, 'Trainer-Zugang freigegeben.').catch(function () {}); } }, 'Zugang freigeben'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: function () { act(function () { return api('POST', '/api/admin/trainer-requests/' + r.id, { decision: 'reject' }); }, 'Abgelehnt.').catch(function () {}); } }, 'Ablehnen'))));
  });
  a.proposals.forEach(function (p) {
    var reply = h('input', { id: 'pr-' + p.id, type: 'text', maxlength: 300, placeholder: 'Antwort bei Ablehnung (optional)' });
    reply.addEventListener('input', function () { S.formDirty = true; });
    var dogWarn = p.kind === 'course' && p.data.type === 'hund' && p.current === null && false;
    v.append(h('div', { class: 'panel' },
      h('div', { class: 'row' }, h('b', null, p.kind === 'course' ? (p.course_id ? 'Kursänderung: ' : 'Neuer Kurs: ') + (p.data.title || '') : 'Profiländerung'), h('span', { class: 'chip grey' }, p.trainer_name)),
      dogWarn ? null : null,
      h('ul', { class: 'diff' }, diffRows(p)), reply,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary sm', onclick: function () { act(function () { return api('POST', '/api/admin/proposals/' + p.id, { decision: 'approve', reply: reply.value }); }, 'Freigegeben.').catch(function () {}); } }, 'Freigeben'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: function () { act(function () { return api('POST', '/api/admin/proposals/' + p.id, { decision: 'reject', reply: reply.value }); }, 'Abgelehnt.').catch(function () {}); } }, 'Ablehnen'))));
  });
}
function adminKurse(v) {
  if (S.editing) { v.append(adminCourseForm()); return; }
  v.append(h('div', null, h('button', { type: 'button', class: 'btn primary', onclick: function () { S.editing = { course: null }; render(); } }, 'Neuen Kurs anlegen')));
  if (!S.courses.length) { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Noch keine Kurse angelegt.'))); return; }
  var box = h('div', { class: 'list' }); v.append(box);
  S.courses.forEach(function (c) { box.append(adminActions(courseCard(c), c)); });
}
function adminBuchungen(v, a) {
  var byCourse = {}, order = [];
  a.bookings.forEach(function (b) { if (!byCourse[b.course_id]) { byCourse[b.course_id] = []; order.push(b.course_id); } byCourse[b.course_id].push(b); });
  var upcoming = S.courses.filter(function (c) { return c.date >= todayISO(); });
  var pastB = a.bookings.filter(function (b) { return b.status === 'ok' && b.starts_at < Date.now(); });
  if (pastB.length) {
    v.append(h('div', { class: 'panel' }, h('h3', null, 'Vergangene Kurse (letzte 30 Tage)'),
      h('p', { class: 'small muted' }, 'Wer nicht gekommen ist, markierst du hier. Dann bekommt die Person eine Mail mit dem vollen Kurspreis.'),
      h('div', { class: 'list' }, pastB.map(function (b) {
        return h('div', { class: 'row between' },
          h('span', null, b.title + ' · ' + dparts(b.date).full + ' · ' + b.first_name + ' · ' + b.seats + '× ', b.no_show ? h('span', { class: 'chip bad' }, 'Nicht erschienen') : null, ' ',
            h('span', { class: 'chip ' + (b.pay_status === 'bezahlt' ? 'ok' : 'grey') }, PAY[b.pay_method] + ' · ' + (b.pay_status === 'bezahlt' ? 'bezahlt' : 'offen'))),
          h('span', { class: 'row' },
            h('button', { type: 'button', class: 'btn sm' + (b.no_show ? '' : ' danger'), onclick: function () { act(function () { return api('POST', '/api/admin/bookings/' + b.id, { action: b.no_show ? 'showed' : 'noshow' }); }, b.no_show ? 'Markierung entfernt.' : 'Als nicht erschienen markiert, Mail ist raus.').catch(function () {}); } }, b.no_show ? 'War doch da' : 'Nicht erschienen'),
            h('button', { type: 'button', class: 'btn sm', onclick: function () { act(function () { return api('POST', '/api/admin/bookings/' + b.id, { action: b.pay_status === 'bezahlt' ? 'unpaid' : 'paid' }); }).catch(function () {}); } }, b.pay_status === 'bezahlt' ? 'Als offen markieren' : 'Als bezahlt markieren')));
      }))));
  }
  if (!upcoming.length) { v.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Keine kommenden Kurse.'))); return; }
  upcoming.forEach(function (c) {
    var t = TYPES[c.type] || TYPES.ohne, bs = byCourse[c.id] || [];
    v.append(h('div', { class: 'panel' },
      h('div', { class: 'row' }, h('span', { class: 'chip ' + t.cls }, t.label), h('b', null, c.title)),
      h('p', { class: 'small muted' }, dparts(c.date).full + ', ' + c.time + ' Uhr · ' + c.taken + ' von ' + c.cap + ' Plätzen belegt'),
      bs.length ? h('div', { class: 'list' }, bs.map(function (b) {
        return h('div', { class: 'row between' },
          h('span', null, b.first_name + ' · ' + b.seats + '× ' + (b.dog_name ? '· Hund ' + b.dog_name + ' ' : ''), h('span', { class: 'chip ' + (b.status === 'ok' ? 'ok' : 'warn') }, b.status === 'ok' ? 'Gebucht' : 'Warteliste'), ' ',
            h('span', { class: 'chip ' + (b.pay_status === 'bezahlt' ? 'ok' : 'grey') }, PAY[b.pay_method] + ' · ' + (b.pay_status === 'bezahlt' ? 'bezahlt' : 'offen')), h('span', { class: 'small muted' }, ' · ' + b.email)),
          h('span', { class: 'row' },
            h('button', { type: 'button', class: 'btn sm', onclick: function () { act(function () { return api('POST', '/api/admin/bookings/' + b.id, { action: b.pay_status === 'bezahlt' ? 'unpaid' : 'paid' }); }).catch(function () {}); } }, b.pay_status === 'bezahlt' ? 'Als offen markieren' : 'Als bezahlt markieren'),
            b.status === 'wait' ? h('button', { type: 'button', class: 'btn sm', onclick: function () { act(function () { return api('POST', '/api/admin/bookings/' + b.id, { action: 'promote' }); }, 'Nachgerückt.').catch(function () {}); } }, 'Nachrücken') : null,
            h('button', { type: 'button', class: 'btn sm danger', onclick: function () { act(function () { return api('POST', '/api/admin/bookings/' + b.id, { action: 'remove' }); }, 'Buchung entfernt.').catch(function () {}); } }, 'Entfernen')));
      })) : h('p', { class: 'small muted' }, 'Noch keine Buchungen.')));
  });
}
function adminAbos(v) {
  var box = h('div', { class: 'list' });
  v.append(box);
  api('GET', '/api/admin/plans').then(function (res) {
    var rows = [];
    rows.push(h('p', { class: 'muted small' }, 'Hier änderst du Preise und Inhalte der Abos. Änderungen gelten für neue Käufe. Laufende Abos bei Stripe behalten ihren bisherigen Preis.'));
    res.plans.forEach(function (p) {
      var F = {
        name: h('input', { type: 'text', value: p.name, maxlength: 60, required: true }),
        price: h('input', { type: 'number', step: '0.5', min: 1, value: p.price_cents / 100, required: true }),
        intro: h('input', { type: 'number', step: '0.5', min: 0, value: p.intro_cents / 100 }),
        credits: h('input', { type: 'number', min: 1, max: 60, value: p.credits, required: true }),
        guests: h('input', { type: 'number', min: 0, max: 20, value: p.guests }),
        desc: h('textarea', { maxlength: 600 }, p.description),
        active: h('input', { type: 'checkbox', checked: p.active }),
        until: h('input', { type: 'date', value: p.valid_until || '' })
      };
      rows.push(h('form', { class: 'panel stack', onsubmit: function (e) {
        e.preventDefault();
        api('PUT', '/api/admin/plans/' + p.id, { name: F.name.value, price_euro: F.price.value, intro_euro: F.intro.value, credits: F.credits.value, guests: F.guests.value, description: F.desc.value, active: F.active.checked, valid_until: F.until.value })
          .then(function () { toast('Gespeichert.'); return reload(); }).catch(function (err) { toast(err.message); });
      } },
        h('h3', null, p.name + (p.kind === 'monthly' ? ' (monatlich)' : ' (Paket)')),
        h('div', { class: 'grid2' }, fld('Name', F.name), fld('Preis in Euro', F.price)),
        h('div', { class: 'grid2' }, fld('Kurse', F.credits, p.kind === 'monthly' ? 'Pro Monat. 99 bedeutet unbegrenzt.' : 'Insgesamt.'), fld('Gästetickets', F.guests)),
        p.kind === 'monthly' ? fld('Kennenlern-Preis für den ersten Monat in Euro', F.intro, '0 = kein Kennenlern-Preis.') : null,
        p.kind === 'pack' ? fld('Gültig bis', F.until, 'Nach diesem Tag verfällt das Guthaben und das Paket ist nicht mehr kaufbar. Leer lassen, dann gilt es ' + p.valid_days + ' Tage ab Kauf.') : null,
        fld('Beschreibung', F.desc),
        h('label', { class: 'check' }, F.active, h('span', null, 'Im Angebot zeigen')),
        h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'))));
    });
    var email = h('input', { type: 'email', required: true, placeholder: 'E-Mail der Kundin' });
    var sel = h('select', null, res.plans.map(function (p) { return h('option', { value: p.id }, p.name); }));
    rows.push(h('form', { class: 'panel stack', onsubmit: function (e) {
      e.preventDefault();
      api('POST', '/api/admin/memberships', { email: email.value, plan_id: Number(sel.value) }).then(function () { toast('Abo angelegt, die Kundin bekommt eine Mail.'); email.value = ''; return reload(); }).catch(function (err) { toast(err.message); });
    } }, h('h3', null, 'Abo von Hand anlegen'),
      h('p', { class: 'muted small' }, 'Zum Beispiel, wenn jemand bar oder per PayPal bezahlt hat. Die Person braucht ein Konto.'),
      h('div', { class: 'grid2' }, fld('E-Mail', email), fld('Abo', sel)),
      h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Abo anlegen'))));
    rows.push(h('div', { class: 'panel' }, h('h3', null, 'Aktive Abos'),
      res.memberships.length ? res.memberships.map(function (m) {
        return h('div', { class: 'row between mship' },
          h('div', null, h('b', null, m.user_name || m.user_email), ' · ' + m.plan_name + ' ', m.status === 'gekuendigt' ? h('span', { class: 'chip warn' }, 'gekündigt') : null, m.expired ? h('span', { class: 'chip bad' }, 'abgelaufen') : null,
            h('div', { class: 'small muted' }, m.user_email + ' · noch ' + m.credits_left + ' Kurse, ' + m.guests_left + ' Gästetickets · bis ' + fmtD(m.period_end))),
          h('span', { class: 'row' },
            m.stripe ? null : h('button', { type: 'button', class: 'btn sm', onclick: function () { api('POST', '/api/admin/memberships/' + m.id, { action: 'renew' }).then(function () { toast('Neuer Zeitraum gestartet.'); return reload(); }).catch(function (e) { toast(e.message); }); } }, 'Neuer Monat'),
            h('button', { type: 'button', class: 'btn sm danger', onclick: function () { api('POST', '/api/admin/memberships/' + m.id, { action: 'end' }).then(function () { toast('Abo beendet.'); return reload(); }).catch(function (e) { toast(e.message); }); } }, 'Beenden')));
      }) : h('p', { class: 'muted' }, 'Noch keine Abos.')));
    box.replaceChildren.apply(box, rows);
  }).catch(function (e) { box.textContent = e.message; });
}
function adminStories(v) {
  var r = S.room || {};
  var fb = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'st-before' }), fa = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'st-after' });
  var cap = h('input', { type: 'text', maxlength: 200, id: 'st-cap', placeholder: 'Zum Beispiel: Anna, regelmäßig seit dem Frühling' });
  var weeks = h('input', { type: 'number', min: 0, max: 520, id: 'st-weeks', placeholder: '12' });
  var ok = h('input', { type: 'checkbox', id: 'st-ok' });
  function up(f) { if (!f || !f.files[0]) return Promise.reject(new Error('Bitte wähle beide Fotos.')); if (f.files[0].size > 5 * 1024 * 1024) return Promise.reject(new Error('Ein Foto ist größer als 5 MB.')); return api('POST', '/api/admin/story-photo', undefined, f.files[0]); }
  v.append(h('div', { class: 'panel stack' }, h('h3', null, 'Vorher und nachher: echte Gäste'),
    h('p', { class: 'muted small' }, 'Zeig hier nur Fotos von Gästen, die ausdrücklich zugestimmt haben. Bitte keine Versprechen zur Figur machen. Die Fotos erscheinen unter „Warum Yoga“.'),
    h('div', { class: 'grid2' }, fld('Foto vorher', fb), fld('Foto nachher', fa)),
    h('div', { class: 'grid2' }, fld('Text', cap), fld('Nach wie vielen Wochen?', weeks)),
    h('label', { class: 'check' }, ok, h('span', null, 'Die Person hat der Veröffentlichung der Fotos zugestimmt.')),
    h('div', null, h('button', { type: 'button', class: 'btn primary', onclick: function () {
      if (!ok.checked) { toast('Bitte bestätige die Zustimmung der Person.'); return; }
      Promise.all([up(fb), up(fa)]).then(function (x) { return api('POST', '/api/admin/stories', { before: x[0].file, after: x[1].file, caption: cap.value, weeks: Number(weeks.value) || 0, consent: true }); })
        .then(function () { toast('Geschichte gespeichert.'); return reload(); }).catch(function (e) { toast(e.message); });
    } }, 'Geschichte veröffentlichen')),
    (r.stories || []).length ? h('div', { class: 'list' }, r.stories.map(function (st) {
      return h('div', { class: 'row between' }, h('span', null, (st.caption || 'Ohne Text') + (st.weeks ? ' · ' + st.weeks + ' Wochen' : '')),
        h('button', { type: 'button', class: 'btn sm danger', onclick: function () { api('DELETE', '/api/admin/stories/' + st.id).then(function () { toast('Geschichte gelöscht.'); return reload(); }).catch(function (e) { toast(e.message); }); } }, 'Löschen'));
    })) : null));
}
function adminGutscheine(v) {
  var box = h('div', { class: 'list' });
  var amount = h('input', { id: 'gs-euro', type: 'number', min: 1, max: 1000, step: 1, value: 50, required: true });
  var note = h('input', { id: 'gs-note', type: 'text', maxlength: 120, placeholder: 'Zum Beispiel: Geschenk für Anna' });
  function load() {
    return api('GET', '/api/admin/vouchers').then(function (res) {
      box.replaceChildren.apply(box, res.vouchers.length ? res.vouchers.map(function (g) {
        return h('div', { class: 'row between' },
          h('span', null, h('b', null, g.code), ' · ' + euro(g.cents_left) + ' von ' + euro(g.cents_total) + (g.note ? ' · ' + g.note : '')),
          h('button', { type: 'button', class: 'btn sm danger', onclick: function () { api('DELETE', '/api/admin/vouchers/' + g.id).then(function () { toast('Gutschein gelöscht.'); return load(); }).catch(function (e) { toast(e.message); }); } }, 'Löschen'));
      }) : [h('p', { class: 'muted' }, 'Noch keine Gutscheine.')]);
    }).catch(function (e) { box.textContent = e.message; });
  }
  v.append(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault();
    api('POST', '/api/admin/vouchers', { euro: Number(amount.value), note: note.value }).then(function (res) { toast('Gutschein ' + res.code + ' angelegt.'); note.value = ''; return load(); }).catch(function (err) { toast(err.message); });
  } }, h('h3', null, 'Gutschein anlegen'),
    h('p', { class: 'muted small' }, 'Du verkaufst den Gutschein selbst (zum Beispiel bar oder per PayPal) und gibst den Code weiter. Beim Buchen trägt die Person den Code ein, der Betrag wird abgezogen. Bei Storno kommt er zurück auf den Gutschein.'),
    h('div', { class: 'grid2' }, fld('Wert in Euro', amount), fld('Notiz (nur für dich)', note)),
    h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Code erzeugen'))));
  v.append(h('div', { class: 'panel' }, h('h3', null, 'Alle Gutscheine'), box));
  load();
}
function adminNutzer(v, a) {
  var nlCount = a.users.filter(function (u) { return u.newsletter && u.email_verified; }).length;
  v.append(h('div', { class: 'panel' }, h('h3', null, 'Neuigkeiten-Liste'), h('p', { class: 'muted small' }, nlCount + ' bestätigte Konten möchten Neuigkeiten per E-Mail. Du lädst die Liste herunter und nutzt sie in deinem E-Mail-Programm.'),
    h('div', null, h('a', { class: 'btn sm', href: '/api/admin/newsletter.csv', download: 'newsletter.csv' }, 'Liste herunterladen'))));
  v.append(h('div', { class: 'panel' }, h('p', { class: 'muted small' }, 'Hier siehst du alle Konten. Über die Rolle bestimmst du, wer Trainer oder Admin ist. Neue Konten sind immer Kunden.'),
    h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'E-Mail'), h('th', null, 'Rolle'))),
      h('tbody', null, a.users.map(function (u) {
        var self = u.id === S.user.id;
        var sel = h('select', { id: 'role-' + u.id, 'aria-label': 'Rolle von ' + u.name, disabled: self, value: u.role }, Object.keys(ROLE_LABEL).map(function (k) { return h('option', { value: k }, ROLE_LABEL[k]); }));
        sel.addEventListener('change', function () { act(function () { return api('POST', '/api/admin/users/' + u.id + '/role', { role: sel.value }); }, 'Rolle geändert.').catch(function () { render(); }); });
        return h('tr', null, h('td', null, u.name || '–'), h('td', null, u.email, ' ', h('span', { class: 'chip ' + (u.email_verified ? 'ok' : 'warn') }, u.email_verified ? 'bestätigt' : 'nicht bestätigt')), h('td', null, sel));
      }))))));
}
function adminRaum(v) {
  var r = S.room || {}, F = {};
  F.studio_name = h('input', { id: 'rm-studio', type: 'text', value: r.studio_name || '', maxlength: 60, required: true });
  F.tagline = h('input', { id: 'rm-tag', type: 'text', value: r.tagline || '', maxlength: 140 });
  F.room_title = h('input', { id: 'rm-title', type: 'text', value: r.room_title || '', maxlength: 60 });
  F.body = h('textarea', { id: 'rm-text', maxlength: 2000 }, r.body || '');
  F.facts = h('textarea', { id: 'rm-facts', maxlength: 800 }, r.facts || '');
  F.rules = h('textarea', { id: 'rm-rules', maxlength: 1000 }, r.rules || '');
  F.paypal_me = h('input', { id: 'rm-paypal', type: 'text', value: r.paypal_me ? 'paypal.me/' + r.paypal_me : '', maxlength: 80 });
  F.pay_info = h('textarea', { id: 'rm-pay', maxlength: 400 }, r.pay_info || '');
  F.address = h('input', { id: 'rm-addr', type: 'text', maxlength: 200, value: r.address || '', placeholder: 'Straße Hausnummer, PLZ Ort' });
  F.directions = h('textarea', { id: 'rm-dir', maxlength: 1200 }, r.directions || '');
  F.instagram = h('input', { id: 'rm-insta', type: 'text', maxlength: 60, value: r.instagram ? '@' + r.instagram : '' });
  F.faq = h('textarea', { id: 'rm-faq', maxlength: 6000, rows: 12 }, r.faq || '');
  F.reviews = h('textarea', { id: 'rm-rev', maxlength: 4000, rows: 6 }, r.reviews || '');
  var file = h('input', { id: 'rm-photo', type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  var photoMsg = h('span', { class: 'small muted' }, r.photo_url ? 'Foto hochgeladen.' : 'Noch kein Foto.');
  var photoBtn = h('button', { type: 'button', class: 'btn sm', onclick: function () {
    var f = file.files && file.files[0];
    if (!f) { toast('Bitte wähle zuerst ein Foto.'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Das Foto ist größer als 5 MB.'); return; }
    photoMsg.textContent = 'Lädt hoch …';
    act(function () { return api('POST', '/api/admin/room/photo', undefined, f); }, 'Foto gespeichert.').catch(function () { photoMsg.textContent = 'Upload nicht möglich.'; });
  } }, 'Foto hochladen');
  var gfile = h('input', { id: 'rm-gal', type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  var gbtn = h('button', { type: 'button', class: 'btn sm', onclick: function () {
    var f = gfile.files && gfile.files[0];
    if (!f) { toast('Bitte wähle zuerst ein Foto.'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Das Foto ist größer als 5 MB.'); return; }
    act(function () { return api('POST', '/api/admin/gallery', undefined, f); }, 'Foto zur Galerie hinzugefügt.').catch(function () {});
  } }, 'Zur Galerie hinzufügen');
  v.append(afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault();
    var body = {}; Object.keys(F).forEach(function (k) { body[k] = F[k].value; });
    act(function () { return api('PUT', '/api/admin/room', body); }, 'Gespeichert.').catch(function () {});
  } },
    h('h3', null, 'Raum und Studio'),
    fld('Name des Studios', F.studio_name), fld('Untertitel', F.tagline), fld('Überschrift Raum', F.room_title), fld('Beschreibung', F.body),
    fld('Eigenschaften', F.facts, 'Eine pro Zeile im Format „Titel: Wert“, zum Beispiel „Größe: 40 m²“.'),
    fld('Gut zu wissen', F.rules, 'Eine Regel oder ein Hinweis pro Zeile.'),
    fld('Adresse', F.address, 'Wird in der Erinnerungsmail und auf der Seite „Der Raum“ gezeigt.'),
    fld('Anfahrt und Parken', F.directions, 'Zum Beispiel: Parkplätze, Bus, Klingel, Hinweise für Hunde.'),
    fld('Instagram-Name', F.instagram, 'Zum Beispiel @pfotenyoga. Leer lassen, wenn du keins hast.'),
    fld('Häufige Fragen', F.faq, 'Pro Frage ein Block: erste Zeile die Frage, darunter die Antwort. Zwischen den Blöcken eine Leerzeile.'),
    fld('Stimmen von Gästen', F.reviews, 'Nur echte Rückmeldungen mit Erlaubnis. Pro Block: erste Zeile das Zitat, zweite Zeile der Name, zum Beispiel „Anna, mit Hund Luna“. Leer lassen, dann erscheint nichts.'),
    fld('PayPal.me-Name oder -Link', F.paypal_me, 'Zum Beispiel paypal.me/deinname. Leer lassen, dann gibt es PayPal nicht zur Auswahl. Du markierst Buchungen selbst als bezahlt.'),
    fld('Zahlungshinweise', F.pay_info, 'Wird bei „Überweisung“ gezeigt, zum Beispiel IBAN und Verwendungszweck.'),
    h('div', { class: 'fld' }, h('span', { class: 'fl' }, 'Foto vom Raum'), h('div', { class: 'row' }, file, photoBtn, photoMsg), h('small', null, 'Dieses Foto erscheint groß auf der Startseite und bei „Der Raum“.')),
    h('div', { class: 'fld' }, h('span', { class: 'fl' }, 'Galerie (bis zu 12 Fotos)'),
      h('div', { class: 'gallery admin' }, (r.gallery || []).map(function (g) {
        return h('div', { class: 'gitem' }, h('img', { src: g.url, alt: '' }),
          h('button', { type: 'button', class: 'btn sm danger', onclick: function () { act(function () { return api('DELETE', '/api/admin/gallery/' + g.id); }, 'Foto gelöscht.').catch(function () {}); } }, 'Löschen'));
      })),
      h('div', { class: 'row' }, gfile, gbtn)),
    h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Speichern')))));
}
function adminRecht(v) {
  var L = (S.room && S.room.legal) || {}, F = {};
  var defs = [['imprint', 'Impressum'], ['privacy', 'Datenschutzerklärung'], ['terms', 'AGB und Stornobedingungen']];
  var fields = [];
  defs.forEach(function (d) {
    F[d[0]] = h('textarea', { id: 'lg-' + d[0], rows: 9, maxlength: 20000 }, L[d[0]] || '');
    F[d[0] + '_en'] = h('textarea', { id: 'lg-' + d[0] + '-en', rows: 9, maxlength: 20000 }, L[d[0] + '_en'] || '');
    fields.push(fld(d[1] + ' (Deutsch)', F[d[0]]), fld(d[1] + ' (Englisch, optional)', F[d[0] + '_en']));
  });
  v.append(afterInput(h('form', { class: 'panel stack', onsubmit: function (e) {
    e.preventDefault();
    var body = {}; Object.keys(F).forEach(function (k) { body[k] = F[k].value; });
    act(function () { return api('PUT', '/api/admin/legal', body); }, 'Gespeichert.').catch(function () {});
  } },
    h('h3', null, 'Rechtliche Texte'),
    h('p', { class: 'muted small' }, 'Diese Texte erscheinen unter „Impressum, Datenschutz, AGB“. Eine Leerzeile trennt Absätze. Der englische Text ist optional: Ist er leer, sehen Besucher auf Englisch den deutschen Text. Lass die Texte rechtlich prüfen.'),
    fields,
    h('div', null, h('button', { type: 'submit', class: 'btn primary' }, 'Speichern')))));
}
function adminMails(v, a) {
  v.append(h('div', { class: 'panel' },
    h('p', { class: 'muted small' }, S.config.mail ? 'E-Mails werden über Resend verschickt. Hier siehst du die letzten 30.' : 'Es ist kein Mail-Dienst eingerichtet. Die Mails werden nur hier aufgelistet und nicht verschickt.'),
    a.mails.length ? h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Zeit'), h('th', null, 'An'), h('th', null, 'Betreff'), h('th', null, 'Status'))),
      h('tbody', null, a.mails.map(function (m) {
        return h('tr', null, h('td', null, new Date(m.created_at).toLocaleString(LOC())), h('td', null, m.to_email), h('td', null, m.subject),
          h('td', null, h('span', { class: 'chip ' + (m.sent ? 'ok' : m.error ? 'bad' : 'grey') }, m.sent ? 'versendet' : m.error ? 'Fehler' : 'nicht versendet')));
      })))) : h('p', { class: 'muted' }, 'Noch keine Mails.')));
}

/* ---------- Rechtliches ---------- */
function viewLegal(v) {
  var L = (S.room && S.room.legal) || {}, en = S.lang === 'en';
  v.append(h('h2', null, 'Impressum, Datenschutz und AGB'));
  var secs = [['Impressum', 'imprint', 'Name und Anschrift des Anbieters, E-Mail-Adresse, Telefonnummer, Steuernummer oder NIF, ggf. Registereintrag.'],
    ['Datenschutzerklärung', 'privacy', 'Welche Daten gespeichert werden (Name, E-Mail, Buchungen, Hundename), wofür, wie lange, an wen sie gehen (Hosting, Zahlungsdienst Stripe, Mail-Dienst Resend) und welche Rechte Nutzer haben.'],
    ['AGB und Stornobedingungen', 'terms', 'Kostenlose Stornierung bis ' + S.config.cancel_hours + ' Stunden vor Beginn, Regeln bei Absage durch das Studio, Haftung bei Hundekursen und Welpenterminen, Hausrecht (Ausschluss einzelner Hunde).']];
  var missing = secs.some(function (s) { return !L[s[1]]; });
  if (missing) v.append(h('div', { class: 'banner' }, 'Diese Texte sind Platzhalter. Bitte ersetze sie vor dem Start durch geprüfte Angaben (am besten mit Rechtsberatung).'));
  secs.forEach(function (s) {
    var txt = en && L[s[1] + '_en'] ? L[s[1] + '_en'] : L[s[1]];
    var box = h('div', { class: 'panel', id: 'legal-' + s[1] }, h('h3', null, s[0]));
    if (!txt) box.append(h('p', { class: 'prose' }, s[2]));
    else {
      if (en && !L[s[1] + '_en']) box.append(h('p', { class: 'small muted' }, 'Dieser Text liegt nur auf Deutsch vor.'));
      txt.split(/\n{2,}/).forEach(function (p) { if (p.trim()) box.append(h('p', { class: 'prose' }, p.trim())); });
    }
    v.append(box);
  });
}

/* ---------- Übersetzung (Englisch) ---------- */
var ATTRS = ['placeholder', 'aria-label', 'alt', 'title'];
function trText(n) {
  if (!n.parentNode || /^(TEXTAREA|SCRIPT|STYLE|INPUT)$/.test(n.parentNode.nodeName)) return;
  var t = window.EN.tr(n.nodeValue);
  if (t !== n.nodeValue) n.nodeValue = t;
}
function trAttr(e, a) {
  var v = e.getAttribute(a);
  if (!v) return;
  var t = window.EN.tr(v);
  if (t !== v) e.setAttribute(a, t);
}
function trWalk(n) {
  if (n.nodeType === 3) { trText(n); return; }
  if (n.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(n.nodeName)) return;
  ATTRS.forEach(function (a) { if (n.hasAttribute(a)) trAttr(n, a); });
  Array.prototype.forEach.call(n.childNodes, trWalk);
}
function startTranslator() {
  if (!window.EN || !window.MutationObserver) return;
  new MutationObserver(function (ms) {
    if (S.lang !== 'en') return;
    ms.forEach(function (m) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') trAttr(m.target, m.attributeName);
      else Array.prototype.forEach.call(m.addedNodes, trWalk);
    });
    if (document.title) document.title = window.EN.tr(document.title);
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (S.lang === 'en') trWalk(document.body);
}

/* ---------- Start ---------- */
function init() {
  initLang(); startTranslator();
  Promise.all([api('GET', '/api/config'), api('GET', '/api/me')]).then(function (r) {
    S.config = r[0]; S.user = r[1].user;
    return Promise.all([loadPublic(), loadUserData()]);
  }).then(function () { S.ready = true; render(); }).catch(function (e) { S.error = 'Die Seite konnte nicht geladen werden. Bitte lade sie neu.'; render(); console.error(e); });
}
setInterval(function () {
  if (document.hidden || !S.ready || S.formDirty || !$('#modal').hidden) return;
  Promise.all([loadPublic(), loadUserData()]).then(function () { if (!S.formDirty && $('#modal').hidden) render(); }).catch(function () {});
}, 45000);
init();
})();
