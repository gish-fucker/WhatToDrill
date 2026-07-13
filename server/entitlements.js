function parseLimit(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new Error(`${name} must be an integer between 1 and 100000.`);
  }
  return value;
}

export function loadEntitlementConfig(accountAuth, upstreamTimeoutMs) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (serviceRoleKey && !accountAuth) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY requires the account service to be configured.");
  }
  if (!serviceRoleKey) return null;
  return {
    baseUrl: accountAuth.baseUrl,
    serviceRoleKey,
    freeLimit: parseLimit("FREE_AI_ADVICE_LIMIT", 3),
    proLimit: parseLimit("PRO_AI_ADVICE_LIMIT", 100),
    timeoutMs: upstreamTimeoutMs
  };
}

function cleanInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid entitlement ${name}.`);
  return parsed;
}

export function normalizeEntitlementSummary(value) {
  if (!value || typeof value !== "object" || !value.quota || typeof value.quota !== "object") {
    throw new Error("Invalid entitlement response.");
  }
  const plan = value.effective_plan;
  if (!["free", "pro"].includes(plan)) throw new Error("Invalid entitlement plan.");
  const subscriptionStatus = value.subscription_status;
  if (subscriptionStatus !== null && !["active", "trialing", "past_due", "canceled", "expired"].includes(subscriptionStatus)) {
    throw new Error("Invalid entitlement subscription status.");
  }
  const currentPeriodEnd = value.current_period_end;
  if (currentPeriodEnd !== null && !Number.isFinite(Date.parse(currentPeriodEnd))) {
    throw new Error("Invalid entitlement period end.");
  }
  const resetAt = new Date(value.quota.reset_at);
  if (!Number.isFinite(resetAt.getTime())) throw new Error("Invalid entitlement reset date.");
  const used = cleanInteger(value.quota.used, "used count");
  const pending = cleanInteger(value.quota.pending, "pending count");
  const remaining = cleanInteger(value.quota.remaining, "remaining count");
  const limit = cleanInteger(value.quota.limit, "limit");
  if (remaining !== Math.max(limit - used - pending, 0)) {
    throw new Error("Inconsistent entitlement quota.");
  }
  return {
    configured: true,
    plan,
    subscriptionStatus,
    currentPeriodEnd,
    quota: { used, pending, remaining, limit, resetAt: resetAt.toISOString() }
  };
}

async function callRpc(config, name, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok || !data) throw new Error(`Entitlement RPC ${name} failed.`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function rpcBody(config, userId, requestId) {
  return {
    p_user_id: userId,
    ...(requestId ? { p_request_id: requestId } : {}),
    p_free_limit: config.freeLimit,
    p_pro_limit: config.proLimit
  };
}

export async function getAccountEntitlement(config, userId) {
  return normalizeEntitlementSummary(await callRpc(config, "get_account_entitlement", rpcBody(config, userId)));
}

export async function reserveAdviceQuota(config, userId, requestId) {
  const data = await callRpc(config, "reserve_ai_advice_quota", rpcBody(config, userId, requestId));
  return { allowed: data.allowed === true, entitlement: normalizeEntitlementSummary(data) };
}

export async function completeAdviceQuota(config, userId, requestId) {
  const data = await callRpc(config, "complete_ai_advice_quota", rpcBody(config, userId, requestId));
  if (data.completed !== true) throw new Error("Quota reservation expired before completion.");
  return normalizeEntitlementSummary(data);
}

export async function releaseAdviceQuota(config, userId, requestId) {
  const data = await callRpc(config, "release_ai_advice_quota", rpcBody(config, userId, requestId));
  return normalizeEntitlementSummary(data);
}
