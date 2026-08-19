// Commits one or more data files to the site via /api/commit (data action).
// Called by refresh.mjs after queries succeed.
//
// files: Array<{ name: string, content: string }>
//   name is relative to the dashboard folder (e.g. 'usage_data.js' or 'data.json')

export async function publish(slug, files) {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const secret  = process.env.PIPELINE_SECRET;

  if (!siteUrl) throw new Error('publish: SITE_URL is not set in _pipeline/.env');
  if (!secret)  throw new Error('publish: PIPELINE_SECRET is not set in _pipeline/.env');

  const endpoint = `${siteUrl}/api/commit`;
  console.error(`[publish] POST ${endpoint} — slug=${slug}, files=[${files.map(f => f.name).join(', ')}]`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'data',
      auth: { token: secret },
      slug,
      files,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`publish: commit failed (HTTP ${res.status}) — ${body.error || JSON.stringify(body)}`);
  }

  return body;
}
