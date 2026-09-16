'use strict';

const nodemailer = require('nodemailer');

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT || '587') === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendAccessEmail({ to, name, accessKey }) {
  const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();

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

  if (!transporter) {
    console.log('[email] SMTP não configurado — chave NÃO enviada por e-mail.');
    console.log(`[email] Destinatário: ${to} | Chave: ${accessKey}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }

  await transporter.sendMail({ from, to, subject, text, html });
  return { sent: true };
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
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();
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

  if (!transporter) {
    console.log('[email] SMTP não configurado — contato NÃO enviado.');
    console.log(`[email] De: ${safeEmail} | Assunto: ${safeSubject}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }

  await transporter.sendMail({
    from,
    to,
    replyTo: safeEmail,
    subject: mailSubject,
    text,
    html
  });
  return { sent: true };
}

module.exports = {
  smtpConfigured,
  sendAccessEmail,
  sendContactEmail
};
