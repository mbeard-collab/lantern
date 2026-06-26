// Password gate for the /private/ space. A *second* gate on top of the
// site-wide Netlify password: even people who can see the rest of the site
// can't view anything under /private/ without this space's password.
//
// Stateless: the cookie holds a SHA-256 hash of the password (never the raw
// value), and each request re-derives the expected hash from PRIVATE_PASSWORD.
// Rotating PRIVATE_PASSWORD invalidates every existing cookie automatically.

import type { Context } from "https://edge.netlify.com";

const COOKIE = "lantern_private";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export default async (request: Request, context: Context): Promise<Response> => {
  const password = Deno.env.get("PRIVATE_PASSWORD");
  if (!password) {
    return new Response("Private space is not configured (PRIVATE_PASSWORD unset).", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
  }
  const expected = await sha256hex(password);
  const url = new URL(request.url);

  // Sign out: clear the cookie and show the login page.
  if (request.method === "GET" && url.searchParams.has("logout")) {
    const headers = new Headers({ Location: "/private/" });
    headers.append(
      "Set-Cookie",
      `${COOKIE}=; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    return new Response(null, { status: 303, headers });
  }

  // Login form submission.
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const supplied = String(form?.get("password") ?? "");
    if (supplied && (await sha256hex(supplied)) === expected) {
      const headers = new Headers({ Location: url.pathname });
      headers.append(
        "Set-Cookie",
        `${COOKIE}=${expected}; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
      );
      return new Response(null, { status: 303, headers });
    }
    return loginResponse(url.pathname, true);
  }

  // Already authenticated → serve the requested static asset.
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (match && timingSafeEqual(match[1], expected)) {
    return context.next();
  }

  return loginResponse(url.pathname, false);
};

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish comparison for two equal-length hex strings.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function loginResponse(pathname: string, error: boolean): Response {
  return new Response(loginPage(pathname, error), {
    status: error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function loginPage(action: string, error: boolean): string {
  const safeAction = action
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Private · GovSpend Dashboards</title>
<style>
  :root { --bg:#0B0F17; --elev:#121826; --line:#232C42; --text:#E6EAF2; --muted:#8A93A6; --accent:#4DA3FF; --accent-2:#7C5CFF; --red:#FF6B6B; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text); font-family:-apple-system,"SF Pro Text","Inter",Segoe UI,system-ui,sans-serif; }
  .card { width:100%; max-width:360px; background:var(--elev); border:1px solid var(--line); border-radius:14px; padding:28px; margin:20px; }
  .mark { width:34px; height:34px; border-radius:9px; background:linear-gradient(135deg,#4DA3FF,#7C5CFF); display:flex; align-items:center; justify-content:center; font-weight:700; color:#0B0F17; margin-bottom:16px; }
  h1 { font-size:18px; margin:0 0 4px; }
  p { font-size:13px; color:var(--muted); margin:0 0 18px; }
  label { font-size:12px; color:var(--muted); display:block; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:#0E1320; color:var(--text); font-size:14px; }
  input:focus { outline:none; border-color:var(--accent); }
  button { width:100%; margin-top:14px; padding:10px 12px; border:0; border-radius:9px; background:linear-gradient(135deg,#4DA3FF,#7C5CFF); color:#0B0F17; font-weight:600; font-size:14px; cursor:pointer; }
  .err { color:var(--red); font-size:12px; margin-top:10px; ${error ? "" : "display:none;"} }
</style>
</head>
<body>
  <form class="card" method="POST" action="${safeAction}">
    <div class="mark">G</div>
    <h1>Private space</h1>
    <p>This area is password-protected. Enter the password to continue.</p>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Enter</button>
    <div class="err">Incorrect password. Try again.</div>
  </form>
</body>
</html>`;
}
