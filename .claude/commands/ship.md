# /ship

Commit a dashboard to the repo, push to GitHub, and verify the Netlify deploy fired. The user runs this when they're satisfied with a dashboard built via `/build-dashboard`.

## Usage

```
/ship <slug>
```

Examples:
- `/ship sales`
- `/ship ai-spend`

The slug must match a subfolder in the repo root.

## What this command does

### Step 1 — Validate

- Confirm `<slug>/index.html` exists and is non-trivial (more than a placeholder — file size > 5KB is a reasonable heuristic).
- Run `git status` to confirm there are uncommitted changes in `<slug>/index.html`. If there's nothing to commit, tell the user and stop.
- Check that the working directory is clean except for the dashboard files. If unrelated changes are staged, ask the user before bundling them in.

### Step 2 — Update the landing page registry

Open `index.html` at the repo root and locate the `DASHBOARDS` array near the bottom (inside the `<script>` block).

- If a dashboard entry with `id: "<slug>"` exists: update its `updated` field to `"today"`.
- If no entry exists (this is a brand-new dashboard):
  1. Ask the user for the section (`operational`, `intelligence`, `ai-cost`, or `reference`).
  2. Ask for the title, description (≤160 chars), owner, and cadence (`daily`, `weekly`, `ondemand`, `realtime`).
  3. Append a new entry to the `DASHBOARDS` array with `updated: "today"`.

### Step 3 — Commit and push

- Stage: `git add <slug>/index.html index.html`
- Commit message: `Update <slug> dashboard` for refreshes, or `Add <slug> dashboard` for new ones. Include a one-line body describing the change if it's substantive (e.g., "Adds Q2 win-rate chart and refreshes top displacement targets").
- Push: `git push origin main`

### Step 4 — Verify the Netlify deploy

After the push:

- Wait 10 seconds.
- Run `netlify deploys:list --json` (or `netlify status`) to confirm a new deploy was triggered. Look for one with `state: "building"` or `state: "ready"` newer than the push.
- If `netlify` CLI isn't available or returns an error, fall back to running `gh run list` to confirm the GitHub side fired, and tell the user to check Netlify's Deploys tab manually.
- Report the deploy's status and the live URL: `https://govspend-ops-dashboards.netlify.app/<slug>/`

### Step 5 — Final summary

Tell the user:

- What was committed (file paths)
- The commit hash
- The deploy status (building / ready / failed)
- The live URL for the dashboard
- A reminder: the deploy typically completes in 30 seconds. Refresh the URL to see the new version.

## Constraints

- **Never force-push.** If the push fails because the local branch is behind, tell the user and stop. They'll need to pull first.
- **Never commit without confirmation** if there are unrelated changes in `git status`. Ask before bundling them in.
- **Never modify any file other than** the dashboard's `<slug>/index.html` (already changed by `/build-dashboard`) and the root `index.html` (registry update). If other changes are needed, raise them with the user separately.
- **Don't commit secrets, API keys, or local-only files.** The `.gitignore` should already cover `.netlify/`, `.DS_Store`, etc., but eyeball the staged files before committing.
