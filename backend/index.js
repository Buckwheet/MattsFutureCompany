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

      // 1. Search for existing customer by email
      const existingCustomers = await stripe.customers.list({
        email: email,
        limit: 1
      });

      let customer;
      if (existingCustomers.data.length > 0) {
        // 2a. Update existing customer
        customer = existingCustomers.data[0];
        await stripe.customers.update(customer.id, {
          description: `Latest Equipment: ${equipment}`,
          metadata: {
            latest_issue: issue,
            latest_equipment: equipment,
            last_request_date: new Date().toISOString()
          }
        });
        console.log(`Updated existing customer: ${customer.id}`);
      } else {
        // 2b. Create new customer
        customer = await stripe.customers.create({
          name,
          email,
          phone,
          description: `Equipment: ${equipment}`,
          metadata: {
            latest_issue: issue,
            latest_equipment: equipment,
            first_request_date: new Date().toISOString()
          }
        });
        console.log(`Created new customer: ${customer.id}`);
      }

      // 3. Return success
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
      console.error('Stripe Error:', err.message);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to process request. Please try calling instead.' 
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
