'use strict';

const crypto = require('crypto');

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET deve ter pelo menos 16 caracteres no .env');
  }
  return secret;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function createSessionToken(license, ttlSeconds) {
  const ttl = ttlSeconds || 60 * 60 * 24 * 30; // 30 dias
  const payload = {
    sub: license.id,
    email: license.email,
    name: license.name || '',
    exp: Math.floor(Date.now() / 1000) + ttl
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Sessão inválida ou expirada.' });
  }
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  const admin = process.env.ADMIN_TOKEN;
  if (!admin) {
    return res.status(500).json({ ok: false, error: 'ADMIN_TOKEN não configurado.' });
  }
  const header = req.headers['x-admin-token'] || '';
  const q = req.query.token || '';
  if (header !== admin && q !== admin) {
    return res.status(401).json({ ok: false, error: 'Token admin inválido.' });
  }
  next();
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  requireAuth,
  requireAdmin
};
