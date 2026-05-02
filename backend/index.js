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

      // 1. Stripe Customer Logic (Search or Create)
      const existingCustomers = await stripe.customers.list({ email: email, limit: 1 });
      let customer;
      
      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        await stripe.customers.update(customer.id, {
          description: `Latest Equipment: ${equipment}`,
          metadata: {
            latest_issue: issue,
            latest_equipment: equipment,
            last_request_date: new Date().toISOString()
          }
        });
      } else {
        customer = await stripe.customers.create({
          name, email, phone,
          description: `Equipment: ${equipment}`,
          metadata: {
            latest_issue: issue,
            latest_equipment: equipment,
            first_request_date: new Date().toISOString()
          }
        });
      }

      // 2. Notify Matt via Resend
      // We use onboarding@resend.dev until the domain is fully verified in Resend
      const emailRes = await fetch('https://api.resend.com/emails', {
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
              <p>A new request has been submitted from the website.</p>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Customer:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${name}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${phone}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Equipment:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${equipment}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Issue:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${issue}</td></tr>
              </table>
              <div style="margin-top: 30px;">
                <a href="https://dashboard.stripe.com/customers/${customer.id}" 
                   style="background: #d92d20; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                   View in Stripe Dashboard
                </a>
              </div>
            </div>
          `
        }),
      });

      // 3. Return success to frontend
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Request received! Matt will contact you soon.',
        customerId: customer.id 
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
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
