'use strict';

const { esc } = require('./util');

/**
 * Jede Mail wird in der Tabelle "outbox" festgehalten. Mit RESEND_API_KEY wird sie
 * zusätzlich über Resend verschickt. Ohne Schlüssel bleibt sie nur dort liegen,
 * der Admin sieht sie im Bereich "Mails".
 */
function createMailer(db, { apiKey, from, log }) {
  return function send(to, subject, html) {
    if (!to) return Promise.resolve();
    const id = Number(
      db.prepare('INSERT INTO outbox (to_email, subject, html, created_at) VALUES (?, ?, ?, ?)').run(to, subject, html, Date.now()).lastInsertRowid,
    );
    if (!apiKey) {
      if (log) console.log(`[mail] nicht versendet (kein RESEND_API_KEY): an ${to}, ${subject}`);
      return Promise.resolve();
    }
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })
      .then(async (res) => {
        if (res.ok) db.prepare('UPDATE outbox SET sent = 1 WHERE id = ?').run(id);
        else db.prepare('UPDATE outbox SET error = ? WHERE id = ?').run(`${res.status} ${(await res.text()).slice(0, 300)}`, id);
      })
      .catch((e) => {
        db.prepare('UPDATE outbox SET error = ? WHERE id = ?').run(String(e.message || e).slice(0, 300), id);
      });
  };
}

/** Einfaches Mail-Layout. Zeilen dürfen HTML enthalten, Werte vorher mit esc() bereinigen. */
function mailShell(studio, title, lines) {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#1B2822">
<h2 style="margin:0 0 12px">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${l}</p>`).join('\n')}
<p style="color:#5A695F;font-size:13px;margin-top:22px">${esc(studio)}</p></div>`;
}

module.exports = { createMailer, mailShell };
