# Design: Auto-prompt Location on Delivery "Yes"

**Date:** 2026-07-12
**Project:** Peterson Small Engine Repair
**Issue:** #3
**Status:** Approved (brainstorming complete)

---

## Problem

Two issues with the delivery-estimate UX:

1. A white "📍 Enable location for an instant delivery estimate" button is
   visible and requires a manual click. The site should instead prompt for
   location automatically when the customer opts into delivery.
2. **Bug:** the delivery section is visible by default even though "No" is the
   default pickup choice and the JS sets `hidden = true`. A CSS rule on
   `.form-group` / `.delivery-section` sets `display`, which overrides the
   `[hidden]` attribute's implicit `display:none`, so the section shows anyway.

## Goal

- "No" selected (default): delivery section fully hidden. No button, nothing.
- Switching to "Yes": automatically prompt for location permission; if the
  customer denies/blocks it, reveal a manual address field so they can still
  get a quote.
- Remove the enable-location button entirely.

## Changes

### Markup (`site/index.html`)
- Delete the `#enable-location-btn` button element (lines ~461-463).
- Keep `#delivery-section`, `#delivery-manual` (manual address field),
  `#delivery-estimate` (estimate line), and the hidden inputs unchanged.

### CSS (`site/style.css`)
- The culprit is `.service-form .form-group { display: flex; }` (line 358),
  specificity (0,2,0). The delivery section carries both `.form-group` and
  `.delivery-section`, so this rule overrides the `[hidden]` attribute's
  implicit `display:none`.
- Add `.delivery-section[hidden] { display: none !important; }` near the other
  `.delivery-section` rules (~line 562). `.delivery-section[hidden]` alone ties
  the culprit's specificity, so `!important` guarantees the win regardless of
  source order.

### Behavior (`site/index.html` inline JS)
- Remove the `enableLocationBtn` lookup and its click handler.
- Add a function `promptForLocation()` that:
  - If `navigator.geolocation` is unavailable → reveal the manual address field.
  - Else set the estimate line to "Requesting location…" and call
    `getCurrentPosition`:
    - success → store coords in hidden inputs, `fetchEstimate({ lat, lng })`.
    - error/denied → reveal the manual address field, clear the estimate line.
- In the pickup "Yes" `change` handler: after showing the section
  (`updateDeliveryVisibility()`), call `promptForLocation()`.
- In the pickup "No" `change` handler: hide the section and clear the hidden
  fields (`delivery_lat`, `delivery_lng`, `estimate`, `distance_miles`),
  the manual address input, and the estimate line; re-hide the manual field.
- Keep the existing manual-address `blur` → `fetchEstimate({ address })` handler.

## Behavior after change

| State | Result |
|---|---|
| No (default) | Section hidden, nothing rendered. |
| Switch to Yes, permission granted | Estimate shown from geolocation coords. |
| Switch to Yes, permission denied/unavailable | Manual address field revealed for a typed quote. |
| Switch back to No | Section hidden, all delivery fields cleared. |

## Constraints / non-goals

- Progressive enhancement preserved: a missing/failed location never blocks lead
  submission.
- No backend change. No change to the geocode metro constraint, fee tiers, or
  the estimate endpoint.
- Browser geolocation requires a user gesture; checking "Yes" is that gesture,
  so auto-triggering from the `change` event is permitted. Manual field is the
  fallback if a browser still blocks it.
- Out of scope: showing the resolved address for correction (#4) and the
  customer-email address note (#5) — separate issues.

## Testing

- No automated frontend test harness exists; verify by review + manual/live
  check: default No hides the section; switching to Yes fires the permission
  prompt; denying reveals the manual field; switching back to No clears state;
  lead still submits with no location.
