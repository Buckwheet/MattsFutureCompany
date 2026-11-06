# Agent Remediation Instructions — Security Scan (Round 4)

**Repository:** `D:\Other Code Projects\MattsFutureCompany` (Peterson Small Engine Repair)  
**Prerequisite Reading:** Read `STATUS.md` and `PROCEDURE.md` before making any changes.

---

## 0. Mandatory Workflow & Guardrails (Do Not Skip)

1. **Stack:** ESM JavaScript across all packages (`backend/`, `site/`, `parts-manager/`, `tools/`). **Not TypeScript.**
2. **Branching:** Never commit directly to `main`. Create a feature/fix branch first:
   ```bash
   git checkout -b fix/round-4-security-hardening
   ```
3. **Test-First & "Prove It Bites":**
   - Every change to auth, input validation, webhooks, money, CORS, or uploads **must** include a regression test in `backend/test/*.test.js` in the same commit.
   - Before considering any test done, temporarily disable your fix and verify the new test **fails**, then re-enable the fix and confirm it **passes**.
4. **Single Linter & Gate:**
   - Run from repo root:
     ```bash
     npm run lint
     npm test
     npm run check
     ```
   - Do **not** add per-package ESLint configs; root `eslint.config.js` lints everything.
   - If you touch anything under `site/`, you **must** also run `npm run verify:ui` against a local server or production (`PROCEDURE.md` §1a) and bump `style.css?v=` if `site/style.css` changes.
5. **Secrets Safety:**
   - Never print, log, or commit the values inside `.env`.
   - Maintain `PROJECT_STATE.md` at major milestones.

---

## Phase 1: Dependency Security Upgrades (Finding #1)

### Goal
Resolve High/Critical `npm audit` vulnerabilities across `parts-manager/`, `backend/`, and repo root without breaking tests or builds.

### Steps
1. **Root (`package.json` / `package-lock.json`):**
   - Run `npm audit fix` at the repo root to update transitive `brace-expansion`, `js-yaml`, and `zod`.
2. **Parts Manager (`parts-manager/package.json`):**
   - Run `npm --prefix parts-manager audit fix` to upgrade:
     - `axios` to `>=1.20.0` (fixes prototype pollution, header injection, and ReDoS advisories).
     - `vite` to `>=8.1.6` (fixes Windows `launch-editor`, UNC NTLMv2 leak, and `server.fs.deny` bypass advisories).
     - Transitive `follow-redirects`, `form-data`, `postcss`, `nanoid`, `brace-expansion`, `browserslist`, `zod`.
   - If `eslint` / `@eslint/js` in `parts-manager/package.json` are unused duplicates (root `eslint.config.js` owns linting per `PROCEDURE.md` §1), align or remove the duplicate devDependencies in `parts-manager/package.json` so `npm --prefix parts-manager audit` is clean.
   - Verify build: `npm --prefix parts-manager run build`.
3. **Backend (`backend/package.json`):**
   - Upgrade `wrangler` to `^4.158.0` (fixes `miniflare`, `undici`, `sharp`, `ws` High advisories).
   - Upgrade `vitest` to latest compatible version (`>=4.1.12` or `^5.1.0`) so `@vitest/mocker`, `tinypool`, and `vite` Critical/High advisories are resolved.
   - Verify all 61+ tests still run and pass with `npm test`.

---

## Phase 2: Backend Input Validation, Auth, & R2 Hardening (`backend/index.js`)

### 2.1 Validate `/api/estimate` & `buildEstimate` Inputs (Finding #4)
- **File:** `backend/index.js` (`orsGeocode`, `orsReverseGeocode`, `buildEstimate`, and `POST /api/estimate` around lines 208–296, 844–860)
- **Problem:** `lat`, `lng`, and `address` are not validated for type, geographic bounds, or length. `lat` and `lng` are interpolated directly into URL query strings (`&point.lat=${lat}&point.lon=${lng}`) and `mapLink`.
- **Fix:**
  1. Create and export a helper `validateEstimateInput({ lat, lng, address })` (or enforce at the start of `buildEstimate`):
     - If `lat != null || lng != null`: both must be finite numbers (`typeof lat === 'number'` or coerced cautiously with `Number.isFinite`) within `lat >= -90 && lat <= 90` and `lng >= -180 && lng <= 180`. Otherwise throw/return a `400` validation error.
     - If `address != null`: must be `typeof address === 'string'`, trimmed length between `1` and `500`. Otherwise throw/return a `400` validation error.
     - Use `encodeURIComponent(destLat)` and `encodeURIComponent(destLng)` in `orsReverseGeocode` and `mapLink`.
  2. In `POST /api/estimate`, return `corsResponse({ error: ... }, 400, corsHeaders)` on invalid input before calling OpenRouteService.
- **Tests (`backend/test/estimate.test.js`):**
  - Reject out-of-range coordinates (`lat: 999`, `lng: -500`), non-numeric strings (`lat: "45.1&evil=1"`), and oversized `address` (`'a'.repeat(501)`).

### 2.2 Prevent Client-Spoofed Delivery Fee/Distance in Lead Capture (Finding #3)
- **File:** `backend/index.js` (`validateLeadInput` lines 87–104, `POST /` lines 883–966)
- **Problem:** `validateLeadInput` ignores `pickup_required`, `delivery_lat`, `delivery_lng`, `estimate`, and `distance_miles`. `POST /` embeds raw client-controlled `estimate` and `distance_miles` in Matt's lead email.
- **Fix:**
  1. In `validateLeadInput(data)`:
     - Validate `pickup_required`: if present, must be `'Yes'` or `'No'`.
     - Validate `delivery_lat` / `delivery_lng`: if present and non-empty, `Number(delivery_lat)` and `Number(delivery_lng)` must be finite numbers within `[-90, 90]` and `[-180, 180]`.
     - Validate `estimate` and `distance_miles`: if present and non-empty, must be finite non-negative numbers (`Number.isFinite(Number(val)) && Number(val) >= 0 && String(val).length <= 20`).
  2. In `POST /`, when `pickup_required === 'Yes'` and `env.ORS_API_KEY` is configured and a `delivery_address` or valid coordinates are provided, either recalculate the fee server-side via `buildEstimate` (falling back gracefully on ORS failure) or format validated numeric values clearly as client-estimated if ORS is unavailable.
- **Tests (`backend/test/security.test.js`):**
  - Assert `validateLeadInput` rejects invalid `pickup_required` (e.g., `'Maybe'`), out-of-bounds `delivery_lat` (`95`), or non-numeric/spoofed `estimate` (`'0.00 FREE'`).

### 2.3 Support Array `aud` Claims & Validate `header.kid` in `verifyAccessJwt` (Finding #5)
- **File:** `backend/index.js` (`verifyAccessJwt` lines 330–393)
- **Problem:** Cloudflare Access JWTs commonly emit `payload.aud` as an array of strings (`["<AUD>"]`), which fails `payload.aud !== env.CLOUDFLARE_ACCESS_AUD`. Also `header.kid` is not checked to be a non-empty string before `.find(k => k.kid === header.kid)`, and `signatureB64` is not base64-padded before `atob()`.
- **Fix:**
  ```js
  if (!header.kid || typeof header.kid !== 'string') return false;
  const audValid = Array.isArray(payload.aud)
    ? payload.aud.includes(env.CLOUDFLARE_ACCESS_AUD)
    : payload.aud === env.CLOUDFLARE_ACCESS_AUD;
  if (!audValid) return false;
  ```
  Also pad `signatureB64` before `atob()` (just like `base64UrlDecode` does).
- **Tests (`backend/test/auth.test.js`):**
  - Add test: accepts a valid token where `aud` is `[AUD]`.
  - Add test: rejects a token where `aud` is `['wrong-aud']` or `header.kid` is missing/empty.

### 2.4 Harden `/api/photos/:key` & `/api/upload` (Finding #6)
- **File:** `backend/index.js` (lines 658–708)
- **Problem:**
  1. `GET /api/photos/:key` omits `Vary: Origin` when setting `Access-Control-Allow-Origin` and does not check `request.method === 'GET'` or validate `key` format.
  2. `POST /api/upload` uses predictable millisecond keys (`part_${Date.now()}${ext}`).
- **Fix:**
  1. Restrict route to `request.method === 'GET'`.
  2. Validate `key` against `/^part_[a-zA-Z0-9_-]+\.(jpg|png|webp)$/` (return `404` or `400` with `corsHeaders` if invalid).
  3. Always set `headers.set('Vary', 'Origin')` on `/api/photos/:key` responses.
  4. In `POST /api/upload`, generate keys using `part_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}` (or `part_${crypto.randomUUID()}${ext}` — update test regex in `backend/test/security.test.js` if needed).
- **Tests (`backend/test/security.test.js`):**
  - Assert `/api/photos/part_1.jpg` includes `Vary: Origin`.
  - Assert traversal/invalid keys like `/api/photos/../../secret` or `/api/photos/other.txt` are rejected with 400/404 without calling `env.PHOTOS.get`.

### 2.5 Cap `rateLimitMap` Size & Prune Old Idempotency Rows in Cron (Findings #8 & #11)
- **File:** `backend/index.js` (`checkRateLimit` lines 399–425, `scheduled` lines 1071–1165)
- **Fix:**
  1. In `checkRateLimit`, add a hard cap (e.g. `const MAX_RATE_LIMIT_KEYS = 5000;`): if `rateLimitMap.size >= MAX_RATE_LIMIT_KEYS`, run expired-entry eviction immediately; if still at capacity, delete the oldest key (`rateLimitMap.keys().next().value`).
  2. In `scheduled()`, add best-effort cleanup queries inside the DB check block:
     ```js
     await env.DB.prepare("DELETE FROM lead_autorespond WHERE day < date('now', '-7 days')").run();
     await env.DB.prepare("DELETE FROM processed_stripe_events WHERE created_at < datetime('now', '-30 days')").run();
     ```
  3. In `scheduled()`, update the Inventory Dashboard health check (`fetch('https://inventory.petersonsmallenginerepair.com', { redirect: 'manual' })`) so a 302 redirect to Cloudflare Access is recognized distinctly from an origin 5xx failure (Finding #12).

### 2.6 Validate `image_url` and Field Lengths in `POST /api/parts` & Encode UPC in `parts-manager` (Finding #9)
- **Files:** `backend/index.js` (lines 750–775) and `parts-manager/src/App.jsx` (line 72)
- **Fix:**
  1. In `backend/index.js` (`POST /api/parts`):
     - Cap lengths: `name` (<=200), `sku` (<=100), `upc` (<=100), `description` (<=2000), `image_url` (<=500).
     - If `image_url` is non-empty, validate that `new URL(image_url)` parses and its `.protocol` is `'https:'` or `'http:'`; otherwise return `400`.
  2. In `parts-manager/src/App.jsx` line 72:
     - Change `axios.get(`${API_BASE}/api/lookup?upc=${decodedText}`)` to `axios.get(`${API_BASE}/api/lookup?upc=${encodeURIComponent(decodedText)}`)`.

---

## Phase 3: CI/CD & Security Headers Hardening (Findings #7 & #10)

### 3.1 Harden `.github/workflows/deploy.yml` (Finding #7)
- **File:** `.github/workflows/deploy.yml`
- **Fix:**
  1. Add top-level least-privilege token permissions:
     ```yaml
     permissions:
       contents: read
     ```
  2. Pin `actions/checkout` and `cloudflare/wrangler-action` to full commit SHAs (with a comment showing the version tag).
  3. In `Set Worker Secrets`:
     - Pass secrets via the step's `env:` block rather than inline `${{ secrets.* }}` inside `run:`.
     - Guard **all** secrets (including `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDFLARE_ACCESS_AUD`) with `if [ -n "$SECRET_VAR" ]; then printf '%s' "$SECRET_VAR" | npx wrangler secret put ...; fi` so an empty secret never blanks out production and `echo` never adds a trailing newline.

### 3.2 Tighten `site/_headers` (Finding #10)
- **File:** `site/_headers`
- **Fix:**
  - Add `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()`.
  - Strengthen `Content-Security-Policy` to include baseline directives that do not break inline scripts, Google Fonts, or Cloudflare Turnstile:
    ```
    Content-Security-Policy: upgrade-insecure-requests; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
    ```
  - Run `npm run verify:ui` if testing locally to confirm zero layout or Turnstile regressions.

---

## Phase 4: Local `.env` Hygiene (Finding #2 — Manual / Operator Confirmation)

- **File:** `.env` (untracked local file)
- **Action:** Ask the user before deleting any keys from `.env`, or remove only the documented dead keys listed in `PROCEDURE.md` §7 (`CLOUDFLARE_API_KEY`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PAGES_PROJECT`, `SQUARE_APP_ID`, `STRIPE_BACKUP_CODE`) after confirming with the user. **Never print `.env` values to the terminal or chat.**

---

## Final Verification Checklist

Before finishing or opening a PR, run and record the output of:
- [ ] `npm run lint` (0 warnings/errors across `backend`, `site`, `parts-manager`, `tools`)
- [ ] `npm test` (all existing + new security regression tests pass)
- [ ] `npm run check` (full pre-commit gate passes)
- [ ] `npm audit` / `npm --prefix backend audit` / `npm --prefix parts-manager audit`
- [ ] `npm --prefix parts-manager run build` (clean Vite production build)
- [ ] Update `PROJECT_STATE.md` and `STATUS.md` with the completed fixes and test counts.
