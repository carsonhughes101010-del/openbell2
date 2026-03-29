if (context.request.method === 'OPTIONS') {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const { SUPABASE_URL, SUPABASE_KEY } = context.env;
  const { action, data } = await context.request.json();

  const sb = (path, method = 'GET', body) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : ''
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(r => r.json());

  try {
    if (action === 'signup') {
      const existing = await sb(`users?email=eq.${encodeURIComponent(data.email)}&select=uid`);
      if (existing.length > 0) {
        return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers });
      }
      const result = await sb('users', 'POST', {
        uid: data.uid,
        email: data.email.toLowerCase(),
        first_name: data.firstName,
        last_name: data.lastName,
        password_hash: data.passwordHash,
        phone: data.phone,
        dob: data.dob,
        state: data.state,
        age: data.age,
        is_restricted: data.isRestricted || false,
        registered: new Date().toISOString()
      });
      return new Response(JSON.stringify({ success: true, user: result[0] }), { headers });
    }

    if (action === 'login') {
      const result = await sb(`users?email=eq.${encodeURIComponent(data.email.toLowerCase())}&select=*`);
      if (!result.length) return new Response(JSON.stringify({ error: 'No account found' }), { status: 404, headers });
      return new Response(JSON.stringify({ success: true, user: result[0] }), { headers });
    }

    if (action === 'save_draft') {
      await sb('drafts', 'POST', {
        uid: data.uid,
        email: data.email,
        username: data.username,
        league_id: data.leagueId,
        league_name: data.leagueName,
        week: data.week,
        picks: data.picks
      });
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (action === 'save_enrollment') {
      await sb('enrollments', 'POST', {
        uid: data.uid,
        email: data.email,
        username: data.username,
        league_id: data.leagueId,
        league_name: data.leagueName,
        fee: data.fee,
        week: data.week
      });
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (action === 'sign_in_log') {
      await sb('sign_ins', 'POST', { uid: data.uid, email: data.email });
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
