// Pipeline query module for usage-data/
// Produces window.GS_DATA in the exact shape usage-data/index.html expects.

const DAYS = 90;

// refresh.mjs reads these exports to know how to write the output.
export const outputFile = 'usage_data.js';
export const formatOutput = (data) => `window.GS_DATA = ${JSON.stringify(data)};\n`;

export default async function runQuery({ query }) {
  // ---- 1. Date window -------------------------------------------------
  const { rows: [maxRow] } = await query(
    `SELECT MAX(day) as maxday FROM analytics.usage_org_daily`,
  );
  const maxDay = maxRow.maxday;
  const minDay = maxDay - DAYS * 86_400_000;

  // ---- 2. All queries in parallel --------------------------------------
  const [
    portfolioRes,
    orgRes,
    orgUserCountRes,
    orgWeeklyRes,
    userRes,
    userWeeklyRes,
    ownerWeeklyRes,
    ownerFeatureRes,
  ] = await Promise.all([

    // Daily portfolio totals (paying vs trial, three modules)
    query(`
      SELECT
        day,
        SUM(CASE WHEN NOT is_trial THEN core ELSE 0 END) AS cp,
        SUM(CASE WHEN NOT is_trial THEN ai   ELSE 0 END) AS ap,
        SUM(CASE WHEN NOT is_trial THEN opp  ELSE 0 END) AS op,
        SUM(CASE WHEN     is_trial THEN core ELSE 0 END) AS ct,
        SUM(CASE WHEN     is_trial THEN ai   ELSE 0 END) AS at,
        SUM(CASE WHEN     is_trial THEN opp  ELSE 0 END) AS ot,
        COUNT(DISTINCT CASE WHEN core > 0 OR ai > 0 OR opp > 0 THEN organization END) AS n
      FROM analytics.usage_org_daily
      WHERE day >= ?
      GROUP BY day
      ORDER BY day
    `, [minDay]),

    // Org list: one row per org with latest metadata
    query(`
      SELECT
        organization,
        "Customer"    AS c,
        "Owner Name"  AS o,
        MAX("ACV")    AS acv
      FROM analytics.usage_org_daily
      WHERE day >= ?
      GROUP BY organization, "Customer", "Owner Name"
      ORDER BY "Customer"
    `, [minDay]),

    // User count per org (for orgs[].nu)
    query(`
      SELECT organization, COUNT(DISTINCT "User Email") AS nu
      FROM analytics.usage_user_daily
      WHERE day >= ?
      GROUP BY organization
    `, [minDay]),

    // Org weekly usage — sparse; only rows with any activity
    query(`
      SELECT
        organization,
        date_trunc('week', day) AS week,
        SUM(core) AS c,
        SUM(ai)   AS a,
        SUM(opp)  AS p
      FROM analytics.usage_org_daily
      WHERE day >= ?
      GROUP BY organization, date_trunc('week', day)
      HAVING SUM(core) + SUM(ai) + SUM(opp) > 0
      ORDER BY organization, week
    `, [minDay]),

    // User list: one row per email with latest metadata
    query(`
      SELECT
        "User Email"                              AS e,
        MAX("firstName") || ' ' || MAX("lastName") AS n,
        MAX("Customer")                           AS c,
        MAX("Owner Name")                         AS o
      FROM analytics.usage_user_daily
      WHERE day >= ?
      GROUP BY "User Email"
      ORDER BY n
    `, [minDay]),

    // User weekly usage — sparse
    query(`
      SELECT
        "User Email"            AS e,
        date_trunc('week', day) AS week,
        SUM(core) AS c,
        SUM(ai)   AS a,
        SUM(opp)  AS p
      FROM analytics.usage_user_daily
      WHERE day >= ?
      GROUP BY "User Email", date_trunc('week', day)
      HAVING SUM(core) + SUM(ai) + SUM(opp) > 0
      ORDER BY e, week
    `, [minDay]),

    // Owner weekly usage
    query(`
      SELECT
        "Owner Name"            AS o,
        date_trunc('week', day) AS w,
        SUM(core) AS c,
        SUM(ai)   AS a,
        SUM(opp)  AS p
      FROM analytics.usage_org_daily
      WHERE day >= ?
      GROUP BY "Owner Name", date_trunc('week', day)
      ORDER BY o, w
    `, [minDay]),

    // Owner feature breakdown (AI panels, notebooks, search, opp, CRM)
    // Joins feature rolling table to owner via org → usage_org_daily mapping
    query(`
      WITH org_owners AS (
        SELECT organization, MAX("Owner Name") AS owner_name
        FROM analytics.usage_org_daily
        WHERE day >= ?
        GROUP BY organization
      )
      SELECT
        oo.owner_name                                AS o,
        SUM(f."AI_Panel_Rolling_30_Days__c")         AS panel,
        SUM(f."AI_Notebook_Rolling_30_Days__c")      AS notebook,
        SUM(f."AI_Search_Rolling_30_Days__c")        AS search,
        SUM(f."Opportunity_Rolling_30_Days__c")      AS opp,
        SUM(f."CRM_Rolling_30_Days__c")              AS crm
      FROM analytics.usage_org_feature_rolling f
      JOIN org_owners oo ON f.organization = oo.organization
      WHERE NOT f.trial
      GROUP BY oo.owner_name
      ORDER BY oo.owner_name
    `, [minDay]),
  ]);

  // ---- 3. Build index maps ------------------------------------------
  const orgs = orgRes.rows;
  const orgIdxMap  = new Map(orgs.map((r, i) => [r.organization, i]));
  const orgNuMap   = new Map(orgUserCountRes.rows.map(r => [r.organization, Number(r.nu)]));

  const orgsOut = orgs.map(r => ({
    c:   r.c   || '',
    o:   r.o   || '',
    acv: Number(r.acv) || 0,
    nu:  orgNuMap.get(r.organization) || 0,
  }));

  const users = userRes.rows;
  const userIdxMap = new Map(users.map((r, i) => [r.e, i]));
  const usersOut = users.map(r => ({ n: r.n || '', e: r.e || '', c: r.c || '', o: r.o || '' }));

  // Weeks: all unique week-start timestamps seen in orgWeekly
  const weekSet = new Set(orgWeeklyRes.rows.map(r => r.week));
  // Also include any weeks from userWeekly to keep them aligned
  for (const r of userWeeklyRes.rows) weekSet.add(r.week);
  const weeks = Array.from(weekSet).sort((a, b) => a - b);
  const weekIdxMap = new Map(weeks.map((w, i) => [w, i]));

  // Days: all unique day timestamps present in portfolio query
  const days = portfolioRes.rows.map(r => r.day);

  // ---- 4. Assemble portfolio ----------------------------------------
  const portfolio = portfolioRes.rows.map(r => ({
    d:  r.day,
    cp: Math.round(r.cp || 0),
    ap: Math.round(r.ap || 0),
    op: Math.round(r.op || 0),
    ct: Math.round(r.ct || 0),
    at: Math.round(r.at || 0),
    ot: Math.round(r.ot || 0),
    n:  Number(r.n) || 0,
  }));

  // ---- 5. Sparse weekly tuples --------------------------------------
  const orgWeekly = [];
  for (const r of orgWeeklyRes.rows) {
    const oi = orgIdxMap.get(r.organization);
    const wi = weekIdxMap.get(r.week);
    if (oi !== undefined && wi !== undefined) {
      orgWeekly.push([oi, wi, Math.round(r.c), Math.round(r.a), Math.round(r.p)]);
    }
  }

  const userWeekly = [];
  for (const r of userWeeklyRes.rows) {
    const ui = userIdxMap.get(r.e);
    const wi = weekIdxMap.get(r.week);
    if (ui !== undefined && wi !== undefined) {
      userWeekly.push([ui, wi, Math.round(r.c), Math.round(r.a), Math.round(r.p)]);
    }
  }

  // ---- 6. Owner structures -----------------------------------------
  const ownerWeekly = ownerWeeklyRes.rows
    .filter(r => r.o)
    .map(r => ({ o: r.o, w: r.w, c: Math.round(r.c), a: Math.round(r.a), p: Math.round(r.p) }));

  const ownerSet = new Set(orgsOut.map(r => r.o).filter(Boolean));
  const owners = Array.from(ownerSet).sort();

  const ownerFeature = ownerFeatureRes.rows.map(r => ({
    o:        r.o       || '',
    panel:    Number(r.panel)    || 0,
    notebook: Number(r.notebook) || 0,
    search:   Number(r.search)   || 0,
    opp:      Number(r.opp)     || 0,
    crm:      Number(r.crm)     || 0,
  }));

  // ---- 7. Meta -------------------------------------------------------
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  return {
    meta: {
      generatedAt,
      minDay,
      maxDay,
      source: `Full active set · ${orgsOut.length.toLocaleString()} orgs · ${usersOut.length.toLocaleString()} users · weekly buckets`,
    },
    days,
    weeks,
    owners,
    portfolio,
    ownerWeekly,
    ownerFeature,
    orgs:      orgsOut,
    orgWeekly,
    users:     usersOut,
    userWeekly,
  };
}
