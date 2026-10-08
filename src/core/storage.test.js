import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalVault,
  createInitialState,
  createLocalAccount,
  getStoredAccount,
  isValidPin,
  saveEncryptedState,
  unlockLocalAccount,
} from './storage.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    raw: (key) => values.get(key),
  };
}

test('the PIN rule accepts exactly six digits and nothing else', () => {
  assert.equal(isValidPin('483920'), true);
  assert.equal(isValidPin('000000'), true);
  // too short, too long, non-numeric, spaces, mixed and non-string values
  for (const rejected of ['48392', '4839201', 'abcdef', '48392a', '483 920', '', null, undefined, 483920, '483920 ', ' 483920']) {
    assert.equal(isValidPin(rejected), false, `${String(rejected)} must be rejected`);
  }
});

test('account creation rejects a PIN that is not exactly six digits before writing a vault', async (context) => {
  const previousStorage = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  context.after(async () => {
    await clearLocalVault();
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });

  await assert.rejects(createLocalAccount('pin@example.com', '12345'), /6-digit PIN using numbers only/);
  await assert.rejects(createLocalAccount('pin@example.com', 'six digits'), /6-digit PIN using numbers only/);
  await assert.rejects(createLocalAccount('pin@example.com', '1234567'), /6-digit PIN using numbers only/);
  assert.equal(storage.raw('moneylens.local-vault.v1'), undefined, 'a rejected PIN must not create a vault');
});

test('local account encrypts captured records, unlocks with the right PIN, and rejects a wrong one', async (context) => {
  const previousStorage = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  context.after(async () => {
    await clearLocalVault();
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });

  const created = await createLocalAccount('Person@Example.com', '483920');
  assert.equal(created.account.email, 'person@example.com');
  assert.deepEqual(created.state.events, []);
  assert.deepEqual(getStoredAccount(), { email: 'person@example.com', createdAt: getStoredAccount().createdAt });

  const state = createInitialState();
  state.events.push({
    id: 'one',
    sourceText: 'Private captured message R123.45',
    amount: 123.45,
    state: 'posted',
    flow: 'out',
    transactionDate: '2026-09-30',
    inboxState: 'reviewed',
  });
  assert.equal(await saveEncryptedState(state, created.key), true);
  const raw = storage.raw('moneylens.local-vault.v1');
  assert.ok(raw);
  assert.equal(raw.includes('Private captured message'), false);
  assert.equal(raw.includes('123.45'), false);

  const unlocked = await unlockLocalAccount('person@example.com', '483920');
  assert.equal(unlocked.state.events[0].sourceText, 'Private captured message R123.45');
  assert.equal(unlocked.state.events[0].transactionDate, '2026-09-30');
  await assert.rejects(unlockLocalAccount('person@example.com', '000000'), /Could not unlock/);
  await assert.rejects(unlockLocalAccount('person@example.com', '12345'), /6-digit PIN using numbers only/);
  assert.equal((await unlockLocalAccount('person@example.com', '483920')).state.events.length, 1, 'the correct PIN still unlocks after failures');
});
