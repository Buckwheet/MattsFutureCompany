# STATUS — Peterson Small Engine Repair

**Single source of truth for project state.** Process and rules live in `PROCEDURE.md`;
owner-facing operating instructions live in `MATTS_OPS_MANUAL.md`.

Last updated: **2026-09-10** (round 3 shipped and verified in production)

---

## 1. What this is

| Piece | Where | Deploy |
|-------|-------|--------|
| Public marketing site (vanilla HTML/CSS/JS) | `site/` | Cloudflare Pages → `petersonsmallenginerepair.com` |
| Lead / estimate / inventory API | `backend/` (Worker, D1, R2) | `peterson-backend.mattssmallenginerep.workers.dev` |
| Inventory dashboard (React + Vite) | `parts-manager/` | `inventory.petersonsmallenginerepair.com` — **manual deploy, not in CI** |

Integrations: Stripe (customers, products, quotes, webhook), Square (customers, optional),
Resend (transactional email), Cloudflare Access (admin auth), Turnstile (bot gate),
OpenRouteService (geocoding + driving distance).

---

## 2. Deployed and working

- Lead capture with Turnstile bot gate, email/length validation, per-IP rate buckets, Stripe + Square
  customer sync, HTML-escaped notification + auto-response emails.
- Delivery estimate: ORS geocode (metro-biased) → driving miles → tiered fee, with out-of-range handling.
- Stripe webhook auto-deducts inventory on `checkout.session.completed` / `invoice.paid`.
- Daily 08:00 UTC health-check cron → HTML report to Matt.
- Seasonal hero carousel with client-side date gating, mobile auto-height layout.
- Cloudflare Access JWT auth (RS256, iss/aud/email/exp/nbf, alg-pinned) on all admin routes.
- Real 404s, `sitemap.xml`, one `<h1>`, WebP imagery, Open Graph cards.
- CI on merge to `main` deploys Pages + Worker and pushes Worker secrets.

---

## 3. Round 3 — SHIPPED AND VERIFIED IN PRODUCTION (2026-09-10)

PR **#17** → merge commit **`d6d0af1`** on `main` → deploy run **`34508955948`** (58s, all green).
Four commits: `aff5919` backend security, `dcee4c3` site, `2f143df` hygiene, `98b0e8d` review fix.

### Security (`aff5919`)

| # | Finding | Fix |
|---|---------|-----|
| 1 | **Webhook silently lost inventory deductions.** The idempotency claim was taken *before* the work, so a mid-processing failure returned 500 while still holding the claimed id — Stripe's retry then saw "already processed" and no-opped. Permanent, silent under-deduction. | `releaseClaims()` hands the ids back on failure; deduction runs as one `DB.batch()` (implicit transaction) so a release can never leave a partial deduction. |
| 2 | ACAO echoed from the request `Origin` with no `Vary: Origin` — a shared cache could serve one origin's ACAO to another. | `Vary: Origin` on every response (confirmed live). |
| 3 | Email subject interpolated raw user input — CR/LF could smuggle extra headers. | `sanitizeHeader()` on both subjects (control chars → spaces). |
| 4 | Auto-response went to a submitter-chosen address with no cap — a backscatter vector aimed at third parties from Matt's domain. | `lead_autorespond` table caps it at one auto-reply per recipient per UTC day. Matt's lead notification is never suppressed. |
| 5 | Upload size was checked only *after* buffering the whole body. | Reject on `Content-Length` first, then re-verify the actual bytes. |
| 6 | JWT `alg` was never asserted. | `if (header.alg !== 'RS256') return false`. |
| 7 | Auth failures detected by `e.message.includes('Unauthorized')` — a DB error containing that word became a 401. | `AuthError` class + shared `routeError()` helper across all 9 routes. |

Also repaired a **flaky pre-existing test**: `makeToken({tampered:true})` flipped the *last* base64url
signature char, but a 2048-bit RSA signature is 342 chars, so the trailing char's low bits are
discarded by `atob` — the tamper was a no-op ~1/64 of runs. It now flips the first char.

### Site (`dcee4c3` + review fix `98b0e8d`)

**Mobile hero fix** (authored in a parallel session; now device-verified by Matt). On
`max-width: 768px` every `.slide` was `position: absolute; inset: 0`, so `#hero` collapsed to its
500px `min-height` while `.slide-content` was ~650px — overflowing ~75px top (eyebrow badge lost
behind the fixed nav) and ~75px bottom (the "Call" button sliced by `#trust`, dots hidden). Fixed by
migrating `#hero`/`.slide` to CSS Grid stacking.

**Review caught a desktop regression in that work** — the mobile change replaced three declarations
of the same property, so `height: 85vh; height: 85dvh; min-height: 600px` became three `min-height`
lines and only `min-height: 600px` applied. With `display: grid` the desktop hero then sized to
content, dropping from 85dvh (~918px at 1080p) to ~600–700px. `98b0e8d` restored the original
geometry and added `height: auto` to the mobile override (without which the restoration would have
re-clipped mobile). It also reverted two base-rule changes that leaked onto desktop —
`.carousel-dots { bottom }` and `.slide-content` padding. **Net: desktop is identical to the
pre-round-3 baseline apart from the grid migration.** Any future hero work must change base rules
and mobile overrides together and re-check both.

**SEO**

| # | Finding | Fix |
|---|---------|-----|
| 1 | **Every unknown URL returned HTTP 200 + the homepage** (soft 404 site-wide), and `/sitemap.xml` was served as `text/html` — a hard Search Console error. | `site/404.html` gives Pages a real 404; `site/sitemap.xml` + the `robots.txt` line cover the canonical URL. **Verified live: unknown path → 404, sitemap → `application/xml`.** |
| 2 | 8 `<h1>` elements (every carousel slide). | One `<h1>`; the other 7 are `<h2 class="slide-title">`. **Verified live: grep -c `<h1` = 1.** |
| 3 | ~8.5 MB of hero PNGs, all eagerly loaded as CSS `background-image`. | WebP at display size — **8.5 MB → 1.06 MB (86% smaller)** — as real `<img class="slide-bg">`: LCP slide `fetchpriority="high"`, other 7 `loading="lazy"`. **Verified live: `image/webp`.** |
| 4 | No Open Graph / Twitter Card tags. | Full OG + `summary_large_image` set with a generated 1200×630 `og-image.jpg`. **Verified live.** |
| 5 | `streetAddress: ""`, a `geo` block conflicting with the app's routing origin, `areaServed` listing 5 of 14 cities. | Empty `streetAddress` and the conflicting `geo` removed; `areaServed` now all 14 service cities. |
| 6 | No favicon (the icon request was answered by the soft-404). | Generated `favicon-32.png` + `icon-180.png`. **Verified live.** |
| 7 | Legacy `meta keywords`, `meta http-equiv=Cache-Control/Pragma/Expires`, missing image dimensions, literal `**markdown**` in the payment FAQ. | Removed/replaced; all `<img>` carry `width`/`height` and `alt`. |

Bonus find: every `site/images/*.png` was actually **JPEG data** served as `image/png` under
`X-Content-Type-Options: nosniff`. The WebP conversion made the extension honest.

### Repo hygiene (`2f143df`)

- Removed `site.zip` (6.6 MB duplicate of `site/`), the loose Cloudflare API payloads
  (`add_zone.json`, `custom_domain.json`, `dns_record.json`, `link_source.json`, `pages_direct.json`,
  `pages_project.json`) and `deploy.log` (a `wrangler --help` dump).
- Consolidated 8 overlapping handoff docs into `PROCEDURE.md` + this file; deleted
  `CODE_REVIEW_FINDINGS.md`, `SeniorCodeReview.md`, `IMPLEMENTATION_PLAN.md`, `TASK.md`,
  `WALKTHROUGH.md` (recoverable from git history).
- Preserved real content that was loose in the root: `MATTS_OPS_MANUAL.md` (root) and
  `playbook.html` + `scratch/transport_sim.py` (→ `docs/`).

---

## 4. Verification — done, and what is still open

Confirmed against production 2026-09-10:

- [x] Unknown path → **404**. `/images/hero.png?cb=1` → 404 (old asset gone from the deploy).
- [x] `/sitemap.xml` → `application/xml`.
- [x] `/images/hero.webp` → `image/webp`; favicon → `image/png`; `og-image.jpg` → `image/jpeg`.
- [x] Live HTML: exactly one `<h1>`; all `og:*` and `twitter:*` tags present.
- [x] Live `style.css?v=1.0.10` contains `height: 85dvh` + `min-height: 600px`, `.slide-bg`,
      `grid-template-areas`, and the mobile `height: auto; min-height: auto` override.
- [x] Worker `POST /` with no Turnstile token → **400 "Bot verification failed"**.
- [x] Worker responses carry `Vary: Origin`.
- [x] Mobile hero layout visually confirmed on a device by Matt.

Still open:

- [ ] **`stripe trigger invoice.paid` (test mode)** → deducts exactly once, and a forced failure is
      retried cleanly. The webhook fix is only exercised against a fake D1 in unit tests.
- [ ] Search Console: resubmit `sitemap.xml`; confirm the old soft-404 errors clear.
- [ ] Rich Results Test on the homepage (`LocalBusiness` + `FAQPage` parse clean).
- [ ] Share the homepage URL and confirm the OG card renders.
- [ ] Submit a real lead end-to-end and confirm the customer auto-response arrives.
- [ ] Add a Cloudflare **WAF rate-limiting rule** on the Worker hostname.

### If Stripe alerts you

Stripe alerts on **delivery failures** (our endpoint returning 5xx/timeouts) — see
Developers → Webhooks → the endpoint's error rate. It does **not** alert on a request that returns
200 but deducts the wrong amount, so a silent inventory drift would not surface there. Check
inventory against sales periodically; the deduction path is the one to suspect if they diverge.

---

## 5. Known trade-offs and hazards

- **Rate limiter is in-memory per isolate** — best effort, not a global limit. Real protection is a
  Cloudflare Rate Limiting rule. Never let this be the only gate on a money path.
- **Turnstile fails OPEN when `TURNSTILE_SECRET_KEY` is unset.** Keeps the site working during
  rollout; keep the warning log.
- **`ENVIRONMENT=dev` bypasses Access auth** for local dev only. Never set it in production.
- **`deploy.yml` pushes three secrets unconditionally** (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `CLOUDFLARE_ACCESS_AUD` — `echo "${{ secrets.X }}" | wrangler secret put`).
  If any GitHub secret is ever empty, a routine deploy could blank a live secret. The optional ones
  are correctly guarded with `if [ -n ... ]`; these three are not. Worth guarding the same way.
- **Residual webhook race (pre-existing).** If a redelivery of the *same* event arrives while the
  first request is still in flight, its `claim()` loses and returns 200 "already processed"; if the
  first request then fails and releases the claim, Stripe already has a 200 and never retries → that
  deduction is lost. Narrow window, same shape as before round 3.
- **Cloudflare's 4-hour edge cache holds deleted assets.** After the round-3 deploy,
  `/images/hero.png` still returned 200 (950 KB, `cf-cache-status: REVALIDATED`) while
  `?cb=1` returned 404. Harmless — nothing references it — but it means a deleted asset can linger.
- **Email recipient identity is hardcoded** (`mattssmallenginerep@gmail.com`, `authDomain`).
- **Photo reads (`/api/photos/*`) are public** with timestamp-based keys; acceptable for product photos.
- **`parts-manager/` is not deployed by CI** — manual deploy.
- **`docs/superpowers/` remains gitignored** — treated as internal design material.
- **The homepage testimonials are left as-is by decision (2026-09-10).** Do not raise this again or
  "fix" it: they stay as written. Keep the deliberate omission of `aggregateRating` markup, which
  would be a policy violation on unverified reviews.

---

## 6. Parked

- **`PROJECT_STATE.md` is stale.** It documents the mobile hero work, but still lists
  `.carousel-dots: bottom: 52px` and the old `#hero` height as deliverables — both reverted in
  `98b0e8d`. It was left untouched because the parallel session had it open. Reconcile or retire it
  in favour of this file.
- **Untracked `1000007116.jpg` in the repo root** — a 1080×2340 Android screenshot (the mobile bug
  capture), deliberately not committed. Delete or gitignore it.
- Stale-character cleanup (needs a user TOTP click).
- Decide whether to publish a real street address (would enable stronger local-pack signals).
- Pin `cloudflare/wrangler-action` and `actions/checkout` to commit SHAs.
- Per-city landing pages if local query volume justifies it.
- Extract `backend/index.js` (~1100 lines, 9 routes, 3 integrations) into `lib/` + `routes/`.

---

## 7. Restart prompt for a new session

> Working on **MattsFutureCompany** (Peterson Small Engine Repair) at
> `D:\Other Code Projects\MattsFutureCompany`. Read `STATUS.md` first, then `PROCEDURE.md`.
>
> Stack: vanilla HTML/CSS/JS site in `site/` (Cloudflare Pages), a Cloudflare Worker in `backend/`
> (D1 + R2, ESM JavaScript — **not** TypeScript), and a React/Vite admin app in `parts-manager/`.
>
> Gate before claiming anything is done: `npm run lint` then `npm test` (both from the repo root).
> Never commit with a failing test. Any change to auth, input validation, webhooks, money, or uploads
> needs a regression test in the same change — and disable the fix once to prove the test actually
> fails without it.
>
> Round 3 is merged to `main` (PR #17, `d6d0af1`) and verified live; there is no pending work in the
> tree apart from the untracked screenshot noted in §6. Pick up the open items in §4 — the Stripe
> webhook end-to-end test is the most valuable one.
>
> Hero/carousel CSS is the sharpest edge in this repo: base rules and the mobile `@media` overrides
> must be changed together, and `style.css?v=` must be bumped (Pages serves CSS with
> `max-age=14400`, so a stale URL pairs new markup with old CSS). See §3 for the regression that
> caused last time.
>
> Do not commit directly to `main`; branch, open a PR, and let CI deploy on merge. `parts-manager/`
> deploys manually.
