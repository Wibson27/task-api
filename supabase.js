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

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fetchWithTimeout },
};

// The SDK is built for a browser, where one client belongs to one user. After
// signInWithPassword or signUp it keeps that user's session inside the client
// object and quietly uses it for any later call that does not name a token.
//
// persistSession: false does NOT prevent that. It only stops the session being
// written to storage; the client still holds it in memory. Measured: two users
// log in through one client, X then Y, and the client is left holding Y's
// session. A call to auth.signOut() on it then logs out Y — not X, who asked.
// On a server handling many people, a shared client ends up acting as whoever
// logged in last.
//
// So there are two kinds of client here.
//
// `supabase` is shared, and is only used for calls that are told exactly which
// token to act on: getUser(token) and admin.signOut(token). Those never read
// or store a session, so sharing is safe.
//
// createAuthClient() makes a fresh, throwaway client for every signup and login,
// the two calls that store a session. The session is kept in that one object,
// which nothing else ever touches and which is garbage-collected once the
// request finishes. Creating a client opens no connection, so this costs almost
// nothing.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, CLIENT_OPTIONS);

function createAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, CLIENT_OPTIONS);
}

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

module.exports = { supabase, createAuthClient, checkConnection };
