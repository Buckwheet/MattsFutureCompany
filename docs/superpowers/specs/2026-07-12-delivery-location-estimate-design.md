# Design: Delivery Location & Instant Estimate

**Date:** 2026-07-12
**Project:** Peterson Small Engine Repair
**Status:** Approved (brainstorming complete)

---

## Goal

When a customer requests **pickup/delivery** on the service form, offer an optional
browser-geolocation flow that produces an **instant, estimated** pickup-and-delivery
fee based on real driving distance from Matt's shop. Also capture the pickup
location (address + map pin) and pass it to Matt in the lead notification.

The estimate is always presented as an estimate, "confirmed upon scheduling."
A missing location must never block a lead from submitting.

---

## Origin (server-side only)

- Origin address: `10450 Foley Blvd, Coon Rapids, MN 55448`.
- Geocoded once to fixed lat/lng, stored as a constant in the Worker.
- **Never** transmitted to the browser or shown to the customer in any form.

---

## Fee Calculation

Distance is measured **one-way** from the shop via OpenRouteService driving distance.
The fee covers the full round trip (pickup + return), so it is applied to
`roundTripMiles = 2 × oneWayMiles`.

| One-way distance | Rate | Fee |
|---|---|---|
| ≤ 5 mi | $1.50 / mi | `1.50 × roundTripMiles` |
| > 5 mi and ≤ 20 mi | $2.00 / mi | `2.00 × roundTripMiles` |
| > 20 mi | — | No estimate; "Outside standard service area — call to confirm." |

Examples: 3 mi → 6 rt mi × $1.50 = ~$9. 8 mi → 16 rt mi × $2.00 = ~$32.

Displayed to customer as:
> "Estimated pickup & delivery: ~$X (confirmed upon scheduling)"

---

## Service-Area City List (friendly confirmation only)

Distance (≤ 20 mi one-way) is the **only** gate. The city list is used purely to
show a reassuring "✓ [City] is in my service area!" message. A city NOT in the list
but within 20 mi still gets an estimate.

Cities: Coon Rapids, Blaine, Andover, Anoka, Ham Lake, Fridley, Spring Lake Park,
Ramsey, Champlin, Brooklyn Park, Lino Lakes, East Bethel, Maple Grove, Elk River.

---

## Frontend Flow (`site/index.html`)

1. Customer checks **Pickup Required? → Yes** → delivery location section appears.
2. Prompt: "Enable location for an instant delivery estimate?" → triggers the
   browser's native geolocation permission request.
3. **Allowed:** coordinates sent to `POST /api/estimate`; estimate displayed live.
4. **Denied / failed / unavailable:** a manual address field auto-reveals; the
   customer types an address, and the estimate is fetched on blur or submit.
5. Estimate line shows the fee (or the "call to confirm" message when > 20 mi),
   plus the "✓ [City] is in my service area!" note when applicable.
6. If no location is provided at all, the lead still submits (Option A) with no estimate.

All estimate UI is progressive enhancement: if JS or the API fails, the form still submits.

---

## Backend

### New endpoint: `POST /api/estimate` (public)

- Accepts `{ lat, lng }` OR `{ address }`.
- If `address`, geocode via OpenRouteService to coordinates.
- Compute driving distance (one-way) from the fixed origin via ORS Directions/Matrix.
- Reverse-geocode coordinates → street address + city (for coords-based requests).
- Apply the fee table above.
- Match city against the service-area list (case-insensitive) → `inServiceArea` flag.
- Build a public map link (OpenStreetMap or Google Maps) to the pickup pin.
- Response:
  ```json
  {
    "estimate": 32.00,            // null if > 20 mi
    "roundTripMiles": 16.0,
    "oneWayMiles": 8.0,
    "city": "Blaine",
    "inServiceArea": true,
    "outOfRange": false,          // true if > 20 mi
    "mapLink": "https://...",
    "deliveryAddress": "123 Main St, Blaine, MN 55434"
  }
  ```
- Reuses the existing in-memory rate limiter (same as lead capture).
- On any ORS error/timeout: return a soft failure the frontend can ignore.

### Lead capture changes: `POST /`

- Accept new optional fields: `delivery_address`, `delivery_lat`, `delivery_lng`,
  `estimate`, `distance_miles`.
- Matt's lead notification email gains a delivery block:
  - Delivery address
  - Map pin link
  - One-way distance
  - Estimated fee
  - Service-area status
- All user-supplied values escaped with the existing `escapeHtml()` helper.
- These fields are advisory; their absence changes nothing about lead acceptance.

---

## Config & Secrets

- `ORS_API_KEY` — OpenRouteService API key.
  - Added to Cloudflare Worker secrets.
  - Added to the `Set Worker Secrets` step in `.github/workflows/deploy.yml`.
  - Added to `.env.example`.
- Origin coordinates hardcoded as a server-side constant in `backend/index.js`.

---

## Error Handling

- ORS failure, timeout, or missing key → estimate silently omitted; the form and
  lead submission continue to work normally. **A lead is never blocked.**
- Frontend geolocation denial → manual address fallback.
- Manual address geocode failure → no estimate shown; lead still submits.

---

## Out of Scope (future work)

- **Pushing customer data downstream** (CRM, Google Sheets, QuickBooks, a D1
  customers table, improved Stripe/Square sync). This is a separate project with
  its own spec. The fields produced here (address, coords, distance, fee) will be
  available for a future downstream integration to consume.

---

## Testing

- Fee tiers: verify boundaries at 5 mi and 20 mi (just under/over each).
- Round-trip math for representative distances.
- City matching: in-list, not-in-list, case/whitespace variations.
- ORS failure path: form still submits, no estimate shown.
- Geolocation denied path: manual address fallback appears and works.
- No location at all: lead submits (Option A).
- Email escaping of delivery fields.
