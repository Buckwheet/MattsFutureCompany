# PROCEDURE — Development & Security Workflow

**Repo:** MattsFutureCompany (Peterson Small Engine Repair)
**Stack:** JavaScript (NOT TypeScript) — Cloudflare Worker backend (ESM), React/JSX parts-manager (Vite), vanilla inline-JS public site. Vitest for tests. ESLint 10 (flat config) for linting. Husky pre-commit hooks.

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
7. **Commit** with a message naming the finding fixed (e.g. `fix(backend): close webhook idempotency race`).
8. **PR** — one finding per PR where practical; PR title = finding number/name.
9. CI/deploy happens on merge to `main` via `.github/workflows/deploy.yml`.

Rule: a commit that adds a security fix without a test, or a test that fails, is not done.
"Lint green, tests green" is the definition of done — in that order, twice.

## 3. Security checklist (re-review before every deploy)

- [ ] No secret in code, `.env` is gitignored, no secret in git history (`git log -p | grep sk_live`).
- [ ] Public endpoints: bot protection (Turnstile), rate limit, input validation + length caps.
- [ ] Auth: Cloudflare Access JWT verified (iss/aud/exp/signature), no `ENVIRONMENT=dev` in prod.
- [ ] Webhook: signature verified, idempotency via `INSERT OR IGNORE` claims (never SELECT-then-act).
- [ ] Uploads: whitelisted types + magic-byte sniff, size enforced on the body, `nosniff` on serve.
- [ ] All user input HTML-escaped before email embedding; no raw interpolation in subjects/HTML.
- [ ] Emails: sender reputation protections (no arbitrary-address auto-responses without bot gate).
- [ ] `npm run check` green.

## 4. Known deliberate trade-offs (ponytail ceilings)

- **Rate limiter is in-memory per-isolate** — best-effort only, NOT a real global limit.
  Real protection = Cloudflare Rate Limiting rules in the dashboard. Revisit if abuse persists.
- **Turnstile fails OPEN when `TURNSTILE_SECRET_KEY` unset** — keeps the site functional during
  rollout; set the secret (step 6) to actually protect. Never remove the fail-open warning log.
- **`ENVIRONMENT=dev` bypasses Access auth** — local dev only. Never set this secret in prod.

## 5. Security findings status (2026-08-05 review)

| # | Finding | Status |
|---|---------|--------|
| 1 | Lead endpoint abuse (no bot gate, email bomb, junk customers) | FIXED: Turnstile + email regex + length caps |
| 2 | Rate limiter per-isolate / shared bucket | PARTIAL: buckets split per route; global limit = CF dashboard rule |
| 3 | Upload: client content-type, no magic bytes, size cap bypass, no nosniff | FIXED |
| 4 | Webhook idempotency race (SELECT→act→INSERT) | FIXED: INSERT OR IGNORE claims |
| 5 | `ENVIRONMENT=dev` auth fail-open switch | DEFERRED (dev workflow; documented, never set in prod) |
| 6 | JWT: no nbf, hardcoded email | DEFERRED (works; brittle only if Matt's email changes) |
| 7-13 | CORS fallback, dead secrets, tel: masking, headers/CSP, action pinning, photo keys | DEFERRED/ops |

## 6. Turnstile rollout — DONE (2026-08-05, via Cloudflare API)

- Widget "Peterson Lead Form" created via `POST /accounts/{id}/challenges/widgets`
  (managed mode; domains: petersonsmallenginerepair.com, localhost).
- Site key `0x4AAAAAAEHcuMoVkCVFG3hr` is in `site/index.html` (public — safe in repo).
- Secret `TURNSTILE_SECRET_KEY` set as a GitHub repo secret (deploy.yml pushes it to the
  Worker on every deploy).
- Remaining: merge/push the branch → deploy.yml sets the worker secret → verify:
  scripted POST to `/` without a token returns 400 "Bot verification failed".
- To re-create/rotate: `GET|DELETE /accounts/{id}/challenges/widgets/{id}`.

## 7. Ops notes

- Health check cron: daily 08:00 UTC (`backend/wrangler.toml` triggers) → emails Matt.
- Dead secrets found in `.env` (CLOUDFLARE_API_KEY, ZONE_ID, PAGES_PROJECT, SQUARE_APP_ID,
  SQUARE_LOCATION_ID, STRIPE_BACKUP_CODE): rotate or delete — housekeeping.
- `site/index.html` tel: links are masked (`+176****9259`) — verify live click-to-call works;
  if the deployed file is identical, dialing is broken (masking is likely repo-redaction).
- Inventory app (`parts-manager/`) is NOT deployed by CI — deploy manually or add a workflow.
