import Stripe from 'stripe';

// Allowed CORS Origins
const ALLOWED_ORIGINS = [
  'https://inventory.petersonsmallenginerepair.com',
  'https://petersonsmallenginerepair.com',
  'http://localhost:5173',
  'http://localhost:8788'
];

// Helper to get CORS headers dynamically based on the Origin header
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://inventory.petersonsmallenginerepair.com';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cf-Access-Jwt-Assertion',
    'Access-Control-Max-Age': '86400',
  };
}

// JSON CORS response helper
function corsResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

// Escape user-provided values before embedding in HTML emails
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCustomerDeliveryBlock(pickup_required, delivery_address) {
  if (pickup_required !== 'Yes') return '';
  const addr = (delivery_address || '').trim();
  const inner = addr
    ? `<p style="margin: 0 0 6px;"><strong>Pickup/Delivery Address on file:</strong> ${escapeHtml(addr)}</p>
       <p style="margin: 0; font-size: 0.9rem; color: #666;">Please make sure this address is correct. If it isn't, just let me know when I contact you to schedule.</p>`
    : `<p style="margin: 0;"><strong>Pickup/Delivery requested.</strong> I'll confirm your address with you when I reach out to schedule.</p>`;
  return `<div style="margin: 20px 0; padding: 12px; background: #f6f9f7; border-radius: 8px;">${inner}</div>`;
}

// --- Delivery estimate constants & pure helpers ---
// Origin: 10450 Foley Blvd, Coon Rapids, MN 55448 (server-side only, never exposed)
export const ORIGIN_COORDS = { lat: 45.159887, lng: -93.275209 };

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
  if (!Number.isFinite(oneWayMiles) || oneWayMiles < 0) {
    return { estimate: null, roundTripMiles: 0, outOfRange: true };
  }
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

const METERS_PER_MILE = 1609.344;

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

// Base64Url decode helper for JWT parsing
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// Global cache for Cloudflare Access certificates
let cachedJwks = null;
let cachedJwksExpiry = 0;

async function getJwks(authDomain) {
  const now = Date.now();
  if (cachedJwks && now < cachedJwksExpiry) {
    return cachedJwks;
  }
  const res = await fetch(`https://${authDomain}/cdn-cgi/access/certs`);
  if (!res.ok) {
    throw new Error('Failed to fetch Cloudflare Access certificates');
  }
  const jwks = await res.json();
  cachedJwks = jwks;
  cachedJwksExpiry = now + 3600000; // Cache keys for 1 hour
  return jwks;
}

// Verify JWT from Cloudflare Access
async function verifyAccessJwt(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return false;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(base64UrlDecode(headerB64));
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    const authDomain = "petersonenginerepair.cloudflareaccess.com";
    
    // Verify issuer, audience, user, and expiration claims
    if (payload.iss !== `https://${authDomain}`) return false;
    if (payload.aud !== env.CLOUDFLARE_ACCESS_AUD) return false;
    if (payload.email !== "mattssmallenginerep@gmail.com") return false;
    if (payload.exp < Date.now() / 1000) return false;

    // Fetch and cache certificates
    const jwks = await getJwks(authDomain);
    const jwk = jwks.keys.find(k => k.kid === header.kid);
    if (!jwk) return false;

    // Import Public Key using WebCrypto
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify cryptographic signature
    const enc = new TextEncoder();
    const data = enc.encode(`${headerB64}.${payloadB64}`);
    
    const sigStr = atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/'));
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) {
      sigBytes[i] = sigStr.charCodeAt(i);
    }

    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      sigBytes,
      data
    );
  } catch (e) {
    console.error("JWT Verification Error:", e.message);
    return false;
  }
}

const rateLimitMap = new Map();
let lastCleanup = Date.now();

function checkRateLimit(ip, maxRequests = 5, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Periodically evict fully expired IP entries (every 10 minutes)
  if (now - lastCleanup > 600000) {
    lastCleanup = now;
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const valid = timestamps.filter(t => t > windowStart);
      if (valid.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, valid);
      }
    }
  }

  const recent = rateLimitMap.get(ip) || [];
  const valid = recent.filter(t => t > windowStart);
  if (valid.length >= maxRequests) return false;
  valid.push(now);
  rateLimitMap.set(ip, valid);
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const corsHeaders = getCorsHeaders(request);

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper to enforce Cloudflare Access authentication
    const requireAuth = async () => {
      // Only bypass in explicit local dev — never fail open in production.
      if (env.ENVIRONMENT === 'dev') {
        console.warn("Bypassing Access check: ENVIRONMENT=dev (Local Dev)");
        return true;
      }
      if (!env.CLOUDFLARE_ACCESS_AUD) {
        throw new Error('Unauthorized: Access is not configured');
      }
      const isValid = await verifyAccessJwt(request, env);
      if (!isValid) {
        throw new Error('Unauthorized: Valid Cloudflare Access JWT required');
      }
    };

    // --- ROUTE: POST /api/webhooks/stripe (Auto-Inventory Deduction) ---
    if (url.pathname === '/api/webhooks/stripe' && request.method === 'POST') {
      try {
        const signature = request.headers.get('stripe-signature');
        if (!signature) {
          return corsResponse({ error: 'Missing stripe-signature header' }, 400, corsHeaders);
        }

        const bodyText = await request.text();
        let event;

        if (!env.STRIPE_WEBHOOK_SECRET) {
          console.error('STRIPE_WEBHOOK_SECRET is not configured — cannot verify webhook');
          return corsResponse({ error: 'Webhook secret not configured' }, 500, corsHeaders);
        }

        // Workers only have async Web Crypto — the sync constructEvent throws here.
        event = await stripe.webhooks.constructEventAsync(bodyText, signature, env.STRIPE_WEBHOOK_SECRET);

        // Check if event.id has already been processed
        const eventCheck = await env.DB.prepare("SELECT 1 FROM processed_stripe_events WHERE id = ?").bind(event.id).first();
        if (eventCheck) {
          console.log(`Event ${event.id} already processed. Skipping.`);
          return corsResponse({ received: true }, 200, corsHeaders);
        }

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          
          // If this session created an invoice, we skip it here and let invoice.paid handle it.
          if (session.invoice) {
            console.log(`Checkout session ${session.id} has invoice ${session.invoice}. Skipping to let invoice.paid handle it.`);
            await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(event.id).run();
            return corsResponse({ received: true }, 200, corsHeaders);
          }

          // Check if session.id has already been processed
          const sessionCheck = await env.DB.prepare("SELECT 1 FROM processed_stripe_events WHERE id = ?").bind(session.id).first();
          if (sessionCheck) {
            console.log(`Checkout session ${session.id} already processed. Skipping.`);
            await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(event.id).run();
            return corsResponse({ received: true }, 200, corsHeaders);
          }

          const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
          for (const item of lineItems.data) {
            if (item.price && item.price.product) {
              await env.DB.prepare(`
                UPDATE parts
                SET quantity = MAX(0, quantity - ?)
                WHERE stripe_product_id = ?
              `).bind(item.quantity, item.price.product).run();
            }
          }

          // Record session.id and event.id as processed
          await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(session.id).run();
          await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(event.id).run();
        }

        if (event.type === 'invoice.paid') {
          const invoice = event.data.object;

          // Check if invoice.id has already been processed
          const invoiceCheck = await env.DB.prepare("SELECT 1 FROM processed_stripe_events WHERE id = ?").bind(invoice.id).first();
          if (invoiceCheck) {
            console.log(`Invoice ${invoice.id} already processed. Skipping.`);
            await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(event.id).run();
            return corsResponse({ received: true }, 200, corsHeaders);
          }

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

          // Record invoice.id and event.id as processed
          await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(invoice.id).run();
          await env.DB.prepare("INSERT INTO processed_stripe_events (id) VALUES (?)").bind(event.id).run();
        }
        
        return corsResponse({ received: true }, 200, corsHeaders);
      } catch (e) {
        console.error('Webhook Error:', e.message);
        return corsResponse({ error: 'Webhook processing failed' }, 400, corsHeaders);
      }
    }

    // --- ROUTE: GET /api/admin/status (System Pulse) ---
    if (url.pathname === '/api/admin/status' && request.method === 'GET') {
      try {
        await requireAuth();
        const { results: parts } = await env.DB.prepare("SELECT * FROM parts").all();
        const lowStock = parts.filter(p => p.quantity <= p.reorder_point).length;
        const totalValue = parts.reduce((sum, p) => sum + (p.price * p.quantity), 0);

        return corsResponse({
          status: "OPERATIONAL",
          infrastructure: {
            database: "CONNECTED",
            storage: "READY",
            stripe: env.STRIPE_SECRET_KEY ? "CONFIGURED" : "MISSING",
            square: env.SQUARE_ACCESS_TOKEN ? "CONFIGURED" : "MISSING",
            resend: env.RESEND_API_KEY ? "CONFIGURED" : "MISSING"
          },
          inventory: {
            total_items: parts.length,
            low_stock_count: lowStock,
            estimated_value: totalValue.toFixed(2)
          }
        }, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Internal Server Error' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

    // --- ROUTE: GET /api/lookup?upc=... (Auto-Identify) ---
    if (url.pathname === '/api/lookup' && request.method === 'GET') {
      try {
        await requireAuth();
        const upc = url.searchParams.get('upc');
        if (!upc) return corsResponse({ error: 'UPC Required' }, 400, corsHeaders);
        
        let data;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
          if (res.status === 429) {
            if (attempt < 3) {
              await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
              continue;
            }
            return corsResponse({ error: 'UPC lookup rate limited' }, 429, corsHeaders);
          }
          data = await res.json();
          break;
        }
        
        if (data && data.items && data.items.length > 0) {
          const item = data.items[0];
          return corsResponse({
            name: item.title,
            description: item.description,
            success: true
          }, 200, corsHeaders);
        }
        return corsResponse({ success: false }, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Lookup failed' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

    // --- ROUTE: GET /api/photos/:key (Serve Image - Public) ---
    if (url.pathname.startsWith('/api/photos/')) {
      const key = url.pathname.replace('/api/photos/', '');
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response('Photo Not Found', { status: 404, headers: corsHeaders });
      
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
      headers.set('etag', object.httpEtag);
      
      return new Response(object.body, { headers });
    }

    // --- ROUTE: POST /api/upload (Upload Photo) ---
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        await requireAuth();
        const contentType = request.headers.get('Content-Type') || '';
        if (!contentType.startsWith('image/')) {
          return corsResponse({ error: 'Only image uploads are allowed' }, 400, corsHeaders);
        }
        const contentLength = parseInt(request.headers.get('Content-Length') || '0');
        if (contentLength > 10 * 1024 * 1024) { // 10MB limit
          return corsResponse({ error: 'Image size cannot exceed 10MB' }, 400, corsHeaders);
        }

        let ext = '.jpg';
        if (contentType === 'image/png') ext = '.png';
        else if (contentType === 'image/gif') ext = '.gif';
        else if (contentType === 'image/webp') ext = '.webp';
        else if (contentType === 'image/heic') ext = '.heic';

        const key = `part_${Date.now()}${ext}`;
        await env.PHOTOS.put(key, request.body, {
          httpMetadata: { contentType }
        });
        return corsResponse({ success: true, url: `${url.origin}/api/photos/${key}` }, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Upload failed' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

    // --- ROUTE: GET /api/parts (Inventory List) ---
    if (url.pathname === '/api/parts' && request.method === 'GET') {
      try {
        await requireAuth();
        const { results } = await env.DB.prepare("SELECT * FROM parts ORDER BY name ASC").all();
        return corsResponse(results, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Failed to fetch parts' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

    // --- ROUTE: DELETE /api/parts/:id (Remove Part) ---
    if (url.pathname.startsWith('/api/parts/') && request.method === 'DELETE') {
      try {
        await requireAuth();
        const id = url.pathname.split('/').pop();
        await env.DB.prepare("DELETE FROM parts WHERE id = ?").bind(id).run();
        return corsResponse({ success: true }, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Delete failed' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

    // --- ROUTE: POST /api/parts/adjust-quantity (Adjust Quantity Only) ---
    if (url.pathname === '/api/parts/adjust-quantity' && request.method === 'POST') {
      try {
        await requireAuth();
        const { id, quantity } = await request.json();
        const numQuantity = parseInt(quantity);
        if (isNaN(numQuantity) || numQuantity < 0) {
          return corsResponse({ error: 'Quantity must be a non-negative integer' }, 400, corsHeaders);
        }
        await env.DB.prepare("UPDATE parts SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(numQuantity, id).run();
        return corsResponse({ success: true }, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Adjustment failed' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

    // --- ROUTE: POST /api/parts (Add/Update & Sync) ---
    if (url.pathname === '/api/parts' && request.method === 'POST') {
      try {
        await requireAuth();
        const part = await request.json();
        const { name, sku, upc, description, quantity, reorder_point, price, image_url } = part;

        // Server-side parameter validations
        if (!name || typeof name !== 'string' || name.trim() === '') {
          return corsResponse({ error: 'Part Name is required' }, 400, corsHeaders);
        }
        if (!sku || typeof sku !== 'string' || sku.trim() === '') {
          return corsResponse({ error: 'SKU is required' }, 400, corsHeaders);
        }
        const numPrice = parseFloat(price);
        if (isNaN(numPrice) || numPrice < 0) {
          return corsResponse({ error: 'Price must be a non-negative number' }, 400, corsHeaders);
        }
        const numQuantity = parseInt(quantity);
        if (isNaN(numQuantity) || numQuantity < 0) {
          return corsResponse({ error: 'Quantity must be a non-negative integer' }, 400, corsHeaders);
        }
        const numReorderPoint = parseInt(reorder_point);
        if (isNaN(numReorderPoint) || numReorderPoint < 0) {
          return corsResponse({ error: 'Reorder point must be a non-negative integer' }, 400, corsHeaders);
        }

        // 1. Sync to Stripe first (so we have the ID)
        let stripeProductId = part.stripe_product_id;
        if (!stripeProductId) {
          const product = await stripe.products.create({
            name: name,
            description: description || `SKU: ${sku}`,
            default_price_data: {
              currency: 'usd',
              unit_amount: Math.round(numPrice * 100),
            },
            images: image_url ? [image_url] : [],
            metadata: { sku, upc }
          });
          stripeProductId = product.id;
        } else {
          await stripe.products.update(stripeProductId, {
            name: name,
            description: description || `SKU: ${sku}`,
            images: image_url ? [image_url] : [],
            metadata: { sku, upc }
          });
          // Only create new price in Stripe if the price actually changed
          const existingPart = await env.DB.prepare("SELECT price FROM parts WHERE stripe_product_id = ?").bind(stripeProductId).first();
          const oldPrice = existingPart ? parseFloat(existingPart.price) : null;
          if (oldPrice === null || Math.round(oldPrice * 100) !== Math.round(numPrice * 100)) {
            const newPrice = await stripe.prices.create({
              product: stripeProductId,
              currency: 'usd',
              unit_amount: Math.round(numPrice * 100),
            });
            await stripe.products.update(stripeProductId, {
              default_price: newPrice.id,
            });
          }
        }

        // 2. Save to D1
        await env.DB.prepare(`
          INSERT INTO parts (name, sku, upc, description, quantity, reorder_point, price, stripe_product_id, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sku) DO UPDATE SET
            name=excluded.name,
            upc=excluded.upc,
            description=excluded.description,
            quantity=excluded.quantity,
            reorder_point=excluded.reorder_point,
            price=excluded.price,
            image_url=excluded.image_url,
            updated_at=CURRENT_TIMESTAMP
        `).bind(
          name.trim(), 
          sku.trim(), 
          (upc || '').trim(), 
          (description || '').trim(), 
          numQuantity, 
          numReorderPoint, 
          numPrice, 
          stripeProductId, 
          image_url || ''
        ).run();

        return corsResponse({ success: true, stripeProductId }, 200, corsHeaders);
      } catch (e) {
        const isAuthError = e.message.includes('Unauthorized');
        return corsResponse({ error: isAuthError ? e.message : 'Save failed' }, isAuthError ? 401 : 500, corsHeaders);
      }
    }

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

    // --- ROUTE: POST / (Lead Capture - Public) ---
    if (url.pathname === '/' && request.method === 'POST') {
      try {
        const data = await request.json();
        const {
          name, email, phone, equipment, issue, pickup_required,
          delivery_address, delivery_lat, delivery_lng, estimate, distance_miles
        } = data;

        // Basic input validations
        if (!name || !email || !phone || !equipment || !issue) {
          return corsResponse({ error: 'All fields are required' }, 400, corsHeaders);
        }

        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIp)) {
          return corsResponse({ error: 'Too many requests. Please try again later.' }, 429, corsHeaders);
        }

        // 1. STRIPE CUSTOMER LOGIC
        const stripeCustomers = await stripe.customers.list({ email: email, limit: 1 });
        let stripeCustomer;
        if (stripeCustomers.data.length > 0) {
          stripeCustomer = stripeCustomers.data[0];
          await stripe.customers.update(stripeCustomer.id, {
            metadata: { latest_issue: issue, latest_equipment: equipment }
          });
        } else {
          stripeCustomer = await stripe.customers.create({ name, email, phone, metadata: { latest_issue: issue, latest_equipment: equipment } });
        }

        // 2. SQUARE CUSTOMER LOGIC (Optional)
        let squareCustomerId = "pending";
        if (env.SQUARE_ACCESS_TOKEN) {
          try {
            const squareRes = await fetch('https://connect.squareup.com/v2/customers/search', {
              method: 'POST',
              headers: {
                'Square-Version': '2026-05-02',
                'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: { filter: { email_address: { exact: email } } }
              })
            });
            const squareData = await squareRes.json();
            
            if (squareData.customers && squareData.customers.length > 0) {
              squareCustomerId = squareData.customers[0].id;
            } else {
              const createSquare = await fetch('https://connect.squareup.com/v2/customers', {
                method: 'POST',
                headers: {
                  'Square-Version': '2026-05-02',
                  'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  given_name: name.split(' ')[0],
                  family_name: name.split(' ').slice(1).join(' '),
                  email_address: email,
                  phone_number: phone,
                  note: `Equipment: ${equipment} | Issue: ${issue}`
                })
              });
              const newSquare = await createSquare.json();
              if (newSquare.customer) {
                squareCustomerId = newSquare.customer.id;
              }
            }
          } catch (e) {
            console.error('Square Sync Error (Skipping):', e.message);
          }
        }

        // 3. NOTIFY MATT (Optional)
        if (env.RESEND_API_KEY) {
          try {
            const scheduleLink = squareCustomerId !== "pending" 
              ? `<a href="https://squareup.com/dashboard/appointments/calendar/book?customer_id=${squareCustomerId}" style="background: #006aff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.9rem;">Schedule (Square)</a>`
              : `<span style="color: #666; font-size: 0.8rem;">(Square Sync Disabled)</span>`;

            const latNum = Number(delivery_lat);
            const lngNum = Number(delivery_lng);
            const hasValidCoords = Number.isFinite(latNum) && Number.isFinite(lngNum);
            const mapLink = hasValidCoords
              ? `https://www.openstreetmap.org/?mlat=${latNum}&mlon=${lngNum}#map=16/${latNum}/${lngNum}`
              : '';
            const deliveryBlock = (pickup_required === 'Yes')
              ? `<div style="margin-top: 15px; padding: 12px; background: #f6f9f7; border-radius: 8px;">
                   <p style="margin: 0 0 6px;"><strong>🚚 Delivery Requested</strong></p>
                   <p style="margin: 4px 0;"><strong>Address:</strong> ${escapeHtml(delivery_address || 'Not provided')}</p>
                   <p style="margin: 4px 0;"><strong>Distance (one-way):</strong> ${escapeHtml(distance_miles != null && distance_miles !== '' ? distance_miles + ' mi' : 'N/A')}</p>
                   <p style="margin: 4px 0;"><strong>Estimated Fee:</strong> ${escapeHtml(estimate != null && estimate !== '' ? '$' + estimate : 'Call to confirm')}</p>
                   ${mapLink ? `<p style="margin: 4px 0;"><a href="${mapLink}">📍 View pickup location</a></p>` : ''}
                 </div>`
              : '';

            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Peterson Leads <leads@petersonsmallenginerepair.com>',
                to: 'matt@petersonsmallenginerepair.com',
                subject: `🔧 New Lead: ${name} (${equipment})`,
                html: `
                  <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #0b1a14;">New Service Request</h2>
                    <p><strong>Customer:</strong> ${escapeHtml(name)}</p>
                    <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
                    <p><strong>Equipment:</strong> ${escapeHtml(equipment)}</p>
                    <p><strong>Pickup Required?</strong> ${escapeHtml(pickup_required || 'No')}</p>
                    <p><strong>Issue:</strong> ${escapeHtml(issue)}</p>
                    ${deliveryBlock}
                    
                    <div style="margin-top: 30px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
                      <a href="https://dashboard.stripe.com/quotes/create?customer=${stripeCustomer.id}" 
                         style="background: #d92d20; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.9rem;">
                         + Create Quote (Stripe)
                      </a>
                      <a href="https://dashboard.stripe.com/customers/${stripeCustomer.id}" 
                         style="background: #333; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.8rem;">
                         Stripe Profile
                      </a>
                      ${scheduleLink}
                    </div>
                  </div>
                `
              }),
            });
          } catch (e) {
            console.error('Notification Error (Skipping):', e.message);
          }

          // 4. AUTO-RESPONSE TO CUSTOMER (Optional)
          try {
            const customerDeliveryBlock = buildCustomerDeliveryBlock(pickup_required, delivery_address);
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Matt Peterson <matt@petersonsmallenginerepair.com>',
                to: email,
                subject: `🔧 Request Received: Repairing your ${equipment}`,
                html: `
                  <div style="font-family: sans-serif; max-width: 600px; padding: 30px; color: #333; line-height: 1.6;">
                    <h2 style="color: #0b1a14;">Hi ${escapeHtml(name)}, I've received your request!</h2>
                    <p>Thanks for reaching out. I'm currently reviewing the details of your <strong>${escapeHtml(equipment)}</strong> repair and I'll be in touch shortly via phone or email to discuss the next steps.</p>
                    ${customerDeliveryBlock}
                    
                    <h3 style="color: #d92d20; margin-top: 30px;">How It Works:</h3>
                    <ul style="padding-left: 20px;">
                      <li style="margin-bottom: 12px;"><strong>Assessment:</strong> I'll contact you to discuss the issue and schedule a pickup or drop-off.</li>
                      <li style="margin-bottom: 12px;"><strong>Secure Estimate:</strong> You will receive a professional <strong>Stripe Quote</strong> via email to approve before any work begins.</li>
                      <li style="margin-bottom: 12px;"><strong>Fast Repair:</strong> Most repairs are completed within 48 hours of assessment.</li>
                      <li style="margin-bottom: 12px;"><strong>Easy Payment:</strong> Once you're satisfied with the work, pay securely on-site via Tap-to-Pay or through a secure link on your phone.</li>
                    </ul>

                    <p style="margin-top: 40px; font-size: 0.9rem; color: #666;">
                      Looking forward to getting you back to work!<br>
                      <strong>Matt Peterson</strong><br>
                      Peterson Small Engine Repair
                    </p>
                  </div>
                `
              }),
            });
          } catch (e) {
            console.error('Auto-response Error (Skipping):', e.message);
          }
        }

        return corsResponse({ success: true, message: 'Request received!' }, 200, corsHeaders);

      } catch (err) {
        return corsResponse({ error: 'Failed to process lead request' }, 500, corsHeaders);
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      let report = [];
      let allPassed = true;

      // 1. Check Main Website
      try {
        const res = await fetch('https://petersonsmallenginerepair.com');
        if (res.ok) {
          report.push('✅ Main Website (petersonsmallenginerepair.com) is UP');
        } else {
          report.push(`❌ Main Website is DOWN (Status: ${res.status})`);
          allPassed = false;
        }
      } catch (e) {
        report.push(`❌ Main Website check failed: ${e.message}`);
        allPassed = false;
      }

      // 2. Check Inventory Dashboard
      try {
        const res = await fetch('https://inventory.petersonsmallenginerepair.com');
        if (res.ok) {
          report.push('✅ Inventory Dashboard (inventory.petersonsmallenginerepair.com) is UP');
        } else {
          report.push(`❌ Inventory Dashboard is DOWN (Status: ${res.status})`);
          allPassed = false;
        }
      } catch (e) {
        report.push(`❌ Inventory Dashboard check failed: ${e.message}`);
        allPassed = false;
      }

      // 3. Check Database
      try {
        const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM parts").all();
        if (results && results.length > 0) {
          report.push(`✅ Database is connected (Total Parts: ${results[0].count})`);
        } else {
          report.push(`❌ Database query returned no results`);
          allPassed = false;
        }
      } catch (e) {
        report.push(`❌ Database check failed: ${e.message}`);
        allPassed = false;
      }

      // 4. Verify Integrations
      if (env.STRIPE_SECRET_KEY) report.push('✅ Stripe Integration is Configured');
      else { report.push('❌ Stripe Integration is MISSING'); allPassed = false; }

      if (env.SQUARE_ACCESS_TOKEN) report.push('✅ Square Integration is Configured');
      else { report.push('⚠️ Square Integration is MISSING (Optional)'); }

      if (env.RESEND_API_KEY) report.push('✅ Resend Integration is Configured');
      else { report.push('❌ Resend Integration is MISSING'); allPassed = false; }

      // 5. Send Report via Resend
      if (env.RESEND_API_KEY) {
        const statusColor = allPassed ? '#0b1a14' : '#d92d20';
        const statusText = allPassed ? 'All Systems Operational' : 'Action Required: System Issues Detected';

        const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: ${statusColor};">Peterson Small Engine Repair</h2>
            <h3>Daily Health Report</h3>
            <p><strong>Status:</strong> ${statusText}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <ul style="list-style-type: none; padding: 0; line-height: 1.8;">
              ${report.map(item => `<li>${item}</li>`).join('')}
            </ul>
            <p style="margin-top: 30px; font-size: 0.8rem; color: #666;">Automated check performed at ${new Date().toUTCString()}</p>
          </div>
        `;

        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Health Monitor <leads@petersonsmallenginerepair.com>',
              to: 'mattssmallenginerep@gmail.com',
              subject: `Health Report: ${allPassed ? 'OK' : 'ALERT'}`,
              html: emailHtml
            }),
          });
        } catch (e) {
          console.error('Failed to send health report email:', e.message);
        }
      }
    })());
  }
};
