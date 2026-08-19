// Commits one or more data files to the GitHub repo directly via the
// GitHub Contents API. Requires GITHUB_TOKEN and GITHUB_REPO in .env.
//
// files: Array<{ name: string, content: string }>
//   name is relative to the dashboard folder (e.g. 'usage_data.js' or 'data.json')

export async function publish(slug, files) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;

  if (!token) throw new Error('publish: GITHUB_TOKEN is not set in _pipeline/.env');
  if (!repo)  throw new Error('publish: GITHUB_REPO is not set in _pipeline/.env');

  const ghBase = `https://api.github.com/repos/${repo}/contents`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lantern-pipeline',
  };

  async function getSha(path) {
    const res = await fetch(`${ghBase}/${path}?ref=main`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
    return (await res.json()).sha;
  }

  async function putFile(path, content, message, sha) {
    const payload = {
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: 'main',
    };
    if (sha) payload.sha = sha;
    const res = await fetch(`${ghBase}/${path}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
    return (await res.json()).commit?.sha || null;
  }

  const commits = [];
  for (const f of files) {
    const path = `${slug}/${f.name}`;
    console.error(`[publish] committing ${path} to ${repo}@main`);
    const sha = await getSha(path);
    const commitSha = await putFile(
      path,
      f.content,
      `Update ${path} via pipeline`,
      sha,
    );
    commits.push({ path, commitSha });
  }

  return { ok: true, commitSha: commits[0]?.commitSha || null, files: commits };
}
