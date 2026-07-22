# Project State
 
**Goal:** Address key code review findings (Stripe price adjustment churn, webhook idempotency, UPC url-encoding, rate-limit eviction, modal title edit).
 
**What changed:**
* Implemented Stripe Webhook idempotency and deduplication using SQLite processed events table to avoid double inventory deductions.
* Added a dedicated backend quantity adjustment endpoint (`/api/parts/adjust-quantity`) and updated the frontend `parts-manager` dashboard to use it, preventing Stripe pricing API churn on quantity changes.
* Optimized `/api/parts` POST updates to only generate new Stripe prices when the price actually changes.
* Added size (10MB) and image content type validation to `/api/upload`.
* URL-encoded the UPC barcode parameter in the lookup query.
* Implemented periodic rate limit map eviction to prevent unbounded isolate memory growth.
* Fixed broken UTF-8 encoding in the trust strip checkmarks by using HTML entities (`&#10003;`).
* Dynamicized the modal header to display "Edit Part" or "Add New Part" depending on whether editing.
* Aligned compatibility dates (`2026-06-25`) across backend wrangler.toml and GitHub deploy action.
* Implemented recurring seasonal date gating for carousel cards in the frontend site using a math-based MMdd date comparison algorithm.
* Created 4 dedicated seasonal special slides: Spring Special (Apr 1–Jul 1), Summer Special (Jul 1–Sep 1), Fall Special/Snow Blower Prep (Sep 1–Jan 1), and Winter Special/Mid-Winter Snow Blower Tune-Up (Jan 1–Apr 1).
* Generated a stunning summer zero-turn mower hero image (`site/images/summer.png`) and integrated it into the Summer Special card.
* Refactored carousel navigation indicator dots to be dynamically generated in JavaScript based on active slides.
* Updated `CODE_REVIEW_FINDINGS.md` and `PROJECT_STATE.md` to track findings resolution.
 
**Commands run + results:**
* `npx wrangler d1 execute DB --local --file=schema.sql` -> Initialized local database tables.
* `npm test` (in backend) -> All 19 vitest tests passed successfully.
* `npm run build` (in parts-manager) -> Production build succeeded cleanly.
 
**Files touched:**
* `backend/schema.sql`
* `backend/index.js`
* `parts-manager/src/App.jsx`
* `site/index.html`
* `site/images/summer.png`
* `backend/wrangler.toml`
* `.github/workflows/deploy.yml`
* `CODE_REVIEW_FINDINGS.md`
* `PROJECT_STATE.md`
 
**Next 3 actions:**
* [ ] Test client-side date gating transitions by mocking different Date objects in local dev mode.
* [ ] Confirm email recipients with Matt (leads vs health reports inboxes).
* [ ] Run staging/live webhook testing with Stripe CLI.



