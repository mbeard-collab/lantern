# Dashboards Site — Conventions for Claude Code

This repo hosts an internal dashboard hub for GovSpend, deployed to Netlify with continuous deploy from `main`. When you (Claude Code) help build or update a dashboard, follow the conventions below.

## What's in this repo

```
index.html               Landing page (the hub — has the DASHBOARDS registry)
README.txt               Human-facing notes for future maintainers
CLAUDE.md                This file
_template/
  dashboard.html         Reusable skeleton for new dashboards
.claude/
  commands/
    build-dashboard.md   Slash command: data file → styled HTML
    ship.md              Slash command: commit + push + verify deploy
<slug>/
  index.html             One folder per dashboard, e.g. sales/, renewals/
```

When a new dashboard is added, it gets its own subfolder with an `index.html`. The landing page links to `/<slug>/`.

## Existing dashboards

The full list lives in the `DASHBOARDS` array near the bottom of `index.html`. As of last update:

- `sales/` — Sales Dashboard (operational, daily)
- `renewals/` — Renewals (operational, daily, refreshed by Evan via python pipeline)
- `marketing/` — Marketing (operational, weekly)
- `customer-success/` — Customer Success (operational, weekly)
- `competitive/` — Competitive Analysis (intelligence, weekly)
- `agencies-po/` — Agencies with PO Data (intelligence, weekly)
- `ai-spend/` — AI Spend (AI & cost, daily)
- `token-usage/` — Token Usage (AI & cost, real-time)
- `news-feed/` — News Feed (reference, daily)
- `tech-completion/` — Tech Completion (reference, weekly)

## Design system

Every dashboard inherits the same dark aesthetic. **Do not invent new colors or fonts.** Stay inside this palette:

```css
--bg:        #0B0F17  /* page background */
--bg-elev:   #121826  /* card background */
--bg-elev-2: #1A2235  /* deeper card / nested surfaces */
--line:      #232C42  /* card and divider borders */
--text:      #E6EAF2  /* primary text */
--text-strong: #FFFFFF /* titles, KPI values */
--muted:     #8A93A6  /* secondary text, axis labels */
--muted-2:   #6B7488  /* tertiary text, footer */

/* Accents — use sparingly, one per chart series */
--accent:    #4DA3FF  /* blue, primary */
--accent-2:  #7C5CFF  /* purple, secondary */
--green:     #39D98A  /* positive deltas, "win" states */
--amber:     #F5B556  /* warning, "active" states */
--red:       #FF6B6B  /* negative deltas, "at risk" states */
```

**Typography:** `-apple-system, "SF Pro Text", "Inter", Segoe UI, system-ui, sans-serif`. Use tabular-nums for any column of numbers (`font-variant-numeric: tabular-nums`).

**Spacing rhythm:** Cards use 14–16px border-radius, 20–22px internal padding, 1px solid `--line` border.

**Charts:** Use Chart.js loaded from `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`. Default to:
- Line/area charts: `borderWidth: 1.8`, `pointRadius: 0`, `tension: 0.32`, fill with the same color at `1F` opacity
- Bar charts: `borderRadius: 6`, `barThickness: 22–28`
- Tooltips: dark background `#0B0F17`, border `#232C42`, padding 12, cornerRadius 8
- Grid lines: `rgba(255,255,255,0.04)` on Y axis only, hide X grid
- Axis ticks: color `--muted`

**Animations:** Subtle. Hover transitions on cards (`translateY(-2px)`, 0.18s ease). Avoid bouncy or attention-grabbing motion.

## Conventions for new dashboards

When generating a dashboard from data:

1. **Start from `_template/dashboard.html`.** Copy it to `<slug>/index.html`. Don't write HTML from scratch.

2. **Always include a back link** in the top-left: `← Back to all dashboards` pointing to `/`.

3. **The page title in the browser tab** should be `<Dashboard Name> — Dashboards` (e.g. `Sales — Dashboards`).

4. **KPI row at the top** if the data supports it. Four cards is the visual standard, three is acceptable, more than four crowds. KPIs should be the most "exec-skimmable" numbers.

5. **One main chart** below the KPIs — usually a trend or distribution that tells the headline story. Full width.

6. **Secondary charts or tables** below in a 2-column grid if needed. Keep the page scannable on a 1280px screen.

7. **Footer line** at the bottom with: data source, refresh cadence, owner. Same pattern as the landing page demo.

8. **Always add a freshness indicator** in the top-right of the main header — small green dot + "Refreshed Xm ago" badge. Use the timestamp of when the dashboard was generated.

## Updating the landing page

When a dashboard is created or substantively changed, update its entry in the `DASHBOARDS` array near the bottom of `index.html`:

- `updated`: set to `"today"` for fresh changes
- `description`: keep ≤ 160 chars, action-oriented
- `cadence`: one of `daily`, `weekly`, `ondemand`, `realtime`
- `section`: one of `tech-ops`, `operational`, `intelligence`, `ai-cost`, `reference`

If a brand-new dashboard is being added (not a refresh of an existing one), append a new object to the array with all fields populated.

## Asking the user before building

When `/build-dashboard` is invoked, **always ask clarifying questions before generating HTML**. At minimum:

1. Confirm the dashboard slug (e.g., is `sales` correct, or is this a new slug?).
2. Identify the columns and their meanings (don't guess from headers — confirm).
3. Ask which metrics should be the KPIs.
4. Ask what story the main chart should tell.
5. Ask the time grain if it's not obvious from the data.

The user has a strong design eye and prefers to iterate. After generating, expect at least 2–3 rounds of "change this, drop that, recolor the other." Don't over-engineer the first draft.

## Things not to do

- Don't add new chart libraries beyond Chart.js. No D3, no Plotly, no ECharts unless the user explicitly asks.
- Don't pull data from URLs at runtime in the browser — every dashboard is statically generated from data the user provides.
- Don't add tracking, analytics, or external scripts beyond Chart.js from the approved CDN.
- Don't change the landing page structure (top nav, sections) without asking. The four sections (Operational, Intelligence, AI & Cost, Reference) are intentional.
- Don't commit or push without an explicit `/ship` invocation. Generation is local-only until the user is happy.
