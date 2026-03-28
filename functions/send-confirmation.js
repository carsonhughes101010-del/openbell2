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

  const { RESEND_API_KEY } = context.env;
  const { email, firstName } = await context.request.json();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Openbell <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to Openbell',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px"><div style="font-size:24px;font-weight:900;margin-bottom:8px">OPENBELL</div><div style="width:32px;height:3px;background:#00c087;margin-bottom:32px"></div><h2 style="font-size:20px;font-weight:700;margin-bottom:12px">Welcome, ${firstName}.</h2><p style="color:#555;line-height:1.7;margin-bottom:32px">Your account is ready. Draft opens every Monday. Picks lock Sunday at 11:59 PM ET. Best portfolio by Friday close wins the pool.</p><a href="https://openbell.pages.dev" style="background:#00c087;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block">Start Drafting →</a></div>`
    })
  });

  return new Response(JSON.stringify({ success: res.ok }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
