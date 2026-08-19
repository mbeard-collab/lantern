// Query module for renewal-manager-dashboard.
//
// DATA GAPS — items the current dashboard shows that cannot be sourced from
// doc.salesforceopportunity + doc.salesforceaccount as described:
//
// BLOCKER (needs answer from Veer before drilldowns work):
//   - account name: salesforceaccount has no Name column. Every per-account row
//     in the dashboard shows a company name. We have AccountId only.
//   - health: Health_Score__c or equivalent not in the schema. All health badges
//     and the entire Usage Health section of each manager page cannot be populated.
//   - cpau / cph: Calculated from a product usage data source (active users,
//     query counts in a rolling 60-day window). Not in CrateDB's SF mirror.
//   - loss_reason: Custom picklist field (Churn_Reason__c or similar) not listed.
//   - notes: Free-text loss notes field not listed.
//   - amount (total contract value): Only ACV2__c is available. The dashboard uses
//     both `amount` (total multi-year TCV) and `acv` (annual). We produce ACV only;
//     the "Won ARR" KPI will be ACV-based and may differ from the hardcoded $2.80M.
//
// ASSUMPTION:
//   - RecordType and Type are not in the schema. We proxy "renewal opportunities"
//     by filtering to the three known renewal manager names. This is fragile —
//     replace with RecordType='Renewal' filter once the column is confirmed.
//
// WHAT THIS QUERY DOES PRODUCE:
//   - Manager-level totals: won / lost / open counts and won ACV
//   - Stage distribution per manager
//   - Monthly trends (won / lost / open counts and won ACV) per manager
//   - Team-level aggregates
//   - Contract changes: prior-year vs. current-year ACV by AccountId (no name)

const RENEWAL_MANAGERS = ['Alexis Shaw', 'Natasha Martinez', 'Steven Goldberg'];
const YEAR = '2026';

export default async function runQuery({ query }) {
  const [oppsResult, changesResult] = await Promise.all([
    queryOpportunities(query),
    queryContractChanges(query),
  ]);

  return buildPayload(oppsResult.rows, changesResult.rows);
}

async function queryOpportunities(query) {
  return query(
    `SELECT
       "Owner"['Name']        AS manager,
       "StageName"            AS stage,
       "CloseDate"            AS close_date,
       "ACV2__c"              AS acv,
       "AccountId"            AS account_id,
       "LastStageChangeDate"  AS last_stage_change
     FROM doc.salesforceopportunity
     WHERE "IsDeleted" = false
       AND "CloseDate" >= ?
       AND "CloseDate" <= ?
     ORDER BY "CloseDate"`,
    [`${YEAR}-01-01`, `${YEAR}-12-31`],
  );
}

async function queryContractChanges(query) {
  // Self-join: find 2026 Closed Won deals paired with the same account's most
  // recent 2025 Closed Won deal. Gives us prior vs. current ACV for the
  // contract changes section (account names still missing — see BLOCKER above).
  return query(
    `SELECT
       curr."AccountId"       AS account_id,
       curr."Owner"['Name']   AS manager,
       curr."CloseDate"       AS close_date,
       curr."ACV2__c"         AS current_acv,
       prev."ACV2__c"         AS prior_acv,
       prev."CloseDate"       AS prior_close_date
     FROM doc.salesforceopportunity curr
     LEFT JOIN doc.salesforceopportunity prev
       ON  curr."AccountId"  = prev."AccountId"
       AND prev."StageName"  = 'Closed Won'
       AND prev."IsDeleted"  = false
       AND prev."CloseDate"  >= ?
       AND prev."CloseDate"  <  ?
     WHERE curr."IsDeleted"  = false
       AND curr."StageName"  = 'Closed Won'
       AND curr."CloseDate"  >= ?
       AND curr."CloseDate"  <= ?
     ORDER BY curr."CloseDate"`,
    ['2025-01-01', `${YEAR}-01-01`, `${YEAR}-01-01`, `${YEAR}-12-31`],
  );
}

function buildPayload(opps, changes) {
  // Filter to known renewal managers (proxy for RecordType=Renewal — see note above).
  const renewalOpps = opps.filter(r => RENEWAL_MANAGERS.includes(r.manager));

  const managers = {};
  for (const mgr of RENEWAL_MANAGERS) {
    managers[mgr] = buildManagerData(renewalOpps.filter(r => r.manager === mgr));
  }

  const teamTotals = RENEWAL_MANAGERS.reduce(
    (acc, mgr) => {
      const t = managers[mgr].totals;
      acc.total  += t.total;
      acc.won    += t.won;
      acc.lost   += t.lost;
      acc.open   += t.open;
      acc.won_acv += t.won_acv;
      return acc;
    },
    { total: 0, won: 0, lost: 0, open: 0, won_acv: 0 },
  );
  teamTotals.win_rate = winRate(teamTotals.won, teamTotals.lost);

  const contractChanges = buildContractChanges(
    changes.filter(r => RENEWAL_MANAGERS.includes(r.manager)),
  );

  return {
    managers,
    team_totals: teamTotals,
    contract_changes: contractChanges,
    data_gaps: [
      'account_name: salesforceaccount has no Name column — drilldown modals show AccountId only',
      'health: Health_Score__c not in CrateDB schema',
      'cpau: requires product usage data table',
      'cph: requires product usage data table',
      'loss_reason: custom picklist not in schema',
      'notes: loss notes field not in schema',
      'amount: only ACV2__c available (won_acv here = ACV, not total contract value)',
    ],
  };
}

function buildManagerData(opps) {
  const today = new Date().toISOString().slice(0, 10);

  const stages = {};
  const monthly = {};

  for (const o of opps) {
    // Stage aggregation
    if (!stages[o.stage]) stages[o.stage] = { count: 0, total_acv: 0 };
    stages[o.stage].count++;
    stages[o.stage].total_acv += o.acv || 0;

    // Monthly aggregation (keyed by YYYY-MM)
    const month = (o.close_date || '').slice(0, 7);
    if (!month) continue;
    if (!monthly[month]) monthly[month] = { won: 0, lost: 0, open: 0, won_acv: 0 };
    if (o.stage === 'Closed Won')  { monthly[month].won++;  monthly[month].won_acv += o.acv || 0; }
    else if (o.stage === 'Closed Lost') { monthly[month].lost++; }
    else if (o.close_date > today) { monthly[month].open++; }
  }

  const won   = opps.filter(o => o.stage === 'Closed Won').length;
  const lost  = opps.filter(o => o.stage === 'Closed Lost').length;
  const open  = opps.filter(o => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length;
  const wonAcv = opps.filter(o => o.stage === 'Closed Won').reduce((s, o) => s + (o.acv || 0), 0);

  return {
    totals: {
      total: opps.length,
      won,
      lost,
      open,
      won_acv: wonAcv,
      win_rate: winRate(won, lost),
      avg_deal_acv: won > 0 ? Math.round(wonAcv / won) : 0,
    },
    stages,
    monthly,
  };
}

function buildContractChanges(rows) {
  return rows
    .filter(r => r.prior_acv != null)
    .map(r => {
      const pct = r.prior_acv > 0
        ? Math.round(((r.current_acv - r.prior_acv) / r.prior_acv) * 1000) / 10
        : null;
      return {
        account_id:   r.account_id,   // NOTE: no account name — see BLOCKER above
        manager:      r.manager,
        close_date:   r.close_date,
        current_acv:  r.current_acv,
        prior_acv:    r.prior_acv,
        pct,
        type: pct == null ? null : pct > 0 ? 'expansion' : pct < 0 ? 'contraction' : 'flat',
      };
    });
}

function winRate(won, lost) {
  const decided = won + lost;
  return decided > 0 ? Math.round((won / decided) * 1000) / 10 : null;
}
