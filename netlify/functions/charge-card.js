export async function onRequest(context) {
  const { STRIPE_SECRET_KEY } = context.env;
  const { customerId, amount, fundName } = await context.request.json();

  const stripe = (await import('https://esm.sh/stripe@13')).default(STRIPE_SECRET_KEY);

  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card'
  });

  if (!methods.data.length) {
    return new Response(JSON.stringify({ error: 'No card saved' }), { status: 400 });
  }

  const intent = await stripe.paymentIntents.create({
    amount: amount * 100,
    currency: 'usd',
    customer: customerId,
    payment_method: methods.data[0].id,
    confirm: true,
    off_session: true,
    description: 'Openbell — ' + fundName
  });

  return new Response(JSON.stringify({ success: true, id: intent.id }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
