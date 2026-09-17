'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { authenticate, listLicenses, createManualLicense, revokeByEmail, hydrateLicensesRemote, markEmailSent, setPasswordForLicense, createPasswordReset, resetPasswordWithToken, findByEmail, hasPassword } = require('./licenses');
const { createSessionToken, createSetupToken, requireAuth, requireAdmin, verifySessionToken, verifySetupToken } = require('./auth');
const { handleCaktoWebhook } = require('./webhook');
const { sendAccessEmail, sendContactEmail, sendPasswordResetEmail, sendNoPasswordHintEmail, smtpConfigured, mailConfigured, mailProvider } = require('./email');

const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_MAX = 3;
const contactHits = new Map();
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX = 3;
const resetHits = new Map();
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

function tooManyHits(map, key, windowMs, max) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    map.set(key, list);
    return true;
  }
  list.push(now);
  map.set(key, list);
  return false;
}

function tooManyContact(ip) {
  return tooManyHits(contactHits, ip, CONTACT_WINDOW_MS, CONTACT_MAX);
}

function tooManyReset(ip) {
  return tooManyHits(resetHits, ip, RESET_WINDOW_MS, RESET_MAX);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

const app = express();
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    smtp: smtpConfigured(),
    email: mailConfigured(),
    emailProvider: mailProvider(),
    publicUrl: process.env.PUBLIC_APP_URL || null
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = req.body && req.body.email;
  const credential = (req.body && (req.body.password || req.body.accessKey || req.body.credential)) || '';
  const result = authenticate(email, credential);
  if (!result.ok) {
    return res.status(401).json({ ok: false, error: result.error });
  }

  if (result.needsPasswordSetup) {
    const setupToken = createSetupToken(result.license);
    return res.json({
      ok: true,
      needsPasswordSetup: true,
      setupToken,
      user: {
        email: result.license.email,
        name: result.license.name || ''
      }
    });
  }

  const token = createSessionToken(result.license);
  res.json({
    ok: true,
    needsPasswordSetup: false,
    hasPassword: true,
    token,
    user: {
      email: result.license.email,
      name: result.license.name || ''
    }
  });
});

app.post('/api/auth/set-password', (req, res) => {
  const setupToken = req.body && req.body.setupToken;
  const password = req.body && req.body.password;
  const confirm = req.body && req.body.confirmPassword;
  const payload = verifySetupToken(setupToken);
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Sessão de cadastro expirada. Entre de novo com a chave de ativação.' });
  }
  if (String(password || '') !== String(confirm || '')) {
    return res.status(400).json({ ok: false, error: 'A confirmação da senha não confere.' });
  }
  const current = findByEmail(payload.email);
  if (!current || current.status !== 'active' || current.id !== payload.sub) {
    return res.status(401).json({ ok: false, error: 'Licença inválida para cadastro de senha.' });
  }
  if (hasPassword(current)) {
    return res.status(400).json({ ok: false, error: 'Senha já cadastrada. Entre com e-mail e senha.' });
  }
  const result = setPasswordForLicense(payload.email, password);
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error });
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

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
  }
  if (tooManyReset(clientIp(req) + ':' + email)) {
    return res.status(429).json({ ok: false, error: 'Aguarde alguns minutos antes de solicitar de novo.' });
  }

  const generic = {
    ok: true,
    message: 'Se este e-mail tiver acesso, você receberá orientações em instantes.'
  };

  try {
    const result = createPasswordReset(email);
    if (result.reason === 'no_password' && result.license) {
      await sendNoPasswordHintEmail({
        to: result.license.email,
        name: result.license.name
      });
      return res.json(generic);
    }
    if (result.sent && result.token && result.license) {
      const mail = await sendPasswordResetEmail({
        to: result.license.email,
        name: result.license.name,
        resetToken: result.token
      });
      if (!mail.sent) {
        console.error('[auth] reset e-mail não enviado:', mail.reason || 'unknown');
      }
    }
    return res.json(generic);
  } catch (err) {
    console.error('[auth] forgot-password:', err);
    return res.status(500).json({ ok: false, error: 'Não foi possível processar o pedido. Tente novamente.' });
  }
});

app.post('/api/auth/reset-password', (req, res) => {
  const token = req.body && req.body.token;
  const password = req.body && req.body.password;
  const confirm = req.body && req.body.confirmPassword;
  if (!token) {
    return res.status(400).json({ ok: false, error: 'Link de redefinição inválido.' });
  }
  if (String(password || '') !== String(confirm || '')) {
    return res.status(400).json({ ok: false, error: 'A confirmação da senha não confere.' });
  }
  const result = resetPasswordWithToken(token, password);
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error });
  }
  const session = createSessionToken(result.license);
  res.json({
    ok: true,
    token: session,
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
    const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
    console.log('[webhook] HTTP', req.headers['content-type'] || 'no-content-type', 'keys=', bodyKeys.join(',') || typeof req.body);
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
      if (emailSent) markEmailSent(license.email, true);
      else console.error('[admin] e-mail não enviado:', mail.reason || 'unknown');
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
    if (mail.sent) markEmailSent(license.email, true);
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
  hydrateLicensesRemote()
    .then((result) => {
      if (result && result.ok) console.log('[licenses] backup remoto sincronizado:', result.merged || 0);
      else console.warn('[licenses] backup remoto indisponível:', result && result.reason);
    })
    .catch((err) => console.warn('[licenses] backup remoto indisponível:', err.message));
});
