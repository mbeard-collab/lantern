# Lantern data pipeline

Queries CrateDB, optionally generates a Claude narrative, and commits
`<slug>/data.json` to the site so dashboards refresh automatically.

## Prerequisites

- Node.js 18+
- Network access to CrateDB (your machine must be on the allowlist)
- A Studio admin account (for committing)
- An Anthropic API key (for narrative generation)

## Setup

Copy `.env.example` to `.env` and fill in the values:

```
cp _pipeline/.env.example _pipeline/.env
# edit _pipeline/.env
```

`.env` is gitignored — never commit it.

## Running

```bash
# Dry run — print the data.json payload to stdout, commit nothing
node _pipeline/refresh.mjs renewal-manager-dashboard --dry-run --no-narrative

# Local test — write <slug>/data.json to the working tree, for use with netlify dev
node _pipeline/refresh.mjs renewal-manager-dashboard --local --no-narrative

# Full run — commit data.json to GitHub, trigger Netlify deploy
node _pipeline/refresh.mjs renewal-manager-dashboard
```

## Adding a new live dashboard

1. Create `_pipeline/queries/<slug>.mjs` exporting a default `async function({ query })` that returns the data payload.
2. Add `live: true` to the dashboard's entry in the root `index.html` `DASHBOARDS` array.
3. Test with `--dry-run --no-narrative`, then `--local`, then a full run.

## Data contract

Every `data.json` the pipeline writes has this shape:

```json
{
  "generated_at": "2026-08-17T23:00:00Z",
  "source": "cratedb",
  "slug": "renewal-manager-dashboard",
  "narrative": "…3–5 sentences, or null",
  "data": { }
}
```

The dashboard fetches `./data.json` on load. On any failure it falls back to
its embedded data silently — a missing or stale `data.json` is never an error.

## Scheduling (macOS launchd)

> **Note:** This is a stopgap. The job should eventually move to a GovSpend-hosted
> scheduler. The only reason it runs from your laptop is that it needs CrateDB
> network access, and your machine is already on the allowlist.

Save this plist as `~/Library/LaunchAgents/com.govspend.lantern-refresh.plist`,
substituting your actual username:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.govspend.lantern-refresh</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOUR_USERNAME/lantern/_pipeline/refresh.mjs</string>
    <string>renewal-manager-dashboard</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USERNAME/lantern</string>

  <!-- Daily at 06:00 ET (11:00 UTC) -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>11</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>/tmp/lantern-refresh.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/lantern-refresh.log</string>

  <!-- Run the job if a scheduled firing was missed (e.g. laptop was asleep) -->
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
```

Load / unload / check:

```bash
# Load (starts scheduling immediately)
launchctl load ~/Library/LaunchAgents/com.govspend.lantern-refresh.plist

# Run once right now (for testing)
launchctl start com.govspend.lantern-refresh

# Check last exit status
launchctl list | grep lantern

# View logs
tail -f /tmp/lantern-refresh.log

# Unload (stops scheduling)
launchctl unload ~/Library/LaunchAgents/com.govspend.lantern-refresh.plist
```

**Note on missed runs:** launchd will not automatically retry a missed scheduled
firing (e.g. if the lid was closed at 6am). If consistent timing matters, enable
Power Nap in System Settings → Battery, which allows scheduled tasks to run while
the lid is closed on AC power. Otherwise, accept that daily runs may occasionally
be late.
