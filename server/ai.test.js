import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnswer, sanitizeRecords } from './ai.js';

test('cloud LLM request sends minimized reviewed-record fields and validates cited IDs', async () => {
  let request;
  const result = await getAnswer({
    question: 'How much did I spend?',
    records: [{
      id: 'event-1', merchant: 'Market', transactionDate: '2026-09-01', amount: 125.5,
      flow: 'out', category: 'Groceries', kind: 'expense', sourceText: 'private SMS text with account data',
    }],
  }, {
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: 'Captured spending is R125.50.', sourceIds: ['event-1', 'invented-id'] }) } }] }),
      };
    },
  });

  assert.equal(result.answer, 'Captured spending is R125.50.');
  assert.deepEqual(result.sourceIds, ['event-1']);
  assert.equal(result.model, 'test-model');
  const sent = JSON.stringify(request);
  assert.match(sent, /event-1/);
  assert.doesNotMatch(sent, /private SMS text|account data|sourceText/);
  assert.equal(request.messages[0].role, 'system');
});

test('cloud LLM sanitization rejects unsupported fields and caps context', () => {
  const records = Array.from({ length: 105 }, (_, index) => ({
    id: `id-${index}`, merchant: '  Shop\nName ', amount: '12.5', flow: 'sideways',
    category: 'Groceries', kind: 'made-up-kind', private: 'drop-me',
  }));
  const safe = sanitizeRecords(records);
  assert.equal(safe.length, 100);
  assert.deepEqual(safe[0], {
    id: 'id-0', merchant: 'Shop Name', date: '', amount: 12.5,
    flow: 'unknown', category: 'Groceries', kind: 'unknown',
  });
  assert.equal(Object.hasOwn(safe[0], 'private'), false);
});

test('cloud LLM is disabled without a server key', async () => {
  await assert.rejects(
    getAnswer({ question: 'hello', records: [] }, { apiKey: '' }),
    /Set OPENAI_API_KEY on the server/,
  );
});
