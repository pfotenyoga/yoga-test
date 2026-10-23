'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./lib/app');

/** Liest eine optionale .env-Datei, ohne Zusatzpakete */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    });
}

function configFromEnv() {
  const port = Number(process.env.PORT) || 3000;
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
  return {
    port,
    dataDir,
    dbFile: path.join(dataDir, 'yoga.db'),
    siteUrl: (process.env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    adminEmail: (process.env.ADMIN_EMAIL || '').trim(),
    cancelHours: Number(process.env.CANCEL_HOURS) || 24,
    resendKey: process.env.RESEND_API_KEY || '',
    mailFrom: process.env.MAIL_FROM || 'Yoga mit Pfoten <onboarding@resend.dev>',
    stripeSecret: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    trustProxy: process.env.TRUST_PROXY === '1',
    autoVerify: process.env.AUTO_VERIFY === '1',
    logMail: true,
  };
}

if (require.main === module) {
  loadEnv(path.join(__dirname, '.env'));
  const cfg = configFromEnv();
  const app = createApp(cfg);
  app.server.listen(cfg.port, () => {
    console.log(`Yoga mit Pfoten läuft auf ${cfg.siteUrl} (Port ${cfg.port})`);
    if (!cfg.resendKey) console.log('Hinweis: Ohne RESEND_API_KEY werden keine E-Mails verschickt. Sie erscheinen im Admin-Bereich unter "Mails".');
    if (!cfg.stripeSecret) console.log('Hinweis: Ohne STRIPE_SECRET_KEY gibt es keine Online-Zahlung.');
    if (cfg.siteUrl.startsWith('http://') && process.env.NODE_ENV === 'production') console.log('Warnung: SITE_URL sollte online mit https:// beginnen.');
  });
  setTimeout(() => app.runReminders(), 30e3);
  const reminders = setInterval(() => { try { app.runReminders(); } catch (e) { console.error('[erinnerung]', e.message); } }, 15 * 60e3);
  reminders.unref();
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { configFromEnv, loadEnv };
