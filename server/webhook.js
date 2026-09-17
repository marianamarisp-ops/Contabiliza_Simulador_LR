'use strict';

const { grantLicense, revokeByOrderId, markEmailSent, needsAccessEmail } = require('./licenses');
const { sendAccessEmail } = require('./email');

function getWebhookSecret() {
  return String(process.env.CAKTO_WEBHOOK_SECRET || '').replace(/^["']|["']$/g, '').trim();
}

function incomingSecret(payload) {
  return String((payload && payload.secret) || '').replace(/^["']|["']$/g, '').trim();
}

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return {};
    }
  }
  return raw;
}

function customerFrom(data) {
  const c = (data && (data.customer || data.buyer || data.client)) || {};
  return {
    email: c.email || (data && data.email) || '',
    name: c.name || '',
    phone: c.phone || ''
  };
}

function queueAccessEmail(license, source) {
  if (!needsAccessEmail(license)) {
    console.log('[email] já enviado, não reenviar:', license.email, 'via', source);
    return;
  }
  sendAccessEmail({
    to: license.email,
    name: license.name,
    accessKey: license.accessKey
  }).then((result) => {
    if (result && result.sent) {
      markEmailSent(license.email, true);
      console.log('[email] enviado:', license.email, result.provider || source);
      return;
    }
    console.error('[email] não enviado:', license.email, (result && result.reason) || 'unknown');
  }).catch((err) => {
    console.error('[email] falha:', license.email, err.message);
  });
}

async function handleCaktoWebhook(body) {
  const payload = parseBody(body);
  const secret = getWebhookSecret();
  const event = payload.event || payload.type || null;
  const data = payload.data || {};
  const orderId = data.id || payload.id || null;
  const customer = customerFrom(data);

  const receivedSecret = incomingSecret(payload);
  const secretOk = Boolean(secret) && receivedSecret === secret;

  console.log('[webhook] recebido', JSON.stringify({
    event: event || null,
    secretOk,
    secretLen: receivedSecret.length,
    expectedLen: secret.length,
    hasEmail: Boolean(customer.email),
    orderId
  }));

  if (!secret) {
    return { status: 500, payload: { ok: false, error: 'CAKTO_WEBHOOK_SECRET não configurado.' } };
  }
  if (!secretOk) {
    console.error('[webhook] secret da Cakto diferente do CAKTO_WEBHOOK_SECRET do Render');
    return { status: 401, payload: { ok: false, error: 'Secret inválido.' } };
  }

  const product = data.product || {};

  if (event === 'purchase_approved' || event === 'subscription_renewed') {
    const { license, created, reused } = grantLicense({
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      orderId,
      productId: product.id || null,
      productName: product.name || null
    });

    const emailQueued = needsAccessEmail(license);
    if (emailQueued) queueAccessEmail(license, 'cakto');

    return {
      status: 200,
      payload: {
        ok: true,
        event,
        licenseId: license.id,
        email: license.email,
        created,
        reused,
        emailQueued
      }
    };
  }

  if (event === 'refund' || event === 'chargeback' || event === 'subscription_canceled') {
    const revoked = revokeByOrderId(orderId, event);
    return {
      status: 200,
      payload: {
        ok: true,
        event,
        revoked: Boolean(revoked),
        email: revoked ? revoked.email : null
      }
    };
  }

  return { status: 200, payload: { ok: true, event, ignored: true } };
}

module.exports = {
  handleCaktoWebhook,
  queueAccessEmail
};
