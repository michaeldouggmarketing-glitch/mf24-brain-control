const DEFAULT_URL = 'https://xjksqwlidkhvobiklisi.supabase.co';

function config() {
  const url = process.env.MF24_PROD_URL || DEFAULT_URL;
  const key = process.env.MF24_PROD_SERVICE_ROLE_KEY;
  if (!key) throw Object.assign(new Error('mf24_prod_service_role_not_configured'), {status:503});
  return {url, key};
}

async function rest(path, {select='*', filters={}, limit=1000, count=false, fetchImpl=fetch} = {}) {
  const {url,key} = config();
  const params = new URLSearchParams({select});
  for (const [name,value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) params.append(name, String(value));
  }
  params.set('limit', String(Math.min(Math.max(Number(limit)||1,1),5000)));
  const response = await fetchImpl(`${url}/rest/v1/${path}?${params}`, {
    headers:{apikey:key, authorization:`Bearer ${key}`, ...(count ? {prefer:'count=exact'} : {})},
    signal:AbortSignal.timeout(9000),
  });
  if (!response.ok) throw Object.assign(new Error('mf24_prod_read_failed'), {status:502, upstreamStatus:response.status});
  const rows = await response.json();
  const range = response.headers?.get?.('content-range') || '';
  const exact = range.includes('/') ? Number(range.split('/').pop()) : null;
  return {rows:Array.isArray(rows) ? rows : [], count:Number.isFinite(exact) ? exact : null};
}

async function exactCount(table, select) {
  const out = await rest(table, {select, limit:1, count:true});
  return out.count ?? out.rows.length;
}

function groupTransactionTotals(rows) {
  const totals = {};
  for (const row of rows) {
    const direction = String(row.direction || 'unknown');
    const currency = String(row.currency || 'BRL').toUpperCase();
    const key = `${direction}:${currency}`;
    if (!totals[key]) totals[key] = {direction,currency,count:0,amount_minor:0};
    totals[key].count += 1;
    totals[key].amount_minor += Number(row.amount_minor || 0);
  }
  return Object.values(totals);
}

export async function getMF24ProductionSnapshot({today = new Date().toISOString().slice(0,10)} = {}) {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = since.toISOString().slice(0,10);
  const [identities,workspaces,members,messages,sessions,commitments,entitlements,grants,txCount,recent] = await Promise.all([
    exactCount('mf24_identities','user_id'),
    exactCount('mf24_workspaces','space_id'),
    exactCount('mf24_workspace_members','user_id'),
    exactCount('mf24_conversation_messages','id'),
    exactCount('mf24_assistant_sessions','id'),
    exactCount('mf24_financial_commitments','id'),
    exactCount('mf24_product_entitlements','id'),
    exactCount('mf24_product_grants','id'),
    exactCount('mf24_ledger_transactions','transaction_id'),
    rest('mf24_ledger_transactions', {
      select:'direction,amount_minor,currency,occurred_at,status',
      filters:{occurred_at:`gte.${sinceDate}`},
      limit:5000,
    }),
  ]);
  return {
    source:'mf24_prod_read_only',
    generated_at:new Date().toISOString(),
    window:{from:sinceDate,to:today},
    counts:{identities,workspaces,members,messages,sessions,commitments,entitlements,grants,transactions:txCount},
    finance:{recent_transactions:recent.rows.length, totals:groupTransactionTotals(recent.rows), sample_truncated:recent.rows.length >= 5000},
    privacy:{private_payloads_returned:false, descriptions_returned:false, raw_messages_returned:false},
  };
}
