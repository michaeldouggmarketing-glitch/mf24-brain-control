const DEFAULT_URL = "https://xjksqwlidkhvobiklisi.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function config() {
  const url = process.env.MF24_PROD_URL || DEFAULT_URL;
  const key = process.env.MF24_PROD_SERVICE_ROLE_KEY;
  if (!key)
    throw Object.assign(new Error("mf24_prod_service_role_not_configured"), { status: 503 });
  return { url, key };
}

async function rest(
  path,
  { select = "*", filters = {}, limit = 1000, count = false, fetchImpl = fetch } = {},
) {
  const { url, key } = config();
  const params = new URLSearchParams({ select });
  for (const [name, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, String(item));
    } else {
      params.append(name, String(value));
    }
  }
  params.set("limit", String(Math.min(Math.max(Number(limit) || 1, 1), 5000)));
  const response = await fetchImpl(`${url}/rest/v1/${path}?${params}`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(count ? { prefer: "count=exact" } : {}),
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok)
    throw Object.assign(new Error("mf24_prod_read_failed"), {
      status: 502,
      upstreamStatus: response.status,
    });
  const rows = await response.json();
  const range = response.headers?.get?.("content-range") || "";
  const exact = range.includes("/") ? Number(range.split("/").pop()) : null;
  return {
    rows: Array.isArray(rows) ? rows : [],
    count: Number.isFinite(exact) ? exact : null,
  };
}

async function exactCount(table, select) {
  const out = await rest(table, { select, limit: 1, count: true });
  return out.count ?? out.rows.length;
}

function groupTransactionTotals(rows) {
  const totals = {};
  for (const row of rows) {
    const direction = String(row.direction || "unknown");
    const currency = String(row.currency || "BRL").toUpperCase();
    const key = `${direction}:${currency}`;
    if (!totals[key]) totals[key] = { direction, currency, count: 0, amount_minor: 0 };
    totals[key].count += 1;
    totals[key].amount_minor += Number(row.amount_minor || 0);
  }
  return Object.values(totals);
}

function validatePrivateContextInput(userId, spaceId) {
  if (!UUID.test(String(userId || "")))
    throw Object.assign(new Error("invalid_mf24_user_id"), { status: 400 });
  if (
    spaceId !== undefined &&
    spaceId !== null &&
    (typeof spaceId !== "string" || !spaceId.trim() || spaceId.length > 120)
  )
    throw Object.assign(new Error("invalid_mf24_space_id"), { status: 400 });
}

function safeToday(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    ? String(value)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function monthBounds(today) {
  const [year, month] = today.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    key: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
    from: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
    toExclusive: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

function isRealizedStatus(status) {
  return !["pending", "canceled", "cancelled"].includes(String(status || "").toLowerCase());
}

function compactMonth(rows, bounds) {
  let incomeMinor = 0;
  let expenseMinor = 0;
  const categories = new Map();
  let realizedCount = 0;

  for (const row of rows) {
    if (!isRealizedStatus(row.status)) continue;
    const amount = Number(row.amount_minor || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (row.direction === "income") {
      incomeMinor += amount;
      realizedCount += 1;
    } else if (row.direction === "expense") {
      expenseMinor += amount;
      realizedCount += 1;
      const category = String(row.category_id || "a_confirmar");
      categories.set(category, (categories.get(category) || 0) + amount);
    }
  }

  return {
    key: bounds.key,
    from: bounds.from,
    to_exclusive: bounds.toExclusive,
    transaction_count: realizedCount,
    income_minor: incomeMinor,
    expense_minor: expenseMinor,
    result_minor: incomeMinor - expenseMinor,
    top_expense_categories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([category_id, amount_minor]) => ({ category_id, amount_minor })),
  };
}

function calculateAccountBalances(accounts, transactions) {
  const balances = new Map();
  for (const account of accounts) {
    balances.set(
      account.account_id,
      account.opening_balance_known ? Number(account.opening_balance_minor || 0) : null,
    );
  }

  const adjust = (accountId, delta) => {
    if (!accountId || !balances.has(accountId)) return;
    const current = balances.get(accountId);
    if (current === null) return;
    balances.set(accountId, current + delta);
  };

  for (const row of transactions) {
    if (!isRealizedStatus(row.status)) continue;
    const amount = Number(row.amount_minor || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (row.direction === "income") adjust(row.account_id, amount);
    else if (row.direction === "expense") adjust(row.account_id, -amount);
    else if (row.direction === "transfer") {
      adjust(row.account_id, -amount);
      adjust(row.destination_account_id, amount);
    }
  }

  return accounts.map((row) => ({
    account_id: row.account_id,
    name: row.name,
    institution: row.institution,
    account_type: row.account_type,
    opening_balance_known: Boolean(row.opening_balance_known),
    known_balance_minor: balances.get(row.account_id),
  }));
}

function compactCommitments(rows, today) {
  const closed = new Set(["paid", "completed", "canceled", "cancelled", "done"]);
  return rows
    .filter((row) => !closed.has(String(row.status || "").toLowerCase()))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      direction: row.direction,
      amount_minor: Number(row.amount_minor || 0),
      currency: row.currency || "BRL",
      title: row.title,
      category_id: row.category_id,
      due_at: row.due_at,
      status: row.status,
      overdue: typeof row.due_at === "string" ? row.due_at.slice(0, 10) < today : false,
      recurrence: row.recurrence || null,
    }));
}

export async function getMF24PrivateContext({ userId, spaceId, today } = {}) {
  validatePrivateContextInput(userId, spaceId);
  const referenceDate = safeToday(today);
  const sharedMemory = { user_id: `eq.${userId}` };
  if (spaceId) sharedMemory.space_id = `eq.${spaceId}`;

  const [memory, state] = await Promise.all([
    rest("mf24_assistant_memory_facts", {
      select: "memory_key,scope,kind,summary,importance,confidence,status,last_seen_at",
      filters: {
        ...sharedMemory,
        status: "eq.active",
        order: "importance.desc,last_seen_at.desc",
      },
      limit: 12,
    }),
    rest("mf24_assistant_turn_state", {
      select:
        "space_id,current_topic,last_intent,last_entity,pending_question,pending_action,dialogue_state,ambiguity_count,recovery_count,updated_at",
      filters: { ...sharedMemory, order: "updated_at.desc" },
      limit: 1,
    }),
  ]);

  let financialSnapshot = null;
  if (spaceId) {
    const ledgerScope = {
      owner_user_id: `eq.${userId}`,
      space_id: `eq.${spaceId}`,
    };
    const bounds = monthBounds(referenceDate);
    const [recent, monthRows, accounts, cards, commitments, accountFlow] = await Promise.all([
      rest("mf24_ledger_transactions", {
        select:
          "transaction_id,direction,amount_minor,currency,occurred_at,description,category_id,account_id,destination_account_id,card_id,installment_plan_id,status,merchant,mirrored_at",
        filters: { ...ledgerScope, order: "occurred_at.desc,mirrored_at.desc" },
        limit: 60,
      }),
      rest("mf24_ledger_transactions", {
        select: "direction,amount_minor,currency,occurred_at,category_id,status",
        filters: {
          ...ledgerScope,
          occurred_at: [`gte.${bounds.from}`, `lt.${bounds.toExclusive}`],
          order: "occurred_at.desc",
        },
        limit: 5000,
      }),
      rest("mf24_ledger_accounts", {
        select:
          "account_id,name,account_type,institution,opening_balance_minor,opening_balance_known,active,mirrored_at",
        filters: {
          owner_user_id: `eq.${userId}`,
          space_id: `eq.${spaceId}`,
          active: "eq.true",
          order: "name.asc",
        },
        limit: 30,
      }),
      rest("mf24_ledger_cards", {
        select:
          "card_id,account_id,name,institution,credit_limit_minor,closing_day,due_day,active,mirrored_at",
        filters: {
          owner_user_id: `eq.${userId}`,
          space_id: `eq.${spaceId}`,
          active: "eq.true",
          order: "name.asc",
        },
        limit: 30,
      }),
      rest("mf24_financial_commitments", {
        select:
          "id,direction,amount_minor,currency,title,category_id,due_at,status,recurrence,updated_at",
        filters: {
          user_id: `eq.${userId}`,
          space_id: `eq.${spaceId}`,
          order: "due_at.asc",
        },
        limit: 40,
      }),
      rest("mf24_ledger_transactions", {
        select: "direction,amount_minor,account_id,destination_account_id,status",
        filters: { ...ledgerScope },
        limit: 5000,
      }),
    ]);

    financialSnapshot = {
      as_of: referenceDate,
      currency: "BRL",
      month: compactMonth(monthRows.rows, bounds),
      recent_transactions: recent.rows.slice(0, 24).map((row) => ({
        transaction_id: row.transaction_id,
        direction: row.direction,
        amount_minor: Number(row.amount_minor || 0),
        currency: row.currency || "BRL",
        occurred_at: row.occurred_at,
        description: row.description,
        merchant: row.merchant,
        category_id: row.category_id,
        account_id: row.account_id,
        destination_account_id: row.destination_account_id,
        card_id: row.card_id,
        installment_plan_id: row.installment_plan_id,
        status: row.status,
      })),
      accounts: calculateAccountBalances(accounts.rows, accountFlow.rows),
      cards: cards.rows.map((row) => ({
        card_id: row.card_id,
        account_id: row.account_id,
        name: row.name,
        institution: row.institution,
        credit_limit_minor:
          row.credit_limit_minor === null || row.credit_limit_minor === undefined
            ? null
            : Number(row.credit_limit_minor),
        closing_day: row.closing_day,
        due_day: row.due_day,
      })),
      commitments: compactCommitments(commitments.rows, referenceDate),
      coverage: {
        recent_transactions_returned: Math.min(recent.rows.length, 24),
        month_rows_scanned: monthRows.rows.length,
        account_flow_rows_scanned: accountFlow.rows.length,
        account_flow_truncated: accountFlow.rows.length >= 5000,
      },
    };
  }

  return {
    memory_facts: memory.rows.map((row) => ({
      memory_key: row.memory_key,
      scope: row.scope,
      kind: row.kind,
      summary: row.summary,
      importance: row.importance,
      confidence: row.confidence,
    })),
    conversation_state: state.rows[0] || null,
    financial_snapshot: financialSnapshot,
    privacy: {
      source: "mf24_prod_private",
      global_brain_written: false,
      raw_messages_loaded: false,
      raw_financial_payloads_loaded: false,
      user_and_space_isolated: Boolean(spaceId),
    },
  };
}

export async function getMF24ProductionSnapshot({
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const [identities, workspaces, members, messages, sessions, commitments, entitlements, grants, txCount, recent] =
    await Promise.all([
      exactCount("mf24_identities", "user_id"),
      exactCount("mf24_workspaces", "space_id"),
      exactCount("mf24_workspace_members", "user_id"),
      exactCount("mf24_conversation_messages", "id"),
      exactCount("mf24_assistant_sessions", "id"),
      exactCount("mf24_financial_commitments", "id"),
      exactCount("mf24_product_entitlements", "id"),
      exactCount("mf24_product_grants", "id"),
      exactCount("mf24_ledger_transactions", "transaction_id"),
      rest("mf24_ledger_transactions", {
        select: "direction,amount_minor,currency,occurred_at,status",
        filters: { occurred_at: `gte.${sinceDate}` },
        limit: 5000,
      }),
    ]);
  return {
    source: "mf24_prod_read_only",
    generated_at: new Date().toISOString(),
    window: { from: sinceDate, to: today },
    counts: {
      identities,
      workspaces,
      members,
      messages,
      sessions,
      commitments,
      entitlements,
      grants,
      transactions: txCount,
    },
    finance: {
      recent_transactions: recent.rows.length,
      totals: groupTransactionTotals(recent.rows),
      sample_truncated: recent.rows.length >= 5000,
    },
    privacy: {
      private_payloads_returned: false,
      descriptions_returned: false,
      raw_messages_returned: false,
    },
  };
}
