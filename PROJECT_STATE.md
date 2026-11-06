# Project State — Peterson Small Engine Repair

## Current milestone — Round 4, Phase 3 complete (2026-11-05)

Branch: `fix/round-4-security-hardening`  
Gate: `npm run check` → ESLint clean (backend, site, parts-manager, tools) + **103/103 Vitest tests passing** (4 files). UI verification: `node tools/verify-ui.mjs` → All checks passed across iPhone-13, iPhone-SE, Android-small, and Desktop-1440.

## What changed

### Phase 1 — dependency security upgrades (complete)
- Root `npm audit fix` resolved transitive `brace-expansion`, `js-yaml`, and `zod` advisories (0 vulnerabilities).
- `parts-manager/`: `axios ^1.20.0`, `vite ^8.1.6`; pruned duplicated ESLint devDependencies; clean Vite build in 740ms.
- `backend/`: `wrangler ^4.158.0`, `vitest ^5.1.0`, `vite ^8.1.6`; `npm audit` clean.

### Phase 2 — backend input validation, auth, R2 hardening (complete)
- **2.1 Estimate validation:** added/exported `validateEstimateInput`; bounded coordinates and addresses; ORS reverse-geocode and map links now use `encodeURIComponent`; `POST /api/estimate` returns 400 before any ORS call.
- **2.2 Lead capture money hardening:** `validateLeadInput` validates `pickup_required`, `delivery_lat`/`delivery_lng`, `estimate`, and `distance_miles`. `POST /` recalculates pickup/delivery distance and fee server-side through `buildEstimate` when ORS is configured, falling back to validated values explicitly labelled `client-estimated`; server values are labelled `server-calculated`.
- **2.3 Cloudflare Access JWT:** supports array `aud` claims, requires a non-empty string `header.kid`, and base64-pads the signature before `atob()`.
- **2.4 R2/photo hardening:** `/api/photos/:key` is GET-only, validates keys against `^part_[a-zA-Z0-9_-]+\.(jpg|png|webp)$`, always sends `Vary: Origin`, and rejects invalid/traversal keys before `env.PHOTOS.get`. Upload keys now use `part_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`.
- **2.5 Rate limit / cron retention:** `rateLimitMap` is hard-capped at 5000 keys with expired-first eviction and oldest-key fallback. Cron prunes `lead_autorespond` after 7 days and `processed_stripe_events` after 30 days (each best-effort), and treats a 302 Cloudflare Access redirect on the Inventory Dashboard as healthy while still alerting on origin 5xx.
- **2.6 Parts validation / UPC encoding:** `POST /api/parts` caps `name` (200), `sku` (100), `upc` (100), `description` (2000), and `image_url` (500), and only accepts `http:`/`https:` image URLs. `parts-manager/src/App.jsx` now calls `encodeURIComponent(decodedText)` for UPC lookup.
- Suite expanded from 61 to 103 tests (42 new regression tests added).

### Phase 3 — CI/CD & security headers hardening (complete)
- **3.1 CI/CD Hardening (`.github/workflows/deploy.yml`):**
  - Added top-level least-privilege token permissions (`permissions: contents: read`).
  - Pinned `actions/checkout` to commit SHA `11d5960a326750d5838078e36cf38b85af677262` (`v4.4.0`).
  - Pinned `cloudflare/wrangler-action` to commit SHA `9acf94ace14e7dc412b076f2c5c20b8ce93c79cd` (`v3.15.0`).
  - Protected all Worker secrets in `Set Worker Secrets`: mapped through step `env:` block, guarded each secret with `if [ -n "$SECRET" ]`, and piped using `printf '%s'` to prevent trailing newlines and avoid blanking production.
- **3.2 Security Headers (`site/_headers`):**
  - Added `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()`.
  - Strengthened Content Security Policy with `upgrade-insecure-requests; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
  - Verified with `node tools/verify-ui.mjs` across mobile and desktop viewports with 100% passes.

## Commands run + results
- `npm run check`: ESLint clean across backend, site, parts-manager, tools; Vitest 4/4 files, 103/103 tests passed.
- `node tools/verify-ui.mjs`: All checks passed (iPhone-13, iPhone-SE, Android-small, Desktop-1440).
- `npm --prefix parts-manager run build`: Clean production bundle (1.00s).
- `npm audit; npm --prefix backend audit; npm --prefix parts-manager audit`: 0 vulnerabilities across all three packages.

## Files touched in Phase 3
- `.github/workflows/deploy.yml`
- `site/_headers`
- `PROJECT_STATE.md`
- `STATUS.md`

## Next actions
- [ ] Commit Phase 3 changes to `fix/round-4-security-hardening` and push to origin.
- [ ] User review and PR creation against `main`.
- [ ] (Optional) Phase 4 operator cleanup of deprecated keys in local `.env`.
