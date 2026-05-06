# /build-dashboard

Generate a styled HTML dashboard from a data file (CSV, XLSX, or JSON) using the shared template.

## Usage

```
/build-dashboard <slug> <path-to-data-file>
```

Examples:
- `/build-dashboard sales _data/sales-q2.csv`
- `/build-dashboard ai-spend ~/Downloads/ai-vendors.xlsx`
- `/build-dashboard new-dashboard data.json`

## What this command does

You are helping the user turn a data file into a styled dashboard for the GovSpend internal dashboard hub. Read `CLAUDE.md` at the repo root before starting if you haven't already — it has the design system, conventions, and constraints.

### Step 1 — Validate inputs

- Confirm the data file at `<path-to-data-file>` exists and is readable.
- If the file is XLSX, use `python3 -c "import pandas as pd; print(pd.read_excel('<path>').head())"` (install pandas with `pip install pandas openpyxl --break-system-packages` if needed). For CSV, read directly. For JSON, parse and confirm structure.
- Determine if `<slug>/` is an existing dashboard subfolder. If yes, the existing `index.html` will be **replaced** — confirm with the user before doing so.
- If `<slug>/` doesn't exist, this is a brand-new dashboard. Note that the landing page registry will need a new entry too (handle this in step 5).

### Step 2 — Inspect the data and ask clarifying questions

Print a brief summary of what's in the file: column names, row count, sample rows, inferred types. Then ask the user:

1. **What should the four KPIs be?** Suggest candidates based on the columns, but confirm. Sometimes the right KPI is a derived metric (sum, average, count distinct), not a raw column.
2. **What story should the main chart tell?** Time series of one metric? Distribution across a category? Comparison? Suggest the most visually compelling option for the data shape, but ask.
3. **Time grain** — daily, weekly, monthly? Only relevant if there's a date column.
4. **Owner and refresh cadence** — for the footer line. If the slug is one of the existing dashboards listed in `CLAUDE.md`, reuse the metadata from there. Otherwise ask.
5. **Anything to specifically include or exclude?**

Wait for the user's answers before generating HTML. Don't guess.

### Step 3 — Generate the dashboard

- Read `_template/dashboard.html`.
- Substitute every `__PLACEHOLDER__` with the appropriate value derived from the data and the user's answers.
- Replace the placeholder `[]` arrays in the `<script>` with the actual data series, formatted as JavaScript array literals.
- If the data doesn't support four KPIs, drop down to three or two — don't pad with junk metrics.
- If a section (secondary chart, table, tertiary chart) doesn't make sense for this data, **remove it entirely** rather than leaving placeholder content.
- Keep the design system intact: only use colors from the palette in `CLAUDE.md`, only use Chart.js, only use the typography defined in the template.

Write the result to `<slug>/index.html`, overwriting the placeholder if there is one.

### Step 4 — Open for review

- Tell the user the file path of the new dashboard.
- Suggest they open it locally in a browser (`open <slug>/index.html` on macOS) to preview.
- Ask: "What needs to change?" — expect 2–3 rounds of iteration. Common requests will be color tweaks, KPI swaps, chart type changes, and adding/removing sections. Make changes in place and confirm each round.

### Step 5 — Don't ship yet

Stop here. **Do not commit or push.** The user runs `/ship <slug>` separately when they're satisfied with the dashboard. That command handles the landing-page registry update, commit, push, and deploy verification.

If this is a brand-new dashboard (no folder existed before this command ran), remind the user that `/ship` will need to add it to the `DASHBOARDS` registry on the landing page — `/ship` handles that automatically, but the user should know.

## Constraints

- **Never invent data.** If a column meaning is ambiguous, ask. Don't assume "revenue" means "ARR" or that "users" means "DAU."
- **Stay inside the design system.** No new colors, fonts, or chart libraries. If something feels visually limiting, raise it with the user — don't silently invent.
- **Preserve the template's structure.** Each section (KPIs, main chart, secondary, table) is optional, but the order and the back link / freshness header are not.
- **The user has design taste.** Generate a strong v1, expect to iterate. Don't over-engineer the first pass.
