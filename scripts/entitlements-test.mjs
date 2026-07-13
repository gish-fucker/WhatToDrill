import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const backendPort = Number(process.env.ENTITLEMENT_TEST_BACKEND_PORT || 5191);
const appPort = Number(process.env.ENTITLEMENT_TEST_APP_PORT || 5192);
const partialPort = Number(process.env.ENTITLEMENT_TEST_PARTIAL_PORT || 5193);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const appUrl = `http://127.0.0.1:${appPort}`;
const user = { id: "11111111-1111-4111-8111-111111111111", email: "quota@example.com" };
const state = { events: new Map(), openaiCalls: 0, failNextOpenAi: false, failRpcs: false, serviceRoleCalls: 0 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function quotaSummary(limit) {
  const events = [...state.events.values()];
  const used = events.filter(event => event === "completed").length;
  const pending = events.filter(event => event === "reserved").length;
  return {
    effective_plan: "free",
    subscription_status: null,
    current_period_end: null,
    quota: {
      used,
      pending,
      remaining: Math.max(limit - used - pending, 0),
      limit,
      reset_at: "2026-08-01T00:00:00.000Z"
    }
  };
}

function createFakeBackend() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, backendUrl);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      if (req.headers.apikey !== "test-service-role" || req.headers.authorization !== "Bearer test-service-role") {
        sendJson(res, 401, { error: "service role required" });
        return;
      }
      state.serviceRoleCalls += 1;
      if (state.failRpcs) {
        sendJson(res, 503, { error: "rpc unavailable" });
        return;
      }
      const body = await readJson(req);
      const limit = body.p_free_limit;
      const name = url.pathname.split("/").at(-1);
      if (name === "get_account_entitlement") {
        sendJson(res, 200, quotaSummary(limit));
        return;
      }
      if (name === "reserve_ai_advice_quota") {
        const existing = state.events.get(body.p_request_id);
        if (existing === "reserved" || existing === "completed") {
          sendJson(res, 200, { ...quotaSummary(limit), allowed: true, idempotent: true });
          return;
        }
        if (quotaSummary(limit).quota.remaining < 1) {
          sendJson(res, 200, { ...quotaSummary(limit), allowed: false, idempotent: false });
          return;
        }
        state.events.set(body.p_request_id, "reserved");
        sendJson(res, 200, { ...quotaSummary(limit), allowed: true, idempotent: false });
        return;
      }
      if (name === "complete_ai_advice_quota") {
        const completed = state.events.get(body.p_request_id) === "reserved" || state.events.get(body.p_request_id) === "completed";
        if (completed) state.events.set(body.p_request_id, "completed");
        sendJson(res, 200, { ...quotaSummary(limit), completed });
        return;
      }
      if (name === "release_ai_advice_quota") {
        if (state.events.get(body.p_request_id) === "reserved") state.events.set(body.p_request_id, "released");
        sendJson(res, 200, { ...quotaSummary(limit), released: true });
        return;
      }
    }

    if (url.pathname === "/auth/v1/user") {
      if (!["Bearer test-access", "Bearer refreshed-access"].includes(req.headers.authorization)) {
        sendJson(res, 401, { error: "expired" });
        return;
      }
      sendJson(res, 200, user);
      return;
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const body = await readJson(req);
      if (body.refresh_token !== "test-refresh") {
        sendJson(res, 401, { error: "invalid refresh" });
        return;
      }
      sendJson(res, 200, {
        access_token: "refreshed-access",
        refresh_token: "refreshed-refresh",
        expires_in: 3600,
        user
      });
      return;
    }
    if (url.pathname === "/v1/responses") {
      state.openaiCalls += 1;
      if (state.failNextOpenAi) {
        state.failNextOpenAi = false;
        sendJson(res, 502, { error: { message: "test upstream failure" } });
        return;
      }
      sendJson(res, 200, { output_text: "测试云端建议" });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
}

function resetQuota() {
  state.events.clear();
  state.openaiCalls = 0;
  state.failNextOpenAi = false;
  state.failRpcs = false;
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function validAdvicePayload() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dailyLogs: [],
    workouts: [],
    settings: {
      trainingGoal: "健康入门",
      preferredEnvironment: "健身房",
      weeklyWorkoutTarget: 2,
      waterTargetMl: 2000,
      conservativeMode: false
    },
    summary: { totalDailyLogs: 0, totalWorkouts: 0 }
  };
}

async function requestAdvice(cookie = "hf_account_access=test-access") {
  return fetch(`${appUrl}/api/advice`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: appUrl },
    body: JSON.stringify(validAdvicePayload())
  });
}

const backend = createFakeBackend();
await new Promise((resolve, reject) => {
  backend.once("error", reject);
  backend.listen(backendPort, "127.0.0.1", resolve);
});

const app = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: String(appPort),
    APP_VERSION: "1.16.0",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_BASE_URL: backendUrl,
    ADVICE_RATE_LIMIT: "100",
    SUPABASE_URL: backendUrl,
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    FREE_AI_ADVICE_LIMIT: "3",
    PRO_AI_ADVICE_LIMIT: "100"
  },
  stdio: "ignore",
  windowsHide: true
});

try {
  await waitForHttp(appUrl);
  const healthResponse = await fetch(`${appUrl}/api/health`);
  const healthText = await healthResponse.text();
  const health = JSON.parse(healthText);
  assert(health.version === "1.16.0" && health.entitlementConfigured && health.aiAccessMode === "account_quota", "Health should expose account quota mode.");
  assert(!healthText.includes("test-service-role"), "Health must not expose the service role key.");

  const signedOut = await fetch(`${appUrl}/api/account/entitlements`);
  assert(signedOut.status === 401, "Signed-out entitlement requests should be rejected.");
  const signedIn = await fetch(`${appUrl}/api/account/entitlements`, { headers: { cookie: "hf_account_access=test-access" } });
  const signedInBody = await signedIn.json();
  assert(signedIn.status === 200 && signedInBody.plan === "free" && signedInBody.quota.remaining === 3, "Signed-in users should receive a normalized Free quota.");

  resetQuota();
  const sequential = [];
  for (let index = 0; index < 4; index += 1) sequential.push(await requestAdvice());
  assert(sequential.slice(0, 3).every(response => response.status === 200), "The first three Free advice requests should succeed.");
  assert(sequential[3].status === 429 && state.openaiCalls === 3, "The fourth Free request should be blocked before OpenAI.");
  const thirdBody = await sequential[2].json();
  assert(thirdBody.entitlement.quota.used === 3 && thirdBody.entitlement.quota.remaining === 0, "Successful advice should return completed quota state.");

  resetQuota();
  state.failNextOpenAi = true;
  const failed = await requestAdvice();
  assert(failed.status === 502 && [...state.events.values()].every(status => status !== "reserved"), "Upstream failure should release its reservation.");
  const afterFailure = await Promise.all([requestAdvice(), requestAdvice(), requestAdvice()]);
  assert(afterFailure.every(response => response.status === 200), "A failed upstream request must not consume Free quota.");

  resetQuota();
  const concurrent = await Promise.all([requestAdvice(), requestAdvice(), requestAdvice(), requestAdvice()]);
  assert(concurrent.filter(response => response.status === 200).length === 3, "Concurrent reservations must not exceed the Free quota.");
  assert(concurrent.filter(response => response.status === 429).length === 1 && state.openaiCalls === 3, "Concurrent exhaustion should block upstream calls.");

  resetQuota();
  const refreshed = await fetch(`${appUrl}/api/account/entitlements`, {
    headers: { cookie: "hf_account_access=expired; hf_account_refresh=test-refresh" }
  });
  assert(refreshed.status === 200 && String(refreshed.headers.get("set-cookie")).includes("refreshed-access"), "Entitlement reads should rotate refreshed account cookies.");

  state.failRpcs = true;
  const unavailable = await fetch(`${appUrl}/api/account/entitlements`, { headers: { cookie: "hf_account_access=test-access" } });
  assert(unavailable.status === 503, "RPC failures should remain unavailable instead of guessing Free or Pro.");
  assert(state.serviceRoleCalls > 0, "Entitlement RPCs should use the server-only service role.");

  const sql = await readFile("supabase/migrations/20260713_entitlements_and_ai_quota.sql", "utf8");
  for (const requirement of ["enable row level security", "pg_advisory_xact_lock", "interval '10 minutes'", "from public, anon, authenticated", "to service_role"]) {
    assert(sql.includes(requirement), `Migration should include ${requirement}.`);
  }

  const partial = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(partialPort),
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "orphaned-service-role"
    },
    stdio: "ignore",
    windowsHide: true
  });
  const partialExit = await new Promise(resolve => partial.once("exit", resolve));
  assert(partialExit !== 0, "A service role without account auth should fail startup.");

  console.log(JSON.stringify({ ok: true, sequentialLimit: 3, concurrentSuccesses: 3, failureReleased: true }));
} finally {
  app.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => app.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000))
  ]);
  backend.close();
}
