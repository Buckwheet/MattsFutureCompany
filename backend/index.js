import Stripe from 'stripe';

export default {
  async fetch(request, env) {
    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Stripe is mandatory for our core flow
    if (!env.STRIPE_SECRET_KEY) {
      console.error('CRITICAL: STRIPE_SECRET_KEY is missing.');
      return new Response(JSON.stringify({ success: false, error: 'Configuration Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY);

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
            ? `<a href="https://squareupsm.com/dashboard/customers/directory/customer/${squareCustomerId}" style="background: #006aff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.9rem;">Schedule (Square)</a>`
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
                  
                  <div style="margin-top: 30px; display: flex; gap: 10px; align-items: center;">
                    <a href="https://dashboard.stripe.com/customers/${stripeCustomer.id}" 
                       style="background: #d92d20; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.9rem;">
                       Billing (Stripe)
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
  },
};
