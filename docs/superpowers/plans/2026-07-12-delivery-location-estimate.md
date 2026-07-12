# Delivery Location & Instant Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional browser-geolocation flow to the delivery request that returns an instant, estimated pickup/delivery fee based on driving distance from Matt's shop, and passes the pickup location to Matt's lead email.

**Architecture:** Pure fee/city logic is extracted into testable helper functions in `backend/index.js` and unit-tested with Vitest. A new public `POST /api/estimate` endpoint calls OpenRouteService (geocode + matrix distance + reverse geocode) and applies the helpers. The frontend form (`site/index.html`) gains a progressively-enhanced delivery section; lead capture accepts and forwards new delivery fields into Matt's email.

**Tech Stack:** Cloudflare Workers (ES modules), Vitest (new, backend unit tests), OpenRouteService REST API, vanilla JS + CSS frontend.

## Global Constraints

- Origin `10450 Foley Blvd, Coon Rapids, MN 55448` is server-side only — NEVER sent to browser or shown to customer. Hardcode as constant `ORIGIN_COORDS`.
- Fee tiers: ≤5 mi one-way → $1.50/mi; >5 & ≤20 mi → $2.00/mi; >20 mi → no estimate ("Outside standard service area — call to confirm."). Fee applies to round-trip miles (`2 × oneWayMiles`).
- Distance (≤20 mi one-way) is the ONLY gate. City list is friendly confirmation only.
- Service-area cities (case-insensitive match): Coon Rapids, Blaine, Andover, Anoka, Ham Lake, Fridley, Spring Lake Park, Ramsey, Champlin, Brooklyn Park, Lino Lakes, East Bethel, Maple Grove, Elk River.
- Estimate copy: "Estimated pickup & delivery: ~$X (confirmed upon scheduling)".
- A missing/failed location or estimate must NEVER block lead submission (Option A).
- Escape all user-supplied values in emails with existing `escapeHtml()`.
- Secret name: `ORS_API_KEY`.

---

### Task 1: Set up Vitest and extract pure fee/city helpers

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/index.js` (add exported helpers near top, after `escapeHtml`)
- Create: `backend/test/estimate.test.js`

**Interfaces:**
- Produces:
  - `calculateFee(oneWayMiles: number) => { estimate: number|null, roundTripMiles: number, outOfRange: boolean }`
  - `matchServiceArea(city: string) => boolean`
  - `SERVICE_AREA_CITIES: string[]`
  - `ORIGIN_COORDS: { lat: number, lng: number }` (lng/lat for ORS)

- [ ] **Step 1: Add Vitest to `backend/package.json`**

```json
{
  "name": "peterson-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "stripe": "^14.25.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install` (workingDirectory: `backend`)
Expected: vitest added to node_modules.

- [ ] **Step 3: Write the failing test**

Create `backend/test/estimate.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { calculateFee, matchServiceArea, SERVICE_AREA_CITIES } from '../index.js';

describe('calculateFee', () => {
  it('charges $1.50/mi round trip at 3 mi one-way', () => {
    const r = calculateFee(3);
    expect(r.roundTripMiles).toBe(6);
    expect(r.estimate).toBeCloseTo(9.0, 2);
    expect(r.outOfRange).toBe(false);
  });

  it('charges $1.50/mi at exactly 5 mi (boundary, inclusive)', () => {
    const r = calculateFee(5);
    expect(r.estimate).toBeCloseTo(15.0, 2); // 10 rt mi * 1.50
  });

  it('charges $2.00/mi just over 5 mi', () => {
    const r = calculateFee(5.1);
    expect(r.estimate).toBeCloseTo(20.4, 2); // 10.2 rt mi * 2.00
  });

  it('charges $2.00/mi at 8 mi one-way', () => {
    const r = calculateFee(8);
    expect(r.estimate).toBeCloseTo(32.0, 2);
  });

  it('charges $2.00/mi at exactly 20 mi (boundary, inclusive)', () => {
    const r = calculateFee(20);
    expect(r.estimate).toBeCloseTo(80.0, 2); // 40 rt mi * 2.00
    expect(r.outOfRange).toBe(false);
  });

  it('returns out of range just over 20 mi', () => {
    const r = calculateFee(20.1);
    expect(r.estimate).toBeNull();
    expect(r.outOfRange).toBe(true);
  });
});

describe('matchServiceArea', () => {
  it('matches exact city', () => {
    expect(matchServiceArea('Blaine')).toBe(true);
  });
  it('matches case-insensitively with whitespace', () => {
    expect(matchServiceArea('  coon rapids ')).toBe(true);
  });
  it('does not match a city outside the list', () => {
    expect(matchServiceArea('Minneapolis')).toBe(false);
  });
  it('handles empty/undefined', () => {
    expect(matchServiceArea('')).toBe(false);
    expect(matchServiceArea(undefined)).toBe(false);
  });
  it('exposes 14 service-area cities', () => {
    expect(SERVICE_AREA_CITIES).toHaveLength(14);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test` (workingDirectory: `backend`)
Expected: FAIL — `calculateFee is not a function` (not yet exported).

- [ ] **Step 5: Implement helpers in `backend/index.js`**

Add immediately after the `escapeHtml` function:

```javascript
// --- Delivery estimate constants & pure helpers ---
// Origin: 10450 Foley Blvd, Coon Rapids, MN 55448 (server-side only, never exposed)
export const ORIGIN_COORDS = { lat: 45.1701, lng: -93.2969 };

export const SERVICE_AREA_CITIES = [
  'Coon Rapids', 'Blaine', 'Andover', 'Anoka', 'Ham Lake', 'Fridley',
  'Spring Lake Park', 'Ramsey', 'Champlin', 'Brooklyn Park', 'Lino Lakes',
  'East Bethel', 'Maple Grove', 'Elk River'
];

const _normalizedCities = SERVICE_AREA_CITIES.map(c => c.toLowerCase());

export function matchServiceArea(city) {
  if (!city || typeof city !== 'string') return false;
  return _normalizedCities.includes(city.trim().toLowerCase());
}

export function calculateFee(oneWayMiles) {
  const roundTripMiles = oneWayMiles * 2;
  if (oneWayMiles > 20) {
    return { estimate: null, roundTripMiles, outOfRange: true };
  }
  const rate = oneWayMiles <= 5 ? 1.5 : 2.0;
  return {
    estimate: Math.round(rate * roundTripMiles * 100) / 100,
    roundTripMiles,
    outOfRange: false
  };
}
```

> Note: `ORIGIN_COORDS` here uses placeholder coordinates for 10450 Foley Blvd. Task 2 Step 6 verifies/corrects them against ORS geocoding before deploy.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test` (workingDirectory: `backend`)
Expected: PASS — all 11 tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/index.js backend/test/estimate.test.js
git commit -m "feat: add tested fee/service-area helpers for delivery estimate"
```

---

### Task 2: Add `POST /api/estimate` endpoint (ORS integration)

**Files:**
- Modify: `backend/index.js` (add route inside `fetch`, before the `POST /` lead route ~line 426; add `orsDrivingMiles` and `orsGeocode`/`orsReverseGeocode` helpers)
- Modify: `backend/test/estimate.test.js` (add endpoint-shape test with mocked fetch)

**Interfaces:**
- Consumes: `calculateFee`, `matchServiceArea`, `ORIGIN_COORDS`, `checkRateLimit`, `getCorsHeaders`, `corsResponse` (all existing).
- Produces: endpoint `POST /api/estimate` returning
  `{ estimate, roundTripMiles, oneWayMiles, city, inServiceArea, outOfRange, mapLink, deliveryAddress }`.
- Produces helper: `buildEstimate(env, { lat, lng, address }) => Promise<estimateObject>`.

- [ ] **Step 1: Write the failing test (mocked ORS)**

Add to `backend/test/estimate.test.js`:

```javascript
import { buildEstimate } from '../index.js';

describe('buildEstimate', () => {
  const env = { ORS_API_KEY: 'test-key' };

  it('builds an estimate from coordinates with mocked ORS', async () => {
    const distances = { distances: [[0, 12875]] }; // meters origin->dest (~8 mi)
    const reverse = { features: [{ properties: { locality: 'Blaine', label: '123 Main St, Blaine, MN 55434' } }] };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => distances })   // matrix
      .mockResolvedValueOnce({ ok: true, json: async () => reverse });    // reverse geocode

    const r = await buildEstimate(env, { lat: 45.16, lng: -93.23 });
    expect(r.oneWayMiles).toBeCloseTo(8.0, 1);
    expect(r.estimate).toBeCloseTo(32.0, 0);
    expect(r.city).toBe('Blaine');
    expect(r.inServiceArea).toBe(true);
    expect(r.mapLink).toContain('45.16');
  });
});
```

Add `vi` to the import line: `import { describe, it, expect, vi } from 'vitest';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (workingDirectory: `backend`)
Expected: FAIL — `buildEstimate is not a function`.

- [ ] **Step 3: Implement ORS helpers and `buildEstimate`**

Add after `calculateFee` in `backend/index.js`:

```javascript
const METERS_PER_MILE = 1609.344;

async function orsGeocode(env, address) {
  const res = await fetch(
    `https://api.openrouteservice.org/geocode/search?api_key=${env.ORS_API_KEY}` +
    `&text=${encodeURIComponent(address)}&boundary.country=US&size=1`
  );
  if (!res.ok) throw new Error('Geocode failed');
  const data = await res.json();
  const f = data.features && data.features[0];
  if (!f) throw new Error('Address not found');
  return {
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    city: f.properties.locality || f.properties.county || '',
    label: f.properties.label || address
  };
}

async function orsReverseGeocode(env, lat, lng) {
  const res = await fetch(
    `https://api.openrouteservice.org/geocode/reverse?api_key=${env.ORS_API_KEY}` +
    `&point.lat=${lat}&point.lon=${lng}&size=1`
  );
  if (!res.ok) throw new Error('Reverse geocode failed');
  const data = await res.json();
  const f = data.features && data.features[0];
  return {
    city: f ? (f.properties.locality || f.properties.county || '') : '',
    label: f ? (f.properties.label || '') : ''
  };
}

async function orsDrivingMiles(env, destLat, destLng) {
  const res = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST',
    headers: {
      'Authorization': env.ORS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      locations: [[ORIGIN_COORDS.lng, ORIGIN_COORDS.lat], [destLng, destLat]],
      sources: [0],
      destinations: [1],
      metrics: ['distance'],
      units: 'm'
    })
  });
  if (!res.ok) throw new Error('Matrix failed');
  const data = await res.json();
  const meters = data.distances[0][0];
  return meters / METERS_PER_MILE;
}

export async function buildEstimate(env, { lat, lng, address }) {
  let destLat = lat, destLng = lng, city = '', label = '';

  if ((destLat == null || destLng == null) && address) {
    const g = await orsGeocode(env, address);
    destLat = g.lat; destLng = g.lng; city = g.city; label = g.label;
  }
  if (destLat == null || destLng == null) {
    throw new Error('No location provided');
  }

  const oneWayMiles = Math.round((await orsDrivingMiles(env, destLat, destLng)) * 10) / 10;

  if (!city) {
    const rev = await orsReverseGeocode(env, destLat, destLng);
    city = rev.city;
    if (!label) label = rev.label;
  }

  const fee = calculateFee(oneWayMiles);
  return {
    estimate: fee.estimate,
    roundTripMiles: fee.roundTripMiles,
    oneWayMiles,
    city,
    inServiceArea: matchServiceArea(city),
    outOfRange: fee.outOfRange,
    mapLink: `https://www.openstreetmap.org/?mlat=${destLat}&mlon=${destLng}#map=16/${destLat}/${destLng}`,
    deliveryAddress: label
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (workingDirectory: `backend`)
Expected: PASS.

- [ ] **Step 5: Add the route handler in `fetch`**

Insert in `backend/index.js` immediately before the `// --- ROUTE: POST / (Lead Capture - Public) ---` comment:

```javascript
    // --- ROUTE: POST /api/estimate (Delivery Estimate - Public) ---
    if (url.pathname === '/api/estimate' && request.method === 'POST') {
      try {
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return corsResponse({ error: 'Too many requests. Please try again later.' }, 429, corsHeaders);
        }
        if (!env.ORS_API_KEY) {
          return corsResponse({ error: 'Estimate unavailable' }, 503, corsHeaders);
        }
        const body = await request.json();
        const { lat, lng, address } = body;
        const result = await buildEstimate(env, { lat, lng, address });
        return corsResponse(result, 200, corsHeaders);
      } catch (e) {
        console.error('Estimate Error:', e.message);
        return corsResponse({ error: 'Could not calculate estimate' }, 502, corsHeaders);
      }
    }
```

- [ ] **Step 6: Verify origin coordinates against ORS**

Run (workingDirectory: `backend`, replace `$KEY`):
```bash
curl "https://api.openrouteservice.org/geocode/search?api_key=$KEY&text=10450%20Foley%20Blvd%20Coon%20Rapids%20MN%2055448&size=1"
```
Expected: JSON with `geometry.coordinates`. Update `ORIGIN_COORDS` in `index.js` with the returned `[lng, lat]` if they differ from the placeholder. Run `npm test` again to confirm green.

- [ ] **Step 7: Commit**

```bash
git add backend/index.js backend/test/estimate.test.js
git commit -m "feat: add POST /api/estimate endpoint with OpenRouteService"
```

---

### Task 3: Wire delivery fields into lead capture + email

**Files:**
- Modify: `backend/index.js` (lead route `POST /` ~line 426-437 destructure; email HTML ~line 516-537)

**Interfaces:**
- Consumes: existing `escapeHtml`.
- Produces: lead notification email includes delivery block when `pickup_required === 'Yes'`.

- [ ] **Step 1: Accept new fields in the lead body**

In `backend/index.js`, change the lead destructure (currently):

```javascript
        const { name, email, phone, equipment, issue, pickup_required } = data;
```
to:
```javascript
        const {
          name, email, phone, equipment, issue, pickup_required,
          delivery_address, delivery_lat, delivery_lng, estimate, distance_miles
        } = data;
```

- [ ] **Step 2: Build the delivery email block**

In `backend/index.js`, immediately before the `await fetch('https://api.resend.com/emails', {` call inside the "NOTIFY MATT" section, add:

```javascript
            const mapLink = (delivery_lat != null && delivery_lng != null)
              ? `https://www.openstreetmap.org/?mlat=${delivery_lat}&mlon=${delivery_lng}#map=16/${delivery_lat}/${delivery_lng}`
              : '';
            const deliveryBlock = (pickup_required === 'Yes')
              ? `<div style="margin-top: 15px; padding: 12px; background: #f6f9f7; border-radius: 8px;">
                   <p style="margin: 0 0 6px;"><strong>🚚 Delivery Requested</strong></p>
                   <p style="margin: 4px 0;"><strong>Address:</strong> ${escapeHtml(delivery_address || 'Not provided')}</p>
                   <p style="margin: 4px 0;"><strong>Distance (one-way):</strong> ${escapeHtml(distance_miles != null ? distance_miles + ' mi' : 'N/A')}</p>
                   <p style="margin: 4px 0;"><strong>Estimated Fee:</strong> ${escapeHtml(estimate != null ? '$' + estimate : 'Call to confirm')}</p>
                   ${mapLink ? `<p style="margin: 4px 0;"><a href="${mapLink}">📍 View pickup location</a></p>` : ''}
                 </div>`
              : '';
```

- [ ] **Step 3: Inject the block into the email HTML**

In the notify-Matt email `html`, replace the line:

```javascript
                    <p><strong>Issue:</strong> ${escapeHtml(issue)}</p>
```
with:
```javascript
                    <p><strong>Issue:</strong> ${escapeHtml(issue)}</p>
                    ${deliveryBlock}
```

- [ ] **Step 4: Verify syntax**

Run: `node --check index.js` (workingDirectory: `backend`)
Expected: no output (valid).

- [ ] **Step 5: Run tests (regression)**

Run: `npm test` (workingDirectory: `backend`)
Expected: PASS (unchanged helper tests).

- [ ] **Step 6: Commit**

```bash
git add backend/index.js
git commit -m "feat: include delivery address, distance, and estimate in lead email"
```

---

### Task 4: Frontend delivery section + geolocation flow

**Files:**
- Modify: `site/index.html` (add delivery UI after pickup section ~line 458; add JS after pickup exclusivity ~line 628; extend submit payload ~line 645)
- Modify: `site/style.css` (add delivery section styles near `.pickup-options` ~line 529)

**Interfaces:**
- Consumes: `POST /api/estimate` from Task 2.
- Produces: `delivery_address`, `delivery_lat`, `delivery_lng`, `estimate`, `distance_miles` in the lead POST body.

- [ ] **Step 1: Add the delivery HTML block**

In `site/index.html`, immediately after the pickup `</div>` that closes the `form-group` at line 458 (after the pickup-options block), insert:

```html
          <div class="form-group delivery-section" id="delivery-section" hidden>
            <button type="button" class="btn secondary" id="enable-location-btn">
              📍 Enable location for an instant delivery estimate
            </button>
            <div class="delivery-manual" id="delivery-manual" hidden>
              <label for="delivery_address">Delivery Address</label>
              <input type="text" id="delivery_address" name="delivery_address" placeholder="Street, City, ZIP">
            </div>
            <div class="delivery-estimate" id="delivery-estimate"></div>
            <input type="hidden" id="delivery_lat" name="delivery_lat">
            <input type="hidden" id="delivery_lng" name="delivery_lng">
            <input type="hidden" id="estimate" name="estimate">
            <input type="hidden" id="distance_miles" name="distance_miles">
          </div>
```

- [ ] **Step 2: Add CSS**

In `site/style.css` after the `.pickup-option` rules (~line 560), add:

```css
.delivery-section { margin-top: 12px; }
.delivery-manual { margin-top: 12px; }
.delivery-estimate {
  margin-top: 12px;
  font-weight: 600;
  color: var(--accent, #d92d20);
  min-height: 1.2em;
}
.delivery-estimate.in-area { color: #0b7a3b; }
.delivery-estimate .muted { color: var(--muted, #888); font-weight: 400; font-size: 0.9rem; }
```

- [ ] **Step 3: Show/hide the delivery section with the pickup toggle**

In `site/index.html`, inside the existing pickup exclusivity block (after line 627, before its closing `}`), add a shared helper. Replace the whole pickup block (lines 610-628) with:

```javascript
  // === Pickup Checkbox Exclusivity + Delivery Section ===
  const pickupYes = document.getElementById('pickup-yes');
  const pickupNo = document.getElementById('pickup-no');
  const deliverySection = document.getElementById('delivery-section');

  function updateDeliveryVisibility() {
    if (deliverySection) deliverySection.hidden = !(pickupYes && pickupYes.checked);
  }
  if (pickupYes && pickupNo) {
    pickupYes.addEventListener('change', () => {
      if (pickupYes.checked) { pickupNo.checked = false; } else { pickupNo.checked = true; }
      updateDeliveryVisibility();
    });
    pickupNo.addEventListener('change', () => {
      if (pickupNo.checked) { pickupYes.checked = false; } else { pickupYes.checked = true; }
      updateDeliveryVisibility();
    });
    updateDeliveryVisibility();
  }
```

- [ ] **Step 4: Add geolocation + estimate JS**

In `site/index.html`, immediately after the block from Step 3, add:

```javascript
  // === Delivery Estimate Flow ===
  const API_ESTIMATE = 'https://peterson-backend.mattssmallenginerep.workers.dev/api/estimate';
  const enableLocationBtn = document.getElementById('enable-location-btn');
  const deliveryManual = document.getElementById('delivery-manual');
  const deliveryAddressInput = document.getElementById('delivery_address');
  const deliveryEstimateEl = document.getElementById('delivery-estimate');
  const latInput = document.getElementById('delivery_lat');
  const lngInput = document.getElementById('delivery_lng');
  const estimateInput = document.getElementById('estimate');
  const distanceInput = document.getElementById('distance_miles');

  function renderEstimate(r) {
    if (!r || r.error) { deliveryEstimateEl.textContent = ''; return; }
    estimateInput.value = r.estimate != null ? r.estimate : '';
    distanceInput.value = r.oneWayMiles != null ? r.oneWayMiles : '';
    if (r.deliveryAddress && !deliveryAddressInput.value) deliveryAddressInput.value = r.deliveryAddress;
    deliveryEstimateEl.classList.toggle('in-area', !!r.inServiceArea);
    if (r.outOfRange) {
      deliveryEstimateEl.innerHTML = 'Outside standard service area — <span class="muted">call to confirm.</span>';
    } else if (r.estimate != null) {
      const area = r.inServiceArea && r.city ? ` <span class="muted">✓ ${r.city} is in my service area!</span>` : '';
      deliveryEstimateEl.innerHTML =
        `Estimated pickup &amp; delivery: ~$${r.estimate.toFixed(2)} <span class="muted">(confirmed upon scheduling)</span>${area}`;
    } else {
      deliveryEstimateEl.textContent = '';
    }
  }

  async function fetchEstimate(payload) {
    try {
      deliveryEstimateEl.textContent = 'Calculating…';
      const res = await fetch(API_ESTIMATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      renderEstimate(await res.json());
    } catch (e) {
      deliveryEstimateEl.textContent = '';
    }
  }

  if (enableLocationBtn) {
    enableLocationBtn.addEventListener('click', () => {
      if (!navigator.geolocation) { if (deliveryManual) deliveryManual.hidden = false; return; }
      deliveryEstimateEl.textContent = 'Requesting location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latInput.value = pos.coords.latitude;
          lngInput.value = pos.coords.longitude;
          fetchEstimate({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => { if (deliveryManual) deliveryManual.hidden = false; deliveryEstimateEl.textContent = ''; }
      );
    });
  }
  if (deliveryAddressInput) {
    deliveryAddressInput.addEventListener('blur', () => {
      const addr = deliveryAddressInput.value.trim();
      if (addr.length > 4) { latInput.value = ''; lngInput.value = ''; fetchEstimate({ address: addr }); }
    });
  }
```

- [ ] **Step 5: Manual smoke test (local)**

Run: `npx wrangler pages dev site` (workingDirectory: repo root) OR open `site/index.html` in a browser.
Expected: checking "Yes" reveals the delivery section; the location button appears. (Estimate calls require the deployed backend + `ORS_API_KEY`; verify wiring in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/style.css
git commit -m "feat: add delivery geolocation flow and live estimate to contact form"
```

---

### Task 5: Configure `ORS_API_KEY` secret and deploy

**Files:**
- Modify: `.github/workflows/deploy.yml` (add secret put step)
- Modify: `.env.example` (add placeholder)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ORS_API_KEY` available to the deployed Worker.

- [ ] **Step 1: Add `ORS_API_KEY` to `.env.example`**

Append to `.env.example`:
```
ORS_API_KEY=
```

- [ ] **Step 2: Add secret to the deploy workflow**

In `.github/workflows/deploy.yml`, inside the `Set Worker Secrets` `run:` block, after the `CLOUDFLARE_ACCESS_AUD` line, add:
```bash
          if [ -n "${{ secrets.ORS_API_KEY }}" ]; then
            echo "${{ secrets.ORS_API_KEY }}" | npx wrangler secret put ORS_API_KEY
          fi
```

- [ ] **Step 3: Set the GitHub Actions secret**

Run (repo root, replace `$KEY` with the ORS key):
```bash
gh secret set ORS_API_KEY --body "$KEY"
```
Expected: `✓ Set Actions secret ORS_API_KEY`.

- [ ] **Step 4: Commit and push (triggers deploy)**

```bash
git add .github/workflows/deploy.yml .env.example
git commit -m "chore: add ORS_API_KEY secret to deploy pipeline"
git push
```

- [ ] **Step 5: Verify deploy**

Run: `gh run list --limit 1`
Expected: `Deploy Peterson Infrastructure` — `completed success`.

- [ ] **Step 6: End-to-end verification**

Run (replace with a known local address):
```bash
curl -X POST "https://peterson-backend.mattssmallenginerep.workers.dev/api/estimate" -H "Content-Type: application/json" -d "{\"address\":\"City Hall, Blaine, MN\"}"
```
Expected: JSON with `estimate`, `oneWayMiles`, `city`, `inServiceArea: true`. Then submit a live delivery lead and confirm Matt's email shows the delivery block.

---

## Notes for the implementer

- The backend must be an ES module already (it uses `export default`); adding `"type": "module"` to `package.json` is safe and needed for Vitest to import `index.js`.
- Do not expose `ORIGIN_COORDS` in any response body or frontend code.
- If ORS returns rate-limit errors (HTTP 429) during testing, wait — the free tier is 2,000/day, 40/min.
