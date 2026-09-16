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
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateAccessKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CONT-${part()}-${part()}-${part()}`;
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
    existingByEmail.status = 'active';
    existingByEmail.name = name || existingByEmail.name;
    existingByEmail.phone = phone || existingByEmail.phone;
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
    status: 'active',
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

function authenticate(email, accessKey) {
  const license = findByEmail(email);
  if (!license) return { ok: false, error: 'E-mail ou chave inválidos.' };
  if (license.status !== 'active') {
    return { ok: false, error: 'Acesso revogado ou inativo. Se acabou de pagar, aguarde alguns minutos ou fale com o suporte.' };
  }
  if (String(accessKey || '').trim().toUpperCase() !== license.accessKey) {
    return { ok: false, error: 'E-mail ou chave inválidos.' };
  }
  return { ok: true, license };
}

function listLicenses() {
  return readStore().licenses.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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
  listLicenses,
  createManualLicense,
  findByEmail,
  findByOrderId
};
