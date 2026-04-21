/**
 * Openbell — Supabase Cloudflare Pages Function
 * Handles all database operations via Supabase REST API.
 *
 * Required Supabase tables (create in Supabase SQL editor if missing):
 *
 *   -- Pool chat messages
 *   CREATE TABLE pool_chats (
 *     id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *     pool_id     text NOT NULL,
 *     uid         text NOT NULL,
 *     username    text NOT NULL,
 *     message     text NOT NULL,
 *     created_at  timestamptz DEFAULT now()
 *   );
 *   ALTER TABLE pool_chats ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY allow_all ON pool_chats FOR ALL USING (true) WITH CHECK (true);
 *
 *   -- Password reset tokens
 *   CREATE TABLE password_resets (
 *     id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *     email      text NOT NULL,
 *     token      text NOT NULL,
 *     expires_at timestamptz NOT NULL,
 *     used       boolean DEFAULT false,
 *     created_at timestamptz DEFAULT now()
 *   );
 *   ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY allow_all ON password_resets FOR ALL USING (true) WITH CHECK (true);
 */

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

  // ── Supabase helpers ─────────────────────────────────────────────
  const SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  async function sbGet(path) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
    return r.json();
  }

  async function sbPost(table, body, prefer = 'return=representation') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': prefer },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  async function sbPatch(path, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  async function sbDelete(path) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'DELETE',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' }
    });
    return r.json();
  }

  function ok(data) {
    return new Response(JSON.stringify({ success: true, ...data }), { headers: cors });
  }
  function err(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: cors });
  }

  // ── Parse request ────────────────────────────────────────────────
  let action, data;
  try {
    const body = await context.request.json();
    action = body.action;
    data = body.data || {};
  } catch (e) {
    return err('Invalid JSON: ' + e.message);
  }

  try {

    // ════════════════════════════════════════════════
    // AUTH — signup
    // ════════════════════════════════════════════════
    if (action === 'signup') {
      const existing = await sbGet('users?email=eq.' + encodeURIComponent(data.email) + '&select=uid');
      if (Array.isArray(existing) && existing.length > 0) {
        return err('Email already registered', 409);
      }
      const user = await sbPost('users', {
        uid:           data.uid,
        email:         data.email.toLowerCase(),
        first_name:    data.firstName,
        last_name:     data.lastName,
        password_hash: data.passwordHash,
        hash_version:  data.hashVersion || 1,
        phone:         data.phone || '',
        dob:           data.dob || '',
        state:         data.state || '',
        age:           data.age || 0,
        is_restricted: data.isRestricted || false,
        registered:    new Date().toISOString()
      });
      return ok({ user: Array.isArray(user) ? user[0] : user });
    }

    // ════════════════════════════════════════════════
    // AUTH — login (returns user row; hash check is client-side)
    // ════════════════════════════════════════════════
    if (action === 'login') {
      const rows = await sbGet(
        'users?email=eq.' + encodeURIComponent(data.email.toLowerCase()) + '&select=*'
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return err('No account found', 404);
      }
      return ok({ user: rows[0] });
    }

    // ════════════════════════════════════════════════
    // AUTH — change password
    // ════════════════════════════════════════════════
    if (action === 'change_password') {
      if (!data.uid || !data.passwordHash) return err('Missing fields');
      const result = await sbPatch(
        'users?uid=eq.' + encodeURIComponent(data.uid),
        { password_hash: data.passwordHash, hash_version: data.hashVersion || 2 }
      );
      return ok({ updated: true });
    }

    // ════════════════════════════════════════════════
    // AUTH — request password reset
    // ════════════════════════════════════════════════
    if (action === 'request_reset') {
      if (!data.email) return err('Missing email');
      const email = data.email.toLowerCase();
      const users = await sbGet('users?email=eq.' + encodeURIComponent(email) + '&select=uid,first_name');
      if (!Array.isArray(users) || users.length === 0) {
        // Return success even if not found to prevent enumeration
        return ok({ sent: true });
      }
      const firstName = users[0].first_name || 'there';
      const token = crypto.randomUUID().replace(/-/g, '');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      await sbPost('password_resets', { email, token, expires_at: expires, created_at: new Date().toISOString() });
      // Send email via Resend
      const { RESEND_API_KEY } = context.env;
      if (RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + RESEND_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Openbell <noreply@openbell.io>',
            to: email,
            subject: 'Reset your Openbell password',
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
              <div style="font-size:24px;font-weight:900;margin-bottom:8px">OPENBELL</div>
              <div style="width:32px;height:3px;background:#00c087;margin-bottom:32px"></div>
              <h2 style="font-size:20px;font-weight:700;margin-bottom:12px">Reset your password, ${firstName}.</h2>
              <p style="color:#555;line-height:1.7;margin-bottom:24px">Use this 6-digit code to reset your password. It expires in 1 hour.</p>
              <div style="font-family:monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#000;background:#f5f5f5;padding:20px;border-radius:8px;text-align:center;margin-bottom:24px">${token.slice(0,6).toUpperCase()}</div>
              <p style="color:#999;font-size:12px">Full token (if needed): <code>${token}</code></p>
              <p style="color:#999;font-size:12px;margin-top:16px">If you didn't request this, ignore this email — your account is safe.</p>
            </div>`
          })
        }).catch(() => {}); // don't fail the request if email fails
      }
      // Return the full token for the frontend to use — do NOT return to client
      // (frontend uses email + the code they receive to call verify_reset)
      return ok({ sent: true });
    }

    // ════════════════════════════════════════════════
    // AUTH — verify reset token
    // ════════════════════════════════════════════════
    if (action === 'verify_reset') {
      if (!data.code || !data.email) return err('Missing fields');
      const email = data.email.toLowerCase();
      const code = data.code.toLowerCase().replace(/\s/g, '');
      // Fetch all unused, non-expired tokens for this email
      const rows = await sbGet(
        'password_resets?email=eq.' + encodeURIComponent(email) +
        '&used=eq.false&select=*&order=created_at.desc&limit=5'
      );
      if (!Array.isArray(rows) || rows.length === 0) return err('Invalid or expired code', 404);
      // Match by first-6 prefix (case insensitive)
      const match = rows.find(r => {
        if (new Date(r.expires_at) < new Date()) return false;
        return r.token.slice(0, 6).toLowerCase() === code;
      });
      if (!match) return err('Invalid or expired code', 404);
      return ok({ valid: true, token: match.token });
    }

    // ════════════════════════════════════════════════
    // AUTH — consume reset token + set new password
    // ════════════════════════════════════════════════
    if (action === 'consume_reset') {
      if (!data.token || !data.email || !data.passwordHash) return err('Missing fields');
      const email = data.email.toLowerCase();
      const rows = await sbGet(
        'password_resets?email=eq.' + encodeURIComponent(email) +
        '&token=eq.' + encodeURIComponent(data.token) +
        '&used=eq.false&select=*'
      );
      if (!Array.isArray(rows) || rows.length === 0) return err('Invalid or expired token', 404);
      if (new Date(rows[0].expires_at) < new Date()) return err('Token expired', 410);
      // Mark token as used
      await sbPatch('password_resets?token=eq.' + encodeURIComponent(data.token), { used: true });
      // Update password
      await sbPatch('users?email=eq.' + encodeURIComponent(email), {
        password_hash: data.passwordHash,
        hash_version: data.hashVersion || 2
      });
      return ok({ reset: true });
    }

    // ════════════════════════════════════════════════
    // USER — get full user profile by uid
    // ════════════════════════════════════════════════
    if (action === 'get_user') {
      if (!data.uid) return err('Missing uid');
      const rows = await sbGet('users?uid=eq.' + encodeURIComponent(data.uid) + '&select=*');
      if (!Array.isArray(rows) || rows.length === 0) return err('User not found', 404);
      return ok({ user: rows[0] });
    }

    // ════════════════════════════════════════════════
    // USER — update profile
    // ════════════════════════════════════════════════
    if (action === 'update_profile') {
      if (!data.uid) return err('Missing uid');
      const updates = {};
      if (data.username   !== undefined) updates.username    = data.username;
      if (data.firstName  !== undefined) updates.first_name  = data.firstName;
      if (data.lastName   !== undefined) updates.last_name   = data.lastName;
      if (data.phone      !== undefined) updates.phone       = data.phone;
      if (data.avatarUrl  !== undefined) updates.avatar_url  = data.avatarUrl;
      if (data.bio        !== undefined) updates.bio         = data.bio;
      const result = await sbPatch('users?uid=eq.' + encodeURIComponent(data.uid), updates);
      return ok({ updated: true });
    }

    // ════════════════════════════════════════════════
    // USER — search users by username/email
    // ════════════════════════════════════════════════
    if (action === 'search_users') {
      if (!data.q) return ok({ users: [] });
      const q = encodeURIComponent(data.q.toLowerCase());
      const rows = await sbGet(
        `users?or=(email.ilike.*${q}*,first_name.ilike.*${q}*,last_name.ilike.*${q}*,username.ilike.*${q}*)` +
        '&select=uid,first_name,last_name,email,username,avatar_url&limit=10'
      );
      return ok({ users: Array.isArray(rows) ? rows : [] });
    }

    // ════════════════════════════════════════════════
    // SIGN IN LOG
    // ════════════════════════════════════════════════
    if (action === 'sign_in_log') {
      await sbPost('sign_ins', {
        uid:   data.uid || '',
        email: data.email || '',
        ts:    new Date().toISOString()
      }, 'return=minimal');
      return ok({});
    }

    // ════════════════════════════════════════════════
    // BALANCE — get current balance (sum of transactions)
    // ════════════════════════════════════════════════
    if (action === 'get_balance') {
      if (!data.uid) return err('Missing uid');
      const rows = await sbGet(
        'balance_transactions?uid=eq.' + encodeURIComponent(data.uid) +
        '&select=amount&order=created_at.asc'
      );
      const balance = Array.isArray(rows)
        ? rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
        : 0;
      return ok({ balance: Math.max(0, parseFloat(balance.toFixed(2))) });
    }

    // ════════════════════════════════════════════════
    // BALANCE — record a transaction (deposit, withdrawal, entry, winnings)
    // ════════════════════════════════════════════════
    if (action === 'balance_tx') {
      if (!data.uid || data.amount === undefined) return err('Missing fields');
      const row = await sbPost('balance_transactions', {
        uid:         data.uid,
        email:       data.email || '',
        username:    data.username || '',
        amount:      parseFloat(data.amount),
        type:        data.type || 'credit',        // 'deposit'|'withdrawal'|'pool_entry'|'winnings'|'credit'
        description: data.description || '',
        pool_id:     data.poolId || null,
        pool_name:   data.poolName || null,
        created_at:  new Date().toISOString()
      });
      // Return new running balance
      const allRows = await sbGet(
        'balance_transactions?uid=eq.' + encodeURIComponent(data.uid) + '&select=amount'
      );
      const balance = Array.isArray(allRows)
        ? allRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
        : 0;
      return ok({ balance: Math.max(0, parseFloat(balance.toFixed(2))) });
    }

    // ════════════════════════════════════════════════
    // BALANCE — get full transaction history
    // ════════════════════════════════════════════════
    if (action === 'get_balance_history') {
      if (!data.uid) return err('Missing uid');
      const rows = await sbGet(
        'balance_transactions?uid=eq.' + encodeURIComponent(data.uid) +
        '&select=*&order=created_at.desc&limit=100'
      );
      const balance = Array.isArray(rows)
        ? rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
        : 0;
      return ok({ transactions: rows || [], balance: Math.max(0, parseFloat(balance.toFixed(2))) });
    }

    // ════════════════════════════════════════════════
    // DRAFT — save picks
    // ════════════════════════════════════════════════
    if (action === 'save_draft') {
      if (!data.uid || !data.leagueId || !data.picks) return err('Missing fields');
      // Upsert: delete existing then insert (Supabase upsert on composite key)
      await sbDelete(
        'drafts?uid=eq.' + encodeURIComponent(data.uid) +
        '&league_id=eq.' + encodeURIComponent(data.leagueId) +
        '&week=eq.' + encodeURIComponent(data.week)
      );
      await sbPost('drafts', {
        uid:         data.uid,
        email:       data.email || '',
        username:    data.username || '',
        league_id:   data.leagueId,
        league_name: data.leagueName || '',
        week:        data.week || 0,
        picks:       data.picks,
        submitted_at: new Date().toISOString()
      });
      return ok({});
    }

    // ════════════════════════════════════════════════
    // DRAFT — get user's draft history
    // ════════════════════════════════════════════════
    if (action === 'get_user_drafts') {
      if (!data.uid) return err('Missing uid');
      const rows = await sbGet(
        'drafts?uid=eq.' + encodeURIComponent(data.uid) +
        '&select=*&order=submitted_at.desc'
      );
      return ok({ drafts: Array.isArray(rows) ? rows : [] });
    }

    // ════════════════════════════════════════════════
    // DRAFT — get all picks for a pool + week (for leaderboard)
    // ════════════════════════════════════════════════
    if (action === 'get_pool_drafts') {
      if (!data.leagueId) return err('Missing leagueId');
      const query = data.week
        ? `drafts?league_id=eq.${encodeURIComponent(data.leagueId)}&week=eq.${encodeURIComponent(data.week)}&select=*`
        : `drafts?league_id=eq.${encodeURIComponent(data.leagueId)}&select=*`;
      const rows = await sbGet(query);
      return ok({ drafts: Array.isArray(rows) ? rows : [] });
    }

    // ════════════════════════════════════════════════
    // ENROLLMENT — save enrollment
    // ════════════════════════════════════════════════
    if (action === 'save_enrollment') {
      if (!data.uid || !data.leagueId) return err('Missing fields');
      // Check for duplicate
      const existing = await sbGet(
        'enrollments?uid=eq.' + encodeURIComponent(data.uid) +
        '&league_id=eq.' + encodeURIComponent(data.leagueId) +
        '&week=eq.' + encodeURIComponent(data.week) +
        '&select=id'
      );
      if (Array.isArray(existing) && existing.length > 0) {
        return ok({ duplicate: true }); // Already enrolled
      }
      await sbPost('enrollments', {
        uid:         data.uid,
        email:       data.email || '',
        username:    data.username || '',
        league_id:   data.leagueId,
        league_name: data.leagueName || '',
        fee:         data.fee || 0,
        week:        data.week || 0,
        enrolled_at: new Date().toISOString()
      }, 'return=minimal');
      return ok({});
    }

    // ════════════════════════════════════════════════
    // ENROLLMENT — get user's enrolled pools
    // ════════════════════════════════════════════════
    if (action === 'get_user_enrollments') {
      if (!data.uid) return err('Missing uid');
      const rows = await sbGet(
        'enrollments?uid=eq.' + encodeURIComponent(data.uid) +
        '&select=*&order=enrolled_at.desc'
      );
      return ok({ enrollments: Array.isArray(rows) ? rows : [] });
    }

    // ════════════════════════════════════════════════
    // ENROLLMENT — get all participants in a pool (for leaderboard)
    // ════════════════════════════════════════════════
    if (action === 'get_pool_enrollments') {
      if (!data.leagueId) return err('Missing leagueId');
      const query = data.week
        ? `enrollments?league_id=eq.${encodeURIComponent(data.leagueId)}&week=eq.${encodeURIComponent(data.week)}&select=*`
        : `enrollments?league_id=eq.${encodeURIComponent(data.leagueId)}&select=*`;
      const rows = await sbGet(query);
      return ok({ enrollments: Array.isArray(rows) ? rows : [] });
    }

    // ════════════════════════════════════════════════
    // ENROLLMENT — get enrollment counts for multiple pools
    // ════════════════════════════════════════════════
    if (action === 'get_enrollment_counts') {
      const leagueIds = data.leagueIds || [];
      if (!leagueIds.length) return ok({ counts: {} });
      const counts = {};
      // Batch: fetch all enrollments for given league_ids
      for (const id of leagueIds.slice(0, 20)) {
        const rows = await sbGet(
          'enrollments?league_id=eq.' + encodeURIComponent(id) + '&select=uid'
        );
        counts[id] = Array.isArray(rows) ? rows.length : 0;
      }
      return ok({ counts });
    }

    // ════════════════════════════════════════════════
    // LEADERBOARD — combined enrollments + picks for a pool
    // ════════════════════════════════════════════════
    if (action === 'get_pool_leaderboard') {
      if (!data.leagueId) return err('Missing leagueId');
      const weekParam = data.week ? `&week=eq.${encodeURIComponent(data.week)}` : '';
      const [enrollments, drafts] = await Promise.all([
        sbGet(`enrollments?league_id=eq.${encodeURIComponent(data.leagueId)}${weekParam}&select=uid,username,email,enrolled_at`),
        sbGet(`drafts?league_id=eq.${encodeURIComponent(data.leagueId)}${weekParam}&select=uid,username,picks,submitted_at`)
      ]);
      // Build player map: uid → { username, picks }
      const draftMap = {};
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          draftMap[d.uid] = { username: d.username, picks: d.picks || [], submitted_at: d.submitted_at };
        }
      }
      const players = Array.isArray(enrollments) ? enrollments.map(e => ({
        uid:          e.uid,
        username:     draftMap[e.uid]?.username || e.username || 'Player',
        email:        e.email,
        picks:        draftMap[e.uid]?.picks || [],
        submitted_at: draftMap[e.uid]?.submitted_at || e.enrolled_at,
        has_draft:    !!draftMap[e.uid]
      })) : [];
      return ok({ players });
    }

    // ════════════════════════════════════════════════
    // CHAT — get messages for a pool
    // ════════════════════════════════════════════════
    if (action === 'get_chat') {
      if (!data.poolId) return err('Missing poolId');
      const rows = await sbGet(
        'pool_chats?pool_id=eq.' + encodeURIComponent(data.poolId) +
        '&select=*&order=created_at.asc&limit=100'
      );
      return ok({ messages: Array.isArray(rows) ? rows : [] });
    }

    // ════════════════════════════════════════════════
    // CHAT — send a message
    // ════════════════════════════════════════════════
    if (action === 'send_chat') {
      if (!data.poolId || !data.uid || !data.message) return err('Missing fields');
      const msg = data.message.trim().slice(0, 500); // max 500 chars
      if (!msg) return err('Empty message');
      const row = await sbPost('pool_chats', {
        pool_id:    data.poolId,
        uid:        data.uid,
        username:   data.username || 'Player',
        message:    msg,
        created_at: new Date().toISOString()
      });
      return ok({ message: Array.isArray(row) ? row[0] : row });
    }

    // ════════════════════════════════════════════════
    // PAYOUTS — record a winner payout (admin action)
    // ════════════════════════════════════════════════
    if (action === 'pay_winner') {
      if (!data.uid || !data.amount || !data.poolId || !data.poolName) return err('Missing fields');
      const amount = parseFloat(data.amount);
      if (amount <= 0) return err('Amount must be positive');
      // Write winnings transaction
      await sbPost('balance_transactions', {
        uid:         data.uid,
        email:       data.email || '',
        username:    data.username || '',
        amount:      amount,
        type:        'winnings',
        description: 'Pool winnings — ' + data.poolName,
        pool_id:     data.poolId,
        pool_name:   data.poolName,
        created_at:  new Date().toISOString()
      });
      // Return new balance
      const allRows = await sbGet('balance_transactions?uid=eq.' + encodeURIComponent(data.uid) + '&select=amount');
      const balance = Array.isArray(allRows)
        ? allRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
        : amount;
      return ok({ balance: Math.max(0, parseFloat(balance.toFixed(2))) });
    }

    // ════════════════════════════════════════════════
    // HERO POOL — most active pool for landing page widget
    // ════════════════════════════════════════════════
    if (action === 'get_hero_pool') {
      // Find the pool with the most enrollments
      const allEnrollments = await sbGet('enrollments?select=league_id,league_name,fee,uid,username&order=created_at.desc&limit=200');
      if (!Array.isArray(allEnrollments) || !allEnrollments.length) return ok({ pool: null });
      // Count by league_id
      const counts = {};
      const meta = {};
      for (const e of allEnrollments) {
        const id = e.league_id;
        counts[id] = (counts[id] || 0) + 1;
        if (!meta[id]) meta[id] = { name: e.league_name || 'Pool', fee: parseFloat(e.fee) || 0 };
      }
      const topId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (!topId) return ok({ pool: null });
      // Get leaderboard for top pool
      const players = allEnrollments.filter(e => e.league_id === topId).map(e => ({
        uid: e.uid, username: e.username || 'Player'
      }));
      // Get their picks
      const picks = await sbGet('drafts?league_id=eq.' + encodeURIComponent(topId) + '&select=uid,picks&order=created_at.desc');
      const pickMap = {};
      if (Array.isArray(picks)) picks.forEach(d => { pickMap[d.uid] = d.picks || []; });
      const participants = players.slice(0, 5).map((p, i) => ({
        rank: i + 1,
        name: (p.username || 'Player').split(' ').map((w, j) => j === 0 ? w : w[0] + '.').join(' '),
        picks: pickMap[p.uid] || [],
        ret: null
      }));
      const totalPool = counts[topId] * meta[topId].fee;
      return ok({ pool: { id: topId, name: meta[topId].name, participants: counts[topId], total: totalPool, players: participants } });
    }

    // ════════════════════════════════════════════════
    // PLATFORM STATS — aggregate totals for hero section
    // ════════════════════════════════════════════════
    if (action === 'get_platform_stats') {
      // Count total distinct users ever enrolled
      const allEnrollments = await sbGet('enrollments?select=uid,league_id,fee');
      const enrollArr = Array.isArray(allEnrollments) ? allEnrollments : [];
      const uniqueUsers = new Set(enrollArr.map(e => e.uid)).size;
      const uniquePools = new Set(enrollArr.map(e => e.league_id)).size;
      const totalVolume = enrollArr.reduce((s, e) => s + (parseFloat(e.fee) || 0), 0);
      return ok({ users: uniqueUsers, pools: uniquePools, volume: Math.round(totalVolume) });
    }

    // ════════════════════════════════════════════════
    // RECENT WINNERS — for the scrolling ticker
    // ════════════════════════════════════════════════
    if (action === 'get_recent_winners') {
      // Pull winnings payouts from balance_transactions
      const rows = await sbGet(
        'balance_transactions?type=eq.winnings&amount=gt.0&select=uid,amount,description,pool_name,created_at&order=created_at.desc&limit=20'
      );
      if (!Array.isArray(rows)) return ok({ winners: [] });
      // Also look up usernames from users table
      const uids = [...new Set(rows.map(r => r.uid))];
      let userMap = {};
      if (uids.length) {
        const users = await sbGet('users?uid=in.(' + uids.join(',') + ')&select=uid,username');
        if (Array.isArray(users)) users.forEach(u => { userMap[u.uid] = u.username; });
      }
      const winners = rows.map(r => ({
        name: userMap[r.uid] || 'Player',
        fund: r.pool_name || r.description || 'Pool',
        won:  parseFloat(r.amount).toFixed(0),
        date: r.created_at
      }));
      return ok({ winners });
    }

    // ════════════════════════════════════════════════
    // EVENTS — general event log (analytics, admin)
    // ════════════════════════════════════════════════
    if (action === 'log_event') {
      // Silently accept — used for analytics
      return ok({});
    }

    return err('Unknown action: ' + action);

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message, action }),
      { status: 500, headers: cors }
    );
  }
}
