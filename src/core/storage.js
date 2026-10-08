const VAULT_KEY = 'moneylens.local-vault.v1';
const LEGACY_DEMO_KEY = 'moneylens.demo.v1';
const KDF_ITERATIONS = 310_000;

// A 6-digit PIN is a deliberately simple unlock code, not a strong secret: it has only
// 1,000,000 possible values, so anyone who obtains the stored vault envelope could guess
// it offline. Keep evaluation data fictional or redacted (see README).
export const PIN_LENGTH = 6;

export function isValidPin(value) {
  // The PIN comes from a text field, so require a string: a number or other type is a bug,
  // not a valid unlock code.
  return typeof value === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(value);
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let pendingSave = Promise.resolve();

export const DEFAULT_SETTINGS = {
  monitoringPaused: false,
  excludedSources: [],
};

export function createInitialState(now = new Date()) {
  return {
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    chatMessages: [],
    lastSavedAt: now.toISOString(),
  };
}

function ensureSecureCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Secure browser encryption is unavailable. Open MoneyLens over HTTPS or a supported local secure origin.');
  }
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function readEnvelope() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const envelope = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
    if (envelope?.version === 1 && envelope.email && envelope.salt && envelope.iv && envelope.ciphertext) return envelope;
  } catch {
    // A damaged local vault should show an explicit recovery/reset flow, not seed fake data.
  }
  return null;
}

function writeEnvelope(envelope) {
  if (typeof localStorage === 'undefined') throw new Error('This browser does not provide local storage.');
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
}

async function deriveVaultKey(password, salt) {
  ensureSecureCrypto();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptState(state, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ ...state, lastSavedAt: new Date().toISOString() }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function decryptState(envelope, key) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.ciphertext),
  );
  const parsed = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(parsed.events) || !parsed.settings || !Array.isArray(parsed.chatMessages)) {
    throw new Error('The encrypted MoneyLens data is incomplete.');
  }
  return {
    ...parsed,
    settings: {
      ...DEFAULT_SETTINGS,
      ...parsed.settings,
      excludedSources: Array.isArray(parsed.settings.excludedSources) ? parsed.settings.excludedSources : [],
    },
  };
}

export function getStoredAccount() {
  if (typeof localStorage === 'undefined') return null;
  // Remove the earlier plaintext, fictional prototype dataset. It is never migrated
  // into the private vault because its sample rows cannot be safely distinguished.
  localStorage.removeItem(LEGACY_DEMO_KEY);
  const envelope = readEnvelope();
  return envelope ? { email: envelope.email, createdAt: envelope.createdAt } : null;
}

export async function createLocalAccount(email, pin) {
  const cleanEmail = normalizedEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (!isValidPin(pin)) throw new Error(`Choose a ${PIN_LENGTH}-digit PIN using numbers only.`);
  if (readEnvelope()) throw new Error('A local vault already exists in this browser. Sign in or delete it first.');
  ensureSecureCrypto();

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveVaultKey(pin, salt);
  const state = createInitialState();
  const encrypted = await encryptState(state, key);
  writeEnvelope({
    version: 1,
    email: cleanEmail,
    salt: toBase64(salt),
    ...encrypted,
    kdfIterations: KDF_ITERATIONS,
    createdAt: new Date().toISOString(),
  });
  return { account: { email: cleanEmail }, key, state };
}

export async function unlockLocalAccount(email, pin) {
  const envelope = readEnvelope();
  if (!envelope) throw new Error('No local MoneyLens vault was found in this browser. Create a local account first.');
  if (normalizedEmail(email) !== envelope.email) throw new Error('That email does not match the local account on this browser.');
  if (!isValidPin(pin)) throw new Error(`Enter your ${PIN_LENGTH}-digit PIN using numbers only.`);
  try {
    const key = await deriveVaultKey(pin, fromBase64(envelope.salt));
    const state = await decryptState(envelope, key);
    return { account: { email: envelope.email }, key, state };
  } catch {
    throw new Error(`Could not unlock the vault. Check your ${PIN_LENGTH}-digit PIN; MoneyLens cannot recover a forgotten PIN.`);
  }
}

export function saveEncryptedState(state, key) {
  const operation = pendingSave.catch(() => false).then(async () => {
    const envelope = readEnvelope();
    if (!envelope || !key) return false;
    try {
      const encrypted = await encryptState(state, key);
      writeEnvelope({ ...envelope, ...encrypted });
      return true;
    } catch {
      return false;
    }
  });
  pendingSave = operation;
  return operation;
}

export async function clearLocalVault() {
  await pendingSave.catch(() => false);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(VAULT_KEY);
}

export function downloadJson(events, settings) {
  const payload = {
    exportedAt: new Date().toISOString(),
    note: 'MoneyLens local-vault export. This file is unencrypted after download; store it safely.',
    events,
    settings,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `moneylens-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
