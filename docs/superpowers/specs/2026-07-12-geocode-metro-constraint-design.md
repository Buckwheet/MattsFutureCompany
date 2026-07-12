# Design: Constrain ORS Geocoding to Service Metro

**Date:** 2026-07-12
**Project:** Peterson Small Engine Repair
**Status:** Approved (brainstorming complete)

---

## Problem

The `/api/estimate` endpoint uses OpenRouteService free-text geocoding for
manually-typed addresses. ORS does not bias to Minnesota, so vague input like
"Blaine, MN" resolves to Blaine, **Tennessee** (~974 mi away), producing a
nonsensical distance and a false "outside service area / call to confirm"
result. Confirmed live in production:

```
{"address":"Blaine, MN"} -> deliveryAddress "Blaine, TN, USA", oneWayMiles 974.3
```

Browser geolocation (the primary path) is unaffected because it sends exact
lat/lng. Only the manual-address fallback is at risk.

## Goal

Bias and constrain ORS geocoding so typed addresses resolve within the service
metro, and addresses far outside it fail to geocode (yielding the normal
no-estimate path) rather than resolving to a wrong distant city.

## Approach

Add two parameters to the `orsGeocode` request in `backend/index.js`:

- **`focus.point.lat` / `focus.point.lon`** = the shop origin (`ORIGIN_COORDS`).
  Biases result ranking toward the shop.
- **`boundary.circle.lat` / `boundary.circle.lon`** = origin, plus
  **`boundary.circle.radius=40`** (kilometers? — see note). Hard-filters out
  results outside the circle.

**Radius:** 40 **miles** of service coverage is desired (20 mi service cap +
buffer). ORS `boundary.circle.radius` is expressed in **kilometers**, so 40 mi
≈ **64 km**. The implementation uses `64` and documents the mile→km conversion.

Origin coordinates remain server-side only — these params are added to the
outbound ORS request, never returned to the client.

## Behavior after fix

- "Blaine, MN" → resolves to Blaine, MN (biased) instead of TN.
- A genuine far-away address (e.g. another state) → no ORS match → `orsGeocode`
  throws "Address not found" → endpoint returns its existing 502 soft-failure →
  frontend shows no estimate, lead still submits. (No behavior change to the
  failure path; only the wrong-city path is eliminated.)
- Coordinate-based requests (browser geolocation) → unchanged (they skip
  geocoding entirely).

## Scope

- Only `orsGeocode` changes. `orsReverseGeocode` and `orsDrivingMiles` are
  unchanged.
- No frontend change.
- No change to fee tiers, service-area city list, or the 20-mile distance gate.

## Testing

- Unit: `orsGeocode` (or `buildEstimate` with mocked fetch) — assert the
  outbound geocode URL contains `focus.point.lat`, `focus.point.lon`,
  `boundary.circle.lat`, `boundary.circle.lon`, and `boundary.circle.radius=64`.
- Existing 14 tests must still pass.
- Post-deploy live check: `{"address":"Blaine, MN"}` resolves to MN, and a
  clearly out-of-metro string returns no estimate.

## Out of scope

- Autocomplete / typeahead address entry.
- Switching geocoding providers.
