'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { authenticate, listLicenses, createManualLicense, revokeByEmail } = require('./licenses');
const { createSessionToken, requireAuth, requireAdmin, verifySessionToken } = require('./auth');
const { handleCaktoWebhook } = require('./webhook');
const { sendAccessEmail, sendContactEmail, smtpConfigured } = require('./email');

const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_MAX = 3;
const contactHits = new Map();
const CONTACT_SUBJECTS = [
  'Chave de acesso não recebida',
  'Dúvida sobre o acesso',
  'Outro assunto'
];

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function tooManyContact(ip) {
  const now = Date.now();
  const list = (contactHits.get(ip) || []).filter((t) => now - t < CONTACT_WINDOW_MS);
  if (list.length >= CONTACT_MAX) {
    contactHits.set(ip, list);
    return true;
  }
  list.push(now);
  contactHits.set(ip, list);
  return false;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

const app = express();
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    smtp: smtpConfigured(),
    publicUrl: process.env.PUBLIC_APP_URL || null
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = req.body && req.body.email;
  const accessKey = req.body && req.body.accessKey;
  const result = authenticate(email, accessKey);
  if (!result.ok) {
    return res.status(401).json({ ok: false, error: result.error });
  }
  const token = createSessionToken(result.license);
  res.json({
    ok: true,
    token,
    user: {
      email: result.license.email,
      name: result.license.name || ''
    }
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: { email: req.user.email, name: req.user.name || '' } });
});

app.post('/api/contact', async (req, res) => {
  const body = req.body || {};
  if (String(body.website || '').trim()) {
    return res.json({ ok: true });
  }
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ ok: false, error: 'Informe um nome válido.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
  }
  if (!CONTACT_SUBJECTS.includes(subject)) {
    return res.status(400).json({ ok: false, error: 'Selecione um assunto.' });
  }
  if (message.length < 10 || message.length > 2000) {
    return res.status(400).json({ ok: false, error: 'A mensagem precisa ter entre 10 e 2000 caracteres.' });
  }
  if (tooManyContact(clientIp(req))) {
    return res.status(429).json({ ok: false, error: 'Aguarde alguns minutos antes de enviar outra mensagem.' });
  }
  try {
    const mail = await sendContactEmail({ name, email, subject, message });
    if (!mail.sent) {
      return res.status(503).json({
        ok: false,
        error: 'O envio de e-mail está indisponível no momento. Tente novamente em instantes.'
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[contact]', err);
    res.status(500).json({ ok: false, error: 'Não foi possível enviar a mensagem. Tente novamente.' });
  }
});

app.post('/webhook/cakto', async (req, res) => {
  try {
    const result = await handleCaktoWebhook(req.body);
    res.status(result.status).json(result.payload);
  } catch (err) {
    console.error('[webhook]', err);
    res.status(500).json({ ok: false, error: 'Erro ao processar webhook.' });
  }
});

app.get('/api/admin/licenses', requireAdmin, (_req, res) => {
  res.json({ ok: true, licenses: listLicenses() });
});

app.post('/api/admin/licenses', requireAdmin, async (req, res) => {
  try {
    const email = req.body && req.body.email;
    const name = (req.body && req.body.name) || '';
    if (!email) return res.status(400).json({ ok: false, error: 'Informe o e-mail.' });
    const { license, created } = createManualLicense({ email, name });
    let emailSent = false;
    try {
      const mail = await sendAccessEmail({
        to: license.email,
        name: license.name,
        accessKey: license.accessKey
      });
      emailSent = Boolean(mail.sent);
    } catch (err) {
      console.error('[admin] e-mail:', err.message);
    }
    res.json({ ok: true, created, license, emailSent });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/revoke', requireAdmin, (req, res) => {
  const email = req.body && req.body.email;
  if (!email) return res.status(400).json({ ok: false, error: 'Informe o e-mail.' });
  const revoked = revokeByEmail(email, 'manual');
  if (!revoked) return res.status(404).json({ ok: false, error: 'Licença não encontrada.' });
  res.json({ ok: true, license: revoked });
});

app.post('/api/admin/resend', requireAdmin, async (req, res) => {
  const email = req.body && req.body.email;
  const licenses = listLicenses();
  const license = licenses.find((l) => l.email === String(email || '').trim().toLowerCase());
  if (!license) return res.status(404).json({ ok: false, error: 'Licença não encontrada.' });
  if (license.status !== 'active') {
    return res.status(400).json({ ok: false, error: 'Licença inativa.' });
  }
  try {
    const mail = await sendAccessEmail({
      to: license.email,
      name: license.name,
      accessKey: license.accessKey
    });
    res.json({ ok: true, emailSent: Boolean(mail.sent), reason: mail.reason || null, accessKey: license.accessKey });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Protege o HTML do simulador: sem token válido, redireciona para login
app.get(['/', '/index.html'], (req, res, next) => {
  const token = req.query.token || '';
  if (token && verifySessionToken(token)) return next();
  // Frontend faz o gate; aqui só servimos os arquivos.
  // Mantemos next() e o gate JS bloqueia a UI.
  next();
});

app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Contabiliza rodando em http://localhost:${PORT}`);
  console.log(`Webhook Cakto: POST http://localhost:${PORT}/webhook/cakto`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  if (!process.env.CAKTO_WEBHOOK_SECRET) console.warn('AVISO: CAKTO_WEBHOOK_SECRET não definido');
  if (!process.env.ADMIN_TOKEN) console.warn('AVISO: ADMIN_TOKEN não definido');
  if (!process.env.SESSION_SECRET) console.warn('AVISO: SESSION_SECRET não definido');
});
