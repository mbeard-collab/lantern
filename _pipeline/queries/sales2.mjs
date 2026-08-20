// Pipeline query module for sales2/
// Builds live sales pipeline data from analytics.salesforceopportunity.
//
// GAPS vs the original sales dashboard — ask the original creator:
//   1. pushCount       — not in CrateDB; tracked in SF or computed from close-date history?
//   2. nextStep        — is this the SF standard NextStep field? Can it be added to the sync?
//   3. hasTrial        — stage history, platform trial table, or an SF field?
//   4. effectiveStartDate — custom SF field (e.g. Effective_Start_Date__c)?
//   5. Opportunity scores — Claude-generated daily? Or a fixed algorithm?
//   6. Quotas (REP/SDR/POD_YTD) — SF quota objects, a spreadsheet, or elsewhere?
//   7. SDR originator  — is there an Originator__r.Name field in SF?
//   8. Stage filter    — are the 5 stages below the complete set for new business?
//                        Do renewals ever appear in these stages?
//   9. PREV_RUN/deltas — is previous-run state stored somewhere, or rebuilt by Claude?

export const outputFile = 'sales_data.js';
export const formatOutput = (data) => `window.GS_SALES = ${JSON.stringify(data)};\n`;

// The five open-pipeline stages used in the original sales dashboard.
// QUESTION #8: Confirm these are the correct new-business stages.
const PIPELINE_STAGES = [
  'Opportunity Identified',
  'Demo/Needs Analysis',
  'Trial',
  'Proposal Sent/Negotiating',
  'Finalizing Contract',
];

const STAGE_LIST = PIPELINE_STAGES.map(s => `'${s}'`).join(',');

export default async function runQuery({ query }) {
  const today     = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const thisYear  = today.slice(0, 4);
  const prevYear  = String(Number(thisYear) - 1);
  const nowMs     = Date.now();

  const [pipelineRes, histCwRes] = await Promise.all([

    // All open pipeline opps (no close-date cutoff — include overdue)
    query(`
      SELECT
        "Id"                         AS id,
        "Name"                       AS name,
        "StageName"                  AS stage,
        "ACV2__c"                    AS acv,
        "CloseDate"                  AS close_date,
        "Owner"['Name']              AS owner,
        "LeadSource"                 AS lead_source,
        "LastStageChangeDate"        AS last_stage_change_ms
      FROM analytics.salesforceopportunity
      WHERE "StageName" IN (${STAGE_LIST})
        AND "IsDeleted" = false
      ORDER BY "CloseDate"
    `),

    // Closed Won by month — two full years of history
    query(`
      SELECT
        SUBSTRING("CloseDate", 1, 7)  AS month,
        SUM("ACV2__c")                AS acv,
        COUNT(*)                      AS deals
      FROM analytics.salesforceopportunity
      WHERE "StageName" = 'Closed Won'
        AND "CloseDate" >= ?
        AND "CloseDate" <= ?
        AND "IsDeleted" = false
      GROUP BY SUBSTRING("CloseDate", 1, 7)
      ORDER BY month
    `, [prevYear + '-01-01', today]),
  ]);

  // ---- Opps list -------------------------------------------------------
  const opps = pipelineRes.rows.map(r => ({
    id:    r.id,
    name:  r.name  || '',
    stage: r.stage,
    acv:   Number(r.acv) || 0,
    closeDate:  r.close_date  || '',
    owner: r.owner || '',
    leadSource: r.lead_source || '',
    daysSinceStageChange: r.last_stage_change_ms
      ? Math.floor((nowMs - Number(r.last_stage_change_ms)) / 86_400_000)
      : null,
  }));

  // ---- Pipeline aggregates ---------------------------------------------
  const byStage = {};
  for (const s of PIPELINE_STAGES) byStage[s] = { acv: 0, cnt: 0 };
  for (const o of opps) {
    if (byStage[o.stage]) {
      byStage[o.stage].acv += o.acv;
      byStage[o.stage].cnt++;
    }
  }

  // Pipeline by close month (open opps only)
  const byMonth = {};
  for (const o of opps) {
    const m = o.closeDate.slice(0, 7);
    if (!m) continue;
    if (!byMonth[m]) byMonth[m] = { acv: 0, cnt: 0 };
    byMonth[m].acv += o.acv;
    byMonth[m].cnt++;
  }

  // ---- Closed Won history ----------------------------------------------
  const histCw = {};
  for (const r of histCwRes.rows) {
    histCw[r.month] = { acv: Number(r.acv) || 0, deals: Number(r.deals) || 0 };
  }

  // ---- Top-level KPIs --------------------------------------------------
  const openPipelineAcv  = opps.reduce((s, o) => s + o.acv, 0);
  const activeDeals      = opps.length;

  const thisMonthKey = today.slice(0, 7);
  const cwThisMonth  = histCw[thisMonthKey] || { acv: 0, deals: 0 };

  let cwYtdAcv = 0, cwYtdDeals = 0;
  for (const [m, v] of Object.entries(histCw)) {
    if (m.startsWith(thisYear)) { cwYtdAcv += v.acv; cwYtdDeals += v.deals; }
  }

  return {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      today,
      pipelineStages: PIPELINE_STAGES,
    },
    kpis: {
      cwYtdAcv,
      cwYtdDeals,
      cwThisMonthAcv:   cwThisMonth.acv,
      cwThisMonthDeals: cwThisMonth.deals,
      openPipelineAcv,
      activeDeals,
    },
    histCw,
    byStage,
    byMonth,
    opps,
  };
}
