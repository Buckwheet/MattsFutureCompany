# Geocode Metro Constraint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain OpenRouteService free-text geocoding to the service metro so typed addresses resolve locally (e.g. "Blaine, MN" no longer resolves to Blaine, TN).

**Architecture:** Add `focus.point` (bias toward the shop) and `boundary.circle` (hard-filter to a 64 km radius around the shop) parameters to the `orsGeocode` request in `backend/index.js`. Origin coordinates (`ORIGIN_COORDS`) stay server-side. No frontend changes.

**Tech Stack:** Cloudflare Worker (ES module), Vitest, OpenRouteService (Pelias) geocoding API.

## Global Constraints

- `ORIGIN_COORDS` (the shop origin) must NEVER be returned to the client — these params only go into the outbound ORS request.
- ORS/Pelias `boundary.circle.radius` is in **kilometers**. Service coverage target is 40 miles ≈ **64 km**. Use `64` and document the mile→km conversion inline.
- Only `orsGeocode` changes. `orsReverseGeocode`, `orsDrivingMiles`, and `buildEstimate` are unchanged.
- No change to fee tiers, service-area city list, or the 20-mile distance gate.
- Existing 14 tests must still pass.

---

### Task 1: Constrain `orsGeocode` to the service metro

**Files:**
- Modify: `backend/index.js` (function `orsGeocode`, lines 79-94)
- Test: `backend/test/estimate.test.js` (add a test asserting the geocode URL carries the new params)

**Interfaces:**
- Consumes: `ORIGIN_COORDS` (module constant `{ lat, lng }`, already defined), `buildEstimate(env, { lat, lng, address })` (existing, exported).
- Produces: no signature changes. `orsGeocode(env, address)` still returns `{ lng, lat, city, label }`.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/estimate.test.js`, inside the existing `describe('buildEstimate', () => { ... })` block (which already has `afterEach(() => { vi.restoreAllMocks(); })`):

```javascript
  it('constrains geocoding to the service metro (focus + boundary circle)', async () => {
    const geocode = { features: [{
      geometry: { coordinates: [-93.23, 45.16] },
      properties: { locality: 'Blaine', label: '123 Main St, Blaine, MN, USA' }
    }] };
    const matrix = { distances: [[12875]] };
    const reverse = { features: [{ properties: { locality: 'Blaine', label: '123 Main St, Blaine, MN, USA' } }] };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => geocode })   // geocode (address path)
      .mockResolvedValueOnce({ ok: true, json: async () => matrix })    // matrix
      .mockResolvedValueOnce({ ok: true, json: async () => reverse });  // reverse geocode

    await buildEstimate({ ORS_API_KEY: 'test-key' }, { address: 'Blaine, MN' });

    const geocodeUrl = global.fetch.mock.calls[0][0];
    expect(geocodeUrl).toContain('focus.point.lat=45.159887');
    expect(geocodeUrl).toContain('focus.point.lon=-93.275209');
    expect(geocodeUrl).toContain('boundary.circle.lat=45.159887');
    expect(geocodeUrl).toContain('boundary.circle.lon=-93.275209');
    expect(geocodeUrl).toContain('boundary.circle.radius=64');
  });
```

> Note: the coordinates `45.159887` / `-93.275209` are the current `ORIGIN_COORDS` values in `backend/index.js`. If they differ when you read the file, use the actual values from the file in the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (workingDirectory: `backend`)
Expected: FAIL — the geocode URL does not yet contain `focus.point`/`boundary.circle` params.

- [ ] **Step 3: Implement the constraint**

In `backend/index.js`, replace the `orsGeocode` function body's fetch URL. Change:

```javascript
async function orsGeocode(env, address) {
  const res = await fetch(
    `https://api.openrouteservice.org/geocode/search?api_key=${env.ORS_API_KEY}` +
    `&text=${encodeURIComponent(address)}&boundary.country=US&size=1`
  );
```

to:

```javascript
async function orsGeocode(env, address) {
  // Bias + hard-filter geocoding to the service metro so vague input
  // (e.g. "Blaine, MN") resolves locally instead of a same-named distant city.
  // Pelias boundary.circle.radius is in KM; 40 mi service coverage ≈ 64 km.
  const res = await fetch(
    `https://api.openrouteservice.org/geocode/search?api_key=${env.ORS_API_KEY}` +
    `&text=${encodeURIComponent(address)}&boundary.country=US&size=1` +
    `&focus.point.lat=${ORIGIN_COORDS.lat}&focus.point.lon=${ORIGIN_COORDS.lng}` +
    `&boundary.circle.lat=${ORIGIN_COORDS.lat}&boundary.circle.lon=${ORIGIN_COORDS.lng}` +
    `&boundary.circle.radius=64`
  );
```

Leave the rest of the function (response parsing, return shape) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (workingDirectory: `backend`)
Expected: PASS — all tests green (15 total: 14 existing + 1 new), output pristine.

- [ ] **Step 5: Commit**

```bash
git add backend/index.js backend/test/estimate.test.js
git commit -m "fix: constrain ORS geocoding to service metro (focus + boundary circle)"
```

- [ ] **Step 6: Post-deploy live verification (after merge/deploy — informational, not part of the commit)**

After this is merged and deployed, confirm the fix live:
```bash
curl -X POST "https://peterson-backend.mattssmallenginerep.workers.dev/api/estimate" -H "Content-Type: application/json" -d "{\"address\":\"Blaine, MN\"}"
```
Expected: `deliveryAddress` resolves to a **MN** address (not TN), with a small `oneWayMiles`. And a clearly out-of-metro string returns no estimate (soft failure), lead still submits.

---

## Notes for the implementer

- Shell is Windows PowerShell 5.1: chain with `;` and `if ($?) { ... }`, never `&&`. Do not `cd` inside commands; run test commands from the `backend` directory.
- Do not modify `orsReverseGeocode` — reverse geocoding takes a point, not free text, so it does not need the metro constraint.
- Do not leak `ORIGIN_COORDS` into any response; it only belongs in the outbound ORS request URL.
