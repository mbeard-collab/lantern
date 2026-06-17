// Commits a dashboard HTML file (and optionally an updated root index.html
// with a new DASHBOARDS registry entry) to GitHub via the Contents API.
// Or deletes a dashboard. Hides GITHUB_TOKEN server-side.
//
// Auth: every request must include { auth: { email, password } } in the body.
// email must be in STUDIO_ADMINS (csv); password must equal STUDIO_ADMIN_PASSWORD.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const env = process.env;
  const missing = [];
  if (!env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  if (!env.GITHUB_REPO) missing.push("GITHUB_REPO");
  if (!env.STUDIO_ADMINS) missing.push("STUDIO_ADMINS");
  if (!env.STUDIO_ADMIN_PASSWORD) missing.push("STUDIO_ADMIN_PASSWORD");
  if (missing.length) {
    return json({ error: `Missing env vars: ${missing.join(", ")}` }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // ---- Auth gate (applies to every action) ---------------------------------
  const email = String(body?.auth?.email || "").trim().toLowerCase();
  const password = String(body?.auth?.password || "");
  const admins = env.STUDIO_ADMINS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!email || !admins.includes(email) || password !== env.STUDIO_ADMIN_PASSWORD) {
    return json({ error: "Not authorized" }, 401);
  }

  const action = body.action || "ship";

  // ---- auth-check: just confirm creds, do nothing --------------------------
  if (action === "auth-check") {
    return json({ ok: true, email });
  }

  // ---- Common GitHub helpers ----------------------------------------------
  const repo = env.GITHUB_REPO;
  const headers = {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "studio-commit",
  };
  const ghBase = `https://api.github.com/repos/${repo}/contents`;

  async function getSha(path) {
    const res = await fetch(`${ghBase}/${path}?ref=main`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
    return (await res.json()).sha;
  }

  async function putFile(path, content, message, sha) {
    const payload = {
      message,
      content: utf8ToBase64(content),
      branch: "main",
    };
    if (sha) payload.sha = sha;
    const res = await fetch(`${ghBase}/${path}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function deleteFile(path, message, sha) {
    const res = await fetch(`${ghBase}/${path}`, {
      method: "DELETE",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, sha, branch: "main" }),
    });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // ---- Validate slug (used by both ship and delete) ------------------------
  const slug = body.slug;
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return json({ error: "slug must be kebab-case (a-z, 0-9, hyphens)" }, 400);
  }

  // ---- DELETE action -------------------------------------------------------
  if (action === "delete") {
    if (typeof body.updatedIndexHtml !== "string") {
      return json({ error: "delete requires updatedIndexHtml (registry entry removed)" }, 400);
    }
    try {
      const dashboardPath = `${slug}/index.html`;
      const dashSha = await getSha(dashboardPath);
      if (!dashSha) return json({ error: `Dashboard "${slug}" does not exist on main` }, 404);

      const delMsg = `Delete ${slug} dashboard via Studio (by ${email})`;
      const delRes = await deleteFile(dashboardPath, delMsg, dashSha);

      const indexSha = await getSha("index.html");
      if (!indexSha) throw new Error("Root index.html not found");
      const indexRes = await putFile(
        "index.html",
        body.updatedIndexHtml,
        `Unregister ${slug} from DASHBOARDS (by ${email})`,
        indexSha,
      );

      return json({
        ok: true,
        deletedCommitSha: delRes.commit?.sha || null,
        indexCommitSha: indexRes.commit?.sha || null,
      });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  // ---- SHIP action (default) ----------------------------------------------
  const { html, commitMessage, isNew, updatedIndexHtml, dataFiles } = body;
  if (typeof html !== "string" || !html.includes("<html") || !html.includes("</html>")) {
    return json({ error: "html must be a complete HTML document" }, 400);
  }
  if (isNew && typeof updatedIndexHtml !== "string") {
    return json({ error: "isNew requires updatedIndexHtml" }, 400);
  }

  // Optional companion files committed into the dashboard folder alongside
  // index.html (e.g. a data.json the HTML fetches, or a sibling app.js/styles.css).
  // Text only — putFile base64-encodes UTF-8, which would corrupt binary formats.
  const ALLOWED_DATA_EXT = new Set([
    "json", "csv", "tsv", "txt", "geojson", "svg", "md", "js", "mjs", "css",
  ]);
  const cleanDataFiles = [];
  if (dataFiles != null) {
    if (!Array.isArray(dataFiles)) {
      return json({ error: "dataFiles must be an array" }, 400);
    }
    for (const f of dataFiles) {
      const name = String(f?.name || "").trim();
      // Relative path under the dashboard folder: no leading slash, no traversal.
      if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(name) || name.split("/").includes("..")) {
        return json({ error: `Invalid data file name: ${JSON.stringify(f?.name)}` }, 400);
      }
      const ext = name.split(".").pop().toLowerCase();
      if (!ALLOWED_DATA_EXT.has(ext)) {
        return json({ error: `Data file "${name}" must end in one of: ${[...ALLOWED_DATA_EXT].join(", ")}` }, 400);
      }
      if (typeof f.content !== "string") {
        return json({ error: `Data file "${name}" content must be a string` }, 400);
      }
      cleanDataFiles.push({ name, content: f.content });
    }
  }

  try {
    const dashboardPath = `${slug}/index.html`;
    const existingSha = await getSha(dashboardPath);

    if (isNew && existingSha) {
      return json(
        { error: `Dashboard slug "${slug}" already exists. Pick a new slug or update the existing one.` },
        409,
      );
    }

    const baseMsg = commitMessage || (existingSha ? `Update ${slug} dashboard` : `Add ${slug} dashboard`);
    const dashboardMsg = `${baseMsg} via Studio (by ${email})`;
    const dashRes = await putFile(dashboardPath, html, dashboardMsg, existingSha);

    // Commit each companion data file into the dashboard folder.
    const dataCommits = [];
    for (const df of cleanDataFiles) {
      const dfPath = `${slug}/${df.name}`;
      const dfSha = await getSha(dfPath);
      const dfRes = await putFile(
        dfPath,
        df.content,
        `${dfSha ? "Update" : "Add"} ${dfPath} via Studio (by ${email})`,
        dfSha,
      );
      dataCommits.push({ path: dfPath, commitSha: dfRes.commit?.sha || null });
    }

    let indexCommitSha = null;
    if (isNew) {
      const indexSha = await getSha("index.html");
      if (!indexSha) throw new Error("Root index.html not found — cannot register dashboard");
      const indexRes = await putFile(
        "index.html",
        updatedIndexHtml,
        `Register ${slug} in DASHBOARDS (by ${email})`,
        indexSha,
      );
      indexCommitSha = indexRes.commit?.sha || null;
    }

    return json({
      ok: true,
      commitSha: dashRes.commit?.sha || null,
      indexCommitSha,
      dataFiles: dataCommits,
      deployUrl: `https://govspend-ops-dashboards.netlify.app/${slug}/`,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

function utf8ToBase64(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
