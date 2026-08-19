// CrateDB HTTP query helper.
// Requires env: CRATE_URL, CRATE_USER, CRATE_PASSWORD

const TIMEOUT_MS = 30_000;
const REQUIRED = ['CRATE_URL', 'CRATE_USER', 'CRATE_PASSWORD'];

function creds() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`CrateDB: missing required env vars: ${missing.join(', ')}\nCheck _pipeline/.env`);
  }
  return {
    url: process.env.CRATE_URL.replace(/\/$/, ''),
    user: process.env.CRATE_USER,
    password: process.env.CRATE_PASSWORD,
  };
}

function toObjects({ cols, rows }) {
  return rows.map(row => Object.fromEntries(cols.map((col, i) => [col, row[i]])));
}

async function attempt(url, user, password, stmt, args) {
  const upper = stmt.trimStart().toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    throw new Error(`CrateDB: only SELECT/WITH allowed — got: ${stmt.slice(0, 60)}`);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ stmt, args }),
      signal: ac.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || JSON.stringify(body).slice(0, 200);
      const err = new Error(`CrateDB HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function query(stmt, args = []) {
  const { url, user, password } = creds();
  try {
    const raw = await attempt(url, user, password, stmt, args);
    return { raw, rows: toObjects(raw) };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[crate] Timeout on first attempt — retrying once…');
      const raw = await attempt(url, user, password, stmt, args);
      return { raw, rows: toObjects(raw) };
    }
    if (err.status >= 400 && err.status < 500) throw err; // no retry on 4xx
    throw err;
  }
}
