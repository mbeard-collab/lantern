// Voting endpoints: vote (public), aggregate (public), ballots (admin),
// update-items (admin → commits items.json to repo).
//
// Routes (via netlify.toml redirects):
//   GET  /api/voting/aggregate?pollId=...
//   POST /api/voting/vote              { pollId, voter, voter_email, votes }
//   POST /api/voting/ballots           { pollId, auth }                  → admin
//   POST /api/voting/update-items      { pollId, items_json, auth }       → admin

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const pathAction = url.pathname.split("/").pop() || "";

  if (req.method === "GET") {
    if (pathAction === "aggregate") return aggregate(url.searchParams.get("pollId"));
    if (pathAction === "votecheck") return voteCheck(url.searchParams.get("pollId"), url.searchParams.get("email"));
    return json({ error: "Unknown GET action" }, 400);
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (pathAction === "vote") return vote(body);

  // ---- Admin-only from here ------------------------------------------------
  const authResult = await checkAuth(body.auth);
  if (!authResult.ok) return json({ error: "Not authorized" }, 401);

  if (pathAction === "ballots") return listBallots(body.pollId);
  if (pathAction === "update-items") return updateItems(body, authResult.email);

  return json({ error: "Unknown action" }, 400);
};

// ---- Handlers ---------------------------------------------------------------

async function vote(body) {
  const { pollId, voter, voter_email, votes, item_count } = body;
  if (!pollId || !voter || !voter_email || !votes || typeof votes !== "object") {
    return json({ error: "Missing fields (pollId, voter, voter_email, votes required)" }, 400);
  }
  const emailNorm = String(voter_email).trim().toLowerCase();
  if (!emailNorm.includes("@")) return json({ error: "Invalid email" }, 400);

  const store = getStore("voting");
  const key = `${pollId}:ballot:${emailNorm}`;
  const record = {
    voter: String(voter).trim(),
    voter_email: emailNorm,
    voted_at: new Date().toISOString(),
    item_count: item_count || Object.keys(votes).length,
    votes,
  };
  await store.setJSON(key, record);
  return json({ ok: true, voted_at: record.voted_at });
}

async function voteCheck(pollId, email) {
  if (!pollId || !email) return json({ ok: true, ballot: null });
  const store = getStore("voting");
  const key = `${pollId}:ballot:${String(email).trim().toLowerCase()}`;
  const ballot = await store.get(key, { type: "json" });
  return json({ ok: true, ballot });
}

async function aggregate(pollId) {
  if (!pollId) return json({ error: "pollId required" }, 400);
  const ballots = await loadBallots(pollId);

  const stats = {};            // { itemKey: { sum, count, distribution, skipCount } }
  const voters = [];           // [{ voter, voter_email, voted_at }]

  for (const b of ballots) {
    voters.push({ voter: b.voter, voter_email: b.voter_email, voted_at: b.voted_at });
    for (const [itemKey, v] of Object.entries(b.votes || {})) {
      if (!stats[itemKey]) stats[itemKey] = { sum: 0, count: 0, skipCount: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      if (v === "skip") { stats[itemKey].skipCount++; continue; }
      if (v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 5) continue;
      stats[itemKey].sum += n;
      stats[itemKey].count++;
      stats[itemKey].distribution[n] = (stats[itemKey].distribution[n] || 0) + 1;
    }
  }

  const results = Object.entries(stats).map(([key, s]) => ({
    key,
    average: s.count > 0 ? +(s.sum / s.count).toFixed(2) : null,
    count: s.count,
    skip_count: s.skipCount,
    distribution: s.distribution,
  }));

  return json({
    ok: true,
    poll_id: pollId,
    voter_count: voters.length,
    voters_anonymized: voters.map(v => ({ voted_at: v.voted_at })),  // public aggregate hides names
    results,
  });
}

async function listBallots(pollId) {
  if (!pollId) return json({ error: "pollId required" }, 400);
  const ballots = await loadBallots(pollId);
  return json({ ok: true, poll_id: pollId, ballot_count: ballots.length, ballots });
}

async function updateItems(body, adminEmail) {
  const { pollId, items_json } = body;
  if (!pollId || typeof items_json !== "string") {
    return json({ error: "pollId and items_json (string) required" }, 400);
  }
  // Validate JSON parses + has the expected shape.
  let parsed;
  try { parsed = JSON.parse(items_json); } catch (e) {
    return json({ error: `Invalid JSON: ${e.message}` }, 400);
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    return json({ error: "JSON must have an `items` array at the top level" }, 400);
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return json({ error: "GITHUB_TOKEN and GITHUB_REPO must be configured" }, 500);

  const path = `voting/${pollId}/items.json`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "voting-update",
  };
  const ghBase = `https://api.github.com/repos/${repo}/contents/${path}`;

  // Get current SHA if file exists.
  let sha = null;
  const getRes = await fetch(`${ghBase}?ref=main`, { headers });
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
  } else if (getRes.status !== 404) {
    return json({ error: `Could not read current items.json: ${getRes.status}` }, 500);
  }

  // PUT the new content.
  const payload = {
    message: `Update voting items for ${pollId} (by ${adminEmail})`,
    content: Buffer.from(items_json, "utf-8").toString("base64"),
    branch: "main",
    ...(sha && { sha }),
  };
  const putRes = await fetch(ghBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!putRes.ok) {
    return json({ error: `GitHub commit failed: ${putRes.status} ${await putRes.text()}` }, 500);
  }
  const data = await putRes.json();
  return json({ ok: true, commitSha: data.commit?.sha || null, itemCount: parsed.items.length });
}

// ---- Helpers ----------------------------------------------------------------

async function loadBallots(pollId) {
  const store = getStore("voting");
  const { blobs } = await store.list({ prefix: `${pollId}:ballot:` });
  const items = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

async function checkAuth(auth) {
  const email = String(auth?.email || "").trim().toLowerCase();
  const password = String(auth?.password || "");
  const adminsRaw = process.env.STUDIO_ADMINS || "";
  const adminPassword = process.env.STUDIO_ADMIN_PASSWORD || "";
  if (!adminsRaw || !adminPassword) return { ok: false };
  const admins = adminsRaw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!email || !admins.includes(email) || password !== adminPassword) return { ok: false };
  return { ok: true, email };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
