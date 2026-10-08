const FINANCIAL_CUES = /\b(?:r\s?\d|zar\b|salary|pay(?:day|ment)?|paid|payment|debit order|premium|insurance|electricity|municipal|rent|subscription|renew(?:al)?|bill|invoice|due|account|balance|transaction|transfer|refund|purchase|spent|grocery|groceries|petrol|fuel|school fees|loan|instalment|installment|airtime|data bundle|tax|payslip|overdraft|card)\b/i;
const SOCIAL_NOISE = /\b(?:liked your (?:\w+\s+)?(?:message|photo|post)|reacted to your message|new follower|is live now|posted a new (?:photo|video)|sent you a sticker|typing\.\.\.)\b/i;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:[a-z0-9-]+\.)+(?:co\.za|org\.za|gov\.za|com|net|org|info|app|bank|za)(?:\/[^\s<>()]*)?/i;
const MONEY_PATTERN = /(?:\bR\s*|\bZAR\s*)(\d(?:[\d\s.,]*\d)?)/gi;

export function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function isoFromDate(date) {
  return localDateISO(date);
}

export function parseMoneyValues(text = '') {
  const values = [];
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const compact = match[1].trim().replace(/\s/g, '');
    let normalized = compact;
    if (compact.includes(',') && compact.includes('.')) {
      const lastComma = compact.lastIndexOf(',');
      const lastDot = compact.lastIndexOf('.');
      normalized = lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
    } else if (compact.includes(',')) {
      const lastComma = compact.lastIndexOf(',');
      const decimals = compact.length - lastComma - 1;
      normalized = decimals > 0 && decimals <= 2
        ? `${compact.slice(0, lastComma).replace(/,/g, '')}.${compact.slice(lastComma + 1)}`
        : compact.replace(/,/g, '');
    } else if (compact.includes('.')) {
      const lastDot = compact.lastIndexOf('.');
      if (compact.length - lastDot - 1 === 3) normalized = compact.replace(/\./g, '');
    }
    const amount = Number(normalized);
    if (Number.isFinite(amount)) values.push(Math.round(amount * 100) / 100);
  }
  return values;
}

function nextWeekday(from, weekday) {
  const date = new Date(from);
  const delta = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function monthNumber(name) {
  const normalized = name.toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(normalized);
}

export function detectDate(text = '', now = new Date()) {
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return localDateISO(addDays(now, 1));
  if (/\btoday\b/.test(lower)) return localDateISO(now);
  if (/\b(?:first|1st)\s+(?:day\s+)?(?:of\s+)?next month\b/.test(lower)) return localDateISO(new Date(now.getFullYear(), now.getMonth() + 1, 1));

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const [, year, month, day] = iso;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (parsed.getFullYear() === Number(year) && parsed.getMonth() === Number(month) - 1 && parsed.getDate() === Number(day)) return localDateISO(parsed);
  }

  const weekdays = [['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6]];
  for (const [name, weekday] of weekdays) {
    if (new RegExp(`\\b(?:by|due|on|this)?\\s*${name}\\b`, 'i').test(lower)) return localDateISO(nextWeekday(now, weekday));
  }

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const parsed = new Date(year, month, day);
    if (parsed.getMonth() === month && parsed.getDate() === day) return localDateISO(parsed);
  }

  const monthPattern = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  const dayFirst = text.match(monthPattern);
  const monthFirst = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  const match = dayFirst || monthFirst;
  if (match) {
    const day = Number(dayFirst ? match[1] : match[2]);
    const month = monthNumber(dayFirst ? match[2] : match[1]);
    const explicitYear = text.match(/\b20\d{2}\b/);
    const year = explicitYear ? Number(explicitYear[0]) : now.getFullYear();
    let parsed = new Date(year, month, day);
    if (!explicitYear && parsed < new Date(now.getFullYear(), now.getMonth(), now.getDate())) parsed = new Date(year + 1, month, day);
    if (parsed.getMonth() === month && parsed.getDate() === day) return localDateISO(parsed);
  }
  return null;
}

function detectMerchant(text, category) {
  const patterns = [
    [/\b(netflix)\b/i, 'Netflix'], [/\b(spotify)\b/i, 'Spotify'], [/\b(discovery(?: insure| life)?)\b/i, 'Discovery'],
    [/\b(sanlam)\b/i, 'Sanlam'], [/\b(outsurance)\b/i, 'OUTsurance'], [/\b(uber)\b/i, 'Uber'], [/\b(bolt)\b/i, 'Bolt'],
    [/\b(checkers)\b/i, 'Checkers'], [/\b(shoprite)\b/i, 'Shoprite'], [/\b(woolworths)\b/i, 'Woolworths'],
    [/\b(pick ?n ?pay|pnp)\b/i, 'Pick n Pay'], [/\b(takealot)\b/i, 'Takealot'],
    [/\b(fnb|first national bank)\b/i, 'FNB'], [/\b(capitec)\b/i, 'Capitec'], [/\b(standard bank)\b/i, 'Standard Bank'],
    [/\b(nedbank)\b/i, 'Nedbank'], [/\b(tymebank)\b/i, 'TymeBank'],
  ];
  for (const [pattern, merchant] of patterns) if (pattern.test(text)) return merchant;
  if (category === 'Utilities' && /electricity|municipal/i.test(text)) return 'Electricity account';
  if (category === 'Housing' && /rent|landlord/i.test(text)) return 'Rent';
  if (category === 'Income' && /salary|payday|wage/i.test(text)) return 'Salary';
  const match = text.match(/\b(?:to|at|from)\s+([A-Z][A-Za-z&' -]{2,24})/);
  return match ? match[1].trim().replace(/[.!?]+$/, '') : 'Unknown sender';
}

function detectCategory(text) {
  const value = text.toLowerCase();
  if (/salary|payday|wage|income|received|credited|refund/.test(value)) return 'Income';
  if (/rent|landlord|property/.test(value)) return 'Housing';
  if (/electricity|municipal|water bill|utility|power bill/.test(value)) return 'Utilities';
  if (/insurance|premium|discovery|sanlam|outsurance/.test(value)) return 'Insurance';
  if (/netflix|spotify|subscription|renew(?:al)?|streaming/.test(value)) return 'Subscriptions';
  if (/petrol|fuel|uber|bolt|taxi|transport|bus|train/.test(value)) return 'Transport';
  if (/grocery|groceries|food|checkers|shoprite|woolworths|pick ?n ?pay|pnp/.test(value)) return 'Groceries';
  if (/school|tuition|uniform/.test(value)) return 'Education';
  if (/airtime|data bundle|mobile|cellphone/.test(value)) return 'Mobile & internet';
  if (/loan|instalment|installment|credit card/.test(value)) return 'Debt';
  if (/shopping|takealot|retail|store|purchase/.test(value)) return 'Shopping';
  return 'Other';
}

function detectRecurrence(text) {
  if (/\b(?:monthly|every month|each month|per month|a month)\b/i.test(text)) return 'monthly';
  if (/\b(?:weekly|every week|each week|per week|a week)\b/i.test(text)) return 'weekly';
  if (/\b(?:quarterly|every three months|every 3 months|per quarter)\b/i.test(text)) return 'quarterly';
  if (/\b(?:annually|annual|yearly|every year|per year|a year)\b/i.test(text)) return 'yearly';
  return null;
}

function confidenceScore(kind, amount, date, category, isScam, text) {
  if (isScam) return /\b(?:pin|password|otp|passcode)\b/i.test(text) ? 0.98 : 0.93;
  if (kind === 'income' && amount != null) return 0.98;
  if ((kind === 'bill' || kind === 'subscription' || kind === 'premium_increase') && amount != null && date) return category !== 'Other' ? 0.95 : 0.88;
  if (kind === 'expense' && amount != null) return category !== 'Other' ? 0.91 : 0.78;
  if (amount != null) return 0.61;
  if (kind !== 'unknown') return 0.55;
  return 0.36;
}

function explanationFor(kind, category, amount, dueDate, source, extra = []) {
  const details = [];
  if (kind === 'income') details.push('The text appears to describe money received; confirm the transaction type.');
  else if (kind === 'premium_increase') details.push('The text mentions an insurance premium change; confirm the old and new amounts.');
  else if (kind === 'subscription') details.push('The text mentions a subscription or renewal.');
  else if (kind === 'bill') details.push('The text includes a bill, amount, or payment deadline.');
  else if (kind === 'scam') details.push('The text uses account-threat or credential-request language. This is a warning signal, not a verified verdict.');
  else if (kind === 'expense') details.push('The text appears to describe a payment, purchase, or debit; confirm it before totals use it.');
  if (amount != null) details.push(`Amount found in text: ${formatZar(amount, { decimals: true })}.`);
  if (category && category !== 'Other') details.push(`Category clue: ${category}.`);
  if (dueDate) details.push(`${['bill', 'subscription', 'premium_increase'].includes(kind) ? 'Possible commitment date' : 'Possible date reference'} found in text: ${dueDate}.`);
  if (source) details.push(`Shared from ${source}.`);
  return [...details, ...extra];
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Local rules only. Every extracted record starts unconfirmed and is excluded from totals until reviewed. */
export function analyzeMessage(text, source = 'Shared message', { now = new Date(), existingEvents = [] } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return { ignored: true, reason: 'Add some text to analyse.' };
  if (SOCIAL_NOISE.test(cleanText) && !FINANCIAL_CUES.test(cleanText)) return { ignored: true, reason: 'This looks like a social notification, not a money record.' };

  const amounts = parseMoneyValues(cleanText);
  const isScam = /\b(?:verify (?:your )?account|account (?:will be|is) (?:blocked|locked|suspended)|urgent.{0,24}(?:payment|verify|click)|send (?:your )?(?:pin|password|otp)|share (?:your )?(?:pin|password|otp)|confirm (?:your )?details|account access will be blocked|claim your prize)\b/i.test(cleanText)
    || (/\b(?:pin|password|otp|passcode)\b/i.test(cleanText) && URL_PATTERN.test(cleanText));
  const category = detectCategory(cleanText);
  const merchant = detectMerchant(cleanText, category);
  const dueDate = detectDate(cleanText, now);
  const recurring = detectRecurrence(cleanText);
  const increasePattern = /\b(?:increase|increased|increasing|rise|rising|go up|going up|more per month|premium.{0,20}(?:from|to))\b/i.test(cleanText);
  const hasDueLanguage = /\b(?:due|by|pay(?:ment)? required|must pay|pay before|please pay|send|renew(?:s|al)?|will be charged|next month)\b/i.test(cleanText);
  const incomePattern = /\b(?:salary|payday|wage|income|payment received|credited|refund|deposit received)\b/i.test(cleanText)
    || (amounts.length > 0 && /\b(?:received|credited)\b/i.test(cleanText) && !/\b(?:received a bill|payment required|payment due|insurance premium|purchase)\b/i.test(cleanText));
  const expensePattern = /\b(?:paid|purchase|spent|expense|debited|charged|payment processed|processed|transaction|card purchase|withdrawal)\b/i.test(cleanText);
  const billPattern = /\b(?:bill|invoice|due|payment required|account is due|pay before|school fees|rent is due)\b/i.test(cleanText);
  const subscriptionPattern = /\b(?:subscription|renew(?:al|s)?|streaming service)\b/i.test(cleanText);

  let kind = 'unknown';
  let flow = 'none';
  let state = 'alert';
  let amount = amounts.length === 1 ? amounts[0] : null;
  let previousAmount = null;
  let delta = null;
  if (isScam) kind = 'scam';
  else if (increasePattern && /insurance|premium|policy|cover/i.test(cleanText)) {
    kind = 'premium_increase'; flow = 'out'; state = 'upcoming';
    const explicitRange = cleanText.match(/\bfrom\s+((?:R|ZAR)\s*\d[\d\s,.]*?)\s+to\s+((?:R|ZAR)\s*\d[\d\s,.]*)/i)
      || cleanText.match(/((?:R|ZAR)\s*\d[\d\s,.]*?)\s*(?:->|→)\s*((?:R|ZAR)\s*\d[\d\s,.]*)/i);
    if (explicitRange) {
      const rangeAmounts = parseMoneyValues(`${explicitRange[1]} ${explicitRange[2]}`);
      if (rangeAmounts.length === 2) [previousAmount, amount] = rangeAmounts;
      else amount = null;
    } else if (amounts.length > 1) amount = null;
    const prior = previousAmount == null && amount != null ? existingEvents.find((event) => isConfirmedEvent(event) && event.state === 'posted' && event.category === 'Insurance' && event.merchant === merchant && event.flow === 'out' && event.amount != null) : null;
    if (prior && amount != null) {
      previousAmount = Number(prior.amount);
      delta = Math.round((amount - previousAmount) * 100) / 100;
    } else if (amount != null && previousAmount != null) delta = Math.round((amount - previousAmount) * 100) / 100;
  } else if (incomePattern) { kind = 'income'; flow = 'in'; state = 'posted'; }
  else if (subscriptionPattern && !expensePattern) { kind = 'subscription'; flow = 'out'; state = 'upcoming'; }
  else if (billPattern && !expensePattern) { kind = 'bill'; flow = 'out'; state = 'upcoming'; }
  else if (expensePattern) { kind = 'expense'; flow = 'out'; state = 'posted'; }
  else if (hasDueLanguage && amount != null) { kind = subscriptionPattern ? 'subscription' : 'bill'; flow = 'out'; state = 'upcoming'; }

  const title = isScam ? 'Potential scam signal'
    : kind === 'income' ? 'Possible income received'
      : kind === 'premium_increase' ? 'Possible insurance price change'
        : kind === 'subscription' ? 'Subscription or renewal'
          : kind === 'bill' ? (category === 'Utilities' ? 'Utility bill' : category === 'Housing' ? 'Housing payment' : 'Payment due')
            : kind === 'expense' ? `${category} payment` : 'Unclear message — review details';
  const linkMatch = cleanText.match(URL_PATTERN);
  let linkDomain = null;
  if (linkMatch) {
    const rawLink = linkMatch[0].replace(/[),.;!]+$/, '');
    const normalizedLink = /^https?:\/\//i.test(rawLink) ? rawLink : `https://${rawLink}`;
    try { linkDomain = new URL(normalizedLink).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch { linkDomain = rawLink.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase(); }
  }
  const flags = [];
  if (isScam) flags.push('Potential scam signal');
  if (linkDomain) flags.push('Contains a link');
  if (kind === 'unknown') flags.push('Needs clarification');
  if (kind === 'premium_increase' && delta != null && delta > 0) flags.push(`Increase detected: ${formatZar(delta, { decimals: true })}`);
  if (amounts.length > 1 && amount == null) flags.push('Multiple amounts — check message');
  const explanation = explanationFor(kind, category, amount, dueDate, source, [
    ...(amounts.length > 1 && amount == null ? ['Multiple Rand amounts were found without a clear old-to-new pattern. No amount was chosen automatically.'] : []),
    ...(linkDomain ? [`Link domain found: ${linkDomain}. It was not opened or verified.`] : []),
  ]);
  const existingMatch = existingEvents.find((event) => event.sourceText === cleanText && event.source === source);
  if (existingMatch) return { duplicate: true, reason: 'This exact message is already in your saved records.', event: existingMatch };

  return {
    id: makeId(), title, merchant, source, sourceText: cleanText, kind,
    category: isScam ? 'Safety' : category, amount, previousAmount, delta,
    flow: isScam ? 'none' : flow, state,
    date: localDateISO(now), transactionDate: null,
    dueDate: state === 'upcoming' ? dueDate : null,
    recurring,
    confidence: confidenceScore(kind, amount, dueDate, category, isScam, cleanText),
    confidenceLabel: confidenceScore(kind, amount, dueDate, category, isScam, cleanText) >= 0.9 ? 'High' : confidenceScore(kind, amount, dueDate, category, isScam, cleanText) >= 0.65 ? 'Medium' : 'Low',
    inboxState: 'open', flags, isAnomaly: false, linkDomain, explanation,
    createdAt: now.toISOString(),
  };
}

export function applyReviewCorrection(event, {
  category = event.category,
  amount = event.amount,
  previousAmount = event.previousAmount,
  merchant = event.merchant,
  recurring = event.recurring,
  classification = event.kind,
  transactionDate = event.transactionDate,
  dueDate = event.dueDate,
  inboxState = 'reviewed',
} = {}) {
  const mappings = {
    income: { kind: 'income', flow: 'in', state: 'posted', title: 'Income received' },
    expense: { kind: 'expense', flow: 'out', state: 'posted', title: `${category} payment` },
    bill: { kind: 'bill', flow: 'out', state: 'upcoming', title: category === 'Utilities' ? 'Utility bill' : category === 'Housing' ? 'Housing payment' : 'Payment due' },
    subscription: { kind: 'subscription', flow: 'out', state: 'upcoming', title: 'Subscription renewal' },
    premium_increase: { kind: 'premium_increase', flow: 'out', state: 'upcoming', title: 'Possible insurance price change' },
    scam: { kind: 'scam', flow: 'none', state: 'alert', title: 'Potential scam signal' },
    unknown: { kind: 'unknown', flow: 'none', state: 'alert', title: event.title },
  };
  const mapping = mappings[classification] || mappings.unknown;
  const numericAmount = amount === null || amount === undefined || amount === '' || !Number.isFinite(Number(amount)) ? null : Math.max(0, Number(amount));
  const numericPreviousAmount = previousAmount === null || previousAmount === undefined || previousAmount === '' || !Number.isFinite(Number(previousAmount)) ? null : Math.max(0, Number(previousAmount));
  const delta = mapping.kind === 'premium_increase' && numericAmount != null && numericPreviousAmount != null
    ? Math.round((numericAmount - numericPreviousAmount) * 100) / 100
    : null;
  return {
    ...event,
    ...mapping,
    category: mapping.kind === 'scam' ? 'Safety' : category,
    amount: numericAmount,
    previousAmount: mapping.kind === 'premium_increase' ? numericPreviousAmount : null,
    delta,
    merchant: String(merchant || '').trim() || 'Unknown sender',
    recurring: recurring || null,
    inboxState,
    transactionDate: mapping.state === 'posted' ? (transactionDate || null) : null,
    dueDate: mapping.state === 'upcoming' ? (dueDate || null) : null,
    flags: (event.flags || []).filter((flag) => flag !== 'Needs clarification'),
    isAnomaly: false,
  };
}

export function formatZar(value, { decimals, plus = false } = {}) {
  const amount = Number(value) || 0;
  const showDecimals = decimals ?? (Math.round(Math.abs(amount) * 100) % 100 !== 0);
  const formatted = Math.abs(amount).toLocaleString('en-ZA', { minimumFractionDigits: showDecimals ? 2 : 0, maximumFractionDigits: showDecimals ? 2 : 0 });
  const sign = amount < 0 ? '−' : plus && amount > 0 ? '+' : '';
  return `${sign}R${formatted}`;
}

export function formatDate(dateString, options = { day: 'numeric', month: 'short' }) {
  if (!dateString) return 'Date not entered';
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZA', options).format(new Date(year, month - 1, day));
}

export function formatMonth(monthKey, options = { month: 'long', year: 'numeric' }) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || '')) return 'Unknown month';
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZA', options).format(new Date(year, month - 1, 1));
}

export function formatRelativeDate(dateString, now = new Date()) {
  if (!dateString) return 'Date not entered';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`;
  return formatDate(dateString, { day: 'numeric', month: 'long' });
}

export function isConfirmedEvent(event) {
  return event.inboxState === 'reviewed' || event.inboxState === 'resolved';
}

function hasValidAmount(event) {
  return event.amount !== null && event.amount !== undefined && Number.isFinite(Number(event.amount)) && Number(event.amount) >= 0;
}

function hasValidTransactionDate(event) {
  const match = String(event.transactionDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function calculateMonthlyTotals(events) {
  const months = new Map();
  for (const event of events) {
    if (!isConfirmedEvent(event) || event.state !== 'posted' || !['in', 'out'].includes(event.flow) || !hasValidTransactionDate(event) || !hasValidAmount(event)) continue;
    const monthKey = event.transactionDate.slice(0, 7);
    const amount = Number(event.amount);
    if (!months.has(monthKey)) months.set(monthKey, { month: monthKey, income: 0, spent: 0, netFlow: 0, incomeEvents: 0, spendEvents: 0, categories: {}, events: [] });
    const record = months.get(monthKey);
    if (event.flow === 'in') { record.income += amount; record.incomeEvents += 1; }
    else { record.spent += amount; record.spendEvents += 1; record.categories[event.category] = (record.categories[event.category] || 0) + amount; }
    record.events.push(event);
  }
  return [...months.values()].map((month) => ({ ...month, netFlow: Math.round((month.income - month.spent) * 100) / 100 })).sort((a, b) => a.month.localeCompare(b.month));
}

function shiftMonth(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function projectMonthlyFlow(events, { now = new Date(), historyMonths = 3, horizon = 3 } = {}) {
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const requiredMonths = Array.from({ length: historyMonths }, (_, index) => shiftMonth(currentMonth, index - historyMonths));
  const actual = calculateMonthlyTotals(events);
  const byMonth = new Map(actual.map((month) => [month.month, month]));
  const basis = requiredMonths.map((month) => byMonth.get(month)).filter(Boolean);
  const missingMonths = requiredMonths.filter((month) => !byMonth.has(month));
  const missingFlowsByMonth = requiredMonths.filter((month) => byMonth.has(month)).map((month) => {
    const record = byMonth.get(month);
    return { month, missingFlows: [!record.incomeEvents && 'inflow', !record.spendEvents && 'outflow'].filter(Boolean) };
  }).filter((item) => item.missingFlows.length);
  if (missingMonths.length || missingFlowsByMonth.length) return { ready: false, requiredMonths, missingMonths, missingFlowsByMonth, basis };
  const average = {
    income: Math.round((basis.reduce((sum, month) => sum + month.income, 0) / historyMonths) * 100) / 100,
    spent: Math.round((basis.reduce((sum, month) => sum + month.spent, 0) / historyMonths) * 100) / 100,
  };
  average.netFlow = Math.round((average.income - average.spent) * 100) / 100;
  const projectedMonths = Array.from({ length: horizon }, (_, index) => ({
    month: shiftMonth(currentMonth, index + 1),
    ...average,
    basisMonths: requiredMonths,
  }));
  return { ready: true, requiredMonths, basis, average, projectedMonths };
}

export function calculateSnapshot(events, now = new Date()) {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const confirmed = events.filter(isConfirmedEvent);
  const monthly = calculateMonthlyTotals(confirmed);
  const currentMonth = monthly.find((item) => item.month === monthKey);
  const upcoming = confirmed.filter((event) => event.state === 'upcoming' && event.flow === 'out');
  const pricedUpcoming = upcoming.filter(hasValidAmount);
  const subscriptions = upcoming.filter((event) => event.kind === 'subscription' || event.category === 'Subscriptions');
  const confirmedPosted = confirmed.filter((event) => event.state === 'posted' && ['in', 'out'].includes(event.flow));
  const datedPostedCount = confirmedPosted.filter(hasValidTransactionDate).length;
  const undatedPostedCount = confirmedPosted.filter((event) => !hasValidTransactionDate(event)).length;
  const unpricedPostedCount = confirmedPosted.filter((event) => !hasValidAmount(event)).length;
  return {
    income: currentMonth?.income || 0,
    spent: currentMonth?.spent || 0,
    netFlow: currentMonth?.netFlow || 0,
    upcomingTotal: Math.round(pricedUpcoming.reduce((sum, event) => sum + Number(event.amount), 0) * 100) / 100,
    upcomingCount: upcoming.length,
    pricedUpcomingCount: pricedUpcoming.length,
    unpricedUpcomingCount: upcoming.filter((event) => !hasValidAmount(event)).length,
    attentionCount: events.filter((event) => event.inboxState === 'open').length,
    subscriptions: subscriptions.length,
    incomeEvents: currentMonth?.incomeEvents || 0,
    spendEvents: currentMonth?.spendEvents || 0,
    categories: currentMonth?.categories || {},
    eventsThisMonth: currentMonth?.events.length || 0,
    datedPostedCount,
    undatedPostedCount,
    unpricedPostedCount,
    confirmedCount: confirmed.length,
    monthly,
  };
}
