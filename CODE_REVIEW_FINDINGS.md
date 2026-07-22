# Code Review Findings — Peterson Small Engine Repair

**Review Date:** 2026-07-12
**Scope:** New issues found beyond `SeniorCodeReview.md` (items 1–11 all verified complete).

---

## 🔴 HIGH Priority

- [x] **1. Quantity adjustment churns Stripe prices**
  `parts-manager/src/App.jsx:121` — `handleAdjustQty` POSTs the full part (incl. `stripe_product_id`) on every +/- click. Backend (`backend/index.js:380-394`) then creates a NEW Stripe price + updates the product on every click, leaving orphaned prices. Fix: dedicated qty-only endpoint, or only re-price when `price` actually changed.
  **DONE:** Added dedicated `/api/parts/adjust-quantity` endpoint for quantity increments/decrements, bypassing Stripe calls entirely. Optimized `/api/parts` updates to only update price on Stripe if the numeric value actually changed.

- [x] **2. Webhook is not idempotent**
  `backend/index.js:180-209` — Stripe redelivers events (at-least-once). No dedupe on `event.id`, so redelivered `checkout.session.completed` deducts inventory twice. Also `checkout.session.completed` + `invoice.paid` for one sale = double deduction. Fix: track processed `event.id`s in D1, and/or handle only one event type.
  **DONE:** Created `processed_stripe_events` table in SQLite D1. Webhook now tracks processed `event.id`s, `session.id`s, and `invoice.id`s. Checkout sessions that generate invoices are skipped during checkout event handling and only deducted on the paid invoice event to avoid double deductions.

---

## 🟡 MEDIUM Priority

- [x] **3. HTML injection in emails**
  `backend/index.js:519-523, 558-559` — `name`, `phone`, `equipment`, `issue` interpolated raw into email HTML. A lead can inject markup/links into Matt's inbox. Fix: escape values before embedding.
  **DONE:** Added `escapeHtml()` helper; applied to both lead notification and customer auto-response emails.

- [x] **4. Auth fails open on missing secret**
  `backend/index.js:151-154` — if `CLOUDFLARE_ACCESS_AUD` is unset, `requireAuth()` returns `true` and the entire admin/inventory API is public. One failed secret push (`.github/workflows/deploy.yml:41`) silently opens the API. Fix: gate bypass on explicit `ENVIRONMENT=dev` flag, not "secret absent".
  **DONE:** Bypass now requires `env.ENVIRONMENT === 'dev'`; missing `CLOUDFLARE_ACCESS_AUD` in prod now throws Unauthorized instead of allowing access.

---

## 🟢 LOW Priority

- [x] **5. UPC not URL-encoded** — `backend/index.js:256`: wrap `upc` in `encodeURIComponent` before fetch URL.
- [x] **6. Rate limit map never evicts** — `backend/index.js:124`: `rateLimitMap` grows unbounded over isolate lifetime. Add periodic cleanup.
- [x] **7. Upload lacks validation** — `backend/index.js:298`: no file size/type limits; `ext` only handles png vs jpg (HEIC → `.jpg`).
- [x] **8. Broken UTF-8 char** — `site/index.html:220`: `<span class="trust-icon"></span>` (mojibake icon).
- [x] **9. Modal title hardcoded** — `parts-manager/src/App.jsx:271`: always "Add New Part" even when editing.
- [ ] **10. Inconsistent email recipients** — leads → `matt@petersonsmallenginerepair.com`; health report → `mattssmallenginerep@gmail.com`. Confirm both inboxes are monitored.
- [x] **11. Compatibility-date mismatch** — root `wrangler.toml` (`2026-06-25`) vs backend (`2026-05-02`). Harmless; align for consistency.
