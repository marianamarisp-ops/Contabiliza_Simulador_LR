'use strict';

const { grantLicense, revokeByOrderId } = require('./licenses');
const { sendAccessEmail } = require('./email');

function getWebhookSecret() {
  return process.env.CAKTO_WEBHOOK_SECRET || '';
}

function customerFrom(data) {
  const c = (data && data.customer) || {};
  return {
    email: c.email,
    name: c.name || '',
    phone: c.phone || ''
  };
}

async function handleCaktoWebhook(body) {
  const secret = getWebhookSecret();
  if (!secret) {
    return { status: 500, payload: { ok: false, error: 'CAKTO_WEBHOOK_SECRET não configurado.' } };
  }
  if (!body || body.secret !== secret) {
    return { status: 401, payload: { ok: false, error: 'Secret inválido.' } };
  }

  const event = body.event;
  const data = body.data || {};
  const orderId = data.id || null;
  const product = data.product || {};
  const customer = customerFrom(data);

  if (event === 'purchase_approved' || event === 'subscription_renewed') {
    const { license, created, reused } = grantLicense({
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      orderId,
      productId: product.id || null,
      productName: product.name || null
    });

    let emailResult = { sent: false, reason: 'skipped_reuse' };
    if (created || !reused) {
      try {
        emailResult = await sendAccessEmail({
          to: license.email,
          name: license.name,
          accessKey: license.accessKey
        });
      } catch (err) {
        console.error('[webhook] falha ao enviar e-mail:', err.message);
        emailResult = { sent: false, reason: err.message };
      }
    }

    return {
      status: 200,
      payload: {
        ok: true,
        event,
        licenseId: license.id,
        email: license.email,
        created,
        emailSent: Boolean(emailResult.sent)
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

  // Outros eventos: só confirma recebimento
  return { status: 200, payload: { ok: true, event, ignored: true } };
}

module.exports = {
  handleCaktoWebhook
};
