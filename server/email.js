'use strict';

const nodemailer = require('nodemailer');

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function webhookConfigured() {
  return Boolean(process.env.EMAIL_WEBHOOK_URL && process.env.EMAIL_WEBHOOK_SECRET);
}

function smtpAllowed() {
  if (process.env.EMAIL_ALLOW_SMTP === 'true') return true;
  if (String(process.env.RENDER || '').toLowerCase() === 'true') return false;
  return true;
}

function mailConfigured() {
  return webhookConfigured() || (smtpConfigured() && smtpAllowed());
}

function mailProvider() {
  if (webhookConfigured()) return 'gmail_https';
  if (smtpConfigured() && smtpAllowed()) return 'smtp';
  if (smtpConfigured()) return 'smtp_blocked';
  return 'none';
}

function smtpPass() {
  return String(process.env.SMTP_PASS || '').replace(/^["']|["']$/g, '');
}

function parseFrom(raw) {
  const value = String(raw || '').replace(/^["']|["']$/g, '').trim();
  const match = value.match(/^(.*)<([^>]+)>\s*$/);
  if (match) {
    return {
      name: match[1].replace(/^["']|["']$/g, '').trim() || 'Contabiliza',
      email: match[2].trim()
    };
  }
  return { name: 'Contabiliza', email: value };
}

function getTransporter() {
  if (!smtpConfigured() || !smtpAllowed()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT || '587') === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass()
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000
  });
}

function fromHeader() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'contabiliza.simulador@gmail.com';
}

async function postToRelay(payload, timeoutMs) {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (!url || !process.env.EMAIL_WEBHOOK_SECRET) {
    return { ok: false, reason: 'webhook_not_configured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      signal: controller.signal,
      body: JSON.stringify({
        secret: process.env.EMAIL_WEBHOOK_SECRET,
        ...payload
      })
    });
    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (_err) {
      data = null;
    }
    if (!response.ok || !data || data.ok === false) {
      const reason = (data && (data.error || data.reason)) || raw.slice(0, 180) || ('http_' + response.status);
      return { ok: false, reason: String(reason), data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'webhook_timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaWebhook({ from, to, subject, text, html, replyTo }) {
  const parsed = parseFrom(from);
  const result = await postToRelay({
    action: 'sendEmail',
    to,
    subject,
    text,
    html,
    replyTo: replyTo || undefined,
    fromName: parsed.name
  });
  if (!result.ok) return { sent: false, reason: result.reason };
  return { sent: true, provider: 'gmail_https' };
}

async function sendViaSmtp({ from, to, subject, text, html, replyTo }) {
  const transporter = getTransporter();
  if (!transporter) {
    if (smtpConfigured() && !smtpAllowed()) {
      return { sent: false, reason: 'smtp_blocked_on_render' };
    }
    return { sent: false, reason: 'smtp_not_configured' };
  }
  await transporter.sendMail({ from, to, subject, text, html, replyTo });
  return { sent: true, provider: 'smtp' };
}

async function sendMail({ to, subject, text, html, replyTo }) {
  const from = fromHeader();
  if (webhookConfigured()) {
    const viaWebhook = await sendViaWebhook({ from, to, subject, text, html, replyTo });
    if (viaWebhook.sent) return viaWebhook;
    console.error('[email] webhook falhou:', viaWebhook.reason);
    const viaSmtp = await sendViaSmtp({ from, to, subject, text, html, replyTo });
    if (viaSmtp.sent) return viaSmtp;
    return viaWebhook;
  }
  return sendViaSmtp({ from, to, subject, text, html, replyTo });
}

async function sendAccessEmail({ to, name, accessKey }) {
  const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  const subject = 'Seu acesso ao Simulador Contabiliza';
  const text =
    `Olá${name ? ' ' + name : ''},\n\n` +
    `Seu pagamento foi confirmado. Use os dados abaixo para entrar:\n\n` +
    `Link: ${appUrl}\n` +
    `E-mail: ${to}\n` +
    `Chave de acesso: ${accessKey}\n\n` +
    `Guarde esta chave. Em caso de dúvida, responda este e-mail.\n\n` +
    `Contabiliza`;
  const html =
    `<p>Olá${name ? ' ' + name : ''},</p>` +
    `<p>Seu pagamento foi confirmado. Use os dados abaixo para entrar:</p>` +
    `<p><b>Link:</b> <a href="${appUrl}">${appUrl}</a><br>` +
    `<b>E-mail:</b> ${to}<br>` +
    `<b>Chave de acesso:</b> <code style="font-size:16px">${accessKey}</code></p>` +
    `<p>Guarde esta chave. Em caso de dúvida, fale com o suporte.</p>` +
    `<p>Contabiliza</p>`;

  if (!mailConfigured()) {
    console.log('[email] envio não configurado — chave NÃO enviada por e-mail.');
    console.log(`[email] Destinatário: ${to} | Chave: ${accessKey}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    return await sendMail({ to, subject, text, html });
  } catch (err) {
    console.error('[email] falha no envio da chave:', err.message);
    return { sent: false, reason: err.message };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendContactEmail({ name, email, subject, message }) {
  const to = process.env.CONTACT_EMAIL || process.env.SMTP_USER || 'contabiliza.simulador@gmail.com';
  const safeName = String(name || '').trim();
  const safeEmail = String(email || '').trim();
  const safeSubject = String(subject || 'Contato pelo simulador').trim();
  const safeMessage = String(message || '').trim();
  const mailSubject = '[Contato simulador] ' + safeSubject;
  const text =
    `Nova mensagem pelo formulário Fale conosco.\n\n` +
    `Nome: ${safeName}\n` +
    `E-mail: ${safeEmail}\n` +
    `Assunto: ${safeSubject}\n\n` +
    `${safeMessage}\n`;
  const html =
    `<p>Nova mensagem pelo formulário <b>Fale conosco</b>.</p>` +
    `<p><b>Nome:</b> ${escapeHtml(safeName)}<br>` +
    `<b>E-mail:</b> ${escapeHtml(safeEmail)}<br>` +
    `<b>Assunto:</b> ${escapeHtml(safeSubject)}</p>` +
    `<p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>`;

  if (!mailConfigured()) {
    console.log('[email] envio não configurado — contato NÃO enviado.');
    console.log(`[email] De: ${safeEmail} | Assunto: ${safeSubject}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    return await sendMail({
      to,
      subject: mailSubject,
      text,
      html,
      replyTo: safeEmail
    });
  } catch (err) {
    console.error('[email] falha no contato:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = {
  smtpConfigured,
  mailConfigured,
  mailProvider,
  webhookConfigured,
  postToRelay,
  sendAccessEmail,
  sendContactEmail
};
