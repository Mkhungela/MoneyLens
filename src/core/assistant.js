import {
  calculateMonthlyTotals,
  formatMonth,
  formatZar,
  isConfirmedEvent,
  projectMonthlyFlow,
} from './intelligence.js';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key, offset) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return monthKey(date);
}

function findMonthKeys(question, now) {
  const input = question.toLowerCase();
  const explicit = [...input.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g)].map((match) => `${match[1]}-${match[2]}`);
  if (explicit.length) return [...new Set(explicit)].slice(0, 2);

  const monthMatches = [];
  for (const [index, name] of MONTHS.entries()) {
    const match = new RegExp(`\\b${name.slice(0, 3)}(?:${name.slice(3)})?\\b`, 'i');
    if (!match.test(input)) continue;
    const explicitYear = input.match(/\b20\d{2}\b/);
    let year = explicitYear ? Number(explicitYear[0]) : now.getFullYear();
    if (!explicitYear && index > now.getMonth()) year -= 1;
    monthMatches.push(`${year}-${String(index + 1).padStart(2, '0')}`);
  }
  if (monthMatches.length) return [...new Set(monthMatches)].slice(0, 2);
  if (/\b(last|previous|prior) month\b/.test(input)) return [shiftMonth(monthKey(now), -1)];
  return [monthKey(now)];
}

function eventSources(events) {
  const seen = new Set();
  return events.filter((event) => {
    if (!event?.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  }).map((event) => ({
    id: event.id,
    title: event.title,
    merchant: event.merchant,
    source: event.source,
    amount: event.amount,
    date: event.transactionDate || event.dueDate || event.date || null,
    kind: event.kind,
  }));
}

function recordsForMonth(month, key) {
  return month?.events.filter((event) => key == null || event.category === key) || [];
}

function monthSummary(month) {
  return `${formatMonth(month.month)}: ${formatZar(month.income)} inflow, ${formatZar(month.spent)} outflow, captured net flow ${formatZar(month.netFlow)} from ${month.events.length} confirmed, dated records`;
}

function categoryFromQuestion(input) {
  const categories = [
    ['Groceries', /grocer|grocery|food|supermarket/],
    ['Transport', /transport|petrol|fuel|taxi|uber|bolt/],
    ['Housing', /housing|rent/],
    ['Utilities', /utilities|electricity|water/],
    ['Insurance', /insurance|premium/],
    ['Subscriptions', /subscription|streaming|netflix|spotify/],
    ['Education', /education|school|tuition/],
    ['Mobile & internet', /airtime|mobile|internet|data bundle/],
    ['Debt', /debt|loan|instalment|installment/],
    ['Shopping', /shopping|retail|takealot/],
  ];
  return categories.find(([, pattern]) => pattern.test(input))?.[0] || null;
}

export function makeAssistantReply(question, events, now = new Date()) {
  const input = String(question || '').toLowerCase();
  const months = calculateMonthlyTotals(events);
  const monthKeys = findMonthKeys(input, now);
  const selectedMonth = months.find((item) => item.month === monthKeys[0]);
  const confirmed = events.filter(isConfirmedEvent);
  const result = (content, sources = []) => ({ content, sources: eventSources(sources) });
  const missingMonth = (key) => `There are no confirmed, dated transaction records for ${formatMonth(key)}. I won’t fill that gap with a guess.`;

  if (!input.trim()) return result('Ask about a month, category, captured payment, or confirmed upcoming commitment. I answer from records you reviewed; I do not have access to your bank or messages.');

  if (/\b(?:afford|can i spend|should i buy|balance|how much money.*left)\b/.test(input)) {
    const sources = selectedMonth?.events || [];
    return result('I can’t confirm affordability or your current balance: MoneyLens has no verified account balance and your captures may be incomplete. I can show exact confirmed inflow/outflow totals for a month, but that is not spendable cash.', sources);
  }

  if (/\b(?:upcoming|coming up|payments? due|bills? due|what.*due)\b/.test(input)) {
    const upcoming = confirmed.filter((event) => event.state === 'upcoming' && event.flow === 'out' && event.inboxState !== 'dismissed')
      .sort((a, b) => String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31')));
    if (!upcoming.length) return result('There are no confirmed upcoming outflows in your saved records. Unreviewed messages are not counted.');
    const withAmount = upcoming.filter((event) => event.amount != null && Number.isFinite(Number(event.amount)));
    const total = withAmount.reduce((sum, event) => sum + Number(event.amount), 0);
    const details = upcoming.map((event) => `${event.merchant}: ${event.amount == null ? 'amount not confirmed' : formatZar(event.amount)}${event.dueDate ? `, due ${event.dueDate}` : ', no due date recorded'}`).join('; ');
    const amountSummary = withAmount.length ? `Sum of records with an amount: ${formatZar(total)}` : 'No amount-confirmed records are available to sum';
    return result(`Confirmed upcoming records: ${details}. ${amountSummary}${upcoming.length !== withAmount.length ? `; ${upcoming.length - withAmount.length} record(s) have no confirmed amount and are excluded from the sum` : ''}. This is not a payment instruction.`, upcoming);
  }

  if (/\b(?:forecast|project|estimate|future|next month|coming months)\b/.test(input)) {
    const projection = projectMonthlyFlow(events, { now });
    if (!projection.ready) {
      const missing = projection.missingMonths.map((key) => formatMonth(key)).join(', ');
      const missingFlows = projection.missingFlowsByMonth.map((item) => `${formatMonth(item.month)} (${item.missingFlows.join(' and ')})`).join(', ');
      return result(`No projection is available yet. MoneyLens needs at least one confirmed, dated inflow and outflow record in each of the three completed months. Missing record months: ${missing || 'none'}. Missing flow records: ${missingFlows || 'none'}. A missing record or flow is not treated as zero.`);
    }
    const sourceList = projection.basis.flatMap((month) => month.events);
    return result(`Projection only—not an observed result. It uses the simple average of your confirmed, dated records from ${projection.requiredMonths.map((key) => formatMonth(key)).join(', ')}: average inflow ${formatZar(projection.average.income)}, average outflow ${formatZar(projection.average.spent)}, average captured net flow ${formatZar(projection.average.netFlow)} per month. It does not prove the records are complete or predict future bills.`, sourceList);
  }

  if (/\b(?:scam|suspicious|safe|link|fraud)\b/.test(input)) {
    const safetyItems = events.filter((event) => event.kind === 'scam' && event.inboxState !== 'dismissed');
    if (!safetyItems.length) return result('There are no captured messages currently flagged for a safety review. That does not verify that other messages are safe.');
    return result(`I found ${safetyItems.length} captured message${safetyItems.length === 1 ? '' : 's'} flagged for review. These are pattern-based warnings, not a verified scam verdict. Do not use a message link; check with the organisation through a channel you already trust.`, safetyItems);
  }

  if (/\b(?:compare|comparison|different months|month to month|month-over-month|what changed)\b/.test(input)) {
    const namedMonth = /\b20\d{2}-(?:0[1-9]|1[0-2])\b/.test(input) || MONTHS.some((name) => new RegExp(`\\b${name.slice(0, 3)}(?:${name.slice(3)})?\\b`, 'i').test(input));
    const currentMonthKey = monthKey(now);
    const keys = monthKeys.length > 1
      ? monthKeys
      : namedMonth
        ? [monthKeys[0], shiftMonth(monthKeys[0], -1)]
        : [currentMonthKey, shiftMonth(currentMonthKey, -1)];
    const first = months.find((item) => item.month === keys[0]);
    const second = months.find((item) => item.month === keys[1]);
    if (!first || !second) return result(`${!first ? missingMonth(keys[0]) : ''}${!first && !second ? ' ' : ''}${!second ? missingMonth(keys[1]) : ''}`, [...(first?.events || []), ...(second?.events || [])]);
    const targetCategory = categoryFromQuestion(input);
    if (targetCategory) {
      const firstMatches = first.events.filter((event) => event.flow === 'out' && event.category === targetCategory);
      const secondMatches = second.events.filter((event) => event.flow === 'out' && event.category === targetCategory);
      if (!firstMatches.length || !secondMatches.length) return result(`I can’t compare ${targetCategory.toLowerCase()} outflow across both months: ${!firstMatches.length ? `no confirmed ${targetCategory.toLowerCase()} record is captured for ${formatMonth(first.month)}` : ''}${!firstMatches.length && !secondMatches.length ? ' or ' : ''}${!secondMatches.length ? `no confirmed ${targetCategory.toLowerCase()} record is captured for ${formatMonth(second.month)}` : ''}. A missing category record is not treated as zero.`, [...firstMatches, ...secondMatches]);
      const totalA = firstMatches.reduce((sum, event) => sum + Number(event.amount), 0);
      const totalB = secondMatches.reduce((sum, event) => sum + Number(event.amount), 0);
      const delta = Math.round((totalB - totalA) * 100) / 100;
      return result(`Confirmed ${targetCategory.toLowerCase()} outflow changed from ${formatZar(totalA)} in ${formatMonth(first.month)} to ${formatZar(totalB)} in ${formatMonth(second.month)}; difference ${formatZar(delta, { plus: true })}. This compares captured records only; it is not a complete bank statement.`, [...firstMatches, ...secondMatches]);
    }
    return result(`${monthSummary(first)}. ${monthSummary(second)}. These are confirmed captures with transaction dates, not a complete bank statement.`, [...first.events, ...second.events]);
  }

  if (/\b(?:spend|spent|spending|outflow|outflows|expenses?|where.*money go)\b/.test(input)) {
    if (!selectedMonth) return result(missingMonth(monthKeys[0]));
    const target = categoryFromQuestion(input);
    const capturedOutflows = selectedMonth.events.filter((event) => event.flow === 'out');
    if (!capturedOutflows.length) return result(`There are no confirmed, dated outflow records for ${formatMonth(monthKeys[0])}. I can’t conclude that no spending occurred.`, selectedMonth.events);
    if (target) {
      const matches = capturedOutflows.filter((event) => event.category === target);
      if (!matches.length) return result(`There are no confirmed, dated ${target.toLowerCase()} outflow records for ${formatMonth(monthKeys[0])}. That does not mean no such spending occurred.`, capturedOutflows);
      const total = matches.reduce((sum, event) => sum + Number(event.amount), 0);
      return result(`Confirmed ${target.toLowerCase()} outflow for ${formatMonth(monthKeys[0])}: ${formatZar(total)} across ${matches.length} dated record${matches.length === 1 ? '' : 's'}.`, matches);
    }
    const top = Object.entries(selectedMonth.categories).sort((a, b) => b[1] - a[1])[0];
    return result(`${formatMonth(monthKeys[0])} confirmed outflow: ${formatZar(selectedMonth.spent)} across ${capturedOutflows.length} dated records.${top ? ` The largest captured category is ${top[0]} at ${formatZar(top[1])}.` : ''} These are only records you confirmed.`, capturedOutflows);
  }

  if (/\b(?:income|inflow|received|net flow|overflow|cash flow)\b/.test(input)) {
    if (!selectedMonth) return result(missingMonth(monthKeys[0]));
    const flow = /\b(?:net flow|cash flow|overflow)\b/.test(input);
    if (flow) return result(`${formatMonth(monthKeys[0])} confirmed captured net flow is ${formatZar(selectedMonth.netFlow)}: ${formatZar(selectedMonth.income)} inflow minus ${formatZar(selectedMonth.spent)} outflow, across ${selectedMonth.events.length} dated records. This is arithmetic over saved captures, not your current balance.`, selectedMonth.events);
    const incomeEvents = selectedMonth.events.filter((event) => event.flow === 'in');
    if (!incomeEvents.length) return result(`There are no confirmed, dated inflow records for ${formatMonth(monthKeys[0])}. I can’t infer income from missing records.`, selectedMonth.events);
    return result(`${formatMonth(monthKeys[0])} confirmed inflow: ${formatZar(selectedMonth.income)} across ${incomeEvents.length} dated record${incomeEvents.length === 1 ? '' : 's'}.`, incomeEvents);
  }

  if (/\b(?:subscription|recurring|debit order)\b/.test(input)) {
    const subscriptions = confirmed.filter((event) => (event.kind === 'subscription' || event.category === 'Subscriptions') && event.inboxState !== 'dismissed');
    if (!subscriptions.length) return result('There are no confirmed subscription records in your saved data.');
    const pricedSubscriptions = subscriptions.filter((event) => event.amount != null && Number.isFinite(Number(event.amount)));
    const total = pricedSubscriptions.reduce((sum, event) => sum + Number(event.amount), 0);
    const amountSummary = pricedSubscriptions.length ? `Sum of recorded amounts: ${formatZar(total)}` : 'No amount-confirmed subscription records are available to sum';
    return result(`Confirmed subscription records: ${subscriptions.map((event) => `${event.merchant} ${event.amount == null ? '(amount not recorded)' : formatZar(event.amount)}${event.dueDate ? `, due ${event.dueDate}` : ''}`).join('; ')}. ${amountSummary}. I have not multiplied this into a yearly estimate.`, subscriptions);
  }

  if (!selectedMonth) return result(missingMonth(monthKeys[0]));
  return result(`I can answer from confirmed records only. For ${formatMonth(monthKeys[0])}, ${selectedMonth.events.length} dated transaction record${selectedMonth.events.length === 1 ? '' : 's'} are saved. Ask “How much did I spend in ${formatMonth(monthKeys[0])}?”, “Compare months”, “What upcoming payments are confirmed?” or ask about a category.`, selectedMonth.events);
}
