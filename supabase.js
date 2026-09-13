// Identity provider. Supabase stores the accounts, hashes the passwords, and
// signs the tokens; nothing in this project ever sees a password hash or a
// signing key. This module only builds the client and checks it can be reached.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_KEY must be set. Copy .env.example to .env and fill them in from your Supabase dashboard.',
  );
}

// persistSession: false because this is a server. The SDK's default is to keep
// the logged-in session in local storage and reuse it for later calls, which is
// right for a browser holding one user's session and wrong for a process serving
// many users: the second person to log in would silently overwrite the first.
// Every request here carries its own token instead.
//
// Every request the SDK makes goes through fetchWithTimeout. Without it, a
// Supabase that accepts connections but stops replying leaves each protected
// request hanging for as long as Supabase does: the client waits, the Node
// socket stays open, and the requests pile up. With it, the call gives up after
// a few seconds and the route answers 502. If a caller already passed its own
// abort signal, both stay in force, and whichever fires first wins.
const AUTH_TIMEOUT_MS = 5000;

function fetchWithTimeout(input, init = {}) {
  const timeout = AbortSignal.timeout(AUTH_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fetchWithTimeout },
});

// createClient opens no connection, so "connected" has to be checked. The auth
// health endpoint answers without needing a user.
//
// The timeout matters. fetch has none by default, so a host that accepts the
// connection and then never replies would leave this await pending forever —
// and whatever is waiting on it would wait forever too.
async function checkConnection(timeoutMs = 3000) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: SUPABASE_KEY },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Supabase auth responded ${response.status}`);
  }
}

module.exports = { supabase, checkConnection };
