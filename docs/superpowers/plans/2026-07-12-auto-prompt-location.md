# Auto-prompt Location on Delivery "Yes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Enable location" button, fix the delivery section showing by default, and auto-prompt for location when the customer selects delivery "Yes" (with manual-address fallback on denial).

**Architecture:** Frontend-only change to `site/index.html` (markup + inline JS) and `site/style.css` (one rule). No backend change.

**Tech Stack:** Vanilla HTML/CSS/JS, browser Geolocation API.

## Global Constraints

- "No" (default) → delivery section fully hidden, nothing rendered.
- Switch to "Yes" → auto-fire `navigator.geolocation.getCurrentPosition`; on granted show estimate; on denied/unavailable reveal the manual address field.
- Switch back to "No" → hide section and clear `delivery_lat`, `delivery_lng`, `estimate`, `distance_miles`, the manual address input, and the estimate line; re-hide the manual field.
- Remove the `#enable-location-btn` button entirely.
- CSS fix: `.service-form .form-group { display:flex }` (specificity 0,2,0) overrides `[hidden]`; add `.delivery-section[hidden] { display: none !important; }` to guarantee hiding.
- Progressive enhancement preserved: missing/failed location never blocks lead submission.
- No backend change; no change to geocode metro constraint, fee tiers, or estimate endpoint.

---

### Task 1: Remove button, fix hidden CSS, auto-prompt on Yes

**Files:**
- Modify: `site/index.html` (delete button ~lines 461-463; rewrite JS ~lines 625-708)
- Modify: `site/style.css` (add rule near `.delivery-section` ~line 562)

**Interfaces:**
- Consumes: `POST /api/estimate` (unchanged), existing DOM ids (`pickup-yes`, `pickup-no`, `delivery-section`, `delivery-manual`, `delivery_address`, `delivery-estimate`, `delivery_lat`, `delivery_lng`, `estimate`, `distance_miles`).
- Produces: no new interfaces.

- [ ] **Step 1: Remove the enable-location button**

In `site/index.html`, delete these three lines (the button inside `#delivery-section`, ~461-463):

```html
            <button type="button" class="btn secondary" id="enable-location-btn">
              📍 Enable location for an instant delivery estimate
            </button>
```

Leave the rest of `#delivery-section` (manual field, estimate div, hidden inputs) intact.

- [ ] **Step 2: Add the CSS hide rule**

In `site/style.css`, immediately after the line `.delivery-section { margin-top: 12px; }` (~line 562), add:

```css
.delivery-section[hidden] { display: none !important; }
```

- [ ] **Step 3: Rewrite the pickup + delivery JS**

In `site/index.html`, replace the entire block from the comment
`// === Pickup Checkbox Exclusivity + Delivery Section ===` through the end of
the `if (enableLocationBtn) { ... }` block (current lines ~625-708) with:

```javascript
  // === Pickup Checkbox Exclusivity + Delivery Section ===
  const pickupYes = document.getElementById('pickup-yes');
  const pickupNo = document.getElementById('pickup-no');
  const deliverySection = document.getElementById('delivery-section');

  function updateDeliveryVisibility() {
    if (deliverySection) deliverySection.hidden = !(pickupYes && pickupYes.checked);
  }

  // === Delivery Estimate Flow ===
  const API_ESTIMATE = 'https://peterson-backend.mattssmallenginerep.workers.dev/api/estimate';
  const deliveryManual = document.getElementById('delivery-manual');
  const deliveryAddressInput = document.getElementById('delivery_address');
  const deliveryEstimateEl = document.getElementById('delivery-estimate');
  const latInput = document.getElementById('delivery_lat');
  const lngInput = document.getElementById('delivery_lng');
  const estimateInput = document.getElementById('estimate');
  const distanceInput = document.getElementById('distance_miles');

  function escapeText(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function renderEstimate(r) {
    if (!r || r.error) { deliveryEstimateEl.textContent = ''; return; }
    distanceInput.value = r.oneWayMiles != null ? r.oneWayMiles : '';
    if (r.deliveryAddress && !deliveryAddressInput.value) deliveryAddressInput.value = r.deliveryAddress;
    deliveryEstimateEl.classList.toggle('in-area', !!r.inServiceArea);
    if (r.outOfRange) {
      estimateInput.value = '';
      deliveryEstimateEl.innerHTML = 'Outside standard service area — <span class="muted">call to confirm.</span>';
    } else if (r.estimate != null) {
      estimateInput.value = r.estimate;
      const area = r.inServiceArea && r.city ? ` <span class="muted">✓ ${escapeText(r.city)} is in my service area!</span>` : '';
      deliveryEstimateEl.innerHTML =
        `Estimated pickup &amp; delivery: ~$${r.estimate.toFixed(2)} <span class="muted">(confirmed upon scheduling)</span>${area}`;
    } else {
      estimateInput.value = '';
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

  function promptForLocation() {
    if (!navigator.geolocation) {
      if (deliveryManual) deliveryManual.hidden = false;
      return;
    }
    deliveryEstimateEl.textContent = 'Requesting location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        latInput.value = pos.coords.latitude;
        lngInput.value = pos.coords.longitude;
        fetchEstimate({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        if (deliveryManual) deliveryManual.hidden = false;
        deliveryEstimateEl.textContent = '';
      }
    );
  }

  function clearDeliveryFields() {
    latInput.value = '';
    lngInput.value = '';
    estimateInput.value = '';
    distanceInput.value = '';
    if (deliveryAddressInput) deliveryAddressInput.value = '';
    if (deliveryManual) deliveryManual.hidden = true;
    deliveryEstimateEl.textContent = '';
    deliveryEstimateEl.classList.remove('in-area');
  }

  if (pickupYes && pickupNo) {
    pickupYes.addEventListener('change', () => {
      if (pickupYes.checked) { pickupNo.checked = false; } else { pickupNo.checked = true; }
      updateDeliveryVisibility();
      if (pickupYes.checked) promptForLocation();
    });
    pickupNo.addEventListener('change', () => {
      if (pickupNo.checked) { pickupYes.checked = false; } else { pickupYes.checked = true; }
      updateDeliveryVisibility();
      if (pickupNo.checked) clearDeliveryFields();
    });
    updateDeliveryVisibility();
  }

  if (deliveryAddressInput) {
    deliveryAddressInput.addEventListener('blur', () => {
      const addr = deliveryAddressInput.value.trim();
      if (addr.length > 4) { latInput.value = ''; lngInput.value = ''; fetchEstimate({ address: addr }); }
    });
  }
```

> This preserves `escapeText`, `renderEstimate`, `fetchEstimate`, and the manual-address `blur` handler verbatim; removes the `enableLocationBtn` lookup and click handler; adds `promptForLocation()` and `clearDeliveryFields()`; and merges the two script sections so all declarations exist before the handlers use them. Do NOT duplicate the `API_ESTIMATE`/`deliveryManual`/etc. `const` declarations elsewhere — the old second block that declared them is part of what you are replacing.

- [ ] **Step 4: Verify JS validity**

Extract the inline `<script>` contents to a temp file and run `node --check` on it.
Run (from repo root, PowerShell):
```
$html = Get-Content site\index.html -Raw; $m = [regex]::Match($html, '(?s)<script>(.*)</script>'); Set-Content -Path "$env:TEMP\site-check.js" -Value $m.Groups[1].Value; node --check "$env:TEMP\site-check.js"
```
Expected: no output (valid). If multiple `<script>` tags exist, target the last/main one.

- [ ] **Step 5: Confirm the button is gone and no stray references remain**

Run (repo root):
```
Select-String -Path site\index.html -Pattern "enable-location-btn|enableLocationBtn"
```
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/style.css
git commit -m "fix: auto-prompt location on delivery Yes, remove button, fix hidden section (#3)"
```

- [ ] **Step 7: Post-deploy live verification (informational, after merge)**

After merge/deploy, on the live site: default (No) shows no delivery section; switching to Yes fires the browser location prompt; denying reveals the manual address field; switching back to No clears everything; submitting with no location still works.

---

## Notes for the implementer

- Shell is Windows PowerShell 5.1: chain with `;` and `if ($?) { ... }`, never `&&`. No `cd` inside commands.
- There is no frontend test harness; `node --check` on the extracted script plus the grep are the automated checks. The behavioral verification is manual/live (Step 7).
- Do not touch the backend, the estimate endpoint, or the geocode logic.
