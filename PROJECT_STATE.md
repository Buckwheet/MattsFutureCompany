# Project State — Peterson Small Engine Repair

## Current milestone — Round 4, Phase 2 complete (2026-11-05)

Branch: `fix/round-4-security-hardening`
Gate: `npm run check` → ESLint clean (backend, site, parts-manager, tools) + **103/103 Vitest tests passing** (4 files).

## What changed

### Phase 1 — dependency security upgrades (complete)
- Root `npm audit fix` resolved transitive `brace-expansion`, `js-yaml`, and `zod` advisories (0 vulnerabilities).
- `parts-manager/`: `axios ^1.20.0`, `vite ^8.1.6`; removed duplicated ESLint devDependencies; clean Vite build.
- `backend/`: `wrangler ^4.158.0`, `vitest ^5.1.0`, `vite ^8.1.6`; `npm audit` clean.

### Phase 2 — backend input validation, auth, R2 hardening (complete)
- **2.1 Estimate validation:** added/exported `validateEstimateInput`; bounded coordinates and addresses; ORS reverse-geocode and map links now use `encodeURIComponent`; `POST /api/estimate` returns 400 before any ORS call.
- **2.2 Lead capture money hardening:** `validateLeadInput` now validates `pickup_required`, `delivery_lat`/`delivery_lng`, `estimate`, and `distance_miles`. `POST /` recalculates pickup/delivery distance and fee server-side through `buildEstimate` when ORS is configured, falling back to validated values explicitly labelled `client-estimated`; server values are labelled `server-calculated`.
- **2.3 Cloudflare Access JWT:** supports array `aud` claims, requires a non-empty string `header.kid`, and base64-pads the signature before `atob()`.
- **2.4 R2/photo hardening:** `/api/photos/:key` is GET-only, validates keys against `^part_[a-zA-Z0-9_-]+\.(jpg|png|webp)$`, always sends `Vary: Origin`, and rejects invalid/traversal keys before `env.PHOTOS.get`. Upload keys now use `part_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`.
- **2.5 Rate limit / cron retention:** `rateLimitMap` is hard-capped at 5000 keys with expired-first eviction and oldest-key fallback. Cron prunes `lead_autorespond` after 7 days and `processed_stripe_events` after 30 days (each best-effort), and treats a 302 Cloudflare Access redirect on the Inventory Dashboard as healthy while still alerting on origin 5xx.
- **2.6 Parts validation / UPC encoding:** `POST /api/parts` caps `name` (200), `sku` (100), `upc` (100), `description` (2000), and `image_url` (500), and only accepts `http:`/`https:` image URLs. `parts-manager/src/App.jsx` now calls `encodeURIComponent(decodedText)` for UPC lookup.

## Tests added (42 new, 61 → 103)
- `backend/test/estimate.test.js`: `validateEstimateInput` bounds/type/address cases, 400-before-ORS route tests, encoding checks.
- `backend/test/auth.test.js`: array `aud` accept/reject, missing/empty/non-string `kid`.
- `backend/test/security.test.js`: lead pickup/coords/money validation, server recalculation + fallback labeling, rate-limit cap/eviction, photo `Vary`/invalid keys, random upload keys, parts length/URL validation, cron retention/302 health behavior.

## Prove It Bites
Temporarily reverted only `backend/index.js` to its pre-Phase-2 state (`git stash push -- backend/index.js`), ran the suite, and observed **34 failing tests / 69 passing**. Restored the file and verified its SHA-256 was identical. `npm run check` then passed 103/103.

## Commands run + results
- `npm run lint` → 0 errors / 0 warnings.
- `npm --prefix backend test` → 4 files, 103 tests passed.
- `npm run check` → lint clean + 103/103 tests passed.
- Proof run without Phase 2 backend code → 34 failed, 69 passed (expected).

## Files touched in Phase 2
- `backend/index.js`
- `backend/test/estimate.test.js`
- `backend/test/auth.test.js`
- `backend/test/security.test.js`
- `parts-manager/src/App.jsx`
- `PROJECT_STATE.md`
- `STATUS.md`

## Next actions
- [ ] Review the Phase 2 diff and commit on `fix/round-4-security-hardening`.
- [ ] Phase 3: CI/CD least-privilege permissions + SHA-pinned actions + guarded secrets; tighten `site/_headers`.
- [ ] Phase 4: confirm and remove only documented dead keys from local `.env` with the operator.
- [ ] Run `npm audit`, `npm --prefix backend audit`, `npm --prefix parts-manager audit`, and the parts-manager production build before opening the PR.
