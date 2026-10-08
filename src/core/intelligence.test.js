import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMessage,
  applyReviewCorrection,
  calculateMonthlyTotals,
  calculateSnapshot,
  detectDate,
  formatZar,
  parseMoneyValues,
  projectMonthlyFlow,
} from './intelligence.js';
import { makeAssistantReply } from './assistant.js';

const now = new Date(2026, 8, 29, 12, 0, 0);

const confirmed = (id, { amount, flow = 'out', month = '2026-09', day = '10', category = 'Other', state = 'posted', kind = 'expense', dueDate = null } = {}) => ({
  id,
  title: `${category} capture`,
  merchant: `${id} merchant`,
  source: 'SMS',
  sourceText: `Captured ${id}`,
  amount,
  flow,
  state,
  kind,
  category,
  inboxState: 'reviewed',
  date: '2026-09-29',
  transactionDate: state === 'posted' ? `${month}-${day}` : null,
  dueDate,
});

test('parses Rand formats without silently changing decimal/grouping values', () => {
  assert.deepEqual(parseMoneyValues('R12,500 salary; R1 299.50 debit; ZAR 89'), [12500, 1299.5, 89]);
  assert.deepEqual(parseMoneyValues('A small fee of R1,50'), [1.5]);
  assert.deepEqual(parseMoneyValues('R12.500,00 and R1.200'), [12500, 1200]);
  assert.equal(formatZar(12500), 'R12 500');
});

test('uses explicit or relative dates only where wording supports a date', () => {
  assert.equal(detectDate('Electricity is due Friday', now), '2026-10-02');
  assert.equal(detectDate('Pay by 30 September', now), '2026-09-30');
  assert.equal(detectDate('Subscription renews tomorrow', now), '2026-09-30');
  assert.equal(detectDate('Premium changes sometime next month', now), null);
  assert.equal(detectDate('Rent is due on the 1st day of next month', now), '2026-10-01');
});

test('new captures remain unconfirmed and do not invent a transaction date', () => {
  const result = analyzeMessage('FNB: R12,500 salary received.', 'Bank notification', { now });
  assert.equal(result.kind, 'income');
  assert.equal(result.flow, 'in');
  assert.equal(result.amount, 12500);
  assert.equal(result.category, 'Income');
  assert.equal(result.confidenceLabel, 'High');
  assert.equal(result.inboxState, 'open');
  assert.equal(result.transactionDate, null);
  assert.equal(result.date, '2026-09-29');
});

test('does not choose an amount from a multi-amount message without an explicit old-to-new pattern', () => {
  const result = analyzeMessage('FNB salary R12,500 received. Your available balance is R8,000.', 'Bank notification', { now });
  assert.equal(result.kind, 'income');
  assert.equal(result.amount, null);
  assert.ok(result.flags.includes('Multiple amounts — check message'));
  assert.ok(result.explanation.some((line) => line.includes('No amount was chosen automatically')));
});

test('extracts an upcoming bill clue but leaves vague next-month timing undated', () => {
  const bill = analyzeMessage('Electricity payment of R650 required by Friday.', 'SMS', { now });
  assert.equal(bill.kind, 'bill');
  assert.equal(bill.category, 'Utilities');
  assert.equal(bill.amount, 650);
  assert.equal(bill.state, 'upcoming');
  assert.equal(bill.dueDate, '2026-10-02');
  assert.equal(bill.inboxState, 'open');

  const vague = analyzeMessage('Your electricity bill of R650 is due next month.', 'SMS', { now });
  assert.equal(vague.state, 'upcoming');
  assert.equal(vague.dueDate, null);
});

test('does not assume a recurring frequency unless the message states one', () => {
  const unspecified = analyzeMessage('Netflix renewal is due tomorrow for R159.', 'Email', { now });
  assert.equal(unspecified.kind, 'subscription');
  assert.equal(unspecified.recurring, null);
  const monthly = analyzeMessage('Netflix monthly renewal is due tomorrow for R159.', 'Email', { now });
  assert.equal(monthly.recurring, 'monthly');
  const yearly = analyzeMessage('Insurance premium changes to R1,500 per year.', 'Email', { now });
  assert.equal(yearly.recurring, 'yearly');
});

test('compares a clearly stated insurance increase with a matching confirmed payment', () => {
  const result = analyzeMessage('Discovery insurance premium increases from R650 to R730 per month next month.', 'Email', {
    now,
    existingEvents: [{ ...confirmed('discovery-old', { amount: 650, category: 'Insurance', month: '2026-08', day: '01', state: 'posted' }), merchant: 'Discovery' }],
  });
  assert.equal(result.kind, 'premium_increase');
  assert.equal(result.amount, 730);
  assert.equal(result.previousAmount, 650);
  assert.equal(result.delta, 80);
  assert.equal(result.dueDate, null);
  assert.equal(result.inboxState, 'open');
});

test('does not compare a premium change with another insurer', () => {
  const result = analyzeMessage('Discovery insurance premium increases to R730 next month.', 'Email', {
    now,
    existingEvents: [{ ...confirmed('sanlam-old', { amount: 650, category: 'Insurance', month: '2026-08', day: '01', state: 'posted' }), merchant: 'Sanlam' }],
  });
  assert.equal(result.previousAmount, null);
  assert.equal(result.delta, null);
});

test('flags suspicious wording and extracts a link domain without opening or validating it', () => {
  const result = analyzeMessage('Your account will be blocked. Verify your account now at https://secure-example.co.za/login', 'SMS', { now });
  assert.equal(result.kind, 'scam');
  assert.equal(result.category, 'Safety');
  assert.equal(result.linkDomain, 'secure-example.co.za');
  assert.equal(result.flow, 'none');
  assert.equal(result.inboxState, 'open');
  const bareDomain = analyzeMessage('Share your OTP at www.verify-fnb.co.za', 'SMS', { now });
  assert.equal(bareDomain.kind, 'scam');
  assert.equal(bareDomain.linkDomain, 'verify-fnb.co.za');
});

test('ignores social noise, flags exact duplicate text, and leaves unclear financial text for review', () => {
  const ignored = analyzeMessage('Thabo liked your WhatsApp message.', 'WhatsApp', { now });
  assert.equal(ignored.ignored, true);

  const first = analyzeMessage('R500 transfer reference 0200', 'SMS', { now });
  assert.equal(first.kind, 'unknown');
  assert.equal(first.confidenceLabel, 'Low');
  assert.equal(first.inboxState, 'open');
  assert.deepEqual(analyzeMessage(first.sourceText, 'SMS', { now, existingEvents: [first] }), {
    duplicate: true,
    reason: 'This exact message is already in your saved records.',
    event: first,
  });

  const corrected = applyReviewCorrection(first, {
    category: 'Transport',
    amount: 500,
    classification: 'expense',
    transactionDate: '2026-09-18',
  });
  assert.equal(corrected.kind, 'expense');
  assert.equal(corrected.flow, 'out');
  assert.equal(corrected.state, 'posted');
  assert.equal(corrected.category, 'Transport');
  assert.equal(corrected.amount, 500);
  assert.equal(corrected.transactionDate, '2026-09-18');
  assert.equal(corrected.inboxState, 'reviewed');
  assert.deepEqual(corrected.flags, []);
});

test('month totals include only reviewed posted records with valid transaction dates and amounts', () => {
  const events = [
    confirmed('income', { amount: 12500, flow: 'in', category: 'Income', kind: 'income', day: '01' }),
    confirmed('spend', { amount: 500, category: 'Transport', day: '12' }),
    { ...confirmed('open', { amount: 9999, day: '15' }), inboxState: 'open' },
    { ...confirmed('missing-date', { amount: 700, day: '16' }), transactionDate: null },
    { ...confirmed('invalid-date', { amount: 800, day: '17' }), transactionDate: '2026-09-31' },
    { ...confirmed('missing-amount', { amount: null, day: '18' }) },
    confirmed('upcoming', { amount: 1000, state: 'upcoming', kind: 'bill', dueDate: '2026-10-02' }),
    { ...confirmed('unpriced-upcoming', { amount: null, state: 'upcoming', kind: 'bill' }), dueDate: null },
  ];
  const months = calculateMonthlyTotals(events);
  assert.equal(months.length, 1);
  assert.equal(months[0].income, 12500);
  assert.equal(months[0].spent, 500);
  assert.equal(months[0].netFlow, 12000);
  assert.equal(months[0].events.length, 2);

  const snapshot = calculateSnapshot(events, now);
  assert.equal(snapshot.income, 12500);
  assert.equal(snapshot.spent, 500);
  assert.equal(snapshot.upcomingTotal, 1000);
  assert.equal(snapshot.upcomingCount, 2);
  assert.equal(snapshot.pricedUpcomingCount, 1);
  assert.equal(snapshot.unpricedUpcomingCount, 1);
  assert.equal(snapshot.attentionCount, 1);
  assert.equal(snapshot.eventsThisMonth, 2);
  assert.equal(snapshot.undatedPostedCount, 2);
  assert.equal(snapshot.unpricedPostedCount, 1);
  assert.equal('available' in snapshot, false);
});

test('historical-average projection requires all three prior record months and stays separate from actuals', () => {
  const history = [
    confirmed('june-income', { amount: 3000, flow: 'in', category: 'Income', kind: 'income', month: '2026-06', day: '01' }),
    confirmed('june-spend', { amount: 1000, month: '2026-06', day: '12' }),
    confirmed('july-income', { amount: 4000, flow: 'in', category: 'Income', kind: 'income', month: '2026-07', day: '01' }),
    confirmed('july-spend', { amount: 1500, month: '2026-07', day: '12' }),
    confirmed('august-income', { amount: 5000, flow: 'in', category: 'Income', kind: 'income', month: '2026-08', day: '01' }),
    confirmed('august-spend', { amount: 2000, month: '2026-08', day: '12' }),
  ];
  const projection = projectMonthlyFlow(history, { now });
  assert.equal(projection.ready, true);
  assert.deepEqual(projection.requiredMonths, ['2026-06', '2026-07', '2026-08']);
  assert.equal(projection.average.income, 4000);
  assert.equal(projection.average.spent, 1500);
  assert.equal(projection.average.netFlow, 2500);
  assert.equal(projection.projectedMonths[0].month, '2026-10');
  assert.equal(projection.projectedMonths[0].netFlow, 2500);

  const missing = projectMonthlyFlow(history.filter((event) => !event.id.startsWith('july')), { now });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missingMonths, ['2026-07']);

  const missingFlow = projectMonthlyFlow(history.filter((event) => event.id !== 'july-income'), { now });
  assert.equal(missingFlow.ready, false);
  assert.deepEqual(missingFlow.missingMonths, []);
  assert.deepEqual(missingFlow.missingFlowsByMonth, [{ month: '2026-07', missingFlows: ['inflow'] }]);
});

test('assistant answers use exact confirmed records and return traceable source ids', () => {
  const events = [
    confirmed('september-bus', { amount: 120, category: 'Transport', day: '08' }),
    confirmed('september-food', { amount: 380, category: 'Groceries', day: '12' }),
    { ...confirmed('pending', { amount: 4000, category: 'Shopping', day: '15' }), inboxState: 'open' },
  ];
  const answer = makeAssistantReply('How much did I spend in September?', events, now);
  assert.match(answer.content, /R500/);
  assert.match(answer.content, /2 dated records/);
  assert.deepEqual(answer.sources.map((source) => source.id).sort(), ['september-bus', 'september-food']);
  assert.deepEqual(answer.sources.map((source) => [source.id, source.date]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['september-bus', '2026-09-08'],
    ['september-food', '2026-09-12'],
  ]);
});

test('a comparison naming one month uses that month and its predecessor', () => {
  const events = [
    confirmed('august', { amount: 200, category: 'Transport', month: '2026-08', day: '08' }),
    confirmed('september', { amount: 500, category: 'Transport', month: '2026-09', day: '08' }),
  ];
  const answer = makeAssistantReply('Compare September', events, new Date(2026, 9, 1));
  assert.match(answer.content, /September 2026/);
  assert.match(answer.content, /August 2026/);
  assert.deepEqual(answer.sources.map((source) => source.id).sort(), ['august', 'september']);
});

test('assistant compares a requested category only when both selected months have records', () => {
  const events = [
    confirmed('aug-transport', { amount: 200, category: 'Transport', month: '2026-08', day: '08' }),
    confirmed('sep-transport', { amount: 500, category: 'Transport', month: '2026-09', day: '08' }),
  ];
  const answer = makeAssistantReply('Compare transport spending in August and September', events, now);
  assert.match(answer.content, /R200/);
  assert.match(answer.content, /R500/);
  assert.match(answer.content, /R300/);
  assert.deepEqual(answer.sources.map((source) => source.id).sort(), ['aug-transport', 'sep-transport']);
});

test('assistant does not invent a zero total for upcoming items without amounts', () => {
  const events = [confirmed('unknown-upcoming', { amount: null, state: 'upcoming', kind: 'bill', dueDate: null })];
  const answer = makeAssistantReply('What confirmed payments are upcoming?', events, now);
  assert.match(answer.content, /No amount-confirmed records are available to sum/);
  assert.doesNotMatch(answer.content, /R0/);
  assert.equal(answer.sources[0].id, 'unknown-upcoming');
});
