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
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// createClient opens no connection, so "connected" has to be checked. The auth
// health endpoint answers without needing a user.
async function checkConnection() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: SUPABASE_KEY },
  });

  if (!response.ok) {
    throw new Error(`Supabase auth responded ${response.status}`);
  }
}

module.exports = { supabase, checkConnection };
