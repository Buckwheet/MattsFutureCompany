# Senior Code Review — Fix Plan

**Project:** Peterson Small Engine Repair (`MattsFutureCompany`)
**Review Date:** 2026-06-25
**Audience:** Implementation agent — follow each section to apply fixes in order.

---

## 🔴 CRITICAL (Fix First)

### 1. Rotate exposed credentials and move `.env` out of repo root

**Problem:** `.env` contains live Stripe `sk_live_*`, Cloudflare API token, Resend key, Square access token, and Stripe backup codes. The file exists in the project root which is also the Pages build output directory (`pages_build_output_dir = "./"`). Even though `.gitignore` excludes it, this is one accidental commit or CI misconfiguration from disaster.

**Steps:**

1. **Immediately rotate every credential in the file:**
   - Stripe: regenerate `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in Stripe Dashboard. Invalidate the Stripe backup code.
   - Cloudflare: regenerate `CLOUDFLARE_API_KEY` and `CLOUDFLARE_API_TOKEN` in Cloudflare Dashboard.
   - Resend: regenerate `RESEND_API_KEY` in Resend Dashboard.
   - Square: regenerate `SQUARE_ACCESS_TOKEN` in Square Developer Dashboard.
   - Update `CLOUDFLARE_ACCESS_AUD` if the old one was tied to a policy using the old token.

2. **Update `.gitignore`** — already has `.env` listed, confirm it's still there. Add `!.env.example` so an example file can be committed.

3. **Create a `.env.example` file** in the project root with placeholder values:
   ```
   CLOUDFLARE_EMAIL=
   CLOUDFLARE_API_TOKEN=
   CLOUDFLARE_ACCOUNT_ID=
   DOMAIN=petersonsmallenginerepair.com
   COMPANY_NAME=Peterson Small Engine Repair
   STRIPE_SECRET_KEY=
   STRIPE_PUBLISHABLE_KEY=
   RESEND_API_KEY=
   SQUARE_ACCESS_TOKEN=
   SQUARE_LOCATION_ID=
   CLOUDFLARE_ACCESS_AUD=
   ```

4. **Move the real `.env` out of the repo root** to a parent directory (e.g. `%USERPROFILE%\.secrets\matts-future-company.env`), or use Windows Credential Manager / a password manager. Document the location in a private note.

5. **Verify git is not tracking `.env`:**
   ```
   git rm --cached .env   # if it was previously tracked
   ```

---

### 2. Fix `invoice.paid` webhook handler

**Problem:** `backend/index.js` lines 81-92 handles both `invoice.paid` and `checkout.session.completed` with the same logic. For `invoice.paid`, `event.data.object` is an **Invoice** object (not a Checkout Session), so `stripe.checkout.sessions.listLineItems(session.id)` fails — invoices don't have line items the same way checkout sessions do.

**Steps:**

1. Open `backend/index.js` and locate the webhook handler block (~line 70-92).

2. Replace the combined `if` with separate handlers:

   ```javascript
   if (event.type === 'checkout.session.completed') {
     const session = event.data.object;
     const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

     for (const item of lineItems.data) {
       await env.DB.prepare(`
         UPDATE parts
         SET quantity = MAX(0, quantity - ?)
         WHERE stripe_product_id = ?
       `).bind(item.quantity, item.price.product).run();
     }
   }

   if (event.type === 'invoice.paid') {
     const invoice = event.data.object;

     // Skip subscription invoices that don't have line items
     if (!invoice.lines || !invoice.lines.data) {
       console.log('invoice.paid: no line items, skipping inventory deduction');
     } else {
       for (const item of invoice.lines.data) {
         if (item.price && item.price.product) {
           await env.DB.prepare(`
             UPDATE parts
             SET quantity = MAX(0, quantity - ?)
             WHERE stripe_product_id = ?
           `).bind(item.quantity, item.price.product).run();
         }
       }
     }
   }
   ```

3. Verify: invoice objects have a `lines` property directly on them (unlike checkout sessions which need a separate API call).

---

### 3. Require Stripe webhook secret or reject events

**Problem:** Lines 77-80 fall back to parsing the raw body when `STRIPE_WEBHOOK_SECRET` is not set, accepting any POST as a valid Stripe event. Anyone can fake events and manipulate inventory.

**Steps:**

1. Open `backend/index.js` and find the webhook signature check (~line 74-80).

2. Replace the fallback with a hard error:

   ```javascript
   if (!env.STRIPE_WEBHOOK_SECRET) {
     console.error('STRIPE_WEBHOOK_SECRET is not configured — cannot verify webhook');
     return corsResponse({ error: 'Webhook secret not configured' }, 500, corsHeaders);
   }

   event = stripe.webhooks.constructEvent(bodyText, signature, env.STRIPE_WEBHOOK_SECRET);
   ```

3. Set the `STRIPE_WEBHOOK_SECRET` in Cloudflare Worker secrets:
   ```
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   Its value comes from Stripe Dashboard → Webhooks → your endpoint → "Signing secret".

4. Also add it to the GitHub Actions deploy workflow's secrets section (`.github/workflows/deploy.yml`) so it's set on each deployment.

---

## 🟡 MEDIUM Priority

### 4. Wrap scheduled handler operations in `ctx.waitUntil()`

**Problem:** The `scheduled` function (~line 530) performs 4 HTTP checks, a DB query, and an email send. Cloudflare Workers may terminate execution after the handler's `async function` returns — none of these operations are wrapped in `ctx.waitUntil()`, so the email (last operation) may silently never get sent.

**Steps:**

1. Open `backend/index.js` and find the `scheduled` function.

2. Wrap the entire health check and email-sending logic in `ctx.waitUntil()`:

   ```javascript
   async scheduled(controller, env, ctx) {
     ctx.waitUntil((async () => {
       let report = [];
       let allPassed = true;
       // ... all existing logic stays the same, just indented inside this block ...
     })());
   }
   ```

3. The wrapping pattern ensures the Worker runtime won't terminate until all promises inside `waitUntil` resolve.

---

### 5. Add rate limiting to public lead capture endpoint

**Problem:** `POST /` (the lead capture form) is public, creates Stripe customers, queries Square, and sends 2 emails per request. No rate limiting means anyone can spam it, costing Stripe API fees and flooding Matt's inbox.

**Steps:**

1. Open `backend/index.js` and add a simple in-memory rate limiter before the lead capture handler (~line 370):

   ```javascript
   // --- Rate limiter (in-memory, per-worker) ---
   const rateLimitMap = new Map();

   function checkRateLimit(ip, maxRequests = 5, windowMs = 60000) {
     const now = Date.now();
     const windowStart = now - windowMs;
     const recent = rateLimitMap.get(ip) || [];
     const valid = recent.filter(t => t > windowStart);
     if (valid.length >= maxRequests) return false;
     valid.push(now);
     rateLimitMap.set(ip, valid);
     return true;
   }
   ```

2. At the top of the lead capture handler (after parsing the body, before Stripe customer creation):

   ```javascript
   const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
   if (!checkRateLimit(clientIp)) {
     return corsResponse({ error: 'Too many requests. Please try again later.' }, 429, corsHeaders);
   }
   ```

3. Note: This is per-worker-instance in-memory. For a global rate limit, use Cloudflare's WAF rate limiting rule instead. But this catches the common case.

---

### 6. Detect actual image content type in photo upload

**Problem:** Frontend hardcodes `Content-Type: image/jpeg` (`App.jsx` line 103) and backend stores as `image/jpeg`. If the user's device captures a PNG or HEIC photo, the stored content type is wrong, causing browser rendering issues.

**Steps:**

1. Open `parts-manager/src/App.jsx` and find the `handlePhotoCapture` function (~line 96-112).

2. Replace the hardcoded header with dynamic detection:

   ```javascript
   const contentType = file.type || 'image/jpeg';

   const res = await fetch(`${API_BASE}/api/upload`, {
     method: 'POST',
     headers: {
       'Content-Type': contentType,
       'Cf-Access-Jwt-Assertion': sessionStorage.getItem('cf_access_jwt') || ''
     },
     body: file
   });
   ```

3. Open `backend/index.js` and find the upload handler (~line 230-240).

4. Extract the content type from the request instead of hardcoding:

   ```javascript
   const contentType = request.headers.get('Content-Type') || 'image/jpeg';
   const ext = contentType === 'image/png' ? '.png' : '.jpg';
   const key = `part_${Date.now()}${ext}`;

   await env.PHOTOS.put(key, request.body, {
     httpMetadata: { contentType }
   });
   ```

---

### 7. Restrict Pages deployment output directory

**Problem:** `wrangler.toml` sets `pages_build_output_dir = "./"`, deploying the entire repo root — including `*.md`, `*.json`, `site.zip`, `deploy.log`, `scratch/`, and `playbook.html` — to production.

**Steps:**

1. Create a `site/` directory at the project root.

2. Move these files into `site/`:
   - `index.html`
   - `style.css`
   - `_headers`
   - `robots.txt`
   - `images/` (the whole directory)

3. Update `wrangler.toml`:
   ```toml
   pages_build_output_dir = "./site"
   ```

4. Verify the site still works: the paths are relative to the HTML file, so no asset paths change.

5. Clear the old deployment (or deploy to a preview branch first to test).

---

### 8. Add pickup checkbox to the frontend contact form

**Problem:** Backend expects `pickup_required` in the POST body (line 375), but the frontend `index.html` doesn't include a pickup checkbox field. The feature is only half-implemented.

**Steps:**

1. Open `index.html` and locate the contact form section (~line 370, the `<section id="contact">` area).

2. Inside the form, after the issue/description textarea, add:

   ```html
   <div class="form-group">
     <label>Pickup Required?</label>
     <div class="pickup-toggle">
       <label class="radio-label">
         <input type="radio" name="pickup_required" value="yes" onchange="document.getElementById('pickup_no').checked = false">
         Yes — I need pickup
       </label>
       <label class="radio-label">
         <input type="radio" name="pickup_required" value="no" id="pickup_no" checked>
         No — I'll drop it off
       </label>
     </div>
   </div>
   ```

3. Update the form's submit handler JS to include `pickup_required` in the payload:

   ```javascript
   const pickupRadios = document.querySelectorAll('input[name="pickup_required"]');
   const pickupValue = Array.from(pickupRadios).find(r => r.checked)?.value || 'no';
   // Add to the fetch body:
   pickup_required: pickupValue === 'yes' ? 'Yes' : 'No',
   ```

4. Add CSS for the toggle in `style.css`:
   ```css
   .pickup-toggle {
     display: flex;
     gap: 20px;
     margin-top: 8px;
   }
   .radio-label {
     display: flex;
     align-items: center;
     gap: 8px;
     cursor: pointer;
   }
   ```

---

## 🟢 LOW Priority

### 9. Sync price changes to Stripe when editing a part

**Problem:** When editing a part's price with an existing `stripe_product_id`, the D1 record updates but Stripe's product price is never updated. Price changes only take effect for new parts.

**Steps:**

1. Open `backend/index.js` and find the POST `/api/parts` handler (~line 270-310).

2. When `stripeProductId` already exists, update the Stripe price:

   ```javascript
   if (part.stripe_product_id) {
     // Create a new price for the existing product
     const newPrice = await stripe.prices.create({
       product: part.stripe_product_id,
       currency: 'usd',
       unit_amount: Math.round(numPrice * 100),
     });
     // Optionally: mark the old price as inactive
     // This way checkout sessions will use the new price
   }
   ```

3. Note: Stripe doesn't allow editing an existing price. You create a new price and optionally deactivate the old one. The product's `default_price` can also be updated to point to the new price.

---

### 10. Add retry logic and fallback for UPC lookup

**Problem:** UPCItemDB trial API is rate-limited per-IP. Cloudflare Workers share a small IP pool. No retries, caching, or fallback means barcode scanning silently fails.

**Steps:**

1. Open `backend/index.js` and find the `/api/lookup` handler (~line 185-205).

2. Add retry logic with exponential backoff:

   ```javascript
   async function lookupUPC(upc, retries = 3) {
     for (let attempt = 1; attempt <= retries; attempt++) {
       try {
         const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`);
         if (res.status === 429) {
           // Rate limited — wait and retry
           if (attempt < retries) {
             await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
             continue;
           }
           return { success: false, error: 'Rate limited' };
         }
         return await res.json();
       } catch (e) {
         if (attempt === retries) throw e;
         await new Promise(r => setTimeout(r, 1000 * attempt));
       }
     }
   }
   ```

3. Optionally cache results in D1 (create a `upc_cache` table with `upc TEXT PRIMARY KEY, data TEXT, cached_at DATETIME`) to avoid repeated lookups for the same barcode.

---

### 11. Add `compatibility_date` to root `wrangler.toml`

**Problem:** The Pages deployment `wrangler.toml` has no `compatibility_date`, so the deployment uses whatever Wrangler's current default is — which can change when Wrangler updates.

**Steps:**

1. Open the root `wrangler.toml`.

2. Add:
   ```toml
   compatibility_date = "2026-06-25"
   ```

---

## Summary: Fix Order

| Order | Bug | Severity | File(s) |
|-------|-----|----------|---------|
| 1 | Rotate credentials + move `.env` | 🔴 | `.env`, `.env.example`, `.gitignore` |
| 2 | Fix `invoice.paid` webhook | 🔴 | `backend/index.js` |
| 3 | Require webhook secret | 🔴 | `backend/index.js`, `wrangler.toml` |
| 4 | `ctx.waitUntil()` in cron | 🟡 | `backend/index.js` |
| 5 | Rate limiting on leads | 🟡 | `backend/index.js` |
| 6 | Dynamic image content type | 🟡 | `backend/index.js`, `App.jsx` |
| 7 | Restrict Pages build output | 🟡 | `wrangler.toml`, file structure |
| 8 | Add pickup checkbox to form | 🟡 | `index.html`, `style.css` |
| 9 | Sync price changes to Stripe | 🟢 | `backend/index.js` |
| 10 | UPC lookup retry + fallback | 🟢 | `backend/index.js` |
| 11 | Add compatibility_date | 🟢 | `wrangler.toml` |
