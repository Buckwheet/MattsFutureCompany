# STATUS — Peterson Small Engine Repair

**Single source of truth for project state.** Process and rules live in `PROCEDURE.md`;
owner-facing operating instructions live in `MATTS_OPS_MANUAL.md`.

Last updated: **2026-09-10**

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
- Seasonal hero carousel with client-side date gating.
- Cloudflare Access JWT auth (RS256, iss/aud/email/exp/nbf, alg-pinned) on all admin routes.
- CI on merge to `main` deploys Pages + Worker and pushes Worker secrets.

---

## 3. Changes in the working tree (2026-09-10) — NOT YET COMMITTED OR DEPLOYED

A full code + security + SEO review was run, then every recommendation implemented.
`npm run lint` is clean and the backend suite is green (61 tests, up from 51).

### Security

| # | Finding | Fix |
|---|---------|-----|
| 1 | **Webhook lost inventory deductions.** The idempotency claim was taken *before* the work, so a mid-processing failure returned 500 while leaving the id claimed — Stripe's retry then saw "already processed" and no-opped. Permanent, silent under-deduction. | `releaseClaims()` hands the ids back on failure; deduction now runs as one `DB.batch()` (implicit transaction) so a release can never leave a partial deduction. |
| 2 | ACAO echoed from the request `Origin` with no `Vary: Origin` — a shared cache could serve one origin's ACAO to another. | `Vary: Origin` on every response. |
| 3 | Email subject interpolated raw user input — CR/LF could smuggle extra headers. | `sanitizeHeader()` on both subjects (control chars → spaces). |
| 4 | Auto-response went to a submitter-chosen address with no cap — a backscatter vector aimed at third parties from Matt's domain. | `lead_autorespond` table caps it at one auto-reply per recipient per UTC day. Matt's lead notification is never suppressed. |
| 5 | Upload size was checked only *after* buffering the whole body. | Reject on `Content-Length` first, then re-verify the actual bytes. |
| 6 | JWT `alg` was never asserted. | `if (header.alg !== 'RS256') return false`. |
| 7 | Auth failures detected by `e.message.includes('Unauthorized')` — a DB error containing that word became a 401. | `AuthError` class + shared `routeError()` helper across all 9 routes. |

### SEO

| # | Finding | Fix |
|---|---------|-----|
| 1 | **Every unknown URL returned HTTP 200 + the homepage** (soft 404 site-wide). `/sitemap.xml` was served as `text/html`, which is a hard Search Console error. | Added `site/404.html` — Cloudflare Pages now returns a real 404. |
| 2 | No sitemap; the `robots.txt` directive was commented out. | Added `site/sitemap.xml`, enabled the `Sitemap:` line. |
| 3 | 8 `<h1>` elements on the page (every carousel slide). | One `<h1>` (main hero); the other 7 are `<h2 class="slide-title">`, styled identically. |
| 4 | ~8.5 MB of hero PNGs, all loaded eagerly as CSS `background-image`. | Converted to WebP at display size — **8.5 MB → 1.06 MB (86% smaller)**. Backgrounds are now real `<img>`: the LCP slide is `fetchpriority="high"`, the other 7 are `loading="lazy"`. |
| 5 | No Open Graph / Twitter Card tags. | Full OG + `summary_large_image` set, with a generated 1200×630 `og-image.jpg`. |
| 6 | `streetAddress: ""`, a `geo` block conflicting with the app's routing origin, and `areaServed` listing 5 of 14 cities. | Empty `streetAddress` and the conflicting `geo` removed; `areaServed` now lists all 14 service cities. |
| 7 | No favicon (the icon request was answered by the soft-404). | Generated `favicon-32.png` + `icon-180.png` and declared both. |
| 8 | Legacy `meta keywords`, `meta http-equiv=Cache-Control/Pragma/Expires`, missing image dimensions, literal `**markdown**` rendering in the payment FAQ. | Removed/replaced; all `<img>` now carry `width`/`height` and `alt`. |

Bonus find: every `site/images/*.png` was actually **JPEG data** served as `image/png` under
`X-Content-Type-Options: nosniff`. The WebP conversion makes the extension honest.

### Repo hygiene

- Removed stale artifacts: `site.zip` (6.6 MB duplicate of `site/`), the loose Cloudflare API payloads
  (`add_zone.json`, `custom_domain.json`, `dns_record.json`, `link_source.json`, `pages_direct.json`,
  `pages_project.json`), and `deploy.log` (a `wrangler --help` dump).
- Consolidated the process docs: 8 overlapping handoff files → `PROCEDURE.md` + this file. Deleted
  `CODE_REVIEW_FINDINGS.md`, `PROJECT_STATE.md`, `SeniorCodeReview.md`, `IMPLEMENTATION_PLAN.md`,
  `TASK.md`, `WALKTHROUGH.md` (all recoverable from git history).
- Preserved real content that was sitting loose in the root: `MATTS_OPS_MANUAL.md` (kept at root) and
  `playbook.html` + `scratch/transport_sim.py` (moved to `docs/`).
- Repaired a **flaky pre-existing test**: `makeToken({tampered:true})` flipped the *last* base64url
  signature char, but a 2048-bit RSA signature is 342 chars, so the trailing char's low bits are
  discarded by `atob` — the tamper was a no-op ~1/64 of runs. It now flips the first char.

---

## 4. Verification checklist — run AFTER deploy

The 404 behaviour, sitemap and image formats can only be confirmed against Pages.

- [ ] `curl -sS -o /dev/null -w "%{http_code}\n" https://petersonsmallenginerepair.com/no-such-page` → **404** (was 200)
- [ ] `curl -sSI https://petersonsmallenginerepair.com/sitemap.xml | grep -i content-type` → `application/xml` (was `text/html`)
- [ ] `curl -sSI https://petersonsmallenginerepair.com/images/hero.webp | grep -i content-type` → `image/webp`
- [ ] Search Console: resubmit `sitemap.xml`; confirm the old soft-404 errors clear
- [ ] Rich Results Test on the homepage: `LocalBusiness` + `FAQPage` both parse, no errors
- [ ] Share the homepage URL in Slack/iMessage and confirm the OG card renders
- [ ] Scripted `POST /` with no Turnstile token → 400 "Bot verification failed"
- [ ] `stripe trigger invoice.paid` (Stripe CLI, test mode) → inventory deducts exactly once, and a
      forced failure is retried successfully by redelivery
- [ ] Add a Cloudflare **WAF rate-limiting rule** on the Worker hostname (limiter is still in-memory
      per isolate)
- [ ] Submit a real lead end-to-end and confirm the customer auto-response arrives

---

## 5. Known trade-offs (deliberate)

- **Rate limiter is in-memory per isolate** — best effort, not a global limit. Real protection is a
  Cloudflare Rate Limiting rule. Never let this be the only gate on a money path.
- **Turnstile fails OPEN when `TURNSTILE_SECRET_KEY` is unset.** Keeps the site working during
  rollout; keep the warning log.
- **`ENVIRONMENT=dev` bypasses Access auth** for local dev only. Never set it in production.
- **Email recipient identity is hardcoded** (`mattssmallenginerep@gmail.com`, `authDomain`) — moving it
  to a secret is an ops change.
- **Photo reads (`/api/photos/*`) are public** and keys are timestamp-based. Acceptable while photos
  are product images only.
- **`parts-manager/` is not deployed by CI** — manual deploy.
- **`docs/superpowers/` remains gitignored** — those design specs are treated as internal.
- **The homepage testimonials are left as-is by decision (2026-09-10).** Do not raise this again or
  "fix" it: they stay as written. Keep the deliberate omission of `aggregateRating` markup, which
  would be a policy violation on unverified reviews.

---

## 6. Parked

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
> needs a regression test in the same change.
>
> The working tree holds an unreviewed, undeployed set of fixes from a full code + security + SEO
> review — see §3. Start by confirming whether that was committed and deployed, then work through
> §4's post-deploy checklist.
>
> Do not commit directly to `main`; branch first. `parts-manager/` deploys manually.
