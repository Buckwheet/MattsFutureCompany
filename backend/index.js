import Stripe from 'stripe';

export default {
  async fetch(request, env) {
    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const url = new URL(request.url);
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);

    // --- ROUTE: GET /api/lookup?upc=... (Auto-Identify) ---
    if (url.pathname === '/api/lookup' && request.method === 'GET') {
      const upc = url.searchParams.get('upc');
      if (!upc) return new Response('UPC Required', { status: 400 });
      
      try {
        const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          return new Response(JSON.stringify({
            name: item.title,
            description: item.description,
            success: true
          }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        return new Response(JSON.stringify({ success: false }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // --- ROUTE: GET /api/photos/:key (Serve Image) ---
    if (url.pathname.startsWith('/api/photos/')) {
      const key = url.pathname.replace('/api/photos/', '');
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response('Photo Not Found', { status: 404 });
      
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('etag', object.httpEtag);
      
      return new Response(object.body, { headers });
    }

    // --- ROUTE: POST /api/upload (Upload Photo) ---
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const contentType = request.headers.get('content-type') || '';
        const key = `part_${Date.now()}.jpg`;
        
        await env.PHOTOS.put(key, request.body, {
          httpMetadata: { contentType: 'image/jpeg' }
        });

        return new Response(JSON.stringify({ 
          success: true, 
          url: `${url.origin}/api/photos/${key}` 
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // --- ROUTE: GET /api/parts (Inventory List) ---
    if (url.pathname === '/api/parts' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare("SELECT * FROM parts ORDER BY name ASC").all();
        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // --- ROUTE: POST /api/parts (Add/Update & Sync) ---
    if (url.pathname === '/api/parts' && request.method === 'POST') {
      try {
        const part = await request.json();
        const { name, sku, upc, description, quantity, reorder_point, price, image_url } = part;

        // 1. Sync to Stripe first (so we have the ID)
        let stripeProductId = part.stripe_product_id;
        if (!stripeProductId) {
          const product = await stripe.products.create({
            name: name,
            description: description || `SKU: ${sku}`,
            default_price_data: {
              currency: 'usd',
              unit_amount: Math.round(price * 100),
            },
            images: image_url ? [image_url] : [],
            metadata: { sku, upc }
          });
          stripeProductId = product.id;
        }

        // 2. Save to D1
        await env.DB.prepare(`
          INSERT INTO parts (name, sku, upc, description, quantity, reorder_point, price, stripe_product_id, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sku) DO UPDATE SET
            name=excluded.name,
            quantity=excluded.quantity,
            price=excluded.price,
            image_url=excluded.image_url,
            updated_at=CURRENT_TIMESTAMP
        `).bind(name, sku, upc, description, quantity, reorder_point, price, stripeProductId, image_url).run();

        return new Response(JSON.stringify({ success: true, stripeProductId }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // --- ROUTE: POST / (Lead Capture - Existing) ---
    if (url.pathname === '/' && request.method === 'POST') {
      try {
        const data = await request.json();
        const { name, email, phone, equipment, issue } = data;

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
                    <p><strong>Customer:</strong> ${name}</p>
                    <p><strong>Equipment:</strong> ${equipment}</p>
                    <p><strong>Issue:</strong> ${issue}</p>
                    
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
                    <h2 style="color: #0b1a14;">Hi ${name}, I've received your request!</h2>
                    <p>Thanks for reaching out. I'm currently reviewing the details of your <strong>${equipment}</strong> repair and I'll be in touch shortly via phone or email to discuss the next steps.</p>
                    
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

        return new Response(JSON.stringify({ success: true, message: 'Request received!' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });

      } catch (err) {
        console.error('Backend Error:', err.message);
        return new Response(JSON.stringify({ success: false, error: 'Internal Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
