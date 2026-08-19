// Triggers a live refresh of usage-data/usage_data.js by running the CrateDB
// queries and committing the result directly to GitHub.
//
// POST body: { password: string }
// Password must match the REFRESH_PASSWORD Netlify env var.
//
// Required Netlify env vars (in addition to the shared ones):
//   REFRESH_PASSWORD, CRATE_URL, CRATE_USER, CRATE_PASSWORD,
//   GITHUB_TOKEN, GITHUB_REPO

import { query } from '../../_pipeline/lib/crate.mjs';
import runQuery, { outputFile, formatOutput } from '../../_pipeline/queries/usage-data.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const env = process.env;

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const password = String(body?.password || '');
  if (!env.REFRESH_PASSWORD || password !== env.REFRESH_PASSWORD) {
    return json({ error: 'Wrong password' }, 401);
  }

  const required = ['CRATE_URL', 'CRATE_USER', 'CRATE_PASSWORD', 'GITHUB_TOKEN', 'GITHUB_REPO'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) return json({ error: `Missing Netlify env vars: ${missing.join(', ')}` }, 500);

  try {
    const data = await runQuery({ query });
    const content = formatOutput(data);

    const ghBase = `https://api.github.com/repos/${env.GITHUB_REPO}/contents`;
    const ghHeaders = {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lantern-refresh',
    };

    const path = `usage-data/${outputFile}`;
    const getRes = await fetch(`${ghBase}/${path}?ref=main`, { headers: ghHeaders });
    const sha = getRes.ok ? (await getRes.json()).sha : null;

    const putRes = await fetch(`${ghBase}/${path}`, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update ${path} via browser refresh`,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch: 'main',
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub PUT failed (${putRes.status}): ${errText.slice(0, 200)}`);
    }
    const putBody = await putRes.json();

    return json({
      ok: true,
      generatedAt: data.meta.generatedAt,
      orgs: data.orgs.length,
      users: data.users.length,
      commitSha: putBody.commit?.sha?.slice(0, 7) || null,
    });
  } catch (err) {
    console.error('[refresh-usage-data]', err);
    return json({ error: err.message }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
