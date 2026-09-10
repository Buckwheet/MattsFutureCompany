# PROCEDURE — Development & Security Workflow

**Repo:** MattsFutureCompany (Peterson Small Engine Repair)
**Stack:** JavaScript (NOT TypeScript) — Cloudflare Worker backend (ESM), React/JSX parts-manager (Vite), vanilla inline-JS public site. Vitest for tests. ESLint 10 (flat config) for linting. Husky pre-commit hooks.

Current project state, findings status and the post-deploy checklist live in **`STATUS.md`**.
Owner-facing operating instructions live in `MATTS_OPS_MANUAL.md`. This file is rules only.

---

## 1. Tooling (one command each)

| Task | Command | Where |
|------|---------|-------|
| Lint everything | `npm run lint` | repo root |
| Auto-fix lint | `npm run lint:fix` | repo root |
| Run all tests | `npm test` | repo root (delegates to backend) |
| Run one test file | `npx vitest run test/<file>.test.js` | backend/ |
| Full gate (pre-commit) | `npm run check` | repo root (lint + test) |

Linting is owned by the **root** ESLint config (`eslint.config.js`) and covers all three
codebases: `backend/` (node globals), `site/` (inline scripts via eslint-plugin-html),
`parts-manager/` (React hooks rules). Do NOT add a per-package linter; one config, one tool.

Linter decision: **ESLint, not Biome.** The repo already shipped a proper ESLint 10 flat
config in parts-manager; Biome would be a second tool + deleted config for zero gain, and
the codebase is JS — no TS-specific benefit. Revisit only if we migrate to TypeScript.

Pre-commit hook (installed via `npm install` → husky `prepare`):
`.husky/pre-commit` runs `npm run check` (lint + tests). If it fails, the commit is blocked.
Force-past only with `git commit --no-verify` and a comment explaining why (security fixes
get an exemption only for CI-unrelated failures, never for broken tests).

## 2. The standard change loop (mandatory order)

For EVERY code change:

1. **Branch** — `git checkout -b fix/<what>` (never commit security fixes to main directly).
2. **Write the fix** at the root cause (one guard in the shared function, not every caller).
3. **Write/adjust tests FIRST for security paths** — any change to input validation,
   auth, webhooks, money, or uploads requires a regression test in the same commit.
4. **Run tests** — `npm test`. All must pass.
5. **Run lint** — `npm run lint`. Zero errors. Fix lint issues in the same commit.
6. **Retest** — `npm test` again after lint fixes (lint fixes can break tests).
7. **Commit** with a message naming the finding fixed (e.g. `fix(backend): release webhook claim on failure`).
8. **PR** — one finding per PR where practical; PR title = finding number/name.
9. CI/deploy happens on merge to `main` via `.github/workflows/deploy.yml`.

Rule: a commit that adds a security fix without a test, or a test that fails, is not done.
"Lint green, tests green" is the definition of done — in that order, twice.

**Prove a regression test bites.** Before calling a security test done, disable the fix and
confirm the test fails, then restore it. A test that passes with and without the fix is
decoration. (Found this way: the old `tampered` auth test was a no-op ~1/64 of runs because
it flipped the last base64url char of a 342-char signature, whose low bits `atob` discards.)

## 3. Security checklist (re-review before every deploy)

- [ ] No secret in code, `.env` is gitignored, no secret in git history (`git log -p | grep sk_live`).
- [ ] Public endpoints: bot protection (Turnstile), rate limit, input validation + length caps.
- [ ] Auth: Cloudflare Access JWT verified (iss/aud/email/exp/nbf/**alg**), no `ENVIRONMENT=dev` in prod.
- [ ] Webhook: signature verified; idempotency via `INSERT OR IGNORE` claims that are **released on
      failure** — a claim held across a 500 permanently loses the work (see §4).
- [ ] Uploads: declared `Content-Length` rejected early, whitelisted types + magic-byte sniff, size
      re-enforced on the actual body, `nosniff` on serve.
- [ ] All user input HTML-escaped (`escapeHtml`) before **HTML** embedding; all user input
      control-char-stripped (`sanitizeHeader`) before **email header** embedding.
- [ ] Emails: sender reputation protections — bot gate **and** a per-recipient cap on the
      customer auto-response (`lead_autorespond`, 1/recipient/UTC day).
- [ ] CORS: ACAO only for allowlisted origins, and `Vary: Origin` on every response.
- [ ] `npm run check` green.

## 4. Backend invariants (do not regress)

1. **Idempotency claims are released on failure.** `claim()` records ids in `claimedIds`;
   `releaseClaims()` deletes them before a 500 is returned, so Stripe's redelivery can redo the
   work. Deduction runs through `applyDeductions()` → `DB.batch()` (one implicit transaction) so a
   released claim can never leave a partial deduction. Returning 500 while holding a claim is a
   data-loss bug, not a retry.
2. **Route errors go through `routeError()`.** Auth failures are `AuthError` (→ 401); everything
   else is a generic 500 with the real cause logged. Never reintroduce
   `e.message.includes('Unauthorized')`.
3. **Every admin route calls `requireAuth()` first**, and `requireAuth()` fails closed in prod.
4. **Emails:** `escapeHtml` for HTML bodies, `sanitizeHeader` for subjects. Both, always.
5. **`site/_headers` applies `nosniff` to everything.** Static assets must have honest extensions
   and real bytes (the old `*.png` files were JPEGs served as `image/png`), and the Worker must
   keep setting the sniffed `Content-Type`.

## 5. Frontend / SEO invariants

- `site/index.html` has **exactly one `<h1>`**. Other carousel slide titles are
  `<h2 class="slide-title">`, which `site/style.css` styles identically to `.slide-content h1`.
- Every `<img>` declares `width`/`height` and `alt`; hero backgrounds are real `<img class="slide-bg">`
  so they can be lazy-loaded (only the LCP slide is eager, with `fetchpriority="high"`).
- Keep `site/404.html` — without it Cloudflare Pages returns the homepage with HTTP 200 for every
  unknown URL (site-wide soft 404s). Keep `site/sitemap.xml` and the `Sitemap:` line in `robots.txt`.
- Images ship as WebP at display size. A 1 MB PNG hero is a regression.
- **Bump `style.css?v=` whenever `style.css` changes.** Pages serves it with
  `Cache-Control: public, max-age=14400`, so a version-pinned URL keeps returning the old CSS for up
  to 4 hours — and new markup against old CSS silently breaks the layout (`<img class="slide-bg">`
  with no `.slide-bg` rule stacks every hero image). Same trap for any renamed asset: change the URL,
  not just the file.
- `LocalBusiness` and `FAQPage` JSON-LD must stay parseable, and `areaServed` must list all 14
  `SERVICE_AREA_CITIES` so page copy, schema and delivery logic agree.

## 6. Known deliberate trade-offs (ponytail ceilings)

- **Rate limiter is in-memory per-isolate** — best-effort only, NOT a real global limit.
  Real protection = Cloudflare Rate Limiting rules in the dashboard. Revisit if abuse persists.
- **Turnstile fails OPEN when `TURNSTILE_SECRET_KEY` unset** — keeps the site functional during
  rollout; set the secret to actually protect. Never remove the fail-open warning log.
- **`ENVIRONMENT=dev` bypasses Access auth** — local dev only. Never set this secret in prod.
- **Admin identity is hardcoded** (`mattssmallenginerep@gmail.com`, `authDomain`) — moving it to a
  secret is an ops change, not a code change.
- **`/api/photos/*` reads are public** with timestamp-derived keys. Acceptable for product photos.
- **`docs/superpowers/` is gitignored** — treated as internal design material.

## 7. Ops notes

- Health check cron: daily 08:00 UTC (`backend/wrangler.toml` triggers) → emails Matt.
  Note: the dashboard check follows the Access redirect to its login page, which returns 200, so
  that line reports UP even when the dashboard is broken.
- D1 schema changes go in **both** `backend/schema.sql` and a numbered file in
  `backend/migrations/` (currently `0001_processed_stripe_events`, `0002_lead_autorespond`).
- Dead secrets still in `.env` (CLOUDFLARE_API_KEY, ZONE_ID, PAGES_PROJECT, SQUARE_APP_ID,
  STRIPE_BACKUP_CODE): rotate or delete — housekeeping.
- `site/index.html` tel: links are WORKING in production; the earlier "masked href" finding was a
  false positive from tool output redaction.
- Inventory app (`parts-manager/`) is NOT deployed by CI — deploy manually or add a workflow.
- The Worker hostname (`peterson-backend.mattssmallenginerep.workers.dev`) is a public ingress;
  want a Cloudflare WAF / rate-limiting rule on it.
