const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
exports.handler = async (event) => {
  const { email } = JSON.parse(event.body);
  const customers = await stripe.customers.list({ email, limit: 1 });
  const customer = customers.data.length
    ? customers.data[0]
    : await stripe.customers.create({ email });
  const intent = await stripe.setupIntents.create({
    customer: customer.id,
    payment_method_types: ['card'],
  });
  return {
    statusCode: 200,
    body: JSON.stringify({
      clientSecret: intent.client_secret,
      customerId: customer.id
    })
  };
};
```

4. Click the green **Commit changes** button

**Creating the second file:**

1. Click **Add file** → **Create new file** again
2. In the filename box, type:
```
   netlify/functions/charge-card.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
exports.handler = async (event) => {
  const { customerId, amount, fundName } = JSON.parse(event.body);
  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card'
  });
  if (!methods.data.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No card saved' })
    };
  }
  const intent = await stripe.paymentIntents.create({
    amount: amount * 100,
    currency: 'usd',
    customer: customerId,
    payment_method: methods.data[0].id,
    confirm: true,
    off_session: true,
    description: 'Openbell — ' + fundName + ' entry'
  });
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, id: intent.id })
  };
};
