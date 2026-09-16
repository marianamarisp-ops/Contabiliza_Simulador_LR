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

module.exports = {
  smtpConfigured,
  sendAccessEmail
};
