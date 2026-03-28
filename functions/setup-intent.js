export async function onRequest(context) {
  const { STRIPE_SECRET_KEY } = context.env;
  const { email } = await context.request.json();

  const stripe = (await import('https://esm.sh/stripe@13')).default(STRIPE_SECRET_KEY);

  const customers = await stripe.customers.list({ email, limit: 1 });
  const customer = customers.data.length
    ? customers.data[0]
    : await stripe.customers.create({ email });

  const intent = await stripe.setupIntents.create({
    customer: customer.id,
    payment_method_types: ['card'],
  });

  return new Response(JSON.stringify({
    clientSecret: intent.client_secret,
    customerId: customer.id
  }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
