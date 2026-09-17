'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LICENSES_FILE)) {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify({ licenses: [] }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  const tmp = LICENSES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, LICENSES_FILE);
  queueRemoteSync(store.licenses);
}

let remoteSyncTimer = null;
function queueRemoteSync(licenses) {
  clearTimeout(remoteSyncTimer);
  const snapshot = Array.isArray(licenses) ? licenses.slice() : [];
  remoteSyncTimer = setTimeout(() => {
    syncLicensesRemote(snapshot).catch((err) => {
      console.error('[licenses] backup remoto falhou:', err.message);
    });
  }, 300);
}

async function syncLicensesRemote(licenses) {
  const { webhookConfigured, postToRelay } = require('./email');
  if (!webhookConfigured()) return;
  const result = await postToRelay({ action: 'saveLicenses', licenses }, 15000);
  if (!result.ok && result.reason !== 'invalid') {
    console.error('[licenses] backup remoto:', result.reason);
  }
}

function newerStamp(a, b) {
  return String((a && a.updatedAt) || (a && a.createdAt) || '') >
    String((b && b.updatedAt) || (b && b.createdAt) || '');
}

async function hydrateLicensesRemote() {
  const { webhookConfigured, postToRelay } = require('./email');
  if (!webhookConfigured()) return { ok: false, reason: 'webhook_not_configured' };
  const result = await postToRelay({ action: 'loadLicenses' }, 15000);
  if (!result.ok) {
    if (result.reason === 'invalid') return { ok: true, merged: 0 };
    return { ok: false, reason: result.reason };
  }
  const remote = (result.data && result.data.licenses) || [];
  if (!Array.isArray(remote) || !remote.length) return { ok: true, merged: 0 };
  const store = readStore();
  const byEmail = new Map(store.licenses.map((l) => [l.email, l]));
  let merged = 0;
  remote.forEach((item) => {
    if (!item || !item.email) return;
    const email = normalizeEmail(item.email);
    const current = byEmail.get(email);
    if (!current) {
      store.licenses.push(item);
      byEmail.set(email, item);
      merged += 1;
      return;
    }
    if (newerStamp(item, current)) {
      Object.assign(current, item);
      merged += 1;
    }
  });
  if (merged) {
    ensureStore();
    const tmp = LICENSES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, LICENSES_FILE);
  }
  return { ok: true, merged };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateAccessKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CONT-${part()}-${part()}-${part()}`;
}

const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LEN = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuf);
}

function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LEN) {
    return { ok: false, error: `A senha deve ter pelo menos ${MIN_PASSWORD_LEN} caracteres.` };
  }
  if (value.length > 128) {
    return { ok: false, error: 'A senha é longa demais.' };
  }
  return { ok: true };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hasPassword(license) {
  return Boolean(license && license.passwordHash);
}

function findByEmail(email) {
  const store = readStore();
  const normalized = normalizeEmail(email);
  return store.licenses.find((l) => l.email === normalized) || null;
}

function findByOrderId(orderId) {
  if (!orderId) return null;
  const store = readStore();
  return store.licenses.find((l) => l.orderId === orderId) || null;
}

/**
 * Cria ou reativa licença para o e-mail da compra.
 * Se já existir ativa para o mesmo pedido, devolve a existente (idempotente).
 */
function grantLicense({ email, name, orderId, productId, productName, phone }) {
  const store = readStore();
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('E-mail do cliente ausente no webhook');

  const existingByOrder = orderId
    ? store.licenses.find((l) => l.orderId === orderId)
    : null;
  if (existingByOrder) {
    existingByOrder.status = 'active';
    existingByOrder.revokedAt = null;
    existingByOrder.updatedAt = new Date().toISOString();
    writeStore(store);
    return { license: existingByOrder, created: false, reused: true };
  }

  const existingByEmail = store.licenses.find((l) => l.email === normalized);
  if (existingByEmail) {
    const wasRevoked = existingByEmail.status !== 'active';
    const orderChanged = Boolean(orderId && existingByEmail.orderId !== orderId);
    existingByEmail.status = 'active';
    existingByEmail.name = name || existingByEmail.name;
    existingByEmail.phone = phone || existingByEmail.phone;
    if (wasRevoked || orderChanged) existingByEmail.emailSentAt = null;
    existingByEmail.orderId = orderId || existingByEmail.orderId;
    existingByEmail.productId = productId || existingByEmail.productId;
    existingByEmail.productName = productName || existingByEmail.productName;
    existingByEmail.revokedAt = null;
    existingByEmail.updatedAt = new Date().toISOString();
    writeStore(store);
    return { license: existingByEmail, created: false, reused: false };
  }

  const license = {
    id: crypto.randomUUID(),
    email: normalized,
    name: name || '',
    phone: phone || '',
    accessKey: generateAccessKey(),
    passwordHash: null,
    passwordSetAt: null,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    status: 'active',
    emailSentAt: null,
    orderId: orderId || null,
    productId: productId || null,
    productName: productName || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revokedAt: null
  };
  store.licenses.push(license);
  writeStore(store);
  return { license, created: true, reused: false };
}

function revokeByOrderId(orderId, reason) {
  const store = readStore();
  const license = store.licenses.find((l) => l.orderId === orderId);
  if (!license) return null;
  license.status = 'revoked';
  license.revokeReason = reason || 'revoked';
  license.revokedAt = new Date().toISOString();
  license.updatedAt = license.revokedAt;
  writeStore(store);
  return license;
}

function revokeByEmail(email, reason) {
  const store = readStore();
  const license = store.licenses.find((l) => l.email === normalizeEmail(email));
  if (!license) return null;
  license.status = 'revoked';
  license.revokeReason = reason || 'revoked';
  license.revokedAt = new Date().toISOString();
  license.updatedAt = license.revokedAt;
  writeStore(store);
  return license;
}

function authenticate(email, credential) {
  const license = findByEmail(email);
  if (!license) return { ok: false, error: 'E-mail ou credencial inválidos.' };
  if (license.status !== 'active') {
    return { ok: false, error: 'Acesso revogado ou inativo. Se acabou de pagar, aguarde alguns minutos ou fale com o suporte.' };
  }

  const cred = String(credential || '').trim();
  if (!cred) return { ok: false, error: 'Informe a chave de acesso ou a senha.' };

  const keyMatch = cred.toUpperCase() === String(license.accessKey || '').toUpperCase();
  const passMatch = hasPassword(license) && verifyPassword(cred, license.passwordHash);

  if (!hasPassword(license)) {
    if (!keyMatch) {
      return {
        ok: false,
        error: 'No primeiro acesso, use a chave enviada após o pagamento. Depois você cadastra sua senha.'
      };
    }
    return { ok: true, license, needsPasswordSetup: true };
  }

  if (passMatch) {
    return { ok: true, license, needsPasswordSetup: false };
  }

  if (keyMatch) {
    return {
      ok: false,
      error: 'Você já cadastrou uma senha. Entre com e-mail e senha, ou use “Esqueci minha senha”.'
    };
  }

  return { ok: false, error: 'E-mail ou senha inválidos.' };
}

function setPasswordForLicense(email, password) {
  const strength = validatePasswordStrength(password);
  if (!strength.ok) return strength;

  const store = readStore();
  const license = store.licenses.find((l) => l.email === normalizeEmail(email));
  if (!license) return { ok: false, error: 'Licença não encontrada.' };
  if (license.status !== 'active') {
    return { ok: false, error: 'Acesso revogado ou inativo.' };
  }

  license.passwordHash = hashPassword(password);
  license.passwordSetAt = new Date().toISOString();
  license.resetTokenHash = null;
  license.resetTokenExpiresAt = null;
  license.updatedAt = license.passwordSetAt;
  writeStore(store);
  return { ok: true, license };
}

function createPasswordReset(email) {
  const store = readStore();
  const license = store.licenses.find((l) => l.email === normalizeEmail(email));
  if (!license || license.status !== 'active') {
    return { ok: true, sent: false, reason: 'not_found' };
  }
  if (!hasPassword(license)) {
    return { ok: true, sent: false, reason: 'no_password', license };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  license.resetTokenHash = hashToken(token);
  license.resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  license.updatedAt = new Date().toISOString();
  writeStore(store);
  return { ok: true, sent: true, token, license };
}

function resetPasswordWithToken(token, password) {
  const strength = validatePasswordStrength(password);
  if (!strength.ok) return strength;

  const tokenHash = hashToken(token);
  const store = readStore();
  const license = store.licenses.find((l) => l.resetTokenHash && l.resetTokenHash === tokenHash);
  if (!license) return { ok: false, error: 'Link de redefinição inválido ou já utilizado.' };
  if (license.status !== 'active') {
    return { ok: false, error: 'Acesso revogado ou inativo.' };
  }
  if (!license.resetTokenExpiresAt || new Date(license.resetTokenExpiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'Link de redefinição expirado. Solicite um novo.' };
  }

  license.passwordHash = hashPassword(password);
  license.passwordSetAt = new Date().toISOString();
  license.resetTokenHash = null;
  license.resetTokenExpiresAt = null;
  license.updatedAt = license.passwordSetAt;
  writeStore(store);
  return { ok: true, license };
}

function markEmailSent(email, sent) {
  const store = readStore();
  const license = store.licenses.find((l) => l.email === normalizeEmail(email));
  if (!license) return null;
  license.emailSentAt = sent ? new Date().toISOString() : null;
  license.updatedAt = new Date().toISOString();
  writeStore(store);
  return license;
}

function needsAccessEmail(license) {
  return Boolean(license && !license.emailSentAt);
}

function listLicenses() {
  return readStore().licenses.slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((l) => ({
      id: l.id,
      email: l.email,
      name: l.name,
      phone: l.phone,
      accessKey: l.accessKey,
      hasPassword: hasPassword(l),
      passwordSetAt: l.passwordSetAt || null,
      status: l.status,
      emailSentAt: l.emailSentAt,
      orderId: l.orderId,
      productId: l.productId,
      productName: l.productName,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      revokedAt: l.revokedAt,
      revokeReason: l.revokeReason
    }));
}

function createManualLicense({ email, name }) {
  return grantLicense({
    email,
    name: name || '',
    orderId: 'manual-' + crypto.randomUUID(),
    productId: null,
    productName: 'Liberação manual',
    phone: ''
  });
}

module.exports = {
  normalizeEmail,
  grantLicense,
  revokeByOrderId,
  revokeByEmail,
  authenticate,
  setPasswordForLicense,
  createPasswordReset,
  resetPasswordWithToken,
  hasPassword,
  validatePasswordStrength,
  MIN_PASSWORD_LEN,
  listLicenses,
  createManualLicense,
  findByEmail,
  findByOrderId,
  markEmailSent,
  needsAccessEmail,
  hydrateLicensesRemote
};
