export async function onRequest(context) {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
  }

  const { SUPABASE_URL, SUPABASE_KEY } = context.env;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500, headers: cors });
  }

  const sb = (path, method, body) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: method || 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : ''
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r) { return r.json(); });

  var action, data;
  try {
    var body = await context.request.json();
    action = body.action;
    data = body.data;
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON: ' + e.message }), { status: 400, headers: cors });
  }

  try {
    if (action === 'signup') {
      var existing = await sb('users?email=eq.' + encodeURIComponent(data.email) + '&select=uid');
      if (Array.isArray(existing) && existing.length > 0) {
        return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers: cors });
      }
      var result = await sb('users', 'POST', {
        uid: data.uid,
        email: data.email.toLowerCase(),
        first_name: data.firstName,
        last_name: data.lastName,
        password_hash: data.passwordHash,
        phone: data.phone || '',
        dob: data.dob || '',
        state: data.state || '',
        age: data.age || 0,
        is_restricted: data.isRestricted || false,
        registered: new Date().toISOString()
      });
      return new Response(JSON.stringify({ success: true, user: Array.isArray(result) ? result[0] : result }), { headers: cors });
    }

    if (action === 'login') {
      var result = await sb('users?email=eq.' + encodeURIComponent(data.email.toLowerCase()) + '&select=*');
      if (!Array.isArray(result) || result.length === 0) {
        return new Response(JSON.stringify({ error: 'No account found' }), { status: 404, headers: cors });
      }
      return new Response(JSON.stringify({ success: true, user: result[0] }), { headers: cors });
    }

    if (action === 'save_draft') {
      await sb('drafts', 'POST', {
        uid: data.uid || '',
        email: data.email || '',
        username: data.username || '',
        league_id: data.leagueId || '',
        league_name: data.leagueName || '',
        week: data.week || 0,
        picks: data.picks || []
      });
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    }

    if (action === 'save_enrollment') {
      await sb('enrollments', 'POST', {
        uid: data.uid || '',
        email: data.email || '',
        username: data.username || '',
        league_id: data.leagueId || '',
        league_name: data.leagueName || '',
        fee: data.fee || 0,
        week: data.week || 0
      });
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    }

    if (action === 'sign_in_log') {
      await sb('sign_ins', 'POST', { uid: data.uid || '', email: data.email || '' });
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'Unknown action: ' + action }), { status: 400, headers: cors });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: cors });
  }
}
