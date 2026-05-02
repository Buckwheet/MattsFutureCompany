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

      // 2. SQUARE CUSTOMER LOGIC (Sync)
      let squareCustomerId = "pending";
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
          squareCustomerId = newSquare.customer.id;
        }
      } catch (e) {
        console.error('Square Sync Error:', e.message);
      }

      // 3. NOTIFY MATT (Dual Dashboard Links)
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
              
              <div style="margin-top: 30px; display: flex; gap: 10px;">
                <a href="https://dashboard.stripe.com/customers/${stripeCustomer.id}" 
                   style="background: #d92d20; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.9rem;">
                   Billing (Stripe)
                </a>
                <a href="https://squareupsm.com/dashboard/customers/directory/customer/${squareCustomerId}" 
                   style="background: #006aff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 0.9rem;">
                   Schedule (Square)
                </a>
              </div>
            </div>
          `
        }),
      });

      // 4. AUTO-RESPONSE TO CUSTOMER
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
            <div style="font-family: sans-serif; max-width: 600px; padding: 30px; color: #333;">
              <h2 style="color: #0b1a14;">Hi ${name}, Matt here.</h2>
              <p>I've received your request for your <strong>${equipment}</strong>. I'm reviewing the details now and will contact you shortly to schedule an assessment.</p>
              <p>Talk soon!</p>
            </div>
          `
        }),
      });

      return new Response(JSON.stringify({ success: true }), {
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
