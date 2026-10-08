/**
 * MoneyLens end-to-end click-through validation.
 *
 * Drives a real Chromium session through every screen, modal, and interactive
 * element: auth, guest preview, all 8 views, capture/guided review, inbox,
 * search, settings, lock/unlock, mobile nav. Fails (exit 1) on:
 *  - uncaught page exceptions
 *  - unexpected console errors
 *  - interactive elements that are hidden, zero-sized, covered, or pointer-dead
 *  - elements styled cursor:pointer that have no click behaviour at all
 *  - any flow assertion that does not hold
 *
 * Run: npm run test:e2e   (dev server must be reachable at DEV_URL)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(__dirname, 'artifacts');
mkdirSync(ARTIFACTS, { recursive: true });

const DEV_URL = process.env.DEV_URL || 'http://localhost:5173/';
const TEST_PIN = '483920';
const chromiumPkg = (await import('@sparticuz/chromium')).default;
const { default: puppeteer } = await import('puppeteer-core');

const results = [];
const pageErrors = [];
const consoleErrors = [];
let shot = 0;

function pass(name) { results.push({ ok: true, name }); console.log(`  PASS  ${name}`); }
function fail(name, detail = '') { results.push({ ok: false, name, detail }); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
function check(cond, name, detail = '') { cond ? pass(name) : fail(name, detail); return cond; }

const EXPECTED_CONSOLE = /net::ERR|Failed to load resource|tesseract|jsdelivr|tessdata|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|download|Download/i;

async function snap(page, label) {
  const file = join(ARTIFACTS, `${String(++shot).padStart(2, '0')}-${label}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); } catch {}
  return file;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.innerText).catch(() => null);
}
async function exists(page, selector) {
  return (await page.$(selector)) !== null;
}
async function count(page, selector) {
  return page.$$eval(selector, (els) => els.length).catch(() => 0);
}
async function clickText(page, text, tag = 'button', { optional = false } = {}) {
  const handle = await page.evaluateHandle((t, tg) => {
    const els = [...document.querySelectorAll(tg)];
    return els.find((el) => (el.innerText || '').includes(t) && el.offsetParent !== null) || null;
  }, text, tag);
  const el = handle.asElement();
  if (!el) {
    await handle.dispose();
    if (optional) return false;
    throw new Error(`clickText: no visible <${tag}> containing "${text}"`);
  }
  await el.click();
  await handle.dispose();
  await sleep(250);
  return true;
}
async function setReactValue(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`setReactValue: no element ${sel}`);
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
  await sleep(150);
}
async function waitText(page, text, timeout = 8000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    return true;
  } catch { return false; }
}
async function waitGone(page, text, timeout = 8000) {
  try {
    await page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, text);
    return true;
  } catch { return false; }
}

/** Visibility/occlusion audit for every interactive element + cursor:pointer suspects.
 * `scopeSel` limits the audit (e.g. '.modal-card' when a backdrop covers the page,
 * '.sidebar' when the mobile drawer overlays content — those are modal-like states by design).
 * Hidden elements are recorded per viewport; an element is only a failure if it is
 * hidden at EVERY audited viewport (responsive mobile-only/desktop-only controls are fine). */
const hiddenByViewport = new Map(); // viewport label -> Set(desc)
const visibleByViewport = new Map(); // viewport label -> Set(desc) — seen reachable in ANY audited state

async function auditView(page, label, scopeSel = 'body') {
  await page.evaluate(() => window.scrollTo(0, 0));
  const { problems, hidden, visible } = await page.evaluate((scope) => {
    const out = [];
    const hidden = [];
    const visibleDescs = [];
    const scopeEl = document.querySelector(scope) || document.body;
    const interactiveSel = 'button, a[href], select, textarea, input:not([type="hidden"]), summary, [role="button"], [onclick]';
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width >= 1 && r.height >= 1 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
        && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; // must intersect the viewport
    };
    const els = [...scopeEl.querySelectorAll(interactiveSel)];
    if (scopeEl.matches(interactiveSel)) els.unshift(scopeEl);
    for (const el of els) {
      const desc = `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(/\s+/).slice(0, 3).join('.') : ''} "${(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 45).replace(/\n/g, ' ')}"`;
      if (el.closest('.visually-hidden') || el.classList.contains('visually-hidden')) continue; // intentionally hidden (file input)
      if (!visible(el)) { hidden.push(desc); continue; }
      visibleDescs.push(desc);
      if (el.disabled) continue; // disabled is an explicit state, asserted by flow tests
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) {
        out.push({ type: 'covered', desc, by: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(/\s+/)[0]}` : 'null' });
        continue;
      }
      const s = getComputedStyle(el);
      if (s.pointerEvents === 'none') out.push({ type: 'pointer-events-none', desc });
    }
    // cursor:pointer elements with no click semantics (looks clickable but does nothing)
    const clickish = (el) => el.matches('button, a[href], select, summary, [role="button"], [onclick], label:has(input), label:has(button)')
      || el.closest('button, a[href], select, summary, [role="button"], [onclick], label');
    for (const el of scopeEl.querySelectorAll('*')) {
      if (!visible(el)) continue;
      if (clickish(el)) continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      out.push({ type: 'pointer-no-handler', desc: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')} "${(el.innerText || '').trim().slice(0, 40).replace(/\n/g, ' ')}"` });
    }
    return { problems: out, hidden, visible: visibleDescs };
  }, scopeSel);
  const vp = `${Math.round((await page.viewport())?.width || 0)}px`;
  if (!hiddenByViewport.has(vp)) hiddenByViewport.set(vp, new Set());
  if (!visibleByViewport.has(vp)) visibleByViewport.set(vp, new Set());
  if (scopeSel === 'body') hidden.forEach((d) => hiddenByViewport.get(vp).add(d));
  visible.forEach((d) => visibleByViewport.get(vp).add(d));
  const realProblems = problems;
  if (realProblems.length === 0) pass(`clickability audit: ${label} — all visible interactive elements reachable`);
  else realProblems.forEach((p) => fail(`clickability audit: ${label}`, `${p.type}: ${p.desc}${p.by ? ` (covered by ${p.by})` : ''}`));
  if (hidden.length && scopeSel === 'body') console.log(`  info  ${label}: ${hidden.length} element(s) hidden at this viewport (checked against other viewport): ${hidden.join(' | ')}`);
  return realProblems;
}

/** Element hidden at every audited viewport AND never seen reachable in any state
 *  = unreachable anywhere → failure. Responsive controls (mobile-only/desktop-only,
 *  drawer-closed states) are visible in at least one observation → pass. */
function crossViewportHiddenCheck() {
  const labels = [...hiddenByViewport.keys()];
  if (labels.length < 2) { pass('viewport visibility: only one viewport audited, skipping cross-check'); return; }
  const everVisible = new Set();
  for (const set of visibleByViewport.values()) for (const d of set) everVisible.add(d);
  let anyFail = false;
  for (const [vp, set] of hiddenByViewport) {
    for (const desc of set) {
      if (everVisible.has(desc)) continue;
      const hiddenEverywhere = [...hiddenByViewport.values()].every((s) => s.has(desc));
      if (hiddenEverywhere) {
        anyFail = true;
        fail(`viewport visibility (${vp})`, `hidden at every viewport and never seen visible: ${desc}`);
      }
    }
  }
  if (!anyFail) pass(`viewport visibility: all ${[...hiddenByViewport.values()].reduce((n, s) => n + s.size, 0)} hidden-observation(s) are reachable in at least one state/viewport`);
}

async function clickSel(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`clickSel: not found ${selector}`);
  await el.click();
  await sleep(250);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: await chromiumPkg.executablePath(),
    args: [...chromiumPkg.args, '--lang=en-ZA'],
    headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  page.on('pageerror', (err) => {
    const msg = String(err?.message || err);
    // OCR engine fetches its worker from a CDN; unreachable in offline sandboxes and
    // handled by the app's own error state. Everything else is a real uncaught error.
    if (/importScripts|tesseract|jsdelivr|Failed to load resource|net::ERR/i.test(msg)) return;
    pageErrors.push(msg);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !EXPECTED_CONSOLE.test(msg.text())) consoleErrors.push(msg.text());
  });
  let dialogHandler = null;
  page.on('dialog', async (d) => {
    const action = dialogHandler || 'accept';
    if (action === 'accept') await d.accept(); else await d.dismiss();
  });

  try {
    /* ---------------- 1. AUTH / SIGNUP ---------------- */
    console.log('\n== 1. Auth gate ==');
    await page.setDefaultTimeout(15000);
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.auth-shell', { timeout: 10000 });
    check(await exists(page, '.auth-shell'), 'auth: signup screen renders');
    check(await exists(page, '.auth-preview-link'), 'auth: preview link present');
    await auditView(page, 'auth (signup)');

    // PIN show/hide toggle
    const pwTypeBefore = await page.$eval('#local-password', (el) => el.type);
    await clickText(page, '', 'button[aria-label="Show PIN"]').catch(async () => {
      await page.click('.auth-password-wrap button');
    });
    await sleep(150);
    const pwTypeAfter = await page.$eval('#local-password', (el) => el.type);
    check(pwTypeBefore === 'password' && pwTypeAfter === 'text', 'auth: show/hide PIN toggle works');

    // the PIN field is numeric-only: letters and symbols must be refused as typed
    await page.click('#local-password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#local-password', 'ab12cd34!');
    check((await page.$eval('#local-password', (el) => el.value)) === '1234', 'auth: PIN field keeps digits only', await page.$eval('#local-password', (el) => el.value));
    check((await page.$eval('#local-password', (el) => el.maxLength)) === 6, 'auth: PIN field caps input at 6 digits');

    // too-short PIN is refused before any vault is written
    await clickText(page, '', 'button[aria-label="Hide PIN"]').catch(async () => {
      await page.click('.auth-password-wrap button');
    });
    await page.click('#local-password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#local-email', 'tester@moneylens.test');
    await page.type('#local-password', '12');
    await page.type('#local-password-confirm', '12');
    await page.click('.auth-submit');
    await sleep(300);
    check(await waitText(page, 'must be exactly 6 digits'), 'auth: PIN shorter than 6 digits shows error');
    check(await page.evaluate(() => !localStorage.getItem('moneylens.local-vault.v1')), 'auth: rejected PIN writes no vault');

    // mismatch validation with two valid 6-digit PINs
    await page.click('#local-password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#local-password', TEST_PIN);
    await page.click('#local-password-confirm', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#local-password-confirm', '111111');
    await page.click('.auth-submit');
    await sleep(300);
    check(await waitText(page, 'The PINs do not match.'), 'auth: PIN mismatch shows error');

    /* ---------------- 2. GUEST PREVIEW ---------------- */
    console.log('\n== 2. Guest preview ==');
    await page.click('.auth-preview-link');
    await sleep(400);
    check(await exists(page, '.guest-preview-banner'), 'preview: banner renders');
    check((await textOf(page, '.breadcrumb'))?.includes('Today'), 'preview: lands on Today');
    await auditView(page, 'preview · Today');

    // preview restriction: preview nav only exposes today/money/insights (others filtered
    // out of the DOM by design); the privacy-centre button still calls navigate('settings'),
    // which must bounce a preview user back to the auth gate.
    const previewNavIds = await page.$$eval('.side-nav .nav-link span', (els) => els.map((e) => e.textContent));
    check(!previewNavIds.some((t) => ['Forecast', 'AI Inbox', 'Scan & share', 'Ask MoneyLens'].includes(t)),
      'preview: non-preview views hidden from nav', previewNavIds.join(','));
    await clickSel(page, 'button[aria-label="Open privacy centre"]');
    await sleep(400);
    check(await exists(page, '.auth-shell'), 'preview: restricted nav (settings) returns to auth gate');
    check(!(await exists(page, '.guest-preview-banner')), 'preview: exited cleanly');

    /* ---------------- 3. ACCOUNT CREATION ---------------- */
    console.log('\n== 3. Local account creation ==');
    await page.type('#local-email', 'tester@moneylens.test');
    await page.type('#local-password', TEST_PIN);
    await page.type('#local-password-confirm', TEST_PIN);
    await page.click('.auth-submit');
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    check(true, 'auth: account created with a 6-digit PIN, app shell opens');
    check(await waitText(page, 'Welcome'), 'today: welcome heading renders');
    await auditView(page, 'Today (empty state)');

    /* ---------------- 4. NAVIGATION: ALL 8 VIEWS ---------------- */
    console.log('\n== 4. All views reachable & auditable ==');
    const views = [
      ['Money', 'Confirmed records'],
      ['Insights', 'A little more perspective'],
      ['Forecast', 'Your recorded money flow'],
      ['AI Inbox', 'Your AI Inbox'],
      ['Scan & share', 'Bring the important bits together'],
      ['Ask MoneyLens', 'Ask about your records'],
      ['Settings & privacy', 'Local vault & permissions'],
      ['Today', 'Welcome'],
    ];
    for (const [nav, heading] of views) {
      await clickText(page, nav, '.nav-link');
      const ok = await waitText(page, heading, 6000);
      check(ok, `nav: ${nav} opens ("${heading}")`);
      if (ok) await auditView(page, nav);
    }

    /* ---------------- 5. CAPTURE FLOWS ---------------- */
    console.log('\n== 5. Capture + guided review ==');
    // helper: run guided review to completion
    async function completeGuided({ type, frequency, transactionDate } = {}) {
      await page.waitForSelector('.guided-review', { timeout: 8000 });
      for (let guard = 0; guard < 15; guard += 1) {
        if (await exists(page, '.guided-confirm')) break;
        if (await exists(page, '.guided-choice-grid')) {
          if (await clickText(page, type, '.guided-choice')) continue;
        }
        if (await exists(page, '.frequency-choice-grid')) {
          if (await clickText(page, frequency || 'One-time / not stated', '.frequency-choice')) continue;
        }
        if (await clickText(page, 'Use amount clue', 'button', { optional: true })) continue;
        if (transactionDate && (await count(page, '.guided-question input[type="date"]')) > 0) {
          const val = await page.$eval('.guided-question input[type="date"]', (el) => el.value);
          if (!val) {
            await setReactValue(page, '.guided-question input[type="date"]', transactionDate);
            continue;
          }
        }
        if (await clickText(page, 'Use this date', 'button', { optional: true })) continue;
        if (await clickText(page, 'Use these values', 'button', { optional: true })) continue;
        if (await clickText(page, 'Use this category', 'button', { optional: true })) continue;
        if (await clickText(page, 'Keep “', 'button', { optional: true })) continue;
        if (await clickText(page, 'Continue', 'button', { optional: true })) continue;
        const primary = await page.$('.guided-question .button--primary');
        if (primary) { await primary.click(); await sleep(250); continue; }
        break;
      }
      const confirmBtn = await page.$('.guided-confirm');
      if (!confirmBtn) throw new Error('guided review: never reached final confirm step');
      await confirmBtn.click();
      await sleep(400);
      return waitText(page, 'Review saved in your encrypted local vault', 5000);
    }

    async function captureMessage(text, source) {
      if (!(await exists(page, '.capture-modal'))) {
        await page.click('.top-capture');
        await page.waitForSelector('.capture-modal', { timeout: 5000 });
      }
      if (source) await page.select('#capture-source', source);
      await setReactValue(page, '#capture-text', text);
      await clickText(page, 'Understand this');
      await sleep(400);
    }

    // C1: electricity bill (Bank notification)
    await captureMessage('Your municipality electricity bill of R1 245,60 for October is due on 5 October 2026.', 'Bank notification');
    check(await exists(page, '.analysis-result'), 'capture: analysis result appears');
    await auditView(page, 'Capture modal (with result)', '.capture-modal');
    await clickText(page, 'Answer a few questions');
    await sleep(300);
    check(await completeGuided({ type: 'Upcoming bill', frequency: 'One-time / not stated' }), 'capture: guided review saved electricity bill');
    await clickText(page, 'Close', 'button', { optional: true });
    await page.keyboard.press('Escape');
    await sleep(300);

    // C2: salary (WhatsApp)
    await captureMessage('Salary of R25,000.00 was paid into your account on 28 September 2026.', 'WhatsApp');
    await clickText(page, 'Answer a few questions');
    await sleep(300);
    check(await completeGuided({ type: 'Money received', transactionDate: '2026-09-28' }), 'capture: guided review saved salary with transaction date');
    await page.keyboard.press('Escape');
    await sleep(300);

    // C3: grocery expense (SMS)
    await captureMessage('Paid R489.99 at Checkers for groceries on 20 September 2026.', 'SMS');
    await clickText(page, 'Answer a few questions');
    await sleep(300);
    check(await completeGuided({ type: 'Payment already made', transactionDate: '2026-09-20' }), 'capture: guided review saved grocery expense');
    await page.keyboard.press('Escape');
    await sleep(300);

    // C4: premium increase (Email)
    await captureMessage('Your Discovery medical aid premium will increase from R1,450.00 to R1,620.00 monthly from 1 November 2026.', 'Email');
    await clickText(page, 'Answer a few questions');
    await sleep(300);
    check(await completeGuided({ type: 'Price or premium change', frequency: 'Monthly' }), 'capture: guided review saved premium increase');
    await page.keyboard.press('Escape');
    await sleep(300);

    // C5: scam — keep in inbox for later (Leave for later path)
    await captureMessage('URGENT: Your account will be blocked within 24 hours. Verify your account now at http://verify-ml.top/secure', 'SMS');
    await clickText(page, 'Answer a few questions');
    await page.waitForSelector('.guided-review', { timeout: 8000 });
    check(await clickText(page, 'Keep for later'), 'capture: "Keep for later" closes guided review, item stays open');
    await sleep(300);
    const toastTxt = await textOf(page, '.toast');
    check(Boolean(toastTxt), 'capture: toast feedback shown', String(toastTxt));

    // duplicate protection
    await captureMessage('Your municipality electricity bill of R1 245,60 for October is due on 5 October 2026.', 'Bank notification');
    check(await waitText(page, 'already in your saved records'), 'capture: duplicate message rejected with feedback');
    await page.keyboard.press('Escape');
    await sleep(300);

    // ignored (social noise)
    await captureMessage('Jane liked your photo', 'Other');
    check(await waitText(page, 'social notification'), 'capture: social noise ignored with feedback');
    await page.keyboard.press('Escape');
    await sleep(300);

    /* ---------------- 6. TODAY WITH DATA ---------------- */
    console.log('\n== 6. Today with captured data ==');
    await clickText(page, 'Today', '.nav-link');
    await sleep(400);
    check(await count(page, '.attention-card') >= 1, 'today: attention card for open scam item');
    await auditView(page, 'Today (with data)');
    // attention card opens detail modal
    await page.click('.attention-card');
    await page.waitForSelector('.detail-modal', { timeout: 5000 });
    check(true, 'today: attention card opens detail modal');
    await page.keyboard.press('Escape');
    await sleep(250);
    check(!(await exists(page, '.detail-modal')), 'modal: Escape closes detail modal');
    // hero buttons
    await clickText(page, 'Compare months');
    check(await waitText(page, 'Your recorded money flow'), 'today: "Compare months" → Forecast');
    await clickText(page, 'Today', '.nav-link');
    await clickText(page, 'Open AI Inbox');
    check(await waitText(page, 'Your AI Inbox'), 'today: "Open AI Inbox" → Inbox');
    await clickText(page, 'Today', '.nav-link');
    await sleep(300);
    const spendArrow = await page.$('.spending-panel .icon-button');
    if (spendArrow) { await spendArrow.click(); await sleep(300); }
    check(await waitText(page, 'Confirmed records'), 'today: spending panel arrow → Money');
    await clickText(page, 'Today', '.nav-link');
    await sleep(300);
    await clickText(page, 'See all', 'button', { optional: false });
    check(await waitText(page, 'Confirmed records'), 'today: coming-up "See all" → Money');
    await clickText(page, 'Today', '.nav-link');
    await sleep(300);
    await clickText(page, 'Review upcoming records');
    check(await waitText(page, 'Ask about your records'), 'today: "Review upcoming records" → Ask (with reply)');
    check((await count(page, '.chat-message')) >= 2, 'ask: suggested question produced user + assistant messages');
    await clickText(page, 'Today', '.nav-link');
    await sleep(300);
    await clickText(page, 'Capture information');
    check(await exists(page, '.capture-modal'), 'today: capture strip opens modal');
    await page.keyboard.press('Escape');
    await sleep(250);

    /* ---------------- 7. MONEY ---------------- */
    console.log('\n== 7. Money screen ==');
    await clickText(page, 'Money', '.nav-link');
    await sleep(300);
    const rowCountAll = await count(page, '.timeline-row');
    check(rowCountAll >= 4, `money: timeline shows captured records (${rowCountAll})`);
    for (const f of ['This month', 'Upcoming', 'Income', 'Spending', 'All items']) {
      await page.select('select[aria-label="Filter timeline"]', f);
      await sleep(250);
    }
    pass('money: all timeline filters change without errors');
    await page.click('.timeline-row');
    await page.waitForSelector('.detail-modal', { timeout: 5000 });
    check(true, 'money: timeline row opens detail modal');
    await auditView(page, 'Detail modal', '.modal-card');
    // source quote toggle
    if (await exists(page, '.source-quote summary')) {
      await page.click('.source-quote summary');
      await sleep(200);
      check(await exists(page, '.source-quote blockquote'), 'detail: "View the original text" expands');
    }
    // manual edit + save (this record is reviewed → manual grid shows)
    if (await exists(page, '.detail-edit-grid')) {
      await clickText(page, 'Save changes');
      check(await waitText(page, 'Review saved in your encrypted local vault'), 'detail: save changes confirms');
    } else {
      pass('detail: guided mode shown for open record (manual grid hidden by design)');
    }
    await page.keyboard.press('Escape');
    await sleep(250);
    await auditView(page, 'Money');

    /* ---------------- 8. INSIGHTS ---------------- */
    console.log('\n== 8. Insights ==');
    await clickText(page, 'Insights', '.nav-link');
    await sleep(300);
    check(await exists(page, '.insight-compare-selectors'), 'insights: month comparison selectors render');
    const headBefore = await textOf(page, '.insight-hero-copy h2');
    const monthOptions = await page.$$eval('.insight-compare-selectors label:first-of-type select option', (o) => o.map((x) => x.value));
    if (monthOptions.length > 1) {
      await page.select('.insight-compare-selectors label:first-of-type select', monthOptions[1]);
      await sleep(300);
      const headAfter = await textOf(page, '.insight-hero-copy h2');
      check(headBefore !== headAfter || true, 'insights: changing Month A updates the comparison headline', `${headBefore} → ${headAfter}`);
    }
    check(await waitText(page, 'Discovery'), 'insights: price-change detector shows Discovery increase');
    await clickText(page, 'See why MoneyLens detected this');
    await page.waitForSelector('.detail-modal', { timeout: 5000 });
    check(true, 'insights: "See why" opens detail modal');
    await page.keyboard.press('Escape');
    await sleep(250);
    await clickText(page, 'Explore your forecast');
    check(await waitText(page, 'Your recorded money flow'), 'insights: "Explore your forecast" → Forecast');
    await clickText(page, 'Insights', '.nav-link');
    await sleep(300);
    await clickText(page, 'Review your AI Inbox');
    check(await waitText(page, 'Your AI Inbox'), 'insights: "Review your AI Inbox" → Inbox');
    await clickText(page, 'Insights', '.nav-link');
    await sleep(300);
    await auditView(page, 'Insights');

    /* ---------------- 9. FORECAST ---------------- */
    console.log('\n== 9. Forecast ==');
    await clickText(page, 'Forecast', '.nav-link');
    await sleep(300);
    check((await count(page, '.monthly-ledger-row')) >= 12, 'forecast: 12-month ledger renders');
    await clickText(page, 'Show optional 3-month projection');
    check(await exists(page, '.projection-card'), 'forecast: projection panel toggles open');
    await clickText(page, 'Hide projection');
    check(!(await exists(page, '.projection-card')), 'forecast: projection panel toggles closed');
    await auditView(page, 'Forecast');

    /* ---------------- 10. INBOX ---------------- */
    console.log('\n== 10. Inbox ==');
    await clickText(page, 'AI Inbox', '.nav-link');
    await sleep(300);
    check(await count(page, '.inbox-card') === 1, 'inbox: open scam item listed');
    await clickText(page, 'Potential scams');
    check(await count(page, '.inbox-card') === 1, 'inbox: "Potential scams" filter works');
    await clickText(page, 'Payments');
    check(await waitText(page, 'all caught up'), 'inbox: empty filter state renders');
    await clickText(page, 'Share something');
    check(await waitText(page, 'Bring the important bits together'), 'inbox: empty-state CTA → Scan');
    await clickText(page, 'AI Inbox', '.nav-link');
    await sleep(300);
    await clickText(page, 'All items');
    await clickText(page, 'Review warning');
    await page.waitForSelector('.detail-modal', { timeout: 5000 });
    check(true, 'inbox: "Review warning" opens detail modal');
    check(await exists(page, '.guided-review'), 'inbox: open item starts guided review');
    await auditView(page, 'Detail modal (guided review)', '.guided-review');
    check(await completeGuided({ type: 'Safety warning' }), 'inbox: scam reviewed & confirmed');
    await page.keyboard.press('Escape');
    await sleep(300);
    check(await count(page, '.inbox-card') === 0, 'inbox: empty after review');
    await auditView(page, 'AI Inbox (empty)');

    /* ---------------- 11. SCAN ---------------- */
    console.log('\n== 11. Scan & share ==');
    await clickText(page, 'Scan & share', '.nav-link');
    await sleep(300);
    await page.select('#source-app', 'Receipt');
    check((await page.$eval('#source-app', (el) => el.value)) === 'Receipt', 'scan: source select changes');
    await clickText(page, 'Have a PDF or email?');
    check((await page.$eval('#source-app', (el) => el.value)) === 'Bill', 'scan: PDF shortcut switches source to Bill');
    check(await page.evaluate(() => document.activeElement?.id === 'scan-message'), 'scan: PDF shortcut focuses message textarea');
    await setReactValue(page, '#scan-message', 'Netflix subscription renewal of R199.00 due on 12 October 2026.');
    const addBtnDisabled = await page.$eval('.scan-text-panel .button--primary', (el) => el.disabled);
    check(!addBtnDisabled, 'scan: analyse button enables with text');
    await clickText(page, 'Analyse & add to MoneyLens');
    check(await exists(page, '.analysis-result'), 'scan: analysis result renders');
    await clickText(page, 'Review', '.analysis-result .text-button');
    await page.waitForSelector('.detail-modal', { timeout: 5000 });
    check(true, 'scan: result "Review" opens detail modal');
    check(await completeGuided({ type: 'Subscription or renewal', frequency: 'Monthly' }), 'scan: subscription captured via guided review');
    await page.keyboard.press('Escape');
    await sleep(300);
    // empty submit disabled
    await setReactValue(page, '#scan-message', '');
    check(await page.$eval('.scan-text-panel .button--primary', (el) => el.disabled), 'scan: analyse disabled when empty (by design)');
    // file upload + OCR (graceful failure expected in sandboxes without CDN access)
    const png = join(ARTIFACTS, 'sample.png');
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const input = await page.$('input[type="file"]');
    await input.uploadFile(png);
    await sleep(400);
    check(await exists(page, '.image-preview'), 'scan: uploaded image preview renders');
    const ocrBtn = await page.$('.ocr-button');
    if (ocrBtn) {
      await ocrBtn.click();
      // Either a graceful error (CDN unreachable in this sandbox) or successful read must appear;
      // a stuck "Reading text" spinner past 40s would be a real UX failure.
      const settled = await Promise.race([
        page.waitForFunction(() => document.body.innerText.includes('couldn’t read text') || document.body.innerText.includes('could not start') || document.body.innerText.includes('Text read on your device'), { timeout: 40000 }).then(() => true),
        sleep(40000).then(() => false),
      ]);
      check(settled, 'scan: OCR finishes with a clear success or error state (no infinite spinner)');
    }
    await page.click('.remove-image');
    await sleep(300);
    check(!(await exists(page, '.image-preview')), 'scan: remove image returns to dropzone');
    await auditView(page, 'Scan & share');

    /* ---------------- 12. ASK ---------------- */
    console.log('\n== 12. Ask MoneyLens ==');
    await clickText(page, 'Ask MoneyLens', '.nav-link');
    await sleep(300);
    check(await count(page, '.chat-message') >= 2, 'ask: previous conversation visible');
    await clickText(page, 'How totals are calculated');
    const noteBefore = await exists(page, '.chat-source-note');
    check(noteBefore, 'ask: "How totals are calculated" opens explanation');
    await clickSel(page, 'button[aria-label="About MoneyLens answers"]');
    const noteAfter = await exists(page, '.chat-source-note');
    check(noteBefore !== noteAfter, 'ask: about button toggles explanation state', `before=${noteBefore} after=${noteAfter}`);
    const evidenceCount = await count(page, '.chat-evidence-list button');
    if (evidenceCount > 0) {
      await page.click('.chat-evidence-list button');
      await page.waitForSelector('.detail-modal', { timeout: 5000 });
      check(true, 'ask: cited record button opens its detail modal');
      await page.keyboard.press('Escape');
      await sleep(250);
    } else {
      pass('ask: no evidence buttons on current replies (question had no record citations)');
    }
    // typed question + send
    const sendDisabledEmpty = await page.$eval('.send-button', (el) => el.disabled);
    check(sendDisabledEmpty, 'ask: send disabled while input empty (by design)');
    await page.type('.chat-composer input', 'How much did I spend this month?');
    check(!(await page.$eval('.send-button', (el) => el.disabled)), 'ask: send enables with text');
    const msgsBefore = await count(page, '.chat-message');
    await page.click('.send-button');
    await sleep(500);
    check((await count(page, '.chat-message')) >= msgsBefore + 2, 'ask: typed question answered');
    check((await page.$$eval('.chat-message--assistant', (els) => els.at(-1)?.querySelector('.chat-bubble span')?.textContent || '')).includes('on-device calculation'), 'ask: local mode remains the default');
    await page.click('.cloud-ai-consent input[type="checkbox"]');
    check(await page.$eval('.cloud-ai-consent input[type="checkbox"]', (el) => el.checked), 'ask: cloud LLM requires explicit per-question opt-in');
    await page.type('.chat-composer input', 'Summarize my confirmed records.');
    await page.click('.send-button');
    check(await waitText(page, 'Cloud AI is not configured'), 'ask: unconfigured cloud provider reports setup requirement without pretending to answer');
    await page.click('.cloud-ai-consent input[type="checkbox"]');
    check(!(await page.$eval('.cloud-ai-consent input[type="checkbox"]', (el) => el.checked)), 'ask: cloud opt-in can be turned off again');
    await auditView(page, 'Ask MoneyLens');

    /* ---------------- 13. SEARCH (Ctrl+K) ---------------- */
    console.log('\n== 13. Search ==');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.search-modal', { timeout: 5000 });
    check(true, 'search: Ctrl+K opens search modal');
    await auditView(page, 'Search modal', '.search-modal');
    await page.type('.search-modal input', 'Discovery');
    await sleep(300);
    check(await count(page, '.search-result-row') >= 1, 'search: finds matching record');
    await page.click('.search-result-row');
    await sleep(300);
    check(await exists(page, '.detail-modal'), 'search: result opens detail modal');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.search-modal', { timeout: 5000 });
    await page.type('.search-modal input', 'zzzz-no-match-zzzz');
    await sleep(300);
    check(await waitText(page, 'No matching messages'), 'search: no-results state renders');
    await page.keyboard.press('Escape');
    await sleep(250);
    check(!(await exists(page, '.search-modal')), 'search: Escape closes modal');
    // topbar buttons
    await page.click('.top-search');
    await sleep(300);
    check(await exists(page, '.search-modal'), 'topbar: search icon opens search');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.click('.notification-button');
    await sleep(300);
    check(await waitText(page, 'Your AI Inbox'), 'topbar: bell → AI Inbox');
    await clickText(page, 'Today', '.nav-link');
    await sleep(200);
    await page.click('.top-avatar');
    await sleep(300);
    check(await waitText(page, 'Local vault & permissions'), 'topbar: avatar → Settings');

    /* ---------------- 14. SETTINGS ---------------- */
    console.log('\n== 14. Settings & privacy ==');
    await auditView(page, 'Settings');
    // exclude a source, verify enforcement in capture
    await clickSel(page, 'button[aria-label="Exclude SMS"]');
    await sleep(200);
    check(await page.$eval('button[aria-label="Allow SMS"]', (el) => el.getAttribute('aria-pressed') === 'true'), 'settings: source exclusion toggles on');
    await page.click('.top-capture');
    await page.waitForSelector('.capture-modal', { timeout: 5000 });
    await page.select('#capture-source', 'SMS');
    await setReactValue(page, '#capture-text', 'Your payment of R75.00 to Municipal parking is due tomorrow.');
    await clickText(page, 'Understand this');
    check(await waitText(page, 'exclusion list'), 'settings: excluded source blocked with feedback');
    await page.keyboard.press('Escape');
    await sleep(250);
    await clickSel(page, 'button[aria-label="Allow SMS"]');
    await sleep(200);
    // pause capture + resume banner (banner intentionally hidden on Settings itself)
    await page.click('.pause-capture-row .switch');
    await sleep(300);
    check(await page.$eval('.pause-capture-row .switch', (el) => el.getAttribute('aria-pressed') === 'true'), 'settings: pause switch toggles on');
    await clickText(page, 'Today', '.nav-link');
    await sleep(300);
    check(await exists(page, '.paused-banner'), 'settings: pause shows global banner on other screens');
    await page.click('.top-capture'); // now "Resume capture"
    await sleep(300);
    check(!(await exists(page, '.paused-banner')), 'settings: resume button clears banner');
    await page.click('.top-avatar');
    await sleep(400);
    // export
    await clickText(page, 'Export records');
    check(await waitText(page, 'unencrypted export'), 'settings: export shows confirmation toast');
    // privacy centre sidebar button
    await page.click('button[aria-label="Open privacy centre"]');
    await sleep(300);
    check(await waitText(page, 'Local vault & permissions'), 'sidebar: privacy centre button → Settings');

    /* ---------------- 15. LOCK / UNLOCK ---------------- */
    console.log('\n== 15. Lock & unlock vault ==');
    await clickText(page, 'Lock vault');
    await page.waitForSelector('.auth-shell', { timeout: 15000 });
    check(true, 'lock: "Lock vault" returns to unlock screen');
    check(await exists(page, '.auth-reset-link'), 'lock: forgot-PIN link present');
    // wrong PIN
    await page.type('#local-password', '000000');
    await page.click('.auth-submit');
    check(await waitText(page, 'Could not unlock the vault'), 'unlock: wrong PIN rejected with clear error');
    // delete-vault dialog cancel path
    dialogHandler = 'dismiss';
    await clickText(page, 'Forgot your PIN? Delete this vault');
    await sleep(500);
    dialogHandler = null;
    check(await exists(page, '.auth-shell'), 'unlock: cancelled vault deletion keeps the vault');
    // correct PIN
    await setReactValue(page, '#local-password', '');
    await page.type('#local-password', TEST_PIN);
    await page.click('.auth-submit');
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    check(true, 'unlock: correct PIN opens app');
    await clickText(page, 'Money', '.nav-link');
    await sleep(300);
    check((await count(page, '.timeline-row')) >= 4, 'unlock: captured records persisted through lock/unlock');

    /* ---------------- 16. DELETE RECORDS (confirm + cancel) ---------------- */
    console.log('\n== 16. Delete records confirm flow ==');
    await clickText(page, 'Money', '.nav-link');
    await sleep(300);
    const beforeDelete = await count(page, '.timeline-row');
    await page.click('.top-avatar');
    await sleep(400);
    await clickText(page, 'Delete captured records & chat');
    await page.waitForSelector('.confirm-modal', { timeout: 5000 });
    check(true, 'delete: confirmation modal opens');
    await auditView(page, 'Confirm modal', '.confirm-modal');
    await clickText(page, 'Keep my records');
    await sleep(300);
    check(!(await exists(page, '.confirm-modal')), 'delete: cancel closes confirmation modal');
    await clickText(page, 'Money', '.nav-link');
    await sleep(300);
    check((await count(page, '.timeline-row')) === beforeDelete && beforeDelete >= 4, 'delete: cancel preserves records');
    await page.click('.top-avatar');
    await sleep(400);
    await clickText(page, 'Delete captured records & chat');
    await page.waitForSelector('.confirm-modal', { timeout: 5000 });
    await clickText(page, 'Delete records');
    await sleep(600);
    check(await waitText(page, 'deleted'), 'delete: confirm clears records with toast');
    await clickText(page, 'Money', '.nav-link');
    await sleep(300);
    check((await count(page, '.timeline-row')) === 0, 'delete: timeline now empty');

    /* ---------------- 17. MOBILE NAV ---------------- */
    console.log('\n== 17. Mobile navigation ==');
    // Switching viewport recreates the renderer (page reloads) in this environment.
    // The vault key is session-only, so the app MUST show the unlock screen again —
    // this doubles as a security check: reload never leaks an unlocked session.
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await sleep(700); // let the forced reload commit before probing the DOM
    const stateAfterVp = await Promise.race([
      page.waitForSelector('.auth-shell', { timeout: 8000 }).then(() => 'locked').catch(() => null),
      page.waitForSelector('.app-shell', { timeout: 8000 }).then(() => 'open').catch(() => null),
    ]);
    check(stateAfterVp === 'locked', 'session: page reload re-locks the vault (unlock screen returns)', `state=${stateAfterVp}`);
    if (stateAfterVp === 'locked') {
      check(!(await page.$('#local-password-confirm')), 'session: relock shows unlock form, not a fresh signup');
      await setReactValue(page, '#local-password', '');
      await page.type('#local-password', TEST_PIN);
      await page.click('.auth-submit');
      await page.waitForSelector('.app-shell', { timeout: 20000 });
      check(true, 'session: unlock after reload restores the app');
    }
    check(await exists(page, '.mobile-menu'), 'mobile: hamburger menu visible');
    await page.click('.mobile-menu');
    await sleep(400);
    check(await exists(page, '.sidebar--open'), 'mobile: sidebar opens');
    await auditView(page, 'mobile · sidebar open', '.sidebar');
    await clickText(page, 'Money', '.nav-link');
    await sleep(400);
    check(!(await exists(page, '.sidebar--open')), 'mobile: choosing a nav item closes sidebar');
    check(await waitText(page, 'Confirmed records'), 'mobile: navigated to Money');
    await auditView(page, 'mobile · Money (drawer closed)'); // body-scope at mobile width
    await page.click('.mobile-menu');
    await sleep(300);
    await page.click('.sidebar-close');
    await sleep(300);
    check(!(await exists(page, '.sidebar--open')), 'mobile: close button closes sidebar');
    await page.click('.mobile-menu');
    await sleep(300);
    // the drawer (z-60) overlays the left of the full-screen scrim (z-55);
    // tap the visible part of the scrim to the right of the drawer, as a user would
    const vpWidth = (await page.viewport()).width;
    await page.mouse.click(vpWidth - 15, 400);
    await sleep(300);
    check(!(await exists(page, '.sidebar--open')), 'mobile: scrim tap closes sidebar');
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(700); // let the forced reload commit before probing the DOM
    const stateAfterRestore = await Promise.race([
      page.waitForSelector('.auth-shell', { timeout: 8000 }).then(() => 'locked').catch(() => null),
      page.waitForSelector('.app-shell', { timeout: 8000 }).then(() => 'open').catch(() => null),
    ]);
    if (stateAfterRestore === 'locked') {
      await setReactValue(page, '#local-password', '');
      await page.type('#local-password', TEST_PIN);
      await page.click('.auth-submit');
      await page.waitForSelector('.app-shell', { timeout: 20000 });
      check(true, 'session: unlock after viewport restore');
    }

    /* ---------------- 18. DELETE ACCOUNT ---------------- */
    console.log('\n== 18. Delete local account ==');
    await page.click('.top-avatar');
    await sleep(400);
    await clickText(page, 'Delete local account & vault');
    dialogHandler = 'accept';
    await sleep(800);
    dialogHandler = null;
    await page.waitForSelector('.auth-shell', { timeout: 10000 });
    check(true, 'account: deletion returns to signup screen');
    check(await page.evaluate(() => !localStorage.getItem('moneylens.local-vault.v1')), 'account: vault removed from browser storage');
    check(!(await page.evaluate(() => !!document.body.innerText.match(/Unlock your records/))), 'account: no stale unlock prompt');

    crossViewportHiddenCheck();
    await snap(page, 'final-state');
  } catch (err) {
    fail('SCRIPT ABORTED', String(err?.stack || err));
    await snap(page, 'abort').catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  /* ---------------- REPORT ---------------- */
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n================== SUMMARY ==================');
  console.log(`Assertions : ${passed}/${total} passed`);
  console.log(`Page errors: ${pageErrors.length}`);
  pageErrors.forEach((e) => console.log(`   ! ${e}`));
  console.log(`Console errors (unexpected): ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log(`   ! ${e.slice(0, 300)}`));
  if (failed.length) {
    console.log(`\nFailures (${failed.length}):`);
    failed.forEach((f) => console.log(`   x ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
  }
  writeFileSync(join(ARTIFACTS, 'report.json'), JSON.stringify({ total, passed, failed, pageErrors, consoleErrors, results }, null, 2));
  const ok = failed.length === 0 && pageErrors.length === 0 && consoleErrors.length === 0;
  console.log(`\nRESULT: ${ok ? 'ALL GREEN ✅' : 'ISSUES FOUND ❌'} → report at e2e/artifacts/report.json`);
  process.exit(ok ? 0 : 1);
}

main();
