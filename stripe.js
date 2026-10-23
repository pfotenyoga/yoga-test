'use strict';

const crypto = require('node:crypto');

/** Legt eine Stripe-Checkout-Sitzung an und gibt die Adresse der Bezahlseite zurück */
async function createCheckoutSession(secret, { amountCents, title, bookingId, email, successUrl, cancelUrl }) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  form.set('client_reference_id', String(bookingId));
  form.set('metadata[booking_id]', String(bookingId));
  if (email) form.set('customer_email', email);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'eur');
  form.set('line_items[0][price_data][unit_amount]', String(amountCents));
  form.set('line_items[0][price_data][product_data][name]', title);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) throw new Error('Stripe: ' + ((json.error && json.error.message) || res.status));
  return { id: json.id, url: json.url };
}

async function stripeCall(secret, method, path, form) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? form : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Stripe: ' + ((json.error && json.error.message) || res.status));
  return json;
}

/** Checkout für ein Abo (monatlich) oder ein Paket (einmalig). introDiscountCents zieht beim ersten Betrag etwas ab. */
async function createPlanCheckout(secret, { plan, userId, email, successUrl, cancelUrl, introDiscountCents }) {
  const form = new URLSearchParams();
  form.set('mode', plan.kind === 'monthly' ? 'subscription' : 'payment');
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  form.set('client_reference_id', 'u' + userId);
  form.set('metadata[plan_id]', String(plan.id));
  form.set('metadata[user_id]', String(userId));
  if (plan.kind === 'monthly') {
    form.set('subscription_data[metadata][plan_id]', String(plan.id));
    form.set('subscription_data[metadata][user_id]', String(userId));
  }
  if (email) form.set('customer_email', email);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'eur');
  form.set('line_items[0][price_data][unit_amount]', String(plan.price_cents));
  form.set('line_items[0][price_data][product_data][name]', plan.name);
  if (plan.kind === 'monthly') form.set('line_items[0][price_data][recurring][interval]', 'month');
  if (introDiscountCents > 0 && plan.kind === 'monthly') {
    const c = new URLSearchParams();
    c.set('amount_off', String(introDiscountCents));
    c.set('currency', 'eur');
    c.set('duration', 'once');
    c.set('name', 'Kennenlern-Monat');
    const coupon = await stripeCall(secret, 'POST', '/coupons', c);
    form.set('discounts[0][coupon]', coupon.id);
  }
  const json = await stripeCall(secret, 'POST', '/checkout/sessions', form);
  if (!json.url) throw new Error('Stripe: keine Bezahlseite');
  return { id: json.id, url: json.url };
}

/** Beendet ein Abo zum Ende des bezahlten Zeitraums */
async function cancelSubscriptionAtPeriodEnd(secret, subId) {
  const f = new URLSearchParams();
  f.set('cancel_at_period_end', 'true');
  await stripeCall(secret, 'POST', '/subscriptions/' + encodeURIComponent(subId), f);
}

/** Prüft die Signatur eines Stripe-Webhooks. Gibt das Ereignis zurück oder wirft einen Fehler. */
function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  const parts = {};
  String(header || '')
    .split(',')
    .forEach((p) => {
      const [k, v] = p.split('=');
      if (k && v) (parts[k.trim()] = parts[k.trim()] || []).push(v.trim());
    });
  const t = parts.t && parts.t[0];
  if (!t || !parts.v1) throw new Error('signatur_fehlt');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const ok = parts.v1.some((sig) => {
    const b = Buffer.from(sig, 'hex');
    return b.length === expected.length && crypto.timingSafeEqual(b, expected);
  });
  if (!ok) throw new Error('signatur_falsch');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error('signatur_zu_alt');
  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = { createCheckoutSession, createPlanCheckout, cancelSubscriptionAtPeriodEnd, verifyWebhook };
