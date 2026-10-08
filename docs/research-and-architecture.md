# MoneyLens: research, product boundaries and architecture

**Research snapshot:** 29 September 2026. This is product/engineering research, not South African legal advice or a substitute for bank/Google Play approval.

## 1. Executive recommendation

Build MoneyLens as a **user-controlled event-intelligence layer**, not as “another budget that imports transactions.” The distinctive job is to turn a bill change, a deadline, a renewal, a payslip explanation or a suspicious message—arriving across different channels—into a source-linked event, then connect it to the person’s other confirmed information.

The prototype in this repository demonstrates a capture-to-review flow in one browser:

> create a device-local vault → intentionally share text/image → inspect a rule-based extraction → answer one field question at a time → confirm or correct the record → automatically refresh dated calculations → compare any two selected months → open source records → export or delete

A limited guest preview starts empty and saves nothing. This prototype does **not** ingest operating-system notifications, connect to a bank, use a cloud LLM, or make an external financial decision. Its browser cannot read SMS, WhatsApp or bank-app notifications and does not request or simulate those permissions. A local account/6-digit PIN is not a hosted identity service: there is no email verification, cloud sync, password recovery or cross-device access.

## 2. What the research changes about the product

### The category is not empty; the point of difference must be precise

FNB’s own nav» Money describes auto-categorised spend, budget alerts, savings goals, net-worth snapshots and money coaching. Vault22 (formerly 22seven) describes linked-account transaction gathering, automatic categories, budgets and insights. “Automatically categorise spending” or “show spending in one place” is therefore not a defensible innovation claim on its own. MoneyLens should differentiate on **cross-source life-admin context**: one insurance email + the old premium + a due-date message + a receipt can become an explainable change, reminder and cash-flow scenario—even when no bank feed exists. [FNB nav» Money](https://www.fnb.co.za/ways-to-bank/digital/navMoney.html) · [Vault22](https://22seven.com/privacy)

### South African bank connectivity is a partner decision, not a front-end feature

The South African Reserve Bank’s March 2026 public update says the IFWG finalised an open-finance cost/benefit analysis in 2025 and that work to develop an appropriate regulatory framework was continuing into the next financial year. This is a direction of travel, **not evidence that a standard, generally available retail-account API can be assumed today**. [SARB / National Treasury, 2026 Budget Review](https://www.resbank.co.za/content/dam/sarb/what-we-do/financial-surveillance/financial-surveillance-documents/2026/3-2026.pdf)

FNB’s Integration Channel lists a Transaction History API. Its page describes scoped product/customer groups and a third-party route where the customer consents to share selected account information. That is a real partner path worth exploring with FNB, but the documented product scope is not a universal, self-serve personal-account feed. MoneyLens must not ask for bank passwords or emulate login pages. [FNB Integration Channel — Transaction History](https://www.fnb.co.za/integration-channel/catalogue/serviceCatalogue-ZA/services.html?catalogue=serviceCatalogue-ZA&type=API&service=Transaction-History)

The SARB’s open-banking consultation explains why: secure APIs with customer permission are preferable to credential-based screen scraping, and data sharing must have clear control and responsibilities. Use an approved bank/aggregator API after commercial, security and legal review; otherwise keep user-selected file/share input as a fallback. [SARB, Consultation Paper on Open-Banking Activities](https://www.resbank.co.za/content/dam/sarb/what-we-do/payments-and-settlements/regulation-oversight/Consultation%20Paper%20on%20open%20banking.pdf)

### Android notification reading is technically possible, but it is sensitive and not the same as reading SMS

Android’s `NotificationListenerService` receives callbacks for notifications posted or removed. The user must enable notification access in Android Settings; a native service is required. It reads notification content exposed by an app/system notification, not a general history of every message, and source apps may redact or omit previews. Treat it as an optional, revocable ingestion adapter with a user allowlist, local relevance filter and manual-share fallback. [Android API reference](https://developer.android.com/reference/android/service/notification/NotificationListenerService)

Do **not** add broad `READ_SMS`/Call Log permissions to the current concept by default. Google Play classifies them as high-risk/sensitive and restricts them to documented permitted core use cases or reviewed exceptions; a financial-management app should not assume it qualifies. The live policy page also flags forthcoming policy changes, so re-check it at release time. [Google Play: SMS or Call Log permissions](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en)

**Native ingestion design:** request only notification-listener access after a plain-language disclosure; let the person enable/disable sources; filter package names before persistence; process on-device where feasible; suppress OTP/PIN/password content; keep raw text only for a disclosed short purpose; make pause, exclude-app and delete controls work immediately. Never access accessibility services to scrape banking screens.

### POPIA implies an explicit, minimal, explainable data lifecycle

A phone notification can contain personal information about the user and other people. POPIA’s definition includes information such as financial history. That makes the source text sensitive in ordinary product/security terms, but **financial information is not automatically one of POPIA’s listed “special personal information” categories solely because it is financial**. A lawyer/privacy officer should assess each data field and processing purpose rather than using “sensitive” as a legal shortcut.

The Act sets eight conditions for lawful processing, including accountability, processing limitation/minimality, purpose specification, compatible further processing, information quality, openness, security safeguards and data-subject participation. It provides multiple justifications for processing; consent is one route, not a universal substitute for the full analysis. It also addresses operator contracts/security, breach notification, access/correction, cross-border flows and automated decision-making. Design for specific purposes, data minimisation, a visible source, accuracy review, user corrections, retention limits, export/delete and simple withdrawal from optional integrations. [POPIA, official Information Regulator PDF](https://inforegulator.org.za/wp-content/uploads/2025/08/PROTECTION-OF-PERSONAL-INFORMATION-ACT-4-OF-2013.pdf)

Section 71 is relevant if MoneyLens later makes solely automated profile-based decisions with legal consequences or a substantial effect. Keep the product at “organise, explain, flag, estimate and ask” rather than creditworthiness, eligibility, insurance-pricing or autonomous decisions. Make user review meaningful rather than a decorative “confirm” button. [POPIA, section 71](https://inforegulator.org.za/wp-content/uploads/2025/08/PROTECTION-OF-PERSONAL-INFORMATION-ACT-4-OF-2013.pdf)

### Helpful cash-flow arithmetic is not a licence to give product advice

The FAIS Act defines “advice” broadly to include a recommendation, guidance or proposal of a financial nature to a client in respect of purchasing or investing in a financial product, while distinguishing certain factual/objective information and analyses without a recommendation. A transparent arithmetic scenario based on a user-entered amount is different from recommending a specific loan, insurance policy, investment or credit product, which may be a regulated product decision. Have South African counsel/compliance review the actual user journeys, partnerships, ranking, referral compensation and wording before launch. [FAIS Act 37 of 2002, official Government Gazette PDF](https://www.gov.za/sites/default/files/gcis_document/201409/a37-020.pdf)

### Low-data design is a product requirement, not a slogan

ICASA’s March 2026 ICT-sector report records substantial mobile connectivity, but also continuing differences in fixed/mobile access and affordability. That supports a resilient Android-first, low-bandwidth and offline-aware experience; it does **not** justify assuming every intended user is always online, owns a recent phone or can afford repeated large model downloads. [ICASA, State of the ICT Sector in South Africa, March 2026](https://www.icasa.org.za/uploads/files/The-State-of-the-ICT-Sector-Report-of-South-Africa-31-March-2026.pdf)

The current prototype caches a small production app shell after first visit. Screenshot OCR is optional and its Tesseract worker/WASM/language assets can require a one-time CDN download; manual paste remains the low-data fallback. Tesseract.js supports browser OCR, but does not support PDF input. A real low-data release should self-host/pin signed OCR assets, report their size, let users opt in to a language/model download, and avoid blocking core capture when offline. [Tesseract.js project documentation](https://github.com/naptha/tesseract.js)

## 3. MVP behaviour and acceptance criteria

| Capability | Prototype behaviour | Production acceptance criterion |
| --- | --- | --- |
| Relevance | Ignores a small set of obvious social-noise phrases; only analyzes information the user intentionally shares | Per-source/package rules for native capture, user-configurable exclusions, measured false-positive review |
| Extraction | Local rules parse common `R`/`ZAR` formats and selected date/source/category clues; every new capture remains unconfirmed; multiple ambiguous amounts are left blank | Locale-tested corpus, field-level provenance and calibrated abstention across languages/OCR quality |
| Confidence | Visible rule-match heuristic is explicitly not a probability; unreviewed items remain outside totals | Scores validated on consented, representative messages; abstain on unsupported languages/low-quality OCR |
| Explainability | Stores original user-shared text, reason bullets, source, capture date, editable amount/category/date, and link domain; a guided interview explicitly asks for missing facts | Field-level provenance, corrections, rule version, retention controls and meaningful review |
| Screenshot rescue | Optional browser OCR; extracted text is editable before analysis | OCR evaluation by device/language/document type; PDF strategy; accessible capture; no image upload without a separate choice |
| Timeline & insights | Month totals use only reviewed posted records with valid transaction date, flow and amount; upcoming records remain separate; same-date/amount/direction records receive a possible-duplicate warning but are not auto-deduplicated | Reliable cross-source duplicate/reversal handling; support transfers/refunds/irregular income; visible coverage and completeness limits |
| Forecast | Optional simple historical average only when all three prior months contain at least one confirmed dated inflow and outflow; missing flows are not treated as zero; projection is separate from actuals | Validate history sufficiency and user comprehension; explicit horizon and missing-data scenarios; never imply a live balance |
| ScamLens | Flags selected urgency/credential patterns and extracts a URL hostname without opening it | Calibrated “risk signals, not verdict” language, secure domain reputation service review, no click-through/open-on-detection |
| Money chat | Local deterministic answers over confirmed records with links to the records used; missing data is not filled with zero | Red-team retrieval/data-leak tests and evidence correctness; no unsupported claims |
| Local vault | 6-digit-PIN-derived AES-GCM encryption for record/chat data in browser storage; local email label; no recovery or cloud sync | Independent threat model/security testing, platform-backed key storage, deletion and recovery policy, incident response |
| Payments | None | Explicitly out of scope; do not add without a separately regulated, authenticated, user-confirmed payment flow |

## 4. Prototype architecture and data flow

```text
User-selected text ─┐
                    ├─> analyzeMessage() ─> unconfirmed event + source text + reasons
Screenshot ─> optional in-browser OCR ┘                         │
                                                                  ├─ human review/correction
                                                                  ├─ encrypted local browser vault
                                                                  ├─ confirmed dated actuals + separate upcoming records
                                                                  └─ linked assistant answers + optional historical average
```

- **UI:** React 18 + Vite; responsive Today, Money, Insights, Forecast, AI Inbox, Scan & share, Ask and Settings views.
- **Domain logic:** `src/core/intelligence.js` is a local rules engine. `analyzeMessage` returns an unconfirmed event with source text, a heuristic rule-match score, explanation and optional safety flags. Monthly calculations require reviewed posted records, an `in`/`out` flow, a valid explicit transaction date and a valid amount. `makeAssistantReply` uses confirmed records and returns source summaries.
- **No seed dataset:** `src/core/demoData.js` was removed. A new account and the guest preview both start without financial activity; calculations display no totals until the user captures and confirms records.
- **Persistence:** `src/core/storage.js` derives an AES-GCM-256 key from the 6-digit PIN via PBKDF2-SHA256 (310,000 iterations; the PIN is a numeric-only convenience code with a 1,000,000-value space, so it does not resist offline guessing of a stolen vault envelope) and encrypts record/chat state before writing it to browser storage. The email label and encryption metadata are visible in the local envelope. There is no backend, email verification, recovery, cloud sync or cross-device account. A forgotten 6-digit PIN is unrecoverable and, being only 1,000,000 values, cannot resist offline guessing of a copied vault; downloaded JSON exports are plaintext.
- **OCR:** `ScanScreen` lazy-loads Tesseract.js after the user selects “Read text on this device.” The user can inspect/edit OCR output before it is added. No app backend is configured.
- **Offline shell:** `public/sw.js` caches the production app shell/assets after first use. OCR asset download is an exception; the paste path works without OCR.
- **No external telemetry, model key, API proxy, bank connector or payment provider is present.**

### Actuals and projection definitions

A monthly actual is computed only from confirmed posted records with a valid amount, `in`/`out` flow and user-confirmed transaction date:

```text
captured net flow = confirmed dated inflows − confirmed dated outflows
```

This is arithmetic over saved records—not available cash, a bank balance, or a complete spending history. The capture date is never substituted for a transaction date, unknown dates are excluded, and upcoming commitments are shown separately rather than subtracted from historical net flow.

An optional projection is the simple average of each of the three prior calendar months, and is available only when each month has at least one confirmed dated inflow and one confirmed dated outflow. A missing flow is not treated as zero. It is explicitly a projection from captured data; it cannot establish completeness or predict future events. Duplicate/reversal handling, coverage denominators and robust low-history uncertainty remain production work.

### Event shape

Each event keeps (at least) `source`, `sourceText`, `date`, `dueDate`, `merchant`, `kind`, `category`, `amount`, `flow`, `state`, `recurring`, `confidence`, `explanation`, `flags`, `linkDomain` and `inboxState`. Production should version this schema and keep raw content separate from derived fields so a person can delete the original while retaining only a lawful/necessary corrected record if appropriate.

## 5. Safety and privacy threat model

| Threat / failure | Prototype mitigation | Required before real users |
| --- | --- | --- |
| A social notification is mistaken for money | Small irrelevant-message rule; source exclusion; review state | Test diverse writing/code-switching; abstain rather than create noisy data |
| Amount/date/category is wrong | Original text, explanation and editable category/amount; medium/low items go to inbox | Field-level confidence, calibrated thresholds, duplicate/reversal handling, representative evaluation |
| Scam message is actually legitimate (or vice versa) | “Potential scam”; no definitive verdict; never opens URL; domain shown as text | Security review of URL handling; verified official-channel guidance; abuse monitoring and user feedback |
| OTP, password, PIN or third-party personal data is captured | User warning; no server/model; raw text is still stored in the encrypted vault if the user chooses to share it | On-device redaction before persistence; safe allowlists; exclusion/short retention; legal basis/notice for data about others |
| Browser/local profile is inspected or device is shared | Record/chat state is AES-GCM encrypted at rest with a PIN-derived key; email/KDF metadata remains visible; manual lock and vault deletion exist | Independent audit, platform-backed key storage, idle lock, backup protection, secure erase, recovery/incident plan; test hostile same-origin code/device compromise |
| Captured net flow looks like a bank balance | UI says it is based on dated confirmed captures, not a balance; no “available cash” calculation | Coverage/staleness display and user testing for comprehension; no unsupported completeness claims |
| A product is treated as financial advice | No product ranking, referral or payment action; scenario only | FAIS/FSCA perimeter opinion before offering product-specific steering or intermediation |
| Incorrect data changes a consequential outcome | No eligibility/credit decision or external action | Human intervention, appeal/correction path, explainability and legal review; prohibit solely automated high-impact use where applicable |
| Third-party AI/OCR leaks personal text | No cloud AI. User-selected OCR runs in browser; only model assets may download | Vendor/operator due diligence, data-processing terms, residency/cross-border review, no-train/retention controls and separate informed consent |

## 6. Recommended implementation path

### Phase A — Validate the problem and language (before production integrations)

1. Conduct opt-in interviews with a mix of salaried workers, people with irregular income and household bill-payers in South Africa. Validate which real missed-information jobs are frequent; do not infer demand from this concept document alone.
2. Use fictional or consented/redacted examples. Test message relevance and common ZAR/date variations in English, then co-design multilingual support rather than machine-translating financial terms.
3. Measure whether users understand the difference between captured estimate and bank balance, why an item was flagged, what is stored, and how to exclude/delete it.
4. Agree a false-positive budget for “AI Inbox” noise and a high-confidence precision target before automating any classification.

### Phase B — Native capture, still local-first

1. Build an Android shell/service for `NotificationListenerService`; show a prominent disclosure and separate system-settings consent, filter permitted apps and capture only event fields needed for the feature.
2. Prefer local extraction and encrypted on-device storage. Keep manual share/paste as a first-class path and add pause/exclude controls before activating a listener.
3. Add screenshot/receipt processing with visible OCR confidence and correction. Handle poor signal without blocking the timeline/reminders.
4. Run a data protection impact assessment / privacy impact review, security threat modelling and independent mobile-app review; final legal process and notices should be approved by a South African privacy professional.

### Phase C — Consent-based account feeds, not credentials

1. Start a partner discussion with FNB around the documented Integration Channel/API, account scope, consent lifecycle, revocation, polling/webhook behaviour, customer eligibility, operator roles, service levels, incident response and data retention.
2. For other institutions, compare bank APIs or vetted aggregation providers on bank coverage, consent/token design, least privilege, security assurance, data residency, deletion and customer recourse.
3. Never request or store online-banking usernames, passwords, PINs or one-time codes. Do not implement screen scraping as a shortcut.
4. Re-check SARB/IFWG rules, the payment-activity authorisation framework and bank partner requirements at the time of launch; current open-finance work is evolving.

### Phase D — Optional cloud intelligence

Only after a clear product need, privacy notice, risk assessment and provider contract: use a backend boundary with authentication, per-user authorization, encrypted transport/storage, short retention, key management, abuse monitoring and deletion propagation. Send the minimum redacted fields needed to the chosen model; avoid raw notification/document uploads by default. Use event-level citations in generated answers, version prompts/models, test prompt injection in messages and treat source text as untrusted input. Keep all payment decisions outside the model.

## 7. Research references

Primary/regulatory references reviewed on 29 September 2026:

1. **POPIA:** [Information Regulator — Protection of Personal Information Act 4 of 2013 (PDF)](https://inforegulator.org.za/wp-content/uploads/2025/08/PROTECTION-OF-PERSONAL-INFORMATION-ACT-4-OF-2013.pdf)
2. **Open finance policy status:** [SARB / National Treasury — 2026 Budget Review, “Implementation of an open finance framework” (PDF)](https://www.resbank.co.za/content/dam/sarb/what-we-do/financial-surveillance/financial-surveillance-documents/2026/3-2026.pdf)
3. **Open banking principles:** [SARB — Consultation paper on open-banking activities (PDF)](https://www.resbank.co.za/content/dam/sarb/what-we-do/payments-and-settlements/regulation-oversight/Consultation%20Paper%20on%20open%20banking.pdf)
4. **FNB API scope:** [FNB Integration Channel — API Transaction History](https://www.fnb.co.za/integration-channel/catalogue/serviceCatalogue-ZA/services.html?catalogue=serviceCatalogue-ZA&type=API&service=Transaction-History)
5. **Android notification interface:** [Android Developers — `NotificationListenerService`](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
6. **Google Play permissions:** [Google Play Console Help — Use of SMS or Call Log permission groups](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en)
7. **Financial advice perimeter:** [FAIS Act 37 of 2002 — official Government Gazette PDF](https://www.gov.za/sites/default/files/gcis_document/201409/a37-020.pdf)
8. **Local market comparison:** [FNB — nav» Money](https://www.fnb.co.za/ways-to-bank/digital/navMoney.html); [Vault22 — product and privacy overview](https://22seven.com/privacy)
9. **Connectivity context:** [ICASA — State of the ICT Sector of South Africa, March 2026 (PDF)](https://www.icasa.org.za/uploads/files/The-State-of-the-ICT-Sector-Report-of-South-Africa-31-March-2026.pdf)
10. **Browser OCR scope:** [Tesseract.js project README](https://github.com/naptha/tesseract.js)

## 8. Open questions to resolve with users/partners

- Which sources are safe, useful and reliable enough for automatic processing, and which should remain user-share only?
- Does a South African user value an information-first inbox more than an all-account view, and what does “coverage” mean to them?
- Should family/household obligations be modelled without exposing each person’s private events?
- Which languages and code-switching patterns should be supported first, and how will confidence be evaluated in each?
- What local bank/API/aggregator partnership can provide permitted, scoped, revocable data access without collecting credentials?
- Which consent wording, notice, lawful basis, retention period, operator arrangements, transfer mechanism and regulatory perimeter apply to the launched service?
