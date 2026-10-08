# MoneyLens

> **Only say what your records can prove.**

MoneyLens is a South African, capture-based personal-finance intelligence prototype. It turns information you intentionally share into reviewable records, then calculates exact totals only from the records you confirm. It does not assume that those records are complete, read a live bank balance, or connect to messages in other apps.

## What this repository does

This is a runnable browser prototype—not a production financial service, hosted account system or Android notification listener.

1. **Create a local account or preview.** The preview starts with no records, saves nothing and is limited to three views per browser tab. To save personal records, create a local account with an email label and a 6-digit PIN.
2. **Capture intentionally.** Paste message text or choose an image for optional in-browser OCR. The browser cannot read SMS, WhatsApp or bank-app notifications; it does not request or simulate those permissions.
3. **Answer a short follow-up interview.** MoneyLens asks what happened, checks the amount, requests the actual transaction date or due date, and confirms the name, category and any explicitly stated frequency. You can correct a clue, leave it unknown or keep the item out of totals. New captures remain unconfirmed until you finish.
4. **Let calculations update automatically.** A capture date is never treated as a transaction date. Confirmed monthly totals include only reviewed posted records with a valid transaction date, flow and amount. Upcoming commitments are shown separately. Missing fields are called out instead of guessed.
5. **Compare what matters.** Choose any two available months and compare confirmed inflow, outflow, net captured flow and categories where both months have records. Ask MoneyLens to compare a named category or month; answers link to the records used. Missing information is not replaced with zero. A possible same-date/amount/direction match is flagged for review, not automatically removed, so check possible duplicates.
6. **Use an optional historical projection.** A simple average is available only after each of the three prior months has at least one confirmed, dated inflow and outflow record. A missing flow is not treated as zero. It is labeled as a projection from captured records—not an observed result, complete financial picture or prediction. Totals describe saved records, not full spending or an account balance.
7. **Control local data.** Exclude sources, pause user-shared captures, export a JSON copy, clear records/chat, lock the vault or delete the local account.

## Local account and privacy limits

The local account is **not a hosted login**: the email is an unverified label stored in this browser. There is no server, cloud sync, email recovery or cross-device access. A 6-digit PIN derives an AES-GCM-256 key in the browser using PBKDF2-SHA256 (310,000 iterations). Record/chat content is encrypted before it is saved; account metadata (including the email label, salt and encryption parameters) remains visible to the browser. Forgetting the PIN makes the vault unrecoverable. A downloaded JSON export is unencrypted. **The 6-digit PIN is a convenience unlock code, not a strong secret:** it has only 1,000,000 possible values, so anyone who obtains the stored vault envelope (for example on a shared or compromised profile) could guess it offline. Treat the PIN as protecting against casual access only, and keep evaluation data fictional or redacted. Do not share PINs, passwords, one-time codes or full account numbers.

This prototype has not had an independent security audit and does not provide a mobile Keystore, multi-user session management, remote backup/deletion or production account recovery. While the vault is unlocked, browser/device compromise can expose its contents. Use fictional or suitably redacted material during evaluation.

## Run it

Requirements: Node.js 18+ (tested with Node 22).

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Build and serve the production shell with:

```bash
npm test
npm run build
npm run preview
```

The service worker caches the app shell after a successful visit; it does not create a notification listener or bank feed. Screenshot OCR is optional and uses Tesseract.js in the browser. Its worker/WASM/English language assets may download from the Tesseract CDN on first use. Manual paste remains available if OCR is unavailable. PDFs are not OCRed.

### Optional cloud LLM answers

“Ask MoneyLens” now offers two distinct modes. The default is the existing deterministic, on-device calculation assistant. To use a real LLM, configure an OpenAI-compatible provider on the **server**:

```bash
cp .env.example .env
# Edit .env locally and set OPENAI_API_KEY to your provider key.
# Optional: set OPENAI_MODEL and OPENAI_BASE_URL for an OpenAI-compatible provider.
npm run dev
```

Never put the key in a `VITE_*` variable or frontend code, and never commit `.env`. In the Ask screen, cloud use is **off by default** and requires checking “Use cloud AI for my next question.” That request sends the question and up to 100 confirmed/reviewed record summaries (merchant label, dates, amount, category, flow and kind) to the configured provider. Raw captured message text, passwords and the provider key are not sent. The provider’s retention and data-use terms apply. The browser displays which mode answered; cloud answers can be wrong and must be checked against cited records. The server rejects cross-origin requests, limits request size and applies a basic per-client rate limit.

The API server binds to loopback on port 8787 and Vite proxies `/api` to it in development. For a production deployment, host `server/ai.js` behind an authenticated, same-origin backend/reverse proxy and configure the `/api` route there; do not expose a provider key in static frontend assets. This prototype does not include production user authentication, billing controls, or an independent security review. Without a configured server key, local answers continue to work and cloud requests report that setup is required.

## Product boundaries

- **Optional cloud LLM.** Local deterministic answers remain the default. A cloud LLM is called only after per-question opt-in and only when a server-side provider key is configured; it receives a minimized confirmed-record summary, not raw message captures. Cloud responses can hallucinate and are not financial advice.
- **No automatic app access.** This browser cannot read SMS, WhatsApp or other apps’ notifications. Automatic Android notification access would require a separate native app, clear disclosure and explicit OS notification-listener approval. SMS access also has platform and store-policy constraints. The current web app must not imply that access has been granted.
- **No bank feed or credentials.** There is no bank connection, account balance, credential collection or payment service. Any future feed requires a scoped, user-consented integration and appropriate review—not credential scraping.
- **No payments or financial-product recommendations.** The prototype cannot transfer money, contact providers or determine affordability.
- **Not production-ready.** The local 6-digit-PIN vault is a prototype control, not a substitute for security review, legal/privacy review, an audited mobile key-storage design or production account controls.

Research and production constraints are in [docs/research-and-architecture.md](docs/research-and-architecture.md).
