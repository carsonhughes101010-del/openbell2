export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  const { STRIPE_SECRET_KEY } = context.env;
  const { token, amount, email, fundName } = await context.request.json();

  const body = new URLSearchParams({
    amount: String(Math.round(amount * 100)),
    currency: 'usd',
    source: token,
    receipt_email: email,
    description: 'Openbell — ' + fundName,
  });

  const res = await fetch('https://api.stripe.com/v1/charges', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(STRIPE_SECRET_KEY + ':'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const charge = await res.json();

  if (!res.ok) {
    return new Response(JSON.stringify({ success: false, error: charge.error?.message || 'Charge failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  return new Response(JSON.stringify({ success: true, id: charge.id }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
