import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { connect as connectSocket } from "node:net";
import { resolve } from "node:path";
import { CLOUD_SYNC_LIMITS, canonicalizeSyncPayload } from "../server/cloud-sync.js";

const appPort = Number(process.env.SMOKE_APP_PORT || 5183);
const chromePort = Number(process.env.SMOKE_CHROME_PORT || 9240);
const authPort = Number(process.env.SMOKE_AUTH_PORT || 5184);
const unconfiguredPort = Number(process.env.SMOKE_UNCONFIGURED_PORT || 5185);
const cloudUnconfiguredPort = Number(process.env.SMOKE_CLOUD_UNCONFIGURED_PORT || 5186);
const baseUrl = `http://localhost:${appPort}`;
const appUrl = `${baseUrl}/app/`;
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDir = resolve("output", "playwright");
const profileDir = resolve(outputDir, "smoke-profile");
const storageKey = "habit_fitness_app_v1";
const workoutDraftKey = "habit_fitness_workout_draft_v1";
const fakeAccountUser = { id: "11111111-1111-4111-8111-111111111111", email: "smoke@example.com" };
const deleteSyncEnvelopeBytes = 256;

function checksumPayload(payload) {
  return createHash("sha256").update(canonicalizeSyncPayload(payload), "utf8").digest("hex");
}

function sendFakeAuthJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readFakeAuthBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body || "{}");
}

function createFakeAccountProvider(calls, cloud) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${authPort}`);
    const authorization = String(req.headers.authorization || "");
    const isRpc = req.method === "POST" && url.pathname.startsWith("/rest/v1/rpc/");
    calls.push({ method: req.method, path: url.pathname, query: url.search, authorization });
    if (req.headers.apikey !== (isRpc ? "smoke-service-role" : "smoke-anon-key")) {
      sendFakeAuthJson(res, 401, { error: "missing api key" });
      return;
    }
    if (isRpc) {
      if (authorization !== "Bearer smoke-service-role") {
        sendFakeAuthJson(res, 401, { error: "invalid service role" });
        return;
      }
      const body = await readFakeAuthBody(req);
      cloud.calls.push({ path: url.pathname, body });
      if (cloud.mode === "timeout") return;
      if (cloud.mode === "failure") {
        sendFakeAuthJson(res, 500, { message: "PRIVATE_UPSTREAM_MESSAGE" });
        return;
      }
      if (cloud.mode === "malformed") {
        sendFakeAuthJson(res, 200, { unexpected: "PRIVATE_UPSTREAM_MESSAGE" });
        return;
      }
      if (body.p_user_id !== fakeAccountUser.id) {
        sendFakeAuthJson(res, 400, { message: "wrong user" });
        return;
      }
      const now = new Date().toISOString();
      if (url.pathname === "/rest/v1/rpc/get_cloud_sync_state") {
        sendFakeAuthJson(res, 200, cloud.exists ? {
          ok: true,
          exists: true,
          revision: cloud.revision,
          schemaVersion: cloud.schemaVersion,
          checksum: cloud.checksum,
          payload: cloud.payload,
          updatedAt: cloud.updatedAt
        } : { ok: true, exists: false, revision: cloud.revision });
        return;
      }
      if (url.pathname === "/rest/v1/rpc/put_cloud_sync_state") {
        if (body.p_base_revision !== cloud.revision) {
          sendFakeAuthJson(res, 200, {
            ok: false,
            conflict: { revision: cloud.revision, exists: cloud.exists, checksum: cloud.exists ? cloud.checksum : null }
          });
          return;
        }
        cloud.revision += 1;
        cloud.exists = true;
        cloud.schemaVersion = body.p_schema_version;
        cloud.checksum = body.p_checksum;
        cloud.payload = body.p_payload;
        cloud.updatedAt = now;
        sendFakeAuthJson(res, 200, {
          ok: true,
          exists: true,
          revision: cloud.revision,
          schemaVersion: cloud.schemaVersion,
          checksum: cloud.checksum,
          payload: cloud.payload,
          updatedAt: cloud.updatedAt
        });
        return;
      }
      if (url.pathname === "/rest/v1/rpc/delete_cloud_sync_state") {
        if (body.p_base_revision !== cloud.revision) {
          sendFakeAuthJson(res, 200, {
            ok: false,
            conflict: { revision: cloud.revision, exists: cloud.exists, checksum: cloud.exists ? cloud.checksum : null }
          });
          return;
        }
        cloud.revision += 1;
        cloud.exists = false;
        cloud.schemaVersion = null;
        cloud.checksum = null;
        cloud.payload = null;
        cloud.updatedAt = now;
        sendFakeAuthJson(res, 200, { ok: true, exists: false, revision: cloud.revision, deletedAt: now });
        return;
      }
      sendFakeAuthJson(res, 404, { error: "not found" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/otp") {
      const body = await readFakeAuthBody(req);
      sendFakeAuthJson(res, body.email === fakeAccountUser.email ? 200 : 400, {});
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/verify") {
      const body = await readFakeAuthBody(req);
      if (body.email !== fakeAccountUser.email || body.token !== "123456" || body.type !== "email") {
        sendFakeAuthJson(res, 403, { error: "invalid code" });
        return;
      }
      sendFakeAuthJson(res, 200, {
        access_token: "smoke-access-token",
        refresh_token: "smoke-refresh-token",
        expires_in: 3600,
        user: fakeAccountUser
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      if (!["Bearer smoke-access-token", "Bearer refreshed-access-token"].includes(authorization)) {
        sendFakeAuthJson(res, 401, { error: "expired" });
        return;
      }
      sendFakeAuthJson(res, 200, fakeAccountUser);
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const body = await readFakeAuthBody(req);
      if (body.refresh_token !== "smoke-refresh-token") {
        sendFakeAuthJson(res, 401, { error: "invalid refresh" });
        return;
      }
      sendFakeAuthJson(res, 200, {
        access_token: "refreshed-access-token",
        refresh_token: "refreshed-refresh-token",
        expires_in: 3600,
        user: fakeAccountUser
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
      res.writeHead(204);
      res.end();
      return;
    }
    sendFakeAuthJson(res, 404, { error: "not found" });
  });
}

function getResponseCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return {
    values,
    header: values.flatMap(value => value.split(/,\s*(?=hf_account_)/)).map(value => value.split(";")[0]).join("; ")
  };
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method && this.events.has(message.method)) {
        this.events.get(message.method).forEach(resolveEvent => resolveEvent(message.params || {}));
        this.events.delete(message.method);
      }
    });
  }

  ready() {
    return new Promise(resolveReady => this.ws.addEventListener("open", resolveReady, { once: true }));
  }

  send(method, params = {}) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  }

  waitFor(method, timeoutMs = 8000) {
    return new Promise((resolveWait, rejectWait) => {
      const timeout = setTimeout(() => rejectWait(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const handler = params => {
        clearTimeout(timeout);
        resolveWait(params);
      };
      const handlers = this.events.get(method) || [];
      handlers.push(handler);
      this.events.set(method, handlers);
    });
  }

  close() {
    this.ws.close();
  }
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

function rawHttpRequest(url, { method, headers = {}, body = "" }) {
  return new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(url);
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolveRequest({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", rejectRequest);
    if (body) req.write(body);
    req.end();
  });
}

function rawSocketRequest(port, parts) {
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = connectSocket({ host: "127.0.0.1", port });
    const responseChunks = [];
    const timeout = setTimeout(() => {
      socket.destroy(new Error("Raw HTTP request timed out."));
    }, 10_000);
    socket.on("connect", () => {
      for (const part of parts) socket.write(part);
    });
    socket.on("data", chunk => responseChunks.push(chunk));
    socket.on("end", () => {
      clearTimeout(timeout);
      const text = Buffer.concat(responseChunks).toString("utf8");
      const [head = "", ...bodyParts] = text.split("\r\n\r\n");
      const status = Number(head.match(/^HTTP\/1\.1\s+(\d{3})/i)?.[1] || 0);
      resolveRequest({ status, head, text: bodyParts.join("\r\n\r\n") });
    });
    socket.on("error", error => {
      clearTimeout(timeout);
      rejectRequest(error);
    });
  });
}

function chunkedRequestParts({ method, port, headers = {}, chunks = [] }) {
  const lines = [
    `${method} /api/account/sync-state HTTP/1.1`,
    `Host: localhost:${port}`,
    "Connection: close",
    "Transfer-Encoding: chunked",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    ""
  ];
  const parts = [lines.join("\r\n")];
  for (const chunk of chunks) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    parts.push(Buffer.from(`${bytes.byteLength.toString(16)}\r\n`), bytes, Buffer.from("\r\n"));
  }
  parts.push("0\r\n\r\n");
  return parts;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail || "Runtime evaluation failed");
  }
  return result.result.value;
}

async function reload(cdp) {
  const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
  await cdp.send("Page.reload", { ignoreCache: true });
  await loaded;
  await delay(350);
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await delay(350);
}

async function screenshot(cdp, filename) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(resolve(outputDir, filename), Buffer.from(shot.data, "base64"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngDimensions(buffer) {
  const bytes = Buffer.from(buffer);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function waitForChildExit(child, timeoutMs, label) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return Promise.resolve({ code: child?.exitCode ?? null, signal: child?.signalCode ?? null });
  }
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectExit(new Error(`${label} did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolveExit({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  try {
    await waitForChildExit(child, 3_000, label);
  } catch {
    child.kill("SIGKILL");
    await waitForChildExit(child, 3_000, `${label} after SIGKILL`).catch(() => {});
  }
}

async function closeHttpServer(server) {
  if (!server?.listening) return;
  await new Promise(resolveClose => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceClose);
      clearTimeout(giveUp);
      resolveClose();
    };
    const forceClose = setTimeout(() => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    }, 1_000);
    const giveUp = setTimeout(finish, 3_000);
    server.close(finish);
  });
}

async function run() {
  let partialConfigServer;
  let unconfiguredServer;
  let authServer;
  let server;
  let chrome;
  let cloudUnconfiguredServer;
  let cdp;
  try {
    await mkdir(outputDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    partialConfigServer = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(unconfiguredPort), OPENAI_API_KEY: "", SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", ENTITLEMENTS_ENABLED: "0", TRUST_PROXY: "0", TRUST_PROXY_HOPS: "1", NODE_ENV: "development" },
    stdio: "ignore",
    windowsHide: true
  });
    let partialConfigExit;
    try {
      partialConfigExit = await waitForChildExit(partialConfigServer, 5_000, "Partially configured server");
    } catch (error) {
      await stopChild(partialConfigServer, "Partially configured server");
      throw error;
    }
    assert(partialConfigExit.code !== 0, "Server should reject a partially configured account provider.");

    unconfiguredServer = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(unconfiguredPort), OPENAI_API_KEY: "", SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", ENTITLEMENTS_ENABLED: "0", TRUST_PROXY: "0", TRUST_PROXY_HOPS: "1" },
    stdio: "ignore",
    windowsHide: true
  });
  await waitForHttp(`http://127.0.0.1:${unconfiguredPort}`);
  const unconfiguredAccountResponse = await fetch(`http://127.0.0.1:${unconfiguredPort}/api/account/session`);
  const unconfiguredAccount = await unconfiguredAccountResponse.json();
  assert(unconfiguredAccountResponse.status === 200 && !unconfiguredAccount.configured && !unconfiguredAccount.signedIn, "Unconfigured deployment should return a truthful local-only account state.");
    await stopChild(unconfiguredServer, "Unconfigured app server");

  const authProviderCalls = [];
  const cloudProvider = {
    mode: "normal",
    revision: 0,
    exists: false,
    schemaVersion: null,
    checksum: null,
    payload: null,
    updatedAt: new Date().toISOString(),
    calls: []
  };
    authServer = createFakeAccountProvider(authProviderCalls, cloudProvider);
  await new Promise((resolveListen, rejectListen) => {
    authServer.once("error", rejectListen);
    authServer.listen(authPort, "127.0.0.1", resolveListen);
  });

    server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(appPort),
      APP_VERSION: "1.22.0",
      OPENAI_API_KEY: "",
      ADVICE_RATE_LIMIT: "10",
      ACCOUNT_RATE_LIMIT: "5",
      CLOUD_SYNC_IP_RATE_LIMIT: "5",
      CLOUD_SYNC_ACCOUNT_RATE_LIMIT: "20",
      CLOUD_SYNC_RATE_WINDOW_MS: "60000",
      SUPABASE_URL: `http://127.0.0.1:${authPort}`,
      SUPABASE_ANON_KEY: "smoke-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "smoke-service-role",
      ENTITLEMENTS_ENABLED: "0",
      UPSTREAM_TIMEOUT_MS: "1000",
      TRUST_PROXY: "1",
      TRUST_PROXY_HOPS: "1"
    },
    stdio: "ignore",
    windowsHide: true
  });

    chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-default-apps",
    "--disable-gpu",
    "--window-size=1440,1100",
    appUrl
  ], {
    stdio: "ignore",
    windowsHide: true
  });

    await waitForHttp(baseUrl);
    cloudUnconfiguredServer = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: String(cloudUnconfiguredPort),
        OPENAI_API_KEY: "",
        SUPABASE_URL: `http://127.0.0.1:${authPort}`,
        SUPABASE_ANON_KEY: "smoke-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "",
        ENTITLEMENTS_ENABLED: "0",
        TRUST_PROXY: "1",
        TRUST_PROXY_HOPS: "1"
      },
      stdio: "ignore",
      windowsHide: true
    });
    await waitForHttp(`http://127.0.0.1:${cloudUnconfiguredPort}`);
    const indexResponse = await fetch(baseUrl);
    const landingHtml = await indexResponse.text();
    const appResponse = await fetch(appUrl);
    const appHtml = await appResponse.text();
    const privacyResponse = await fetch(`${baseUrl}/privacy.html`);
    const termsResponse = await fetch(`${baseUrl}/terms.html`);
    const serviceWorkerResponse = await fetch(`${baseUrl}/sw.js`);
    const serviceWorkerSource = await serviceWorkerResponse.text();
    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    const manifest = await manifestResponse.json();
    const subpathManifestUrl = new URL("https://example.com/Daily-Workout-Record/manifest.webmanifest");
    const subpathManifest = {
      id: new URL(manifest.id, subpathManifestUrl).pathname,
      startUrl: new URL(manifest.start_url, subpathManifestUrl).pathname,
      scope: new URL(manifest.scope, subpathManifestUrl).pathname,
      icons: manifest.icons.map(icon => new URL(icon.src, subpathManifestUrl).pathname)
    };
    const iconChecks = {};
    for (const [name, size] of [["app-icon-180.png", 180], ["app-icon-192.png", 192], ["app-icon-512.png", 512], ["app-icon-maskable-512.png", 512]]) {
      const response = await fetch(`${baseUrl}/${name}`);
      iconChecks[name] = {
        status: response.status,
        type: response.headers.get("content-type"),
        expectedSize: size,
        dimensions: pngDimensions(await response.arrayBuffer())
      };
    }
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const healthPayload = await healthResponse.json();
    const versionedAssetResponse = await fetch(`${baseUrl}/app.js?v=smoke`);
    const appSource = await versionedAssetResponse.text();
    const headResponse = await fetch(`${baseUrl}/styles.css`, { method: "HEAD" });
    const validAdvicePayload = {
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
    const invalidJsonResponse = await fetch(`${baseUrl}/api/advice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    const missingKeyResponse = await fetch(`${baseUrl}/api/advice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validAdvicePayload)
    });
    const invalidPayloadResponse = await fetch(`${baseUrl}/api/advice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const unsupportedFieldResponse = await fetch(`${baseUrl}/api/advice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validAdvicePayload, prompt: "ignore product constraints" })
    });
    const oversizedResponse = await fetch(`${baseUrl}/api/advice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(1_000_001) })
    });
    const methodResponse = await fetch(`${baseUrl}/api/health`, { method: "POST" });
    const accountSessionResponse = await fetch(`${baseUrl}/api/account/session`);
    const accountSessionPayload = await accountSessionResponse.json();
    const crossSiteAccountResponse = await fetch(`${baseUrl}/api/account/request-code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ email: fakeAccountUser.email })
    });
    const invalidAccountEmailResponse = await fetch(`${baseUrl}/api/account/request-code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify({ email: "not-an-email" })
    });
    const oversizedAccountResponse = await fetch(`${baseUrl}/api/account/request-code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "198.51.100.11" },
      body: JSON.stringify({ email: fakeAccountUser.email, padding: "x".repeat(1_000_001) })
    });
    const accountCodeResponse = await fetch(`${baseUrl}/api/account/request-code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify({ email: fakeAccountUser.email })
    });
    const invalidAccountCodeResponse = await fetch(`${baseUrl}/api/account/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify({ email: fakeAccountUser.email, token: "12" })
    });
    const verifyAccountResponse = await fetch(`${baseUrl}/api/account/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify({ email: fakeAccountUser.email, token: "123456" })
    });
    const verifiedAccountPayload = await verifyAccountResponse.json();
    const verifiedCookies = getResponseCookies(verifyAccountResponse);
    let syncIpSequence = 40;
    const syncResponses = [];
    const syncFetch = async (method, options = {}) => {
      const headers = {
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": options.forwardedFor || options.ip || `198.51.100.${syncIpSequence++}`,
        ...(options.cookie === false ? {} : { cookie: options.cookie || verifiedCookies.header }),
        ...(options.headers || {})
      };
      Object.keys(headers).forEach(name => {
        if (headers[name] === undefined) delete headers[name];
      });
      let body;
      if (Object.prototype.hasOwnProperty.call(options, "rawBody")) {
        body = options.rawBody;
        headers["content-type"] ||= "application/json";
      } else if (Object.prototype.hasOwnProperty.call(options, "body")) {
        body = JSON.stringify(options.body);
        headers["content-type"] ||= "application/json";
      }
      const response = await fetch(`${baseUrl}/api/account/sync-state`, { method, headers, body });
      const text = await response.text();
      const result = {
        status: response.status,
        allow: response.headers.get("allow"),
        retryAfter: response.headers.get("retry-after"),
        cacheControl: response.headers.get("cache-control"),
        setCookie: response.headers.get("set-cookie"),
        text,
        json: (() => { try { return JSON.parse(text); } catch { return null; } })()
      };
      syncResponses.push(result);
      return result;
    };

    const cloudUnconfiguredHealthResponse = await fetch(`http://127.0.0.1:${cloudUnconfiguredPort}/api/health`);
    const cloudUnconfiguredHealth = await cloudUnconfiguredHealthResponse.json();
    const cloudUnconfiguredResponse = await fetch(`http://127.0.0.1:${cloudUnconfiguredPort}/api/account/sync-state`, {
      headers: {
        cookie: verifiedCookies.header,
        origin: `http://127.0.0.1:${cloudUnconfiguredPort}`,
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": "198.51.100.31"
      }
    });
    const cloudUnconfiguredText = await cloudUnconfiguredResponse.text();
    assert(!cloudUnconfiguredHealth.cloudSyncConfigured && cloudUnconfiguredResponse.status === 503, "A signed-in request should receive 503 when cloud sync is not configured.");

    const unsignedSyncByMethod = {};
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await syncFetch(method, {
        cookie: false,
        body: method === "GET" ? undefined : {},
        ip: `198.51.100.${32 + ["GET", "PUT", "DELETE"].indexOf(method)}`
      });
      unsignedSyncByMethod[method] = response;
      assert(response.status === 401, `${method} cloud sync should require an authenticated account.`);
    }
    const unsignedSync = unsignedSyncByMethod.GET;
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await syncFetch(method, {
        cookie: false,
        body: method === "GET" ? undefined : {},
        headers: { origin: `http://sub.localhost:${appPort}`, "sec-fetch-site": "same-site" },
        ip: `198.51.100.${33 + ["GET", "PUT", "DELETE"].indexOf(method)}`
      });
      assert(response.status === 403, `${method} cloud sync should reject a same-site subdomain.`);
    }
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await syncFetch(method, {
        cookie: false,
        body: method === "GET" ? undefined : {},
        headers: { origin: "https://attacker.example", "sec-fetch-site": "same-origin" },
        ip: `198.51.100.${36 + ["GET", "PUT", "DELETE"].indexOf(method)}`
      });
      assert(response.status === 403, `${method} cloud sync should require an exact Origin match even when fetch metadata claims same-origin.`);
    }
    const unsupportedSyncMethod = await syncFetch("POST", { body: {} });
    assert(unsupportedSyncMethod.status === 405 && unsupportedSyncMethod.allow === "GET, PUT, DELETE", "Cloud sync should advertise the exact supported methods.");

    const authCallsBeforeHeaderRejections = authProviderCalls.filter(call => call.path.startsWith("/auth/v1/")).length;
    const getWithBody = await rawHttpRequest(`${baseUrl}/api/account/sync-state`, {
      method: "GET",
      headers: {
        host: `localhost:${appPort}`,
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
        cookie: verifiedCookies.header,
        "x-forwarded-for": "198.51.100.37",
        "content-type": "application/json",
        "content-length": "2"
      },
      body: "{}"
    });
    assert(getWithBody.status === 400 && JSON.parse(getWithBody.text).code === "BODY_NOT_ALLOWED", "GET cloud sync should reject request bodies.");
    const chunkedGet = await rawSocketRequest(appPort, chunkedRequestParts({
      method: "GET",
      port: appPort,
      headers: {
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
        Cookie: verifiedCookies.header,
        "X-Forwarded-For": "198.51.100.151"
      },
      chunks: ["{}"]
    }));
    const conflictingFraming = await rawSocketRequest(appPort, [[
      "PUT /api/account/sync-state HTTP/1.1",
      `Host: localhost:${appPort}`,
      "Connection: close",
      `Origin: ${baseUrl}`,
      "Sec-Fetch-Site: same-origin",
      `Cookie: ${verifiedCookies.header}`,
      "X-Forwarded-For: 198.51.100.152",
      "Content-Type: application/json",
      "Content-Length: 2",
      "Transfer-Encoding: chunked",
      "",
      "2",
      "{}",
      "0",
      "",
      ""
    ].join("\r\n")]);
    const negativeContentLength = await rawSocketRequest(appPort, [[
      "DELETE /api/account/sync-state HTTP/1.1",
      `Host: localhost:${appPort}`,
      "Connection: close",
      `Origin: ${baseUrl}`,
      "Sec-Fetch-Site: same-origin",
      `Cookie: ${verifiedCookies.header}`,
      "X-Forwarded-For: 198.51.100.155",
      "Content-Type: application/json",
      "Content-Length: -1",
      "",
      ""
    ].join("\r\n")]);
    const oversizedChunkedDelete = await rawSocketRequest(appPort, chunkedRequestParts({
      method: "DELETE",
      port: appPort,
      headers: {
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
        Cookie: verifiedCookies.header,
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.153"
      },
      chunks: [" ".repeat(deleteSyncEnvelopeBytes + 1)]
    }));
    const oversizedChunkedPut = await rawSocketRequest(appPort, chunkedRequestParts({
      method: "PUT",
      port: appPort,
      headers: {
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
        Cookie: verifiedCookies.header,
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.154"
      },
      chunks: [Buffer.alloc(CLOUD_SYNC_LIMITS.maxEnvelopeBytes + 1, 0x20)]
    }));
    const authCallsAfterHeaderRejections = authProviderCalls.filter(call => call.path.startsWith("/auth/v1/")).length;
    assert(chunkedGet.status === 400 && conflictingFraming.status === 400 && negativeContentLength.status === 400, "Chunked GET, conflicting framing, and negative Content-Length should be rejected at the HTTP boundary.");
    assert(oversizedChunkedDelete.status === 413 && oversizedChunkedPut.status === 413, "Chunked PUT and DELETE should enforce their method-specific streaming byte limits.");
    assert(authCallsAfterHeaderRejections === authCallsBeforeHeaderRejections, "Framing and streaming size rejections must occur before calling the account provider.");
    const invalidSyncJson = await syncFetch("PUT", { rawBody: "{" });
    const nullSyncJson = await syncFetch("DELETE", { rawBody: "null" });
    assert(invalidSyncJson.status === 400 && invalidSyncJson.json.code === "INVALID_JSON", "Cloud sync should distinguish malformed JSON.");
    assert(nullSyncJson.status === 400 && nullSyncJson.json.code === "JSON_BODY_REQUIRED", "Cloud sync should distinguish a JSON null body.");

    const firstPayload = { records: [{ id: "local-record", value: "private-local-value" }] };
    const firstEnvelope = { baseRevision: 0, schemaVersion: 1, checksum: checksumPayload(firstPayload), payload: firstPayload };
    const checksumMismatch = await syncFetch("PUT", { body: { ...firstEnvelope, checksum: "0".repeat(64) } });
    const forgedUserCallCount = cloudProvider.calls.length;
    const forgedUser = await syncFetch("PUT", { body: { ...firstEnvelope, userId: "22222222-2222-4222-8222-222222222222" } });
    assert(checksumMismatch.status === 422 && forgedUser.status === 422 && cloudProvider.calls.length === forgedUserCallCount, "Invalid checksums and forged user IDs should be rejected before the provider call.");

    const oversizedRawSync = await syncFetch("PUT", { rawBody: `{"padding":"${"界".repeat(Math.ceil(CLOUD_SYNC_LIMITS.maxEnvelopeBytes / 3))}"}` });
    assert(oversizedRawSync.status === 413 && oversizedRawSync.json.code === "SYNC_ENVELOPE_TOO_LARGE", "The raw HTTP envelope should have an independent UTF-8 byte limit.");

    const firstPut = await syncFetch("PUT", { body: firstEnvelope });
    const stalePut = await syncFetch("PUT", { body: firstEnvelope });
    const firstGet = await syncFetch("GET");
    assert(firstPut.status === 200 && firstPut.json.revision === 1 && firstPut.json.payload.records[0].id === "local-record", "PUT should create revision 1 for the authenticated account.");
    assert(stalePut.status === 409 && stalePut.json.conflict.revision === 1, "A stale PUT should return a structured revision conflict.");
    assert(firstGet.status === 200 && firstGet.json.exists && firstGet.json.revision === 1 && firstGet.json.checksum === firstEnvelope.checksum, "GET should return the authenticated account snapshot.");
    assert(cloudProvider.calls.every(call => call.body.p_user_id === fakeAccountUser.id), "Only the account resolution user ID may reach cloud RPCs.");

    const firstDelete = await syncFetch("DELETE", { body: { baseRevision: 1 } });
    const tombstoneGet = await syncFetch("GET");
    assert(firstDelete.status === 200 && !firstDelete.json.exists && firstDelete.json.revision === 2, "DELETE should create an incremented tombstone revision.");
    assert(tombstoneGet.status === 200 && !tombstoneGet.json.exists && tombstoneGet.json.revision === 2 && !("payload" in tombstoneGet.json), "GET should preserve a content-free tombstone revision.");

    const fixedCanonicalBytes = Buffer.byteLength(canonicalizeSyncPayload({ value: "" }), "utf8");
    const remainingCanonicalBytes = CLOUD_SYNC_LIMITS.maxCanonicalBytes - fixedCanonicalBytes;
    const exactBoundaryText = "界".repeat(Math.floor(remainingCanonicalBytes / 3)) + "x".repeat(remainingCanonicalBytes % 3);
    const exactBoundaryPayload = { value: exactBoundaryText };
    assert(Buffer.byteLength(canonicalizeSyncPayload(exactBoundaryPayload), "utf8") === CLOUD_SYNC_LIMITS.maxCanonicalBytes, "Smoke fixture should land exactly on the canonical UTF-8 boundary.");
    const exactBoundaryPut = await syncFetch("PUT", { body: { baseRevision: 2, schemaVersion: 1, checksum: checksumPayload(exactBoundaryPayload), payload: exactBoundaryPayload } });
    const aboveBoundaryPayload = { value: `${exactBoundaryText}x` };
    const aboveBoundaryPut = await syncFetch("PUT", { body: { baseRevision: 3, schemaVersion: 1, checksum: checksumPayload(aboveBoundaryPayload), payload: aboveBoundaryPayload } });
    assert(exactBoundaryPut.status === 200 && exactBoundaryPut.json.revision === 3, `A canonical payload exactly at the UTF-8 limit should succeed (received ${exactBoundaryPut.status}: ${exactBoundaryPut.text.slice(0, 160)}).`);
    assert(aboveBoundaryPut.status === 413 && aboveBoundaryPut.json.code === "SYNC_PAYLOAD_TOO_LARGE", "A canonical payload one UTF-8 byte above the limit should return 413.");
    const exactDeletePrefix = JSON.stringify({ baseRevision: 3 });
    const exactDeleteBody = exactDeletePrefix + " ".repeat(deleteSyncEnvelopeBytes - Buffer.byteLength(exactDeletePrefix));
    const exactDelete = await syncFetch("DELETE", { rawBody: exactDeleteBody });
    const authCallsBeforeOversizedDelete = authProviderCalls.filter(call => call.path.startsWith("/auth/v1/")).length;
    const oversizedDelete = await syncFetch("DELETE", { rawBody: `${exactDeleteBody} ` });
    const authCallsAfterOversizedDelete = authProviderCalls.filter(call => call.path.startsWith("/auth/v1/")).length;
    assert(Buffer.byteLength(exactDeleteBody) === deleteSyncEnvelopeBytes && exactDelete.status === 200 && exactDelete.json.revision === 4, "DELETE should accept an exact method-specific raw envelope boundary.");
    assert(oversizedDelete.status === 413 && authCallsAfterOversizedDelete === authCallsBeforeOversizedDelete, "DELETE should reject one byte above its raw limit before account lookup.");

    cloudProvider.mode = "malformed";
    const malformedProvider = await syncFetch("GET");
    cloudProvider.mode = "failure";
    const failedProvider = await syncFetch("GET");
    cloudProvider.mode = "timeout";
    const timedOutProvider = await syncFetch("GET");
    cloudProvider.mode = "normal";
    assert(malformedProvider.status === 502 && failedProvider.status === 502 && timedOutProvider.status === 504, "Cloud sync should classify malformed, failed, and timed-out providers without leaking provider details.");

    const refreshedSync = await syncFetch("GET", { cookie: "hf_account_access=expired; hf_account_refresh=smoke-refresh-token" });
    assert(refreshedSync.status === 200 && refreshedSync.setCookie?.includes("refreshed-access-token"), "Cloud sync should apply rotated authentication cookies.");
    const missingFetchMetadata = await syncFetch("GET", { headers: { origin: undefined, "sec-fetch-site": undefined } });
    const noneFetchMetadata = await syncFetch("GET", { headers: { origin: undefined, "sec-fetch-site": "none" } });
    assert(missingFetchMetadata.status === 200 && noneFetchMetadata.status === 200, "Non-browser clients with missing metadata and reasonable Sec-Fetch-Site none requests should be accepted.");

    const ipLimitResults = {};
    for (const method of ["GET", "PUT", "DELETE"]) {
      let result;
      for (let index = 0; index <= 5; index += 1) {
        result = await syncFetch(method, {
          cookie: false,
          rawBody: method === "GET" ? undefined : "{}",
          forwardedFor: `198.51.100.${160 + index}, 203.0.113.${10 + ["GET", "PUT", "DELETE"].indexOf(method)}`
        });
      }
      ipLimitResults[method] = result;
      assert(result.status === 429 && Number(result.retryAfter) > 0, `${method} should enforce an independent pre-authentication IP limit with Retry-After.`);
    }
    let invalidForwardedIpLimit;
    for (let index = 0; index <= 5; index += 1) {
      invalidForwardedIpLimit = await syncFetch("GET", {
        cookie: false,
        forwardedFor: `198.51.100.${170 + index}, invalid-client-${index}`
      });
    }
    assert(invalidForwardedIpLimit.status === 429, "Invalid trusted-side client IPs should fall back to the direct peer, so attacker prefixes cannot rotate the rate-limit key.");

    const accountLimitResults = {};
    for (const method of ["GET", "PUT", "DELETE"]) {
      let result;
      for (let index = 0; index < 25; index += 1) {
        result = await syncFetch(method, {
          rawBody: method === "GET" ? undefined : "{",
          ip: `192.0.2.${20 + index}`
        });
        if (result.status === 429) break;
      }
      accountLimitResults[method] = result;
      assert(result.status === 429 && Number(result.retryAfter) > 0, `${method} should enforce an independent authenticated-account limit with Retry-After.`);
    }

    const cloudErrorTexts = [
      cloudUnconfiguredText,
      unsignedSync.text,
      invalidSyncJson.text,
      nullSyncJson.text,
      checksumMismatch.text,
      forgedUser.text,
      oversizedRawSync.text,
      stalePut.text,
      aboveBoundaryPut.text,
      malformedProvider.text,
      failedProvider.text,
      timedOutProvider.text,
      ...Object.values(unsignedSyncByMethod).map(result => result.text),
      ...Object.values(ipLimitResults).map(result => result.text),
      invalidForwardedIpLimit.text,
      ...Object.values(accountLimitResults).map(result => result.text)
    ].join("\n");
    assert(syncResponses.every(result => result.cacheControl === "no-store"), "Every cloud sync response should disable caching.");
    assert(!["smoke-anon-key", "smoke-service-role", "smoke-access-token", "smoke-refresh-token", "PRIVATE_UPSTREAM_MESSAGE", "private-local-value"].some(secret => cloudErrorTexts.includes(secret)), "Cloud sync errors must not expose secrets, provider messages, tokens, or request payloads.");
    const cloudSyncHttp = {
      unconfigured: cloudUnconfiguredResponse.status,
      unauthenticated: unsignedSync.status,
      invalidJson: invalidSyncJson.status,
      nullJson: nullSyncJson.status,
      invalidChecksum: checksumMismatch.status,
      forgedUser: forgedUser.status,
      oversizedEnvelope: oversizedRawSync.status,
      put: firstPut.status,
      conflict: stalePut.status,
      get: firstGet.status,
      delete: firstDelete.status,
      tombstoneRevision: tombstoneGet.json.revision,
      exactBoundary: exactBoundaryPut.status,
      aboveBoundary: aboveBoundaryPut.status,
      exactDeleteBoundary: exactDelete.status,
      aboveDeleteBoundary: oversizedDelete.status,
      providerMalformed: malformedProvider.status,
      providerFailure: failedProvider.status,
      providerTimeout: timedOutProvider.status,
      refreshedCookie: refreshedSync.status,
      ipLimits: Object.fromEntries(Object.entries(ipLimitResults).map(([method, result]) => [method, result.status])),
      invalidForwardedIpLimit: invalidForwardedIpLimit.status,
      accountLimits: Object.fromEntries(Object.entries(accountLimitResults).map(([method, result]) => [method, result.status]))
    };
    const secureVerifyResponse = await fetch(`${baseUrl}/api/account/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `https://localhost:${appPort}`,
        "x-forwarded-for": "203.0.113.250, 198.51.100.30",
        "x-forwarded-proto": "http, https"
      },
      body: JSON.stringify({ email: fakeAccountUser.email, token: "123456" })
    });
    const secureCookies = getResponseCookies(secureVerifyResponse);
    const invalidForwardedVerifyResponse = await fetch(`${baseUrl}/api/account/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-forwarded-for": "203.0.113.251, not-an-ip",
        "x-forwarded-proto": "https, ftp"
      },
      body: JSON.stringify({ email: fakeAccountUser.email, token: "123456" })
    });
    const invalidForwardedCookies = getResponseCookies(invalidForwardedVerifyResponse);
    const signedInSessionResponse = await fetch(`${baseUrl}/api/account/session`, { headers: { cookie: verifiedCookies.header } });
    const signedInSessionPayload = await signedInSessionResponse.json();
    const refreshedSessionResponse = await fetch(`${baseUrl}/api/account/session`, {
      headers: { cookie: "hf_account_access=expired; hf_account_refresh=smoke-refresh-token" }
    });
    const refreshedSessionPayload = await refreshedSessionResponse.json();
    const refreshedCookies = getResponseCookies(refreshedSessionResponse);
    const signoutAccountResponse = await fetch(`${baseUrl}/api/account/signout`, {
      method: "POST",
      headers: { cookie: verifiedCookies.header, origin: baseUrl }
    });
    const signoutCookies = getResponseCookies(signoutAccountResponse);
    const accountMethodResponse = await fetch(`${baseUrl}/api/account/request-code`);
    let accountRateLimitResponse;
    for (let request = 0; request < 6; request += 1) {
      accountRateLimitResponse = await fetch(`${baseUrl}/api/account/request-code`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "198.51.100.20" },
        body: JSON.stringify({ email: fakeAccountUser.email })
      });
    }
    let rateLimitResponse;
    for (let request = 0; request < 8; request += 1) {
      rateLimitResponse = await fetch(`${baseUrl}/api/advice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validAdvicePayload)
      });
    }
    const serverHttp = {
      csp: indexResponse.headers.get("content-security-policy"),
      frameOptions: indexResponse.headers.get("x-frame-options"),
      requestId: healthResponse.headers.get("x-request-id"),
      health: healthPayload,
      indexCache: indexResponse.headers.get("cache-control"),
      landingReady: landingHtml.includes("今天练什么，不用再猜") && landingHtml.includes("WhatToDrill") && landingHtml.includes('href="./app/"'),
      appStatus: appResponse.status,
      appReady: appHtml.includes('id="mainContent"') && appHtml.includes('../app.js'),
      privacyStatus: privacyResponse.status,
      privacyCache: privacyResponse.headers.get("cache-control"),
      termsStatus: termsResponse.status,
      termsCsp: termsResponse.headers.get("content-security-policy"),
      updateMessageHandler: serviceWorkerSource.includes("SKIP_WAITING"),
      iconCacheEntries: Object.keys(iconChecks).every(name => serviceWorkerSource.includes(name)),
      scopeAwareShell: serviceWorkerSource.includes("self.registration.scope") && serviceWorkerSource.includes("cache.put(request"),
      relativeWorkerRegistration: appSource.includes('serviceWorker.register("../sw.js")'),
      manifestIcons: manifest.icons,
      manifestId: manifest.id,
      manifestStartUrl: manifest.start_url,
      manifestScope: manifest.scope,
      subpathManifest,
      iconChecks,
      assetCache: versionedAssetResponse.headers.get("cache-control"),
      headStatus: headResponse.status,
      invalidJsonStatus: invalidJsonResponse.status,
      missingKeyStatus: missingKeyResponse.status,
      invalidPayloadStatus: invalidPayloadResponse.status,
      unsupportedFieldStatus: unsupportedFieldResponse.status,
      oversizedStatus: oversizedResponse.status,
      methodStatus: methodResponse.status,
      accountSession: accountSessionPayload,
      crossSiteAccountStatus: crossSiteAccountResponse.status,
      invalidAccountEmailStatus: invalidAccountEmailResponse.status,
      oversizedAccountStatus: oversizedAccountResponse.status,
      accountCodeStatus: accountCodeResponse.status,
      invalidAccountCodeStatus: invalidAccountCodeResponse.status,
      verifyAccountStatus: verifyAccountResponse.status,
      verifiedAccount: verifiedAccountPayload,
      accountCookieCount: verifiedCookies.values.length,
      accountCookiesStrict: verifiedCookies.values.every(value => value.includes("HttpOnly") && value.includes("SameSite=Strict") && value.includes("Path=/")),
      accountCookiesSecure: verifiedCookies.values.some(value => value.includes("Secure")),
      forwardedHttpsCookiesSecure: secureVerifyResponse.status === 200 && secureCookies.values.length === 2 && secureCookies.values.every(value => value.includes("Secure")),
      invalidForwardedTokensRejected: invalidForwardedVerifyResponse.status === 200 && invalidForwardedCookies.values.length === 2 && invalidForwardedCookies.values.every(value => !value.includes("Secure")),
      signedInSession: signedInSessionPayload,
      refreshedSession: refreshedSessionPayload,
      refreshedCookieRotated: refreshedCookies.values.some(value => value.includes("refreshed-access-token")),
      signoutStatus: signoutAccountResponse.status,
      signoutCookiesCleared: signoutCookies.values.length === 2 && signoutCookies.values.every(value => value.includes("Max-Age=0")),
      accountMethodStatus: accountMethodResponse.status,
      accountRateLimitStatus: accountRateLimitResponse.status,
      providerLogoutNotified: authProviderCalls.some(call => call.path === "/auth/v1/logout" && call.authorization === "Bearer smoke-access-token"),
      rateLimitStatus: rateLimitResponse.status,
      retryAfter: rateLimitResponse.headers.get("retry-after")
    };
    assert(serverHttp.csp?.includes("frame-ancestors 'none'"), "Static responses should include a restrictive CSP.");
    assert(serverHttp.frameOptions === "DENY", "Static responses should prevent framing.");
    assert(/^[0-9a-f-]{36}$/i.test(serverHttp.requestId), "API responses should expose a generated request ID.");
    assert(serverHttp.health.status === "ok" && serverHttp.health.version === "1.22.0", "Health response should expose status and release version.");
    assert(Number.isInteger(serverHttp.health.uptimeSeconds) && serverHttp.health.uptimeSeconds >= 0, "Health response should expose a valid uptime.");
    assert(serverHttp.health.openaiConfigured === false && serverHttp.health.accountConfigured === true && serverHttp.health.entitlementConfigured === false && serverHttp.health.cloudSyncConfigured === true && serverHttp.health.aiAccessMode === "deployment_shared" && serverHttp.health.model === "gpt-5-mini", "Health response should expose independent, non-secret service configuration state.");
    assert(serverHttp.indexCache === "no-cache", "HTML should revalidate instead of using a stale shell.");
    assert(serverHttp.landingReady, "Root should serve the beginner landing page with an app entry.");
    assert(serverHttp.appStatus === 200 && serverHttp.appReady, "The app route should serve the application shell with parent-relative assets.");
    assert(serverHttp.privacyStatus === 200 && serverHttp.termsStatus === 200, "Legal pages should be served as public product pages.");
    assert(serverHttp.privacyCache === "no-cache", "Privacy policy should revalidate so users receive policy updates.");
    assert(serverHttp.termsCsp?.includes("frame-ancestors 'none'"), "Legal pages should receive the same security headers as the app.");
    assert(serverHttp.updateMessageHandler, "Service worker should support user-confirmed activation.");
    assert(serverHttp.iconCacheEntries, "PWA app shell should cache every raster install icon.");
    assert(serverHttp.scopeAwareShell && serverHttp.relativeWorkerRegistration, "PWA registration and shell caching should follow the actual deployment scope.");
    assert(serverHttp.manifestId === "./app/" && serverHttp.manifestStartUrl === "./app/" && serverHttp.manifestScope === "./" && serverHttp.manifestIcons.every(icon => icon.src.startsWith("./")), "Manifest URLs should keep the app start route and deployment-relative scope.");
    assert(serverHttp.subpathManifest.id === "/Daily-Workout-Record/app/" && serverHttp.subpathManifest.startUrl === "/Daily-Workout-Record/app/" && serverHttp.subpathManifest.scope === "/Daily-Workout-Record/" && serverHttp.subpathManifest.icons.every(path => path.startsWith("/Daily-Workout-Record/")), "Manifest URLs should resolve the app inside a GitHub Pages project subpath.");
    assert(serverHttp.manifestIcons.some(icon => icon.sizes === "192x192" && icon.purpose === "any"), "Manifest should declare a standard 192px icon.");
    assert(serverHttp.manifestIcons.some(icon => icon.sizes === "512x512" && icon.purpose === "any"), "Manifest should declare a standard 512px icon.");
    assert(serverHttp.manifestIcons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"), "Manifest should declare a separate maskable icon.");
    assert(Object.values(serverHttp.iconChecks).every(icon => icon.status === 200 && icon.type === "image/png" && icon.dimensions?.width === icon.expectedSize && icon.dimensions?.height === icon.expectedSize), "Raster install icons should be valid PNG files with their declared dimensions.");
    assert(serverHttp.assetCache.includes("immutable"), "Versioned assets should use immutable caching.");
    assert(serverHttp.headStatus === 200, "Static files should support HEAD requests.");
    assert(serverHttp.invalidJsonStatus === 400, "Malformed advice JSON should return 400.");
    assert(serverHttp.missingKeyStatus === 501, "Advice should explain when the API key is unavailable.");
    assert(serverHttp.invalidPayloadStatus === 422, "Advice should reject payloads that do not follow the product schema.");
    assert(serverHttp.unsupportedFieldStatus === 422, "Advice should reject arbitrary top-level prompt fields.");
    assert(serverHttp.oversizedStatus === 413, "Oversized advice payloads should return 413.");
    assert(serverHttp.methodStatus === 405, "Unsupported API methods should return 405.");
    assert(serverHttp.accountSession.configured && !serverHttp.accountSession.signedIn, "Configured account service should return a truthful signed-out session.");
    assert(serverHttp.crossSiteAccountStatus === 403, "Cross-site account mutations should be rejected.");
    assert(serverHttp.invalidAccountEmailStatus === 422 && serverHttp.invalidAccountCodeStatus === 422, "Account endpoints should validate email and verification code shape.");
    assert(serverHttp.oversizedAccountStatus === 413, "Oversized account payloads should return a stable 413 response.");
    assert(serverHttp.accountCodeStatus === 202 && serverHttp.verifyAccountStatus === 200, "Account endpoints should send and verify a valid email code.");
    assert(serverHttp.verifiedAccount.signedIn && serverHttp.verifiedAccount.user?.id === fakeAccountUser.id, "Successful verification should return only the authenticated user summary.");
    assert(serverHttp.accountCookieCount === 2 && serverHttp.accountCookiesStrict, "Account tokens should be stored in strict HttpOnly cookies.");
    assert(!serverHttp.accountCookiesSecure, "Local HTTP development cookies should not require HTTPS.");
    assert(serverHttp.forwardedHttpsCookiesSecure, "Trusted HTTPS deployments should mark every account cookie Secure.");
    assert(serverHttp.invalidForwardedTokensRejected, "Invalid trusted-side forwarding tokens must fall back to the direct connection instead of trusting an attacker prefix.");
    assert(serverHttp.signedInSession.signedIn && serverHttp.signedInSession.dataScope === "local_only", "A valid access cookie should restore the account session without implying sync.");
    assert(serverHttp.refreshedSession.signedIn && serverHttp.refreshedCookieRotated, "An expired access token should refresh and rotate account cookies.");
    assert(serverHttp.signoutStatus === 200 && serverHttp.signoutCookiesCleared, "Sign out should clear both local account cookies.");
    assert(serverHttp.accountMethodStatus === 405 && serverHttp.accountRateLimitStatus === 429, "Account routes should enforce methods and independent rate limits.");
    assert(serverHttp.providerLogoutNotified, "Sign out should notify the identity provider without exposing tokens to the client response.");
    assert(serverHttp.rateLimitStatus === 429, "Advice requests should be rate limited.");
    assert(Number(serverHttp.retryAfter) > 0, "Rate limit responses should include Retry-After.");

    await waitForHttp(`http://localhost:${chromePort}/json/version`);
    const pages = await getJson(`http://localhost:${chromePort}/json/list`);
    const page = pages.find(item => item.type === "page") || pages[0];
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCookies");
    await navigate(cdp, appUrl);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });
    await evaluate(cdp, `activeWorkoutSession = null; clearWorkoutForm(); localStorage.removeItem(${JSON.stringify(storageKey)}); localStorage.removeItem(${JSON.stringify(workoutDraftKey)})`);
    await reload(cdp);

    const todayCheck = await evaluate(cdp, `(() => ({
      localToday: today(),
      inputDate: document.querySelector("#dailyDate").value,
      lastTrendDate: getLastDays(7).at(-1),
      recentIncludesToday: getRecent([{ date: today() }], 7).length,
      title: document.title,
      firstUseText: document.querySelector("#today")?.innerText,
      coachStatus: document.querySelector(".coach-status")?.textContent,
      coachTitle: document.querySelector(".coach-decision strong")?.textContent,
      primaryStartButtons: Array.from(document.querySelectorAll("#today button")).filter(button => {
        const style = getComputedStyle(button);
        const bounds = button.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.backgroundColor === "rgb(31, 114, 95)";
      }).map(button => button.id),
      headerTechnicalAbsent: !document.querySelector("header #accountStatus") && !document.querySelector("header #offlineStatus") && !document.querySelector("header #installStatus"),
      settingsStatusPresent: Boolean(document.querySelector("#technicalSettingsPanel #accountStatus") && document.querySelector("#technicalSettingsPanel #exportBtn")),
      onboardingVisible: !document.querySelector("#starterGuide").hidden,
      extendedDailyHidden: document.querySelector("#extendedDailyRecord")?.hidden,
      weeklyTargetHidden: document.querySelector("#weeklyTargetPanel")?.hidden,
      supportAgreementHidden: document.querySelector("#supportAgreementPanel")?.hidden,
      safetyHidden: document.querySelector("#safetyStrip")?.hidden,
      retentionTitle: document.querySelector("#retentionInsights h3")?.textContent,
      retentionHidden: document.querySelector("#retentionInsights")?.hidden,
      progressEmptyVisible: !document.querySelector("#progressEmptyState")?.hidden,
      retentionConfidence: document.querySelector("#retentionInsights .confidence-pill")?.textContent,
      retentionText: document.querySelector("#retentionInsights")?.innerText,
      safetyText: document.querySelector("#safetyStrip")?.innerText,
      weeklyTargetText: document.querySelector("#weeklyTargetPanel")?.innerText,
      quality: (() => {
        const meter = document.querySelector(".weekly-target-meter");
        const underHeight = Array.from(document.querySelectorAll("button"))
          .filter(button => {
            const style = getComputedStyle(button);
            const rect = button.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0 && rect.height < 44;
          })
          .map(button => button.id || button.textContent.trim());
        const contrast = element => {
          const parse = value => (value.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
          const luminance = value => {
            const channels = parse(value).map(channel => {
              const normalized = channel / 255;
              return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          };
          const style = getComputedStyle(element);
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        };
        const hasReducedMotionRule = Array.from(document.styleSheets).some(sheet =>
          Array.from(sheet.cssRules || []).some(rule => rule.media?.mediaText.includes("prefers-reduced-motion"))
        );
        return {
          initializing: document.body.classList.contains("app-initializing"),
          mainBusy: document.querySelector("#mainContent").getAttribute("aria-busy"),
          meterRole: meter?.getAttribute("role"),
          meterNow: meter?.getAttribute("aria-valuenow"),
          meterText: meter?.getAttribute("aria-valuetext"),
          underHeight,
          inlineStyleCount: document.querySelectorAll("[style]").length,
          hasReducedMotionRule
        };
      })(),
      exerciseProgressText: document.querySelector("#exerciseProgress")?.innerText,
      exerciseProgressHidden: document.querySelector("#exerciseProgress")?.hidden,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(todayCheck.localToday === todayCheck.inputDate, "Today input should use local browser date.");
    assert(todayCheck.lastTrendDate === todayCheck.localToday, "Trend windows should end on local today.");
    assert(todayCheck.recentIncludesToday === 1, "Recent filters should include local today.");
    assert(todayCheck.title === "WhatToDrill · 今天练什么", "The application should use the approved product name.");
    assert(!todayCheck.firstUseText.includes("Personal log") && !todayCheck.firstUseText.includes("Daily Coach"), "The first-use surface should not expose legacy English headings.");
    assert(todayCheck.coachStatus === "首次训练", "Empty daily coach should identify the one-time training setup.");
    assert(todayCheck.coachTitle === "为你匹配第一套训练", "Empty daily coach should not assume gym access before setup.");
    assert(todayCheck.primaryStartButtons.length === 1 && todayCheck.primaryStartButtons[0] === "startCoachWorkoutBtn", `The first-use home should expose one visually primary start action: ${JSON.stringify(todayCheck.primaryStartButtons)}.`);
    assert(todayCheck.headerTechnicalAbsent && todayCheck.settingsStatusPresent, "Normal first-use home should keep technical controls out of the header and preserve them in settings.");
    assert(!todayCheck.onboardingVisible && todayCheck.extendedDailyHidden && todayCheck.weeklyTargetHidden && todayCheck.supportAgreementHidden, "First-use home should hide onboarding, extended records, weekly targets, and support agreements.");
    assert(todayCheck.progressEmptyVisible && todayCheck.retentionHidden, "First-run insights should show one useful start state instead of an empty review dashboard.");
    assert(todayCheck.safetyHidden, "Normal first-use home should keep generic safety copy out of the primary path.");
    assert(!todayCheck.quality.initializing && todayCheck.quality.mainBusy === "false", "The active panel should be revealed only after synchronous initialization finishes.");
    assert(todayCheck.quality.meterRole === "progressbar" && todayCheck.quality.meterNow === "0" && todayCheck.quality.meterText.includes("0/2"), "Weekly target progress should expose valid current-value semantics.");
    assert(todayCheck.quality.underHeight.length === 0, `Visible buttons should provide a 44px touch target: ${todayCheck.quality.underHeight.join(", ")}`);
    assert(todayCheck.quality.inlineStyleCount === 0, "Rendered app content should not use inline styles that violate the production CSP.");
    assert(todayCheck.quality.hasReducedMotionRule, "The interface should respect reduced-motion preferences.");
    assert(todayCheck.exerciseProgressHidden, "Empty exercise progress should stay hidden until the user repeats an exercise.");
    assert(!todayCheck.overflow, "Today desktop layout should not overflow.");

    const supportAgreement = await evaluate(cdp, `(() => {
      const emptyText = document.querySelector("#supportAgreementPanel").innerText;
      document.querySelector("#openSupportAgreementBtn").click();
      const opened = document.querySelector("#supportAgreementDialog").open;
      const focused = document.activeElement?.id;
      document.querySelector("#supportRole").value = "friend";
      document.querySelector("#supportCadence").value = "twice_weekly";
      document.querySelector("#supportStyle").value = "activity";
      document.querySelector("#supportBoundary").value = "no_pressure";
      document.querySelector("#supportAgreementForm").requestSubmit();
      const friend = state.settings.supportPartners[0];
      const firstDate = friend.nextDate;
      const invitation = buildSupportInvitation(friend);
      document.querySelector("#openSupportAgreementBtn").click();
      document.querySelector("#supportRole").value = "coach";
      document.querySelector("#supportCadence").value = "weekly";
      document.querySelector("#supportStyle").value = "accountability";
      document.querySelector("#supportBoundary").value = "ask_first";
      document.querySelector("#supportAgreementForm").requestSubmit();
      const coach = state.settings.supportPartners[1];
      state.settings = normalizeSettings({
        ...state.settings,
        plannedWorkoutDays: [1, 4]
      });
      const accountabilityInvitation = buildSupportInvitation(coach);
      const savedText = document.querySelector("#supportAgreementPanel").innerText;
      document.querySelector('[data-support-partner-id="' + friend.id + '"] [data-support-action="checkin"]').click();
      const checkinOpened = document.querySelector("#supportCheckinDialog").open;
      const checkinFocused = document.activeElement?.value;
      document.querySelector('input[name="supportCheckinScore"][value="4"]').checked = true;
      document.querySelector("#supportCheckinForm").requestSubmit();
      const persisted = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).settings;
      const normalizedInvalid = normalizeSettings({
        supportPartners: Array.from({ length: 8 }, (_, index) => ({
          id: index === 1 ? "bad id!" : "partner_" + index,
          role: index === 0 ? "attacker" : "friend",
          cadence: index === 0 ? "hourly" : "weekly",
          style: index === 0 ? "PRIVATE_HEALTH_DATA" : "activity",
          boundary: index === 0 ? "unknown" : "no_pressure",
          nextDate: index === 0 ? "not-a-date" : today(),
          checkins: [{ date: today(), score: index === 0 ? 6 : 4 }]
        }))
      });
      return {
        emptyText,
        opened,
        focused,
        checkinOpened,
        checkinFocused,
        firstDate,
        secondDate: state.settings.supportPartners.find(item => item.id === friend.id)?.nextDate,
        coachDate: state.settings.supportPartners.find(item => item.id === coach.id)?.nextDate,
        coachCheckins: state.settings.supportPartners.find(item => item.id === coach.id)?.checkins,
        expectedFirst: addLocalDays(today(), 3),
        expectedSecond: addLocalDays(today(), 6),
        expectedCoach: addLocalDays(today(), 7),
        invitation,
        accountabilityInvitation,
        savedText,
        persisted,
        normalizedInvalid,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(supportAgreement.emptyText.includes("建立支持约定"), "First run should explain how to create a support agreement.");
    assert(supportAgreement.opened && supportAgreement.focused === "supportRole", "Support agreement should open and focus its first field.");
    assert(supportAgreement.checkinOpened && supportAgreement.checkinFocused === "3", "Completing a support check-in should ask for a focused local reflection.");
    assert(supportAgreement.firstDate === supportAgreement.expectedFirst && supportAgreement.secondDate === supportAgreement.expectedSecond, "Support check-ins should advance by the selected cadence.");
    assert(supportAgreement.savedText.includes("与朋友的支持约定") && supportAgreement.savedText.includes("与教练的支持约定") && supportAgreement.savedText.includes("每周两次"), "Saved support agreement should summarize independent partners and cadence.");
    assert(supportAgreement.invitation.includes("陪我完成一次轻松活动") && supportAgreement.invitation.includes("不要催促、比较"), "Support invitation should reflect the selected support and boundary.");
    assert(supportAgreement.accountabilityInvitation.includes("周一、周四") && supportAgreement.accountabilityInvitation.includes("问问我是否需要支持"), "Accountability invitations should turn a weekly rhythm into a concrete support cue.");
    assert(!supportAgreement.invitation.includes("疼痛：") && !supportAgreement.invitation.includes("睡眠：") && !supportAgreement.invitation.includes("PRIVATE_HEALTH_DATA") && !supportAgreement.accountabilityInvitation.includes("疼痛：") && !supportAgreement.accountabilityInvitation.includes("支持感"), "Support invitations must not include health, training, or reflection values.");
    assert(supportAgreement.persisted.supportEnabled && supportAgreement.persisted.supportRole === "friend" && supportAgreement.persisted.supportPartners?.length === 2 && supportAgreement.persisted.supportCheckins?.[0]?.score === 4 && supportAgreement.coachDate === supportAgreement.expectedCoach && supportAgreement.coachCheckins.length === 0, "Partner records should persist locally while each partner keeps independent dates and reflections.");
    assert(supportAgreement.normalizedInvalid.supportPartners.length === 6 && supportAgreement.normalizedInvalid.supportPartners[0].role === "family" && supportAgreement.normalizedInvalid.supportPartners[0].cadence === "weekly" && supportAgreement.normalizedInvalid.supportPartners[0].nextDate === "" && supportAgreement.normalizedInvalid.supportPartners[0].checkins.length === 0, "Imported support partners should normalize allowlists, reflection data, IDs, and partner count.");
    assert(!supportAgreement.overflow, "Support agreement should not overflow on desktop.");

    const accessibleTabs = await evaluate(cdp, `(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const relationsValid = tabs.every(tab => {
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        return panel?.getAttribute("role") === "tabpanel" && panel.getAttribute("aria-labelledby") === tab.id;
      });
      const initial = {
        selected: tabs.filter(tab => tab.getAttribute("aria-selected") === "true").map(tab => tab.dataset.tab),
        tabbable: tabs.filter(tab => tab.tabIndex === 0).map(tab => tab.dataset.tab),
        hiddenPanels: document.querySelectorAll('[role="tabpanel"][hidden]').length
      };
      tabs[0].focus();
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      const afterRight = {
        active: document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab,
        focused: document.activeElement?.dataset.tab,
        panelVisible: !document.querySelector("#workout").hidden
      };
      tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      const afterEnd = {
        active: document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab,
        focused: document.activeElement?.dataset.tab
      };
      tabs.at(-1).dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      const afterHome = {
        active: document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab,
        focused: document.activeElement?.dataset.tab,
        panelVisible: !document.querySelector("#today").hidden
      };
      const skipLink = document.querySelector(".skip-link");
      return {
        tablistRole: document.querySelector(".tabs")?.getAttribute("role"),
        tabCount: tabs.length,
        relationsValid,
        initial,
        afterRight,
        afterEnd,
        afterHome,
        skipTarget: skipLink?.getAttribute("href"),
        mainTabIndex: document.querySelector("#mainContent")?.tabIndex
      };
    })()`);
    assert(accessibleTabs.tablistRole === "tablist" && accessibleTabs.tabCount === 4 && accessibleTabs.relationsValid, "Main navigation should expose the four primary destinations with complete tab and tabpanel relationships.");
    assert(accessibleTabs.initial.selected.join() === "today" && accessibleTabs.initial.tabbable.join() === "today" && accessibleTabs.initial.hiddenPanels === 3, "Exactly one initial tab should be selected and tabbable while inactive panels stay hidden.");
    assert(accessibleTabs.afterRight.active === "workout" && accessibleTabs.afterRight.focused === "workout" && accessibleTabs.afterRight.panelVisible, "ArrowRight should activate and focus the next tab.");
    assert(accessibleTabs.afterEnd.active === "mine" && accessibleTabs.afterEnd.focused === "mine", "End should activate and focus the last primary tab.");
    assert(accessibleTabs.afterHome.active === "today" && accessibleTabs.afterHome.focused === "today" && accessibleTabs.afterHome.panelVisible, "Home should return to the first tab and panel.");
    assert(accessibleTabs.skipTarget === "#mainContent" && accessibleTabs.mainTabIndex === -1, "Skip link should target programmatically focusable main content.");

    const waterStepDialog = await evaluate(cdp, `(() => {
      document.querySelector("#waterStepBtn").click();
      const opened = document.querySelector("#waterStepDialog").open;
      const focused = document.activeElement?.id;
      const original = state.settings.waterStepMl;
      const input = document.querySelector("#waterStepInput");
      input.value = "325";
      document.querySelector("#waterStepForm").requestSubmit();
      const invalid = {
        open: document.querySelector("#waterStepDialog").open,
        error: document.querySelector("#waterStepError").textContent,
        unchanged: state.settings.waterStepMl === original
      };
      document.querySelector("#cancelWaterStepBtn").click();
      const cancelled = !document.querySelector("#waterStepDialog").open;
      document.querySelector("#waterStepBtn").click();
      input.value = "350";
      document.querySelector("#waterStepForm").requestSubmit();
      return {
        opened,
        focused,
        invalid,
        cancelled,
        saved: state.settings.waterStepMl,
        button: document.querySelector("#waterStepBtn").textContent,
        closed: !document.querySelector("#waterStepDialog").open
      };
    })()`);
    assert(waterStepDialog.opened && waterStepDialog.focused === "waterStepInput", "Water shortcut dialog should open with input focused.");
    assert(waterStepDialog.invalid.open && waterStepDialog.invalid.error.includes("50 到 2000") && waterStepDialog.invalid.unchanged, "Invalid water shortcut should stay open and preserve settings.");
    assert(waterStepDialog.cancelled, "Cancelling water shortcut should close without changes.");
    assert(waterStepDialog.saved === 350 && waterStepDialog.button.includes("350") && waterStepDialog.closed, "Valid water shortcut should save and update the button.");

    const advicePayloadShape = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      state.dailyLogs = [{
        id: "private-daily-id", date: today(), sleepHours: 7, waterMl: 1800, mood: 4, energy: 4,
        soreness: 1, pain: 0, habits: { privateHabit: true }, note: "状态正常", updatedAt: new Date().toISOString()
      }];
      state.workouts = [{
        id: "private-workout-id", date: today(), title: "全身训练", duration: 30, sessionRpe: 6, note: "动作稳定",
        createdAt: new Date().toISOString(), exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 10, rpe: 6, note: "" }] }]
      }];
      state.exercises = [{ name: "不应整体发送", category: "力量", lastUsed: today() }];
      const payload = buildAdvicePayload();
      Object.assign(state, normalizeImportedState(snapshot));
      return {
        schemaVersion: payload.schemaVersion,
        topLevelExercises: Object.hasOwn(payload, "exercises"),
        dailyKeys: Object.keys(payload.dailyLogs[0]),
        workoutKeys: Object.keys(payload.workouts[0]),
        exerciseName: payload.workouts[0].exercises[0].name
      };
    })()`);
    assert(advicePayloadShape.schemaVersion === 1 && !advicePayloadShape.topLevelExercises, "Cloud advice payload should be versioned and omit the full exercise library.");
    assert(!advicePayloadShape.dailyKeys.includes("id") && !advicePayloadShape.dailyKeys.includes("habits") && !advicePayloadShape.dailyKeys.includes("updatedAt"), "Cloud advice should omit daily record identifiers, timestamps, and habit objects.");
    assert(!advicePayloadShape.workoutKeys.includes("id") && !advicePayloadShape.workoutKeys.includes("createdAt") && advicePayloadShape.exerciseName === "腿举", "Cloud advice should keep useful workout facts without local identifiers.");

    const cloudConsentFlow = await evaluate(cdp, `(async () => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const originalFetch = window.fetch;
      let adviceRequests = 0;
      let exhaustQuota = false;
      window.fetch = async (url, options) => {
        if (url === "/api/advice") {
          adviceRequests += 1;
          if (exhaustQuota) return {
            ok: false,
            status: 429,
            json: async () => ({
              code: "QUOTA_EXHAUSTED",
              entitlement: { configured: true, plan: "free", quota: { used: 3, pending: 0, remaining: 0, limit: 3, resetAt: "2026-08-01T00:00:00.000Z" } }
            })
          };
          return { ok: true, json: async () => ({ advice: "云端测试建议", model: "test-model" }) };
        }
        return originalFetch(url, options);
      };
      state.adviceHistory = [];
      state.settings.cloudAdviceConsentVersion = 0;

      cloudAdviceConfigured = false;
      await generateAdvice();
      const localOnly = {
        requests: adviceRequests,
        source: state.adviceHistory.at(-1)?.source
      };

      state.adviceHistory = [];
      cloudAdviceConfigured = true;
      await generateAdvice();
      const firstPrompt = {
        open: document.querySelector("#cloudConsentDialog").open,
        focused: document.activeElement?.id,
        requests: adviceRequests,
        consent: state.settings.cloudAdviceConsentVersion
      };
      await chooseLocalAdvice();
      const localChoice = {
        closed: !document.querySelector("#cloudConsentDialog").open,
        source: state.adviceHistory.at(-1)?.source,
        requests: adviceRequests,
        consent: state.settings.cloudAdviceConsentVersion
      };

      state.adviceHistory = [];
      await generateAdvice();
      await confirmCloudAdviceConsent();
      const cloudChoice = {
        closed: !document.querySelector("#cloudConsentDialog").open,
        source: state.adviceHistory.at(-1)?.source,
        requests: adviceRequests,
        consent: state.settings.cloudAdviceConsentVersion,
        revokeVisible: !document.querySelector("#revokeCloudConsentBtn").hidden
      };
      state.adviceHistory = [];
      exhaustQuota = true;
      await generateAdvice();
      const quotaFallback = {
        source: state.adviceHistory.at(-1)?.source,
        text: state.adviceHistory.at(-1)?.text,
        toast: document.querySelector("#toast")?.textContent
      };
      exhaustQuota = false;
      revokeCloudAdviceConsent();
      const revoked = {
        consent: state.settings.cloudAdviceConsentVersion,
        revokeHidden: document.querySelector("#revokeCloudConsentBtn").hidden,
        status: document.querySelector("#cloudConsentStatus").textContent
      };

      window.fetch = originalFetch;
      Object.assign(state, normalizeImportedState(snapshot));
      cloudAdviceConfigured = false;
      persistState();
      renderAdvice();
      renderCloudConsentStatus();
      return { localOnly, firstPrompt, localChoice, cloudChoice, quotaFallback, revoked };
    })()`);
    assert(cloudConsentFlow.localOnly.requests === 0 && cloudConsentFlow.localOnly.source === "本地规则", "Local advice mode should not call the cloud endpoint.");
    assert(cloudConsentFlow.firstPrompt.open && cloudConsentFlow.firstPrompt.focused === "useLocalAdviceBtn" && cloudConsentFlow.firstPrompt.requests === 0 && cloudConsentFlow.firstPrompt.consent === 0, "First cloud use should ask before sending and focus the local option.");
    assert(cloudConsentFlow.localChoice.closed && cloudConsentFlow.localChoice.source === "本地规则" && cloudConsentFlow.localChoice.requests === 0 && cloudConsentFlow.localChoice.consent === 0, "Choosing local advice should not save consent or send data.");
    assert(cloudConsentFlow.cloudChoice.closed && cloudConsentFlow.cloudChoice.source === "OpenAI test-model" && cloudConsentFlow.cloudChoice.requests === 1 && cloudConsentFlow.cloudChoice.consent === 1 && cloudConsentFlow.cloudChoice.revokeVisible, "Explicit consent should persist, send once, and expose revocation.");
    assert(cloudConsentFlow.quotaFallback.source === "本地规则" && cloudConsentFlow.quotaFallback.text.includes("本月云端建议额度已用完") && cloudConsentFlow.quotaFallback.toast.includes("已改用本地建议"), "Quota exhaustion should explain and complete a local advice fallback.");
    assert(cloudConsentFlow.revoked.consent === 0 && cloudConsentFlow.revoked.revokeHidden && cloudConsentFlow.revoked.status.includes("首次使用"), "Revoking cloud consent should immediately require consent again.");

    await evaluate(cdp, `document.querySelector("#pain").value = "4";
      document.querySelector("#pain").dispatchEvent(new Event("input", { bubbles: true }));`);
    await delay(200);
    const highPainSafety = await evaluate(cdp, `document.querySelector("#safetyStrip")?.innerText`);
    assert(highPainSafety.includes("优先恢复"), "High pain should switch safety strip to recovery-first copy.");
    await evaluate(cdp, `document.querySelector("#pain").value = "0";
      document.querySelector("#pain").dispatchEvent(new Event("input", { bubbles: true }));`);

    let pwaReady = await evaluate(cdp, `(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => {
          navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
          setTimeout(resolve, 1500);
        });
      }
      return {
        supported: true,
        scope: registration.scope,
        controlled: Boolean(navigator.serviceWorker.controller),
        caches: await caches.keys(),
        status: document.querySelector("#offlineStatus")?.textContent
      };
    })()`);
    if (pwaReady.supported && !pwaReady.controlled) {
      const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
      await cdp.send("Page.reload", { ignoreCache: false });
      await loaded;
      await delay(500);
      pwaReady = await evaluate(cdp, `(async () => {
        const registration = await navigator.serviceWorker.ready;
        return {
          supported: true,
          scope: registration.scope,
          controlled: Boolean(navigator.serviceWorker.controller),
          caches: await caches.keys(),
          status: document.querySelector("#offlineStatus")?.textContent
        };
      })()`);
    }
    assert(pwaReady.supported, "Browser should support service workers for PWA smoke test.");
    assert(pwaReady.controlled, "Service worker should control the app after activation.");
    assert(pwaReady.caches.some(name => name.includes("what-to-drill-shell")), "App shell cache should be created.");

    const installPrompt = await evaluate(cdp, `(async () => {
      let prevented = false;
      let prompted = false;
      handleBeforeInstallPrompt({
        preventDefault() { prevented = true; },
        prompt() {
          prompted = true;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: "accepted" })
      });
      const before = {
        status: document.querySelector("#installStatus")?.textContent,
        hidden: document.querySelector("#installAppBtn")?.hidden
      };
      await installApp();
      return {
        prevented,
        prompted,
        before,
        afterStatus: document.querySelector("#installStatus")?.textContent,
        afterHidden: document.querySelector("#installAppBtn")?.hidden,
        afterDisplay: getComputedStyle(document.querySelector("#installAppBtn")).display,
        toast: document.querySelector("#toast")?.textContent
      };
    })()`);
    assert(installPrompt.prevented, "Install prompt should be intercepted instead of showing automatically.");
    assert(installPrompt.prompted, "Install action should call the deferred browser prompt.");
    assert(installPrompt.before.status.includes("可安装"), "Install status should show install readiness when prompt is available.");
    assert(!installPrompt.before.hidden, "Install button should appear when prompt is available.");
    assert(installPrompt.toast.includes("安装"), "Install flow should give user feedback.");

    await navigate(cdp, `${baseUrl}/privacy.html`);
    const onlinePrivacyBeforeOffline = await evaluate(cdp, `document.querySelector("h1")?.textContent`);
    assert(onlinePrivacyBeforeOffline === "隐私政策", "Privacy policy should load before testing navigation cache isolation.");
    await evaluate(cdp, `(() => {
      const previous = localStorage.getItem(${JSON.stringify(storageKey)});
      if (previous === null) localStorage.removeItem("smoke_offline_previous_state");
      else localStorage.setItem("smoke_offline_previous_state", previous);
      localStorage.removeItem(${JSON.stringify(storageKey)});
      localStorage.removeItem(${JSON.stringify(workoutDraftKey)});
    })()`);

    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    {
      const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
    await cdp.send("Page.navigate", { url: appUrl });
      await loaded;
      await delay(500);
    }
    const offlineLoad = await evaluate(cdp, `(() => {
      window.dispatchEvent(new Event("offline"));
      return ({
      title: document.title,
      hasApp: Boolean(document.querySelector(".app-shell")),
      status: document.querySelector("#offlineStatus")?.textContent,
      noticeVisible: !document.querySelector("#connectionNotice")?.hidden,
      noticeText: document.querySelector("#connectionNotice")?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth
      });
    })()`);
    assert(offlineLoad.title === "WhatToDrill · 今天练什么", "Offline reload should serve the cached app shell.");
    assert(offlineLoad.hasApp, "Offline reload should render the app shell.");
    assert(offlineLoad.noticeVisible && offlineLoad.noticeText.includes("仍可以训练和记录"), `Offline mode should show one concise global notice while keeping local recording available: ${JSON.stringify(offlineLoad)}.`);
    assert(!offlineLoad.overflow, "Offline app shell should not overflow.");
    const offlineFirstSetup = await evaluate(cdp, `(() => {
      document.querySelector("#startCoachWorkoutBtn").click();
      document.querySelector('input[name="firstWorkoutCondition"][value="dumbbells"]').click();
      document.querySelector('input[name="firstWorkoutExperience"][value="beginner"]').click();
      document.querySelector('input[name="firstWorkoutGoal"][value="general"]').click();
      document.querySelector("#firstWorkoutSetupForm").requestSubmit();
      const setupPersisted = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      document.querySelector("#hasPainBtn").click();
      return {
        setupPersisted: setupPersisted.settings.starterTemplateId,
        setupEnvironment: setupPersisted.settings.preferredEnvironment,
        profileStatus: starterProfileConsistency(setupPersisted.settings).status,
        workoutTitle: document.querySelector("#workoutTitle").value,
        pain: state.dailyLogs.find(log => log.date === today())?.pain,
        setupClosed: !document.querySelector("#firstWorkoutSetupDialog").open
      };
    })()`);
    assert(offlineFirstSetup.setupPersisted === "starter_dumbbell_full_body" && offlineFirstSetup.setupEnvironment === "mixed" && offlineFirstSetup.profileStatus === "valid" && offlineFirstSetup.setupClosed, `Offline users should be able to complete and persist first-workout setup: ${JSON.stringify(offlineFirstSetup)}.`);
    assert(offlineFirstSetup.pain === 4 && offlineFirstSetup.workoutTitle === "恢复拉伸", `Pain should override the selected starter template even when setup is completed offline: ${JSON.stringify(offlineFirstSetup)}.`);
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    await evaluate(cdp, `(() => {
      const previous = localStorage.getItem("smoke_offline_previous_state");
      if (previous === null) localStorage.removeItem(${JSON.stringify(storageKey)});
      else localStorage.setItem(${JSON.stringify(storageKey)}, previous);
      localStorage.removeItem("smoke_offline_previous_state");
      activeWorkoutSession = null;
      clearWorkoutDraft();
    })()`);
    {
      const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
      await cdp.send("Page.reload", { ignoreCache: false });
      await loaded;
      await delay(500);
    }
    await evaluate(cdp, `(() => {
      activeWorkoutSession = null;
      clearWorkoutDraft();
      renderAll();
    })()`);

    const settingsEntry = await evaluate(cdp, `(() => {
      document.querySelector("#openSettingsBtn").click();
      return new Promise(resolve => requestAnimationFrame(() => resolve({
        activeTab: document.querySelector(".tab.active")?.dataset.tab,
        focused: document.activeElement?.id
      })));
    })()`);
    assert(settingsEntry.activeTab === "mine" && settingsEntry.focused === "technicalSettingsPanel", "Settings should open the My area and focus the application and local-data controls.");
    const readinessPanel = await evaluate(cdp, `(() => {
      document.querySelector('[data-tab="today"]').click();
      document.querySelector("#showExtendedDailyBtn").click();
      return {
        open: document.querySelector("#quickReadinessDialog").open,
        questions: document.querySelectorAll("#quickReadinessDialog .readiness-question").length,
        focusedName: document.activeElement?.name
      };
    })()`);
    assert(readinessPanel.open && readinessPanel.questions === 4 && readinessPanel.focusedName === "readinessSleep", `Optional adjustment should open a focused four-question readiness panel: ${JSON.stringify(readinessPanel)}.`);
    await evaluate(cdp, `document.querySelector("#openExtendedDailyBtn").click()`);
    await delay(900);
    const onboardingAction = await evaluate(cdp, `(() => ({
      recordHidden: document.querySelector("#extendedDailyRecord").hidden,
      formTop: document.querySelector("#dailyForm").getBoundingClientRect().top,
      formBottom: document.querySelector("#dailyForm").getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
      focused: document.activeElement?.id
    }))()`);
    assert(!onboardingAction.recordHidden && onboardingAction.formTop < onboardingAction.viewportHeight && onboardingAction.formBottom > 0, "Optional state action should reveal and scroll the daily form into view.");
    assert(onboardingAction.focused === "sleepHours", "Optional state action should move focus to the first useful field.");

    await evaluate(cdp, `document.querySelector("#sleepHours").value = "7";
      document.querySelector("#sleepHours").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#saveDailyBtn").click();`);
    await delay(500);
    const afterDailySave = await evaluate(cdp, `(() => ({
      hidden: document.querySelector("#starterGuide").hidden,
      coachStatus: document.querySelector(".coach-status")?.textContent,
      dailyLogs: JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).dailyLogs.length
    }))()`);
    assert(afterDailySave.dailyLogs === 1, "Saving daily state should create the first daily log.");
    assert(afterDailySave.hidden, "Saving a daily log should hide onboarding.");
    assert(afterDailySave.coachStatus === "首次训练", `Saving readiness alone should not bypass the required first-workout profile: ${JSON.stringify(afterDailySave)}.`);

    const quickReadiness = await evaluate(cdp, `(() => {
      document.querySelector("#showExtendedDailyBtn").click();
      document.querySelector('input[name="readinessSleep"][value="rested"]').click();
      document.querySelector('input[name="readinessEnergy"][value="good"]').click();
      document.querySelector('input[name="readinessSoreness"][value="light"]').click();
      document.querySelector('input[name="readinessPain"][value="none"]').click();
      document.querySelector("#quickReadinessForm").requestSubmit();
      const saved = state.dailyLogs.find(item => item.date === today());
      return {
        open: document.querySelector("#quickReadinessDialog").open,
        sleep: saved.sleepHours,
        energy: saved.energy,
        soreness: saved.soreness,
        pain: saved.pain,
        readinessComplete: saved.readinessComplete,
        label: document.querySelector(".coach-status")?.textContent
      };
    })()`);
    assert(!quickReadiness.open && quickReadiness.sleep === 8 && quickReadiness.energy === 4 && quickReadiness.soreness === 1 && quickReadiness.pain === 0, "Quick readiness choices should map to the existing daily-state values.");
    assert(quickReadiness.readinessComplete && quickReadiness.label === "首次训练", "Completing readiness should preserve the required first-workout setup step.");

    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click()`);
    await delay(150);
    const dailyEditLoaded = await evaluate(cdp, `(() => {
      const original = state.dailyLogs[0];
      document.querySelector(".edit-daily-record").click();
      return {
        originalDate: original.date,
        activeTab: document.querySelector(".tab.active")?.dataset.tab,
        date: document.querySelector("#dailyDate").value,
        focused: document.activeElement?.id
      };
    })()`);
    assert(dailyEditLoaded.activeTab === "today" && dailyEditLoaded.date === dailyEditLoaded.originalDate, "Editing daily history should load the original date on the today tab.");
    assert(dailyEditLoaded.focused === "sleepHours", "Editing daily history should focus the first editable field.");
    await evaluate(cdp, `(() => {
      document.querySelector("#sleepHours").value = "8";
      document.querySelector("#dailyNote").value = "修正后的状态";
      document.querySelector("#saveDailyBtn").click();
    })()`);
    await delay(450);
    const dailyEdited = await evaluate(cdp, `(() => {
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        count: parsed.dailyLogs.length,
        sleep: parsed.dailyLogs[0].sleepHours,
        note: parsed.dailyLogs[0].note
      };
    })()`);
    assert(dailyEdited.count === 1 && dailyEdited.sleep === 8 && dailyEdited.note === "修正后的状态", "Saving daily edits should replace the same date without duplication.");

    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click()`);
    await delay(150);
    const dailyDeleteCancel = await evaluate(cdp, `(() => {
      document.querySelector(".delete-daily-record").click();
      const opened = document.querySelector("#deleteDailyDialog").open;
      const focused = document.activeElement?.id;
      document.querySelector("#cancelDeleteDailyBtn").click();
      return { opened, focused, closed: !document.querySelector("#deleteDailyDialog").open, count: state.dailyLogs.length };
    })()`);
    assert(dailyDeleteCancel.opened && dailyDeleteCancel.focused === "cancelDeleteDailyBtn", "Daily delete confirmation should default to cancel.");
    assert(dailyDeleteCancel.closed && dailyDeleteCancel.count === 1, "Canceling daily deletion should preserve the record.");
    const dailyDeleted = await evaluate(cdp, `(() => {
      document.querySelector(".delete-daily-record").click();
      document.querySelector("#confirmDeleteDailyBtn").click();
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        count: parsed.dailyLogs.length,
        cardRemoved: !document.querySelector(".history-card[data-daily-date]"),
        dialogClosed: !document.querySelector("#deleteDailyDialog").open,
        toast: document.querySelector("#toast").textContent
      };
    })()`);
    assert(dailyDeleted.count === 0 && dailyDeleted.cardRemoved, "Confirmed daily deletion should remove the record from storage and history.");
    assert(dailyDeleted.dialogClosed && dailyDeleted.toast.includes("日常状态记录已删除"), "Confirmed daily deletion should close the dialog and explain success.");

    await evaluate(cdp, `(() => {
      document.querySelector('[data-tab="workout"]').click();
      document.querySelector("#workoutTitle").value = "草稿恢复测试";
      document.querySelector("#workoutTitle").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".set-weight").value = "12.5";
      document.querySelector(".set-weight").dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await delay(500);
    const storedWorkoutDraft = await evaluate(cdp, `JSON.parse(localStorage.getItem(${JSON.stringify(workoutDraftKey)}))`);
    assert(storedWorkoutDraft.title === "草稿恢复测试", "Workout draft should autosave its title.");
    assert(storedWorkoutDraft.exercises[0].sets[0].weight === 12.5, "Workout draft should autosave set values.");
    await reload(cdp);
    const restoredWorkoutDraft = await evaluate(cdp, `(() => ({
      title: document.querySelector("#workoutTitle").value,
      weight: document.querySelector(".set-weight").value,
      toast: document.querySelector("#toast").textContent
    }))()`);
    assert(restoredWorkoutDraft.title === "草稿恢复测试" && restoredWorkoutDraft.weight === "12.5", "Reload should restore the unfinished workout draft.");
    assert(restoredWorkoutDraft.toast.includes("已恢复未完成"), "Draft restoration should be visible to the user.");

    await evaluate(cdp, `activeWorkoutSession = null; clearWorkoutForm(); localStorage.removeItem(${JSON.stringify(storageKey)}); localStorage.removeItem(${JSON.stringify(workoutDraftKey)})`);
    await reload(cdp);

    const freshStart = await evaluate(cdp, `(() => ({
      hasStart: Boolean(document.querySelector("#startCoachWorkoutBtn")),
      coachText: document.querySelector("#dailyCoach")?.innerText,
      starterTemplates: ["starter_home_bodyweight", "starter_dumbbell_full_body", "starter_gym_machines", "starter_free_weights"].map(id => beginnerTemplates.find(template => template.id === id)?.name),
      storage: localStorage.getItem(${JSON.stringify(storageKey)}),
      draft: localStorage.getItem(${JSON.stringify(workoutDraftKey)}),
      initializing: document.body.classList.contains("app-initializing")
    }))()`);
    assert(freshStart.hasStart, `Fresh state should restore the daily coach start action: ${JSON.stringify(freshStart)}.`);
    assert(freshStart.starterTemplates.every(Boolean), `All four equipment-compatible starter templates should exist: ${JSON.stringify(freshStart.starterTemplates)}.`);
    const starterProfileRules = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const templates = getAllTemplates();
      const mapping = ["bodyweight", "dumbbells", "machines", "free_weights"]
        .map(equipment => [equipment, starterTemplateIdForEquipment(equipment)]);
      const legacyImported = normalizeImportedState({
        workouts: [{ id: "legacy-workout", date: today(), title: "旧训练", exercises: [] }],
        settings: { trainingRotation: TrainingRotationModel.defaultRotation() }
      });
      Object.assign(state, legacyImported);
      const legacy = {
        status: starterProfileConsistency(state.settings).status,
        needsSetup: needsFirstWorkoutSetup(),
        templateId: resolveTrainingDay(state.settings.trainingRotation, getAllTemplates()).template?.id
      };
      const contradictoryImported = normalizeImportedState({
        workouts: [{ id: "imported-workout", date: today(), title: "导入训练", exercises: [] }],
        settings: {
          trainingRotation: TrainingRotationModel.defaultRotation(),
          preferredEnvironment: "gym",
          availableEquipment: "machines",
          experienceLevel: "beginner",
          starterTemplateId: "starter_home_bodyweight",
          firstWorkoutSetupCompletedAt: new Date().toISOString()
        }
      });
      Object.assign(state, contradictoryImported);
      const contradictory = {
        status: starterProfileConsistency(state.settings).status,
        needsSetup: needsFirstWorkoutSetup(),
        starterIgnored: starterTemplateForSettings(getAllTemplates()) === null,
        resolvedTemplateId: resolveTrainingDay(state.settings.trainingRotation, getAllTemplates()).template?.id
      };
      state.settings = normalizeSettings({
        ...state.settings,
        preferredEnvironment: "mixed",
        availableEquipment: "dumbbells",
        experienceLevel: "experienced",
        starterTemplateId: "starter_dumbbell_full_body",
        firstWorkoutSetupCompletedAt: new Date().toISOString()
      }, state.templates);
      const fullBody = resolveTrainingDay(TrainingRotationModel.defaultRotation(), getAllTemplates()).template?.id;
      const upperLower = resolveTrainingDay({ mode: "upper_lower", currentIndex: 0 }, getAllTemplates()).template?.id;
      const custom = resolveTrainingDay({
        mode: "custom",
        currentIndex: 0,
        days: [
          { id: "custom_recovery", templateId: "beginner_recovery", label: "恢复" },
          { id: "custom_full", templateId: "beginner_full_body", label: "全身" }
        ]
      }, getAllTemplates()).template?.id;
      Object.assign(state, snapshot);
      renderAll();
      return { mapping, legacy, contradictory, fullBody, upperLower, custom };
    })()`);
    assert(JSON.stringify(starterProfileRules.mapping) === JSON.stringify([
      ["bodyweight", "starter_home_bodyweight"],
      ["dumbbells", "starter_dumbbell_full_body"],
      ["machines", "starter_gym_machines"],
      ["free_weights", "starter_free_weights"]
    ]), `Every equipment choice should map to exactly one starter template: ${JSON.stringify(starterProfileRules.mapping)}.`);
    assert(starterProfileRules.legacy.status === "legacy" && !starterProfileRules.legacy.needsSetup && starterProfileRules.legacy.templateId === "beginner_full_body", `A historical user with no starter fields should keep legacy behavior without interruption: ${JSON.stringify(starterProfileRules.legacy)}.`);
    assert(starterProfileRules.contradictory.status === "invalid" && starterProfileRules.contradictory.needsSetup && starterProfileRules.contradictory.starterIgnored && starterProfileRules.contradictory.resolvedTemplateId === "beginner_full_body", `Contradictory imported starter fields must request setup and never drive the wrong template: ${JSON.stringify(starterProfileRules.contradictory)}.`);
    assert(starterProfileRules.fullBody === "starter_dumbbell_full_body" && starterProfileRules.upperLower === "beginner_upper" && starterProfileRules.custom === "beginner_recovery", `Only full-body rotation should adopt the valid starter profile: ${JSON.stringify(starterProfileRules)}.`);

    const submittedStarterProfiles = await evaluate(cdp, `(() => {
      const cases = [
        { equipment: "bodyweight", environment: "home", templateId: "starter_home_bodyweight", title: "居家无器械全身" },
        { equipment: "dumbbells", environment: "mixed", templateId: "starter_dumbbell_full_body", title: "哑铃全身" },
        { equipment: "machines", environment: "gym", templateId: "starter_gym_machines", title: "健身房器械入门" },
        { equipment: "free_weights", environment: "gym", templateId: "starter_free_weights", title: "自由重量基础" }
      ];
      const results = cases.map(testCase => {
        Object.assign(state, normalizeImportedState({}));
        activeWorkoutSession = null;
        clearWorkoutDraft();
        renderAll();
        startDailyCoachWorkout();
        document.querySelector('input[name="firstWorkoutCondition"][value="' + testCase.equipment + '"]').click();
        document.querySelector('input[name="firstWorkoutExperience"][value="experienced"]').click();
        document.querySelector('input[name="firstWorkoutGoal"][value="strength"]').click();
        document.querySelector("#firstWorkoutSetupForm").requestSubmit();
        const persisted = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).settings;
        const painGateOpen = document.querySelector("#painGateDialog").open;
        answerPainGate(false);
        const result = {
          ...testCase,
          persistedEnvironment: persisted.preferredEnvironment,
          persistedEquipment: persisted.availableEquipment,
          persistedExperience: persisted.experienceLevel,
          persistedGoal: persisted.trainingGoal,
          persistedTemplateId: persisted.starterTemplateId,
          profileStatus: starterProfileConsistency(persisted).status,
          painGateOpen,
          startedTitle: activeWorkoutSession?.title
        };
        activeWorkoutSession = null;
        clearWorkoutDraft();
        return result;
      });
      Object.assign(state, normalizeImportedState({}));
      activeWorkoutSession = null;
      clearWorkoutDraft();
      renderAll();
      return results;
    })()`);
    assert(submittedStarterProfiles.every(item => item.persistedEquipment === item.equipment && item.persistedEnvironment === item.environment && item.persistedTemplateId === item.templateId && item.persistedExperience === "experienced" && item.persistedGoal === "strength" && item.profileStatus === "valid" && item.painGateOpen && item.startedTitle === item.title), `Each real setup form submission should persist and start its matching template: ${JSON.stringify(submittedStarterProfiles)}.`);

    const recoveryStarterGoal = await evaluate(cdp, `(() => {
      Object.assign(state, normalizeImportedState({}));
      renderAll();
      startDailyCoachWorkout();
      document.querySelector('input[name="firstWorkoutCondition"][value="bodyweight"]').click();
      document.querySelector('input[name="firstWorkoutExperience"][value="beginner"]').click();
      document.querySelector('input[name="firstWorkoutGoal"][value="recovery"]').click();
      document.querySelector("#firstWorkoutSetupForm").requestSubmit();
      const result = {
        goal: state.settings.trainingGoal,
        profileStatus: starterProfileConsistency(state.settings).status,
        needsSetup: needsFirstWorkoutSetup(),
        painGateOpen: document.querySelector("#painGateDialog").open
      };
      closePainGate();
      Object.assign(state, normalizeImportedState({}));
      persistState();
      renderAll();
      return result;
    })()`);
    assert(recoveryStarterGoal.goal === "recovery" && recoveryStarterGoal.profileStatus === "valid" && !recoveryStarterGoal.needsSetup && recoveryStarterGoal.painGateOpen, `Recovery-first users should complete setup while retaining the pain safety gate: ${JSON.stringify(recoveryStarterGoal)}.`);

    const atomicPreference = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      activateTab("mine", { scroll: false });
      renderPreferences();
      document.querySelector("#preferredEnvironment").value = "home";
      document.querySelector("#availableEquipment").value = "dumbbells";
      document.querySelector("#experienceLevel").value = "experienced";
      document.querySelector("#trainingRotationMode").value = "full_body";
      savePreferences();
      const result = {
        environment: state.settings.preferredEnvironment,
        equipment: state.settings.availableEquipment,
        experience: state.settings.experienceLevel,
        starterTemplateId: state.settings.starterTemplateId,
        completed: Boolean(state.settings.firstWorkoutSetupCompletedAt),
        status: starterProfileConsistency(state.settings).status
      };
      Object.assign(state, snapshot);
      persistState();
      renderAll();
      activateTab("today", { scroll: false });
      return result;
    })()`);
    assert(atomicPreference.environment === "mixed" && atomicPreference.equipment === "dumbbells" && atomicPreference.experience === "experienced" && atomicPreference.starterTemplateId === "starter_dumbbell_full_body" && atomicPreference.completed && atomicPreference.status === "valid", `Saving preferences should update the starter profile atomically and keep dumbbell copy consistent with mixed locations: ${JSON.stringify(atomicPreference)}.`);
    await evaluate(cdp, `document.querySelector("#startCoachWorkoutBtn").click()`);
    const firstWorkoutSetup = await evaluate(cdp, `(() => ({
      open: document.querySelector("#firstWorkoutSetupDialog").open,
      focusedName: document.activeElement?.name,
      conditions: document.querySelectorAll('input[name="firstWorkoutCondition"]').length,
      experiences: document.querySelectorAll('input[name="firstWorkoutExperience"]').length,
      goals: document.querySelectorAll('input[name="firstWorkoutGoal"]').length,
      painGateClosed: !document.querySelector("#painGateDialog").open
    }))()`);
    assert(firstWorkoutSetup.open && firstWorkoutSetup.focusedName === "firstWorkoutCondition" && firstWorkoutSetup.conditions === 4 && firstWorkoutSetup.experiences === 2 && firstWorkoutSetup.goals === 5 && firstWorkoutSetup.painGateClosed, `First start should collect a compact environment profile before pain: ${JSON.stringify(firstWorkoutSetup)}.`);
    await evaluate(cdp, `(() => {
      document.querySelector('input[name="firstWorkoutCondition"][value="bodyweight"]').click();
      document.querySelector('input[name="firstWorkoutExperience"][value="experienced"]').click();
      document.querySelector('input[name="firstWorkoutGoal"][value="muscle_gain"]').click();
      document.querySelector("#firstWorkoutSetupForm").requestSubmit();
    })()`);
    const painGate = await evaluate(cdp, `(() => ({
      open: document.querySelector("#painGateDialog").open,
      focused: document.activeElement?.id,
      activeTab: document.querySelector(".tab.active")?.dataset.tab,
      setupClosed: !document.querySelector("#firstWorkoutSetupDialog").open,
      equipment: state.settings.availableEquipment,
      environment: state.settings.preferredEnvironment,
      experience: state.settings.experienceLevel,
      goal: state.settings.trainingGoal,
      starterTemplateId: state.settings.starterTemplateId
    }))()`);
    assert(painGate.open && painGate.focused === "noPainBtn" && painGate.activeTab === "today" && painGate.setupClosed, "Completing setup should still open the focused binary pain gate.");
    assert(painGate.equipment === "bodyweight" && painGate.environment === "home" && painGate.experience === "experienced" && painGate.goal === "muscle_gain" && painGate.starterTemplateId === "starter_home_bodyweight", `First-workout choices should persist compatibly: ${JSON.stringify(painGate)}.`);
    await evaluate(cdp, `closePainGate()`);
    await reload(cdp);
    const refreshedSetup = await evaluate(cdp, `(() => ({
      needsSetup: needsFirstWorkoutSetup(),
      setupOpen: document.querySelector("#firstWorkoutSetupDialog").open,
      equipment: state.settings.availableEquipment,
      starterTemplateId: state.settings.starterTemplateId
    }))()`);
    assert(!refreshedSetup.needsSetup && !refreshedSetup.setupOpen && refreshedSetup.equipment === "bodyweight" && refreshedSetup.starterTemplateId === "starter_home_bodyweight", `Refreshing a valid first-workout profile should not repeat setup: ${JSON.stringify(refreshedSetup)}.`);
    await evaluate(cdp, `startDailyCoachWorkout()`);
    await evaluate(cdp, `document.querySelector("#noPainBtn").click()`);
    await delay(300);
    const loadedWorkout = await evaluate(cdp, `(() => ({
      activeTab: document.querySelector(".tab.active")?.dataset.tab,
      title: document.querySelector("#workoutTitle").value,
      progress: document.querySelector(".progress-ring strong").textContent,
      sets: Array.from(document.querySelectorAll(".execution-stat strong")).map(el => el.textContent)[1],
      collectedSets: collectWorkoutExercises().reduce((sum, exercise) => sum + exercise.sets.length, 0),
      focusedVisible: !document.querySelector("#focusedWorkoutSession").hidden,
      currentExercise: document.querySelector("#focusedCurrentSet h3")?.textContent,
      currentSetText: document.querySelector("#focusedCurrentSet")?.innerText,
      legacyHidden: document.querySelector("#workoutForm").hidden && document.querySelector("#workoutBuilder").hidden,
      sessionVersion: activeWorkoutSession?.version,
      currentStatus: activeWorkoutSession?.exercises[0]?.sets[0]?.status
    }))()`);
    assert(loadedWorkout.activeTab === "workout", "Coach start should activate workout tab.");
    assert(loadedWorkout.title === "居家无器械全身", "Coach start should load the selected compatible template.");
    assert(loadedWorkout.progress === "0", "Loaded template should start at 0 percent complete.");
    assert(loadedWorkout.sets === "0/8", "Loaded home template should expose eight planned sets.");
    assert(loadedWorkout.collectedSets === 0, "Template cues should not count as completed workout sets.");
    assert(loadedWorkout.focusedVisible && loadedWorkout.currentExercise === "椅子深蹲" && loadedWorkout.currentSetText.includes("第 1 组 / 共 2 组") && loadedWorkout.currentSetText.includes("完成这组"), "Coach start should focus the first compatible planned set.");
    assert(loadedWorkout.legacyHidden && loadedWorkout.sessionVersion === 3 && loadedWorkout.currentStatus === "pending", "Focused training should hide the legacy editor and keep the set explicitly pending.");

    const emptyFinish = await evaluate(cdp, `(() => {
      document.querySelector("#requestFinishFocusedWorkoutBtn").click();
      const result = {
        open: document.querySelector("#focusedFinishDialog").open,
        title: document.querySelector("#focusedFinishTitle").textContent,
        actionsVisible: !document.querySelector("#zeroCompletedActions").hidden,
        workouts: state.workouts.length
      };
      document.querySelector("#continueEmptyWorkoutBtn").click();
      return result;
    })()`);
    assert(emptyFinish.open && emptyFinish.title.includes("还没有完成") && emptyFinish.actionsVisible && emptyFinish.workouts === 0, "A zero-completion session should offer continue, keep, or abandon without creating history.");

    const typedPending = await evaluate(cdp, `(() => {
      document.querySelector("#focusedPrimaryValue").value = "9";
      document.querySelector("#focusedPrimaryValue").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#focusedWeightValue").value = "42.5";
      document.querySelector("#focusedWeightValue").dispatchEvent(new Event("input", { bubbles: true }));
      return {
        status: activeWorkoutSession.exercises[0].sets[0].status,
        actual: activeWorkoutSession.exercises[0].sets[0].actual.reps,
        storedVersion: JSON.parse(localStorage.getItem(${JSON.stringify(workoutDraftKey)})).version
      };
    })()`);
    assert(typedPending.status === "pending" && typedPending.actual === 9 && typedPending.storedVersion === 3, "Editing the current result should persist without implying completion.");

    const completedFocusedSet = await evaluate(cdp, `(() => {
      const startedAt = activeWorkoutSession.startedAt;
      document.querySelector("#completeFocusedSetBtn").click();
      return {
        startedAt,
        completed: WorkoutSessionModel.progress(activeWorkoutSession).completed,
        currentExercise: document.querySelector("#focusedCurrentSet h3")?.textContent,
        undoVisible: Boolean(document.querySelector("#undoFocusedSetBtn")),
        firstStatus: activeWorkoutSession.exercises[0].sets[0].status,
        restTime: document.querySelector("#focusedRestTime")?.textContent,
        restContext: document.querySelector("#focusedRestContext")?.textContent,
        inheritedWeight: document.querySelector("#focusedWeightValue")?.value,
        quickControls: ["decreaseFocusedPrimaryBtn", "increaseFocusedPrimaryBtn", "decreaseFocusedWeightBtn", "increaseFocusedWeightBtn", "extendFocusedRestBtn", "resetFocusedRestBtn", "skipFocusedRestBtn"].every(id => Boolean(document.getElementById(id)))
      };
    })()`);
    assert(completedFocusedSet.completed === 1 && completedFocusedSet.currentExercise === "椅子深蹲" && completedFocusedSet.undoVisible && completedFocusedSet.firstStatus === "completed", "Completing a set should advance, update progress, and expose undo.");
    assert(completedFocusedSet.restTime === "01:30" && completedFocusedSet.restContext.includes("下一组") && completedFocusedSet.inheritedWeight === "42.5" && completedFocusedSet.quickControls, `A completed set should start guided rest, preserve weight, and expose quick controls: ${JSON.stringify(completedFocusedSet)}.`);
    const adjustedFocusedSet = await evaluate(cdp, `(() => {
      document.querySelector("#increaseFocusedPrimaryBtn").click();
      document.querySelector("#decreaseFocusedPrimaryBtn").click();
      document.querySelector("#increaseFocusedWeightBtn").click();
      document.querySelector("#decreaseFocusedWeightBtn").click();
      document.querySelector("#extendFocusedRestBtn").click();
      const extended = document.querySelector("#focusedRestTime")?.textContent;
      document.querySelector("#resetFocusedRestBtn").click();
      const reset = document.querySelector("#focusedRestTime")?.textContent;
      return { reps: document.querySelector("#focusedPrimaryValue").value, weight: document.querySelector("#focusedWeightValue").value, extended, reset };
    })()`);
    assert(adjustedFocusedSet.reps === "10" && adjustedFocusedSet.weight === "42.5" && adjustedFocusedSet.extended === "02:00" && adjustedFocusedSet.reset === "01:30", `Quick adjustments and rest controls should persist exact values: ${JSON.stringify(adjustedFocusedSet)}.`);
    await reload(cdp);
    const restoredFocusedSession = await evaluate(cdp, `(() => ({
      visible: !document.querySelector("#focusedWorkoutSession").hidden,
      version: activeWorkoutSession?.version,
      startedAt: activeWorkoutSession?.startedAt,
      completed: WorkoutSessionModel.progress(activeWorkoutSession).completed,
      currentSetId: activeWorkoutSession?.currentSetId,
      firstActual: activeWorkoutSession?.exercises[0]?.sets[0]?.actual?.reps,
      restSourceSetId: activeWorkoutSession?.companion?.rest?.sourceSetId,
      restRemaining: WorkoutSessionModel.remainingRestSeconds(activeWorkoutSession),
      restVisible: Boolean(document.querySelector("#focusedRestTime")),
      storedVersion: JSON.parse(localStorage.getItem(${JSON.stringify(workoutDraftKey)}))?.version
    }))()`);
    assert(restoredFocusedSession.visible && restoredFocusedSession.startedAt === completedFocusedSet.startedAt && restoredFocusedSession.completed === 1 && restoredFocusedSession.currentSetId && restoredFocusedSession.firstActual === 9, "Reload should restore focused progress, current set, actual input, and original start time.");
    assert(restoredFocusedSession.version === 3 && restoredFocusedSession.storedVersion === 3 && restoredFocusedSession.restSourceSetId && restoredFocusedSession.restRemaining > 0 && restoredFocusedSession.restVisible, `Version 3 draft recovery should restore the active rest companion without resetting it: ${JSON.stringify(restoredFocusedSession)}.`);

    const skippedFocusedRest = await evaluate(cdp, `(() => {
      const currentSetId = activeWorkoutSession.currentSetId;
      document.querySelector("#skipFocusedRestBtn").click();
      return {
        currentSetId: activeWorkoutSession.currentSetId,
        rest: activeWorkoutSession.companion.rest,
        restPanelVisible: Boolean(document.querySelector("#focusedRestTime")),
        storedRest: JSON.parse(localStorage.getItem(${JSON.stringify(workoutDraftKey)}))?.companion?.rest
      };
    })()`);
    assert(skippedFocusedRest.currentSetId === restoredFocusedSession.currentSetId && skippedFocusedRest.rest === null && !skippedFocusedRest.restPanelVisible && skippedFocusedRest.storedRest === null, `Skipping rest should keep the next set selected and clear rest from both UI and draft: ${JSON.stringify(skippedFocusedRest)}.`);

    const exerciseTransitionAndUndo = await evaluate(cdp, `(() => {
      const snapshot = structuredClone(activeWorkoutSession);
      const previousLastCompletedSetId = lastCompletedSetId;
      const firstExercise = activeWorkoutSession.exercises[0];
      firstExercise.sets.forEach((set, index) => {
        set.status = index < firstExercise.sets.length - 1 ? "completed" : "pending";
      });
      const lastSet = firstExercise.sets[firstExercise.sets.length - 1];
      activeWorkoutSession.currentSetId = lastSet.id;
      activeWorkoutSession.companion = { rest: null, transition: null };
      renderFocusedWorkoutSession();
      document.querySelector("#completeFocusedSetBtn").click();
      const afterComplete = {
        transitionKind: activeWorkoutSession.companion.transition?.kind,
        currentExercise: document.querySelector("#focusedCurrentSet h3")?.textContent,
        context: document.querySelector("#focusedRestContext")?.textContent,
        restVisible: Boolean(document.querySelector("#focusedRestTime")),
        undoVisible: Boolean(document.querySelector("#undoFocusedSetBtn"))
      };
      document.querySelector("#undoFocusedSetBtn").click();
      const afterUndo = {
        status: activeWorkoutSession.exercises[0].sets.at(-1).status,
        currentSetId: activeWorkoutSession.currentSetId,
        expectedSetId: lastSet.id,
        rest: activeWorkoutSession.companion.rest,
        transition: activeWorkoutSession.companion.transition,
        restVisible: Boolean(document.querySelector("#focusedRestTime")),
        storedRest: JSON.parse(localStorage.getItem(${JSON.stringify(workoutDraftKey)}))?.companion?.rest
      };
      activeWorkoutSession = snapshot;
      lastCompletedSetId = previousLastCompletedSetId;
      persistWorkoutDraft();
      renderFocusedWorkoutSession();
      return { afterComplete, afterUndo };
    })()`);
    assert(exerciseTransitionAndUndo.afterComplete.transitionKind === "exercise" && exerciseTransitionAndUndo.afterComplete.currentExercise === "墙壁俯卧撑" && exerciseTransitionAndUndo.afterComplete.context.includes("下一动作：墙壁俯卧撑") && exerciseTransitionAndUndo.afterComplete.restVisible && exerciseTransitionAndUndo.afterComplete.undoVisible, `Completing an exercise's last set should foreground the next exercise: ${JSON.stringify(exerciseTransitionAndUndo.afterComplete)}.`);
    assert(exerciseTransitionAndUndo.afterUndo.status === "pending" && exerciseTransitionAndUndo.afterUndo.currentSetId === exerciseTransitionAndUndo.afterUndo.expectedSetId && exerciseTransitionAndUndo.afterUndo.rest === null && exerciseTransitionAndUndo.afterUndo.transition === null && !exerciseTransitionAndUndo.afterUndo.restVisible && exerciseTransitionAndUndo.afterUndo.storedRest === null, `Undo should return to the completed set and clear companion rest consistently: ${JSON.stringify(exerciseTransitionAndUndo.afterUndo)}.`);

    const optionalWorkoutApis = await evaluate(cdp, `(async () => {
      const vibrateDescriptor = Object.getOwnPropertyDescriptor(navigator, "vibrate");
      const wakeLockDescriptor = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
      const vibrationPatterns = [];
      const requests = [];
      let releases = 0;
      let missingApiError = "";
      activateTab("today", { scroll: false });
      await releaseWorkoutWakeLock();
      workoutWakeLock = null;
      workoutWakeLockRequest = null;
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value: pattern => { vibrationPatterns.push(pattern); return true; }
      });
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: async type => {
            requests.push(type);
            return {
              released: false,
              addEventListener() {},
              async release() { this.released = true; releases += 1; }
            };
          }
        }
      });
      vibrateWorkout(35);
      activateTab("workout", { scroll: false });
      await syncWorkoutWakeLock();
      activateTab("today", { scroll: false });
      await Promise.resolve();
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
      try {
        activateTab("workout", { scroll: false });
        vibrateWorkout([45, 50, 45]);
        await syncWorkoutWakeLock();
      } catch (error) {
        missingApiError = error?.message || String(error);
      }
      if (vibrateDescriptor) Object.defineProperty(navigator, "vibrate", vibrateDescriptor);
      else delete navigator.vibrate;
      if (wakeLockDescriptor) Object.defineProperty(navigator, "wakeLock", wakeLockDescriptor);
      else delete navigator.wakeLock;
      return {
        vibrationPatterns,
        requests,
        releases,
        missingApiError,
        activeTab: document.querySelector(".tab.active")?.dataset.tab
      };
    })()`);
    assert(optionalWorkoutApis.vibrationPatterns.length === 1 && optionalWorkoutApis.vibrationPatterns[0] === 35, `Supported vibration should receive the completion feedback pattern: ${JSON.stringify(optionalWorkoutApis)}.`);
    assert(optionalWorkoutApis.requests.length === 1 && optionalWorkoutApis.requests[0] === "screen" && optionalWorkoutApis.releases === 1, `Wake lock should be acquired during visible training and released on tab exit: ${JSON.stringify(optionalWorkoutApis)}.`);
    assert(!optionalWorkoutApis.missingApiError && optionalWorkoutApis.activeTab === "workout", `Missing vibration and wake lock APIs should degrade without interrupting training: ${JSON.stringify(optionalWorkoutApis)}.`);

    const focusedFinish = await evaluate(cdp, `(() => {
      document.querySelector("#requestFinishFocusedWorkoutBtn").click();
      const pendingPrompt = {
        title: document.querySelector("#focusedFinishTitle").textContent,
        pendingVisible: !document.querySelector("#pendingWorkoutActions").hidden
      };
      document.querySelector("#confirmFinishWithPendingBtn").click();
      const summary = {
        visible: !document.querySelector("#focusedSummaryForm").hidden,
        metrics: document.querySelector("#focusedSummaryMetrics").textContent,
        preselected: document.querySelector('input[name="workoutFeeling"]:checked')?.value || ""
      };
      document.querySelector("#focusedSummaryForm").requestSubmit();
      const requiredError = !document.querySelector("#focusedSummaryError").hidden;
      document.querySelector('input[name="workoutFeeling"][value="right"]').click();
      document.querySelector("#focusedSummaryForm").requestSubmit();
      const saved = state.workouts[0];
      const result = {
        pendingPrompt,
        summary,
        requiredError,
        workouts: state.workouts.length,
        savedSets: saved.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
        savedReps: saved.exercises[0].sets[0].reps,
        savedRpe: saved.sessionRpe,
        activeSession: activeWorkoutSession,
        draftRemoved: localStorage.getItem(${JSON.stringify(workoutDraftKey)}) === null,
        activeTab: document.querySelector(".tab.active")?.dataset.tab,
        nextPlan: state.nextWorkoutPlan,
        resultDialog: {
          open: document.querySelector("#nextWorkoutResultDialog").open,
          text: document.querySelector("#nextWorkoutResultContent").innerText
        }
      };
      document.querySelector("#closeNextWorkoutResultBtn").click();
      result.activeTabAfterClose = document.querySelector(".tab.active")?.dataset.tab;
      state.workouts = [];
      state.nextWorkoutPlan = null;
      saveState();
      return result;
    })()`);
    assert(/还有 \d+ 组未处理/.test(focusedFinish.pendingPrompt.title) && focusedFinish.pendingPrompt.pendingVisible, "Ending early should disclose the remaining set count before summary.");
    assert(focusedFinish.summary.visible && focusedFinish.summary.metrics.includes("完成 1 组") && !focusedFinish.summary.preselected && focusedFinish.requiredError, "Summary should show automatic duration and require an unselected plain-language feeling.");
    assert(focusedFinish.workouts === 1 && focusedFinish.savedSets === 1 && focusedFinish.savedReps === 9 && focusedFinish.savedRpe === 6, "Focused save should materialize only the explicitly completed set and map the overall feeling.");
    assert(!focusedFinish.activeSession && focusedFinish.draftRemoved && focusedFinish.activeTabAfterClose === "today", "Successful save should clear the session only after history is written and return to today.");
    assert(focusedFinish.nextPlan?.sourceWorkoutId && focusedFinish.nextPlan.exercises.length && focusedFinish.resultDialog.open && focusedFinish.resultDialog.text.includes("下一次训练"), "Focused save should generate and explain the next workout before returning home.");

    const nextWorkoutRules = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const date = today();
      const baseWorkout = {
        id: "rule-workout", date, title: "规则训练", sessionRpe: 4, feeling: "easy", sourceTemplateId: "starter_gym_machines",
        completionSummary: { completed: 2, skipped: 0, pending: 0 },
        exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 8, rpe: 4, note: "" }, { weight: 20, reps: 8, rpe: 4, note: "" }] }]
      };
      state.settings = normalizeSettings({
        ...state.settings,
        preferredEnvironment: "gym",
        availableEquipment: "machines",
        experienceLevel: "beginner",
        starterTemplateId: "starter_gym_machines",
        firstWorkoutSetupCompletedAt: new Date().toISOString(),
        trainingRotation: TrainingRotationModel.defaultRotation()
      }, state.templates);
      state.workouts = [baseWorkout];
      state.dailyLogs = [{ id: "rule-good", date, sleepHours: 7.5, energy: 4, soreness: 1, pain: 0 }];
      const easy = buildNextWorkoutPlan(baseWorkout);
      state.workouts = [{ ...baseWorkout, sessionRpe: 8, feeling: "hard" }];
      const hard = buildNextWorkoutPlan(state.workouts[0]);
      state.dailyLogs = [{ id: "rule-low", date, sleepHours: 5.5, energy: 2, soreness: 4, pain: 0 }];
      const lowRecovery = buildNextWorkoutPlan(state.workouts[0]);
      state.dailyLogs = [{ id: "rule-pain", date, sleepHours: 7, energy: 2, soreness: 3, pain: 4 }];
      const pain = buildNextWorkoutPlan(state.workouts[0]);
      state.dailyLogs = [{ id: "rule-incomplete", date, sleepHours: 7, energy: 3, soreness: 2, pain: 0 }];
      state.workouts = [{ ...baseWorkout, feeling: "right", sessionRpe: 6, completionSummary: { completed: 1, skipped: 1, pending: 0 } }];
      const incomplete = buildNextWorkoutPlan(state.workouts[0]);
      state.settings.trainingRotation = TrainingRotationModel.normalizeRotation({ mode: "upper_lower", currentIndex: 1 }, getAllTemplates());
      const lowerHistory = {
        id: "lower-history", date: addLocalDays(date, -7), title: "下肢训练", sessionRpe: 6, feeling: "right",
        rotationDayId: "rotation_lower", sourceTemplateId: "beginner_lower", completionSummary: { completed: 3, skipped: 0, pending: 0 },
        exercises: [{ name: "腿举", sets: [{ weight: 35, reps: 10, rpe: 6, note: "" }] }]
      };
      state.workouts = [baseWorkout, lowerHistory];
      const rotated = buildNextWorkoutPlan(baseWorkout);
      Object.assign(state, normalizeImportedState(snapshot));
      renderAll();
      return { easy, hard, lowRecovery, pain, incomplete, rotated };
    })()`);
    assert(nextWorkoutRules.easy.exercises[0].sets[0].weight === 22.5 && nextWorkoutRules.easy.adjustments[0].includes("小幅增加"), "Easy completed sessions should make a small, explainable progression.");
    assert(nextWorkoutRules.hard.exercises[0].sets[0].weight === 20 && nextWorkoutRules.hard.adjustments[0].includes("保持"), "Hard sessions should hold load rather than push progression.");
    assert(nextWorkoutRules.lowRecovery.exercises[0].sets.length === 1 && nextWorkoutRules.lowRecovery.adjustments[0].includes("少做一组"), "Poor recovery should reduce volume before increasing load.");
    assert(nextWorkoutRules.pain.title === "恢复优先训练" && nextWorkoutRules.pain.reasons[0].includes("安全优先"), "High pain should replace loading with a recovery plan.");
    assert(nextWorkoutRules.incomplete.exercises[0].sets[0].weight === 20 && nextWorkoutRules.incomplete.adjustments[0].includes("稳定完成"), "Incomplete sessions should hold the same-day load instead of progressing it.");
    assert(nextWorkoutRules.rotated.title === "下肢训练" && nextWorkoutRules.rotated.sourceComparableWorkoutId === "lower-history" && nextWorkoutRules.rotated.exercises[0].sets[0].weight === 35, "Rotation should choose the next training day and reuse that day's own history.");

    const metricUi = await evaluate(cdp, `(async () => {
      const template = {
        id: "metric-ui",
        name: "计量测试",
        exercises: [
          { name: "平板支撑", metric: "seconds", sets: [{ reps: 30, note: "按秒完成" }] },
          { name: "快走", metric: "minutes", sets: [{ reps: 10, note: "按分钟完成" }] },
          { name: "放松", metric: "completion", sets: [{ reps: null, note: "完成即可" }] }
        ]
      };
      startFocusedWorkoutSession(template, template.name);
      activateTab("workout", { scroll: false });
      await new Promise(resolve => setTimeout(resolve, 400));
      const seconds = document.querySelector("#focusedCurrentSet").innerText;
      document.querySelector("#completeFocusedSetBtn").click();
      await new Promise(resolve => setTimeout(resolve, 400));
      const minutes = document.querySelector("#focusedCurrentSet").innerText;
      document.querySelector("#completeFocusedSetBtn").click();
      await new Promise(resolve => setTimeout(resolve, 400));
      const completion = {
        text: document.querySelector("#focusedCurrentSet").innerText,
        hasPrimary: Boolean(document.querySelector("#focusedPrimaryValue")),
        hasWeight: Boolean(document.querySelector("#focusedWeightValue"))
      };
      document.querySelector("#completeFocusedSetBtn").click();
      await new Promise(resolve => setTimeout(resolve, 400));
      const statusText = document.querySelector(".focused-plan-list").textContent;
      const progress = WorkoutSessionModel.progress(activeWorkoutSession);
      clearWorkoutDraft();
      renderFocusedWorkoutSession();
      return { seconds, minutes, completion, statusText, progress };
    })()`);
    assert(metricUi.seconds.includes("实际秒") && metricUi.minutes.includes("实际分钟"), `Focused UI should label second- and minute-based targets in plain language: ${JSON.stringify(metricUi)}.`);
    assert(metricUi.completion.text.includes("完成这段动作") && !metricUi.completion.hasPrimary && !metricUi.completion.hasWeight, "Completion-only sets should not ask for repetitions or weight.");
    assert(metricUi.progress.completed === 3 && metricUi.statusText.includes("✓ 已完成"), "Plan status should combine text, symbol, and color rather than color alone.");

    const painGateSaved = await evaluate(cdp, `(() => {
      const saved = state.dailyLogs.find(item => item.date === today());
      return { pain: saved?.pain, readinessComplete: saved?.readinessComplete };
    })()`);
    assert(painGateSaved.pain === 0 && painGateSaved.readinessComplete === false, `The binary no-pain answer should be remembered without pretending full readiness was completed: ${JSON.stringify(painGateSaved)}.`);

    const painRecovery = await evaluate(cdp, `(() => {
      state.dailyLogs = [];
      saveState();
      activateTab("today", { scroll: false });
      document.querySelector("#startCoachWorkoutBtn").click();
      const gateOpened = document.querySelector("#painGateDialog").open;
      document.querySelector("#hasPainBtn").click();
      const saved = state.dailyLogs.find(item => item.date === today());
      const result = {
        gateOpened,
        title: document.querySelector("#workoutTitle").value,
        pain: saved?.pain,
        safetyPlan: document.querySelector("#workoutTitle").value.includes("恢复拉伸")
      };
      clearWorkoutDraft();
      clearWorkoutForm();
      state.dailyLogs = [];
      saveState();
      activateTab("today", { scroll: false });
      document.querySelector("#startCoachWorkoutBtn").click();
      document.querySelector("#noPainBtn").click();
      clearWorkoutDraft();
      renderFocusedWorkoutSession();
      return result;
    })()`);
    assert(painRecovery.gateOpened && painRecovery.pain === 4 && painRecovery.safetyPlan, "An abnormal-pain answer should save the signal and load the recovery plan instead of normal loading.");

    const templateDialog = await evaluate(cdp, `(() => {
      document.querySelector("#saveTemplateBtn").click();
      const opened = document.querySelector("#templateNameDialog").open;
      const focused = document.activeElement?.id;
      const defaultName = document.querySelector("#templateNameInput").value;
      document.querySelector("#cancelTemplateNameBtn").click();
      const afterCancel = state.templates.length;
      document.querySelector("#saveTemplateBtn").click();
      document.querySelector("#templateNameInput").value = "我的全身模板";
      document.querySelector("#templateNameForm").requestSubmit();
      const saved = {
        count: state.templates.length,
        name: state.templates.at(-1)?.name,
        closed: !document.querySelector("#templateNameDialog").open
      };
      document.querySelector("#saveTemplateBtn").click();
      document.querySelector("#templateNameInput").value = "我的全身模板";
      document.querySelector("#templateNameForm").requestSubmit();
      const duplicate = {
        open: document.querySelector("#templateNameDialog").open,
        error: document.querySelector("#templateNameError").textContent,
        count: state.templates.length
      };
      document.querySelector("#cancelTemplateNameBtn").click();
      return { opened, focused, defaultName, afterCancel, saved, duplicate };
    })()`);
    assert(templateDialog.opened && templateDialog.focused === "templateNameInput" && templateDialog.defaultName === loadedWorkout.title, "Template dialog should open with a useful default name and focus.");
    assert(templateDialog.afterCancel === 0, "Cancelling template naming should not create a template.");
    assert(templateDialog.saved.count === 1 && templateDialog.saved.name === "我的全身模板" && templateDialog.saved.closed, "Template dialog should save a valid unique name.");
    assert(templateDialog.duplicate.open && templateDialog.duplicate.error.includes("同名模板") && templateDialog.duplicate.count === 1, "Duplicate template names should be blocked inline.");

    await evaluate(cdp, `document.querySelector("#finishWorkoutBtn").click()`);
    await delay(400);
    const blockedSave = await evaluate(cdp, `(() => {
      const raw = localStorage.getItem(${JSON.stringify(storageKey)});
      const parsed = raw ? JSON.parse(raw) : { workouts: [] };
      return {
        workouts: parsed.workouts.length,
        toast: document.querySelector("#toast").textContent,
        hasSummary: Boolean(document.querySelector(".execution-summary"))
      };
    })()`);
    assert(blockedSave.workouts === 0, "Empty template workout should not be saved.");
    assert(blockedSave.toast.includes("请至少记录"), "Blocked save should explain missing set data.");
    assert(!blockedSave.hasSummary, "Blocked save should not show a completion summary.");

    await evaluate(cdp, `document.querySelector(".set-weight").value = "20";
      document.querySelector(".set-weight").dispatchEvent(new Event("input", { bubbles: true }));`);
    await delay(250);
    const oneSetProgress = await evaluate(cdp, `(() => ({
      progress: document.querySelector(".progress-ring strong").textContent,
      sets: Array.from(document.querySelectorAll(".execution-stat strong")).map(el => el.textContent)[1],
      collectedSets: collectWorkoutExercises().reduce((sum, exercise) => sum + exercise.sets.length, 0)
    }))()`);
    assert(oneSetProgress.progress === "13", "One completed set should make 1/8 progress for the selected home starter.");
    assert(oneSetProgress.sets === "1/8", "Execution panel should show one completed set for the selected home starter.");
    assert(oneSetProgress.collectedSets === 1, "Only one real set should be collected for saving.");

    await evaluate(cdp, `document.querySelector("#finishWorkoutBtn").click()`);
    await delay(650);
    const savedWorkout = await evaluate(cdp, `(() => {
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        workouts: parsed.workouts.length,
        savedSets: parsed.workouts[0].exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
        nextPlan: parsed.nextWorkoutPlan,
        draftRemoved: localStorage.getItem(${JSON.stringify(workoutDraftKey)}) === null,
        summary: document.querySelector(".execution-summary")?.innerText,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(savedWorkout.workouts === 1, "One workout should be saved after entering a real set.");
    assert(savedWorkout.savedSets === 1, "Saved workout should include exactly one real set.");
    assert(savedWorkout.draftRemoved, "Saving a workout should clear its unfinished draft.");
    assert(savedWorkout.summary?.includes("刚刚保存"), "Saved workout should show completion summary.");
    assert(savedWorkout.nextPlan?.sourceWorkoutId && !savedWorkout.nextPlan?.acceptedAt && !savedWorkout.nextPlan?.startedAt, "Saved workout data should retain an unstarted next plan so acceptance is recorded only when the user begins it.");
    assert(!savedWorkout.overflow, "Workout desktop layout should not overflow.");

    await evaluate(cdp, `document.querySelector('[data-tab="today"]').click(); window.scrollTo(0, 0);`);
    await delay(150);
    const nextWorkoutHome = await evaluate(cdp, `(() => ({
      title: document.querySelector("#dailyCoach h2")?.textContent,
      text: document.querySelector("#dailyCoach")?.innerText,
      action: document.querySelector("#startNextWorkoutBtn")?.textContent,
      patternOnHome: Boolean(document.querySelector("#dailyCoach .pattern-progress")),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(nextWorkoutHome.title === "下一次训练" && nextWorkoutHome.action === "确认并开始", "Home should prioritize the generated next workout and make its confirmation state explicit.");
    assert(nextWorkoutHome.text.includes("训练顺序") && !nextWorkoutHome.patternOnHome, "Home should explain the rotation source without competing pattern-progress content.");
    assert(!nextWorkoutHome.overflow, "Next workout home card should fit the desktop viewport.");

    const nextWorkoutStart = await evaluate(cdp, `(() => {
      document.querySelector("#startNextWorkoutBtn").click();
      const accepted = {
        status: state.nextWorkoutPlan?.status,
        acceptedAt: state.nextWorkoutPlan?.acceptedAt,
        startedAt: state.nextWorkoutPlan?.startedAt,
        focusedTitle: document.querySelector("#focusedWorkoutSession h2")?.textContent,
        activeTab: document.querySelector(".tab.active")?.dataset.tab
      };
      clearWorkoutDraft();
      activeWorkoutSession = null;
      state.nextWorkoutPlan = null;
      saveState();
      clearWorkoutForm();
      return accepted;
    })()`);
    assert(nextWorkoutStart.status === "started" && nextWorkoutStart.acceptedAt && nextWorkoutStart.startedAt && nextWorkoutStart.focusedTitle && nextWorkoutStart.activeTab === "workout", "Starting the next workout should record plan acceptance and carry its exercises into the focused session.");

    const rotationUi = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      activateTab("library", { scroll: false });
      renderLibrary();
      document.querySelector("#trainingRotationMode").value = "custom";
      document.querySelector("#trainingRotationMode").dispatchEvent(new Event("change", { bubbles: true }));
      const customRows = document.querySelectorAll(".rotation-day-row");
      customRows[0].querySelector(".rotation-label").value = "上肢 A";
      customRows[1].querySelector(".rotation-label").value = "下肢 A";
      document.querySelector("#savePreferencesBtn").click();
      const customSaved = {
        mode: state.settings.trainingRotation.mode,
        labels: state.settings.trainingRotation.days.map(day => day.label),
        rows: customRows.length
      };

      document.querySelector("#trainingRotationMode").value = "upper_lower";
      document.querySelector("#trainingRotationMode").dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#savePreferencesBtn").click();
      const source = {
        id: "rotation-ui-source", date: today(), title: "上肢训练", sessionRpe: 6, feeling: "right",
        rotationDayId: "rotation_upper", sourceTemplateId: "beginner_upper", completionSummary: { completed: 4, skipped: 0, pending: 0 },
        exercises: [{ name: "卧推", sets: [{ weight: 20, reps: 8, rpe: 6, note: "" }] }]
      };
      const lowerHistory = {
        id: "rotation-ui-lower", date: addLocalDays(today(), -7), title: "下肢训练", sessionRpe: 6, feeling: "right",
        rotationDayId: "rotation_lower", sourceTemplateId: "beginner_lower", completionSummary: { completed: 4, skipped: 0, pending: 0 },
        exercises: [{ name: "腿举", sets: [{ weight: 42.5, reps: 10, rpe: 6, note: "" }] }]
      };
      state.workouts = [source, lowerHistory];
      state.settings.trainingRotation.currentIndex = 0;
      state.nextWorkoutPlan = buildNextWorkoutPlan(source);
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      const daySelect = document.querySelector("#nextWorkoutDaySelect");
      daySelect.value = "rotation_lower";
      daySelect.dispatchEvent(new Event("change", { bubbles: true }));
      const changed = {
        title: state.nextWorkoutPlan.title,
        comparable: state.nextWorkoutPlan.sourceComparableWorkoutId,
        weight: state.nextWorkoutPlan.exercises[0].sets[0].weight
      };
      const chosenDate = addLocalDays(today(), 3);
      document.querySelector("#nextWorkoutDateInput").value = chosenDate;
      document.querySelector("#confirmNextWorkoutBtn").click();
      const confirmed = {
        status: state.nextWorkoutPlan.status,
        date: state.nextWorkoutPlan.scheduledFor,
        decision: state.nextWorkoutPlan.userDecision,
        nextIndex: state.settings.trainingRotation.currentIndex,
        dialogClosed: !document.querySelector("#nextWorkoutResultDialog").open
      };
      state.nextWorkoutPlan = buildNextWorkoutPlan(source);
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      document.querySelector("#selfDecideNextWorkoutBtn").click();
      const selfDecided = state.nextWorkoutPlan === null;
      Object.assign(state, normalizeImportedState(snapshot));
      persistState();
      renderAll();
      return { customSaved, changed, confirmed, chosenDate, selfDecided, overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert(rotationUi.customSaved.mode === "custom" && rotationUi.customSaved.rows === 2 && rotationUi.customSaved.labels.join("→") === "上肢 A→下肢 A", "Users should be able to save a named custom training order.");
    assert(rotationUi.changed.title === "下肢训练" && rotationUi.changed.comparable === "rotation-ui-lower" && rotationUi.changed.weight === 42.5, "Changing the suggested training day should rebuild it from that day's own history.");
    assert(rotationUi.confirmed.status === "planned" && rotationUi.confirmed.date === rotationUi.chosenDate && rotationUi.confirmed.decision === "changed_day" && rotationUi.confirmed.nextIndex === 0 && rotationUi.confirmed.dialogClosed, "Users should be able to change the date and confirm a different rotation day without ambiguous state.");
    assert(rotationUi.selfDecided && !rotationUi.overflow, "Choosing to decide independently should remove the automatic plan without causing layout overflow.");

    const nextPlanExerciseEdit = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      state.settings.trainingRotation = TrainingRotationModel.normalizeRotation({
        mode: "upper_lower",
        currentIndex: 0,
        days: [
          { id: "rotation_upper", label: "上肢", templateId: "beginner_upper" },
          { id: "rotation_lower", label: "下肢", templateId: "beginner_lower" }
        ]
      }, getAllTemplates());
      const source = {
        id: "remove-exercise-source", date: today(), title: "上肢训练", sessionRpe: 6, feeling: "right",
        rotationDayId: "rotation_upper", sourceTemplateId: "beginner_upper", completionSummary: { completed: 4, skipped: 0, pending: 0 },
        exercises: [{ name: "卧推", sets: [{ weight: 20, reps: 8, rpe: 6, note: "" }] }]
      };
      state.workouts = [source];
      state.nextWorkoutPlan = buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" });
      const templatesBefore = JSON.stringify(state.templates);
      const workoutsBefore = JSON.stringify(state.workouts);
      const rotationBefore = JSON.stringify(state.settings.trainingRotation);
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      const before = {
        names: state.nextWorkoutPlan.exercises.map(item => item.name),
        duration: state.nextWorkoutPlan.estimatedDuration,
        action: Boolean(document.querySelector("#removeNextWorkoutExerciseBtn"))
      };
      const chosenDate = addLocalDays(today(), 4);
      document.querySelector("#nextWorkoutDateInput").value = chosenDate;
      document.querySelector("#removeNextWorkoutExerciseBtn")?.click();
      const editedNames = state.nextWorkoutPlan.exercises.map(item => item.name);
      const edited = {
        names: editedNames,
        duration: state.nextWorkoutPlan.estimatedDuration,
        date: state.nextWorkoutPlan.scheduledFor,
        inputDate: document.querySelector("#nextWorkoutDateInput")?.value,
        decision: state.nextWorkoutPlan.userDecision,
        persistedNames: JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).nextWorkoutPlan?.exercises?.map(item => item.name) || [],
        dialogOpen: document.querySelector("#nextWorkoutResultDialog").open,
        announcement: document.querySelector("#toast").textContent,
        templatesUnchanged: JSON.stringify(state.templates) === templatesBefore,
        workoutsUnchanged: JSON.stringify(state.workouts) === workoutsBefore,
        rotationUnchanged: JSON.stringify(state.settings.trainingRotation) === rotationBefore
      };
      closeNextWorkoutResult();
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      const reopenedNames = state.nextWorkoutPlan.exercises.map(item => item.name);
      document.querySelector("#confirmNextWorkoutBtn").click();
      const confirmedEdit = {
        date: state.nextWorkoutPlan.scheduledFor,
        status: state.nextWorkoutPlan.status,
        persistedDate: JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).nextWorkoutPlan.scheduledFor
      };

      state.nextWorkoutPlan = buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" });
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      const daySelect = document.querySelector("#nextWorkoutDaySelect");
      daySelect.value = "rotation_upper";
      daySelect.dispatchEvent(new Event("change", { bubbles: true }));
      const changedDay = {
        sourceTemplateId: state.nextWorkoutPlan.sourceTemplateId,
        names: state.nextWorkoutPlan.exercises.map(item => item.name),
        decision: state.nextWorkoutPlan.userDecision
      };

      state.nextWorkoutPlan = buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" });
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      document.querySelector("#removeNextWorkoutExerciseBtn")?.click();
      document.querySelector("#makeNextWorkoutRecoveryBtn").click();
      const recovery = {
        source: state.nextWorkoutPlan.source,
        action: Boolean(document.querySelector("#removeNextWorkoutExerciseBtn"))
      };

      state.nextWorkoutPlan = normalizeNextWorkoutPlan({
        ...buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" }),
        exercises: buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" }).exercises.slice(0, 1)
      });
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      const oneExerciseAction = Boolean(document.querySelector("#removeNextWorkoutExerciseBtn"));

      const durationCases = [1, -5, 0.5, 9999].map(importedDuration => {
        state.nextWorkoutPlan = normalizeNextWorkoutPlan({
          ...buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" }),
          estimatedDuration: importedDuration
        });
        showNextWorkoutResult(source, state.nextWorkoutPlan);
        document.querySelector("#removeNextWorkoutExerciseBtn").click();
        return {
          importedDuration,
          duration: state.nextWorkoutPlan.estimatedDuration,
          remaining: state.nextWorkoutPlan.exercises.length
        };
      });

      state.nextWorkoutPlan = buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" });
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      document.querySelector("#removeNextWorkoutExerciseBtn")?.click();
      const namesBeforeStart = state.nextWorkoutPlan.exercises.map(item => item.name);
      startNextWorkoutPlan();
      const startedNames = activeWorkoutSession.exercises.map(item => item.name);
      clearWorkoutDraft();
      activeWorkoutSession = null;
      clearWorkoutForm();
      Object.assign(state, normalizeImportedState(snapshot));
      persistState();
      renderAll();
      return { before, chosenDate, edited, editedNames, reopenedNames, confirmedEdit, changedDay, recovery, oneExerciseAction, durationCases, namesBeforeStart, startedNames };
    })()`);
    assert(nextPlanExerciseEdit.before.action, "Editable suggested plans should offer 减少一个动作.");
    assert(nextPlanExerciseEdit.edited.names.length === nextPlanExerciseEdit.before.names.length - 1 && nextPlanExerciseEdit.edited.names.join("→") === nextPlanExerciseEdit.before.names.slice(0, -1).join("→"), "Removing an exercise should remove exactly the last item and preserve retained order.");
    assert(nextPlanExerciseEdit.edited.duration > 0 && nextPlanExerciseEdit.edited.duration < nextPlanExerciseEdit.before.duration, "Removing an exercise should reduce the positive duration estimate.");
    assert(nextPlanExerciseEdit.edited.decision === "reduced_exercise" && nextPlanExerciseEdit.edited.persistedNames.join("→") === nextPlanExerciseEdit.editedNames.join("→"), "The one-off edit should be normalized and persisted immediately.");
    assert(nextPlanExerciseEdit.edited.date === nextPlanExerciseEdit.chosenDate && nextPlanExerciseEdit.edited.inputDate === nextPlanExerciseEdit.chosenDate, "Removing an exercise should preserve a valid unsubmitted date in the plan snapshot and redrawn input.");
    assert(nextPlanExerciseEdit.edited.dialogOpen && nextPlanExerciseEdit.edited.announcement.includes(nextPlanExerciseEdit.before.names.at(-1)), "The result dialog should stay open and announce the removed exercise by name.");
    assert(nextPlanExerciseEdit.edited.templatesUnchanged && nextPlanExerciseEdit.edited.workoutsUnchanged && nextPlanExerciseEdit.edited.rotationUnchanged, "Removing an exercise must not mutate templates, history, or rotation.");
    assert(nextPlanExerciseEdit.reopenedNames.join("→") === nextPlanExerciseEdit.editedNames.join("→"), "Closing and reopening should preserve the edited plan snapshot.");
    assert(nextPlanExerciseEdit.confirmedEdit.status === "planned" && nextPlanExerciseEdit.confirmedEdit.date === nextPlanExerciseEdit.chosenDate && nextPlanExerciseEdit.confirmedEdit.persistedDate === nextPlanExerciseEdit.chosenDate, "Changing the date, removing an exercise, and confirming should retain the chosen date.");
    assert(nextPlanExerciseEdit.changedDay.sourceTemplateId === "beginner_upper" && nextPlanExerciseEdit.changedDay.decision !== "reduced_exercise", "Changing the training day should rebuild the plan from its source template.");
    assert(nextPlanExerciseEdit.recovery.source === "recovery_override" && !nextPlanExerciseEdit.recovery.action && !nextPlanExerciseEdit.oneExerciseAction, "Recovery and one-exercise plans should not offer removal.");
    assert(nextPlanExerciseEdit.durationCases.every(item => Number.isFinite(item.duration) && item.duration > 0), "Imported low or negative durations should normalize to a positive estimate after removal.");
    assert(nextPlanExerciseEdit.durationCases.find(item => item.importedDuration === 1)?.duration <= 1, "Removing from a low positive imported duration must not increase the estimate.");
    assert(nextPlanExerciseEdit.durationCases.find(item => item.importedDuration === -5)?.duration <= nextPlanExerciseEdit.durationCases.find(item => item.importedDuration === -5).remaining * 8, "A negative imported duration should be replaced by a bounded per-exercise estimate.");
    assert(nextPlanExerciseEdit.durationCases.find(item => item.importedDuration === 0.5)?.duration === 0.5, "Removing from a sub-minute positive imported duration must preserve it instead of increasing it.");
    assert(nextPlanExerciseEdit.durationCases.find(item => item.importedDuration === 9999)?.duration === nextPlanExerciseEdit.durationCases.find(item => item.importedDuration === 9999).remaining * 8, "An implausibly large imported duration should be rebuilt from the remaining exercise count.");
    assert(nextPlanExerciseEdit.startedNames.join("→") === nextPlanExerciseEdit.namesBeforeStart.join("→"), "Starting the edited plan should use exactly its retained exercises.");

    const previousSetHistory = await evaluate(cdp, `(() => {
      const savedName = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).workouts[0].exercises[0].name;
      const select = document.querySelector(".exercise-name");
      select.value = savedName;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const history = document.querySelector(".exercise-history");
      const before = {
        hidden: history.hidden,
        text: history.innerText,
        button: Boolean(history.querySelector(".reuse-last-sets"))
      };
      history.querySelector(".reuse-last-sets").click();
      const firstRow = document.querySelector(".set-grid");
      return {
        savedName,
        today: today(),
        before,
        weight: firstRow.querySelector(".set-weight").value,
        reps: firstRow.querySelector(".set-reps").value,
        rpe: firstRow.querySelector(".set-rpe").value,
        sets: document.querySelectorAll(".set-grid").length,
        collectedSets: collectWorkoutExercises().reduce((sum, exercise) => sum + exercise.sets.length, 0),
        toast: document.querySelector("#toast").textContent,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(!previousSetHistory.before.hidden && previousSetHistory.before.button, "A repeated exercise should expose its latest history.");
    assert(previousSetHistory.before.text.includes(previousSetHistory.today) && previousSetHistory.before.text.includes("1 组"), "Exercise history should show the latest date and set count.");
    assert(previousSetHistory.weight === "20" && previousSetHistory.reps === "10" && previousSetHistory.rpe === "5", "Reuse should fill weight, reps, and RPE from the latest selected starter exercise.");
    assert(previousSetHistory.sets === 1 && previousSetHistory.collectedSets === 1, "Reuse should copy exactly the saved sets into the active workout.");
    assert(previousSetHistory.toast.includes("上次训练数据"), "Reuse should confirm what was filled.");
    assert(!previousSetHistory.overflow, "Exercise history should not overflow the workout layout.");

    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click()`);
    await delay(200);
    const workoutEditLoaded = await evaluate(cdp, `(() => {
      document.querySelector(".edit-workout-record").click();
      return {
        activeTab: document.querySelector(".tab.active")?.dataset.tab,
        title: document.querySelector("#workoutTitle").value,
        weight: document.querySelector(".set-weight").value,
        saveText: document.querySelector("#saveWorkoutBtn").textContent,
        finishText: document.querySelector("#finishWorkoutBtn").textContent,
        cancelHidden: document.querySelector("#cancelWorkoutEditBtn").hidden
      };
    })()`);
    assert(workoutEditLoaded.activeTab === "workout", "Editing history should open the workout tab.");
    assert(workoutEditLoaded.weight === "20", "Editing history should load the original set values.");
    assert(workoutEditLoaded.saveText === "保存修改" && workoutEditLoaded.finishText === "保存修改", "Edit mode should clearly label both save actions.");
    assert(!workoutEditLoaded.cancelHidden, "Edit mode should expose a cancel action.");

    await evaluate(cdp, `(() => {
      document.querySelector("#workoutTitle").value = "修正后的训练";
      document.querySelector("#workoutTitle").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#saveWorkoutBtn").click();
    })()`);
    await delay(650);
    const workoutEdited = await evaluate(cdp, `(() => {
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        workouts: parsed.workouts.length,
        title: parsed.workouts[0].title,
        saveText: document.querySelector("#saveWorkoutBtn").textContent,
        cancelHidden: document.querySelector("#cancelWorkoutEditBtn").hidden,
        draftRemoved: localStorage.getItem(${JSON.stringify(workoutDraftKey)}) === null,
        toast: document.querySelector("#toast").textContent
      };
    })()`);
    assert(workoutEdited.workouts === 1 && workoutEdited.title === "修正后的训练", "Saving edits should replace the original workout without duplication.");
    assert(workoutEdited.saveText === "保存训练" && workoutEdited.cancelHidden, "Saving edits should leave edit mode.");
    assert(workoutEdited.draftRemoved && workoutEdited.toast.includes("修改已保存"), "Saving edits should clear the draft and confirm success.");

    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click()`);
    await delay(200);
    const workoutDeleteCancel = await evaluate(cdp, `(() => {
      document.querySelector(".delete-workout-record").click();
      const opened = document.querySelector("#deleteWorkoutDialog").open;
      const focused = document.activeElement?.id;
      document.querySelector("#cancelDeleteWorkoutBtn").click();
      return {
        opened,
        focused,
        closed: !document.querySelector("#deleteWorkoutDialog").open,
        workouts: state.workouts.length
      };
    })()`);
    assert(workoutDeleteCancel.opened && workoutDeleteCancel.focused === "cancelDeleteWorkoutBtn", "Delete confirmation should open with focus on cancel.");
    assert(workoutDeleteCancel.closed && workoutDeleteCancel.workouts === 1, "Canceling deletion should preserve the workout.");

    const workoutDeleted = await evaluate(cdp, `(() => {
      document.querySelector(".delete-workout-record").click();
      document.querySelector("#confirmDeleteWorkoutBtn").click();
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        workouts: parsed.workouts.length,
        cardRemoved: !document.querySelector(".history-card[data-workout-id]"),
        dialogClosed: !document.querySelector("#deleteWorkoutDialog").open,
        toast: document.querySelector("#toast").textContent
      };
    })()`);
    assert(workoutDeleted.workouts === 0 && workoutDeleted.cardRemoved, "Confirmed deletion should remove the workout from storage and history.");
    assert(workoutDeleted.dialogClosed && workoutDeleted.toast.includes("训练记录已删除"), "Confirmed deletion should close the dialog and explain success.");

    await evaluate(cdp, `(() => {
      const days = getLastDays(7);
      const dailyLogs = days.slice(1).map((date, index) => ({
        id: "daily-risk-" + index,
        date,
        sleepHours: index < 3 ? 5.5 : 6,
        waterMl: index % 2 ? 1400 : 1900,
        mood: 3,
        energy: 2,
        soreness: 4,
        pain: index === 4 ? 4 : 3,
        habits: { workout: false, stretch: false, study: false, earlySleep: false },
        note: ""
      }));
      const workouts = [days[4], days[6]].map((date, index) => ({
        id: "workout-risk-" + index,
        date,
        title: index ? "下肢高强度" : "上肢高强度",
        duration: 50,
        sessionRpe: 8,
        note: "",
        exercises: [{
          name: index ? "腿举" : "坐姿划船",
          sets: [
            { weight: 30, reps: 10, rpe: 8, note: "" },
            { weight: 30, reps: 10, rpe: 8, note: "" },
            { weight: 30, reps: 8, rpe: 9, note: "" }
          ]
        }]
      }));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({
        dailyLogs,
        workouts,
        exercises: [],
        templates: [],
        adviceHistory: [],
        settings: { waterStepMl: 500 }
      }));
    })()`);
    await reload(cdp);
    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    await delay(300);
    const riskReview = await evaluate(cdp, `(() => ({
      confidence: document.querySelector("#retentionInsights .confidence-pill")?.textContent,
      text: document.querySelector("#retentionInsights")?.innerText,
      report: buildWeeklyReportText(),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(riskReview.confidence === "复盘可信", "Enough data review should show high confidence.");
    assert(riskReview.text.includes("出现高疼痛信号"), "High pain should render a recovery risk.");
    assert(riskReview.text.includes("高强度"), "High RPE should render an intensity warning.");
    assert(riskReview.report.includes("## 本周摘要"), "Weekly report should include summary section.");
    assert(riskReview.report.includes("## 风险提醒"), "Weekly report should include risk section.");
    assert(riskReview.report.includes("## 下周行动"), "Weekly report should include next actions.");
    assert(riskReview.report.includes("## 安全说明"), "Weekly report should include safety disclaimer.");
    assert(!riskReview.overflow, "Insights desktop layout should not overflow.");

    const personalPatterns = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const dates = getLastDays(10);
      const buildWorkout = (date, index, completed, rpe) => ({
        id: "pattern-workout-" + index,
        date,
        title: "PRIVATE_PATTERN_TITLE",
        duration: 30,
        sessionRpe: rpe,
        note: "PRIVATE_PATTERN_NOTE",
        completionSummary: { total: 3, completed, skipped: 3 - completed, pending: 0 },
        exercises: [{ name: "PRIVATE_PATTERN_EXERCISE", sets: Array.from({ length: completed }, () => ({ weight: 999, reps: 8, rpe, note: "PRIVATE_PATTERN_SET" })) }]
      });
      state.dailyLogs = dates.map((date, index) => ({
        id: "pattern-daily-" + index,
        date,
        sleepHours: index < 5 ? 5.5 : 7.5,
        energy: index < 5 ? 2 : 4,
        soreness: index < 5 ? 4 : 1,
        pain: index === 0 ? 4 : 0,
        painArea: index === 0 ? "PRIVATE_PAIN_AREA" : "",
        note: "PRIVATE_PATTERN_DAILY"
      }));
      state.workouts = dates.map((date, index) => buildWorkout(date, index, index < 5 ? 1 : 3, index < 5 ? 8 : 6));
      state.nextWorkoutPlan = { status: "planned" };
      const strong = buildPersonalTrainingPatterns();
      renderPersonalTrainingPatterns();
      const rendered = document.querySelector("#personalTrainingPatterns")?.innerText;
      const action = document.querySelector("#personalTrainingPatterns [data-pattern-action]")?.textContent;

      state.dailyLogs = state.dailyLogs.slice(0, 6);
      state.workouts = state.workouts.slice(0, 6);
      const lowData = buildPersonalTrainingPatterns();

      state.dailyLogs = dates.map((date, index) => ({ id: "flat-daily-" + index, date, sleepHours: 7, energy: 3, soreness: 2, pain: 0 }));
      state.workouts = dates.map((date, index) => buildWorkout(date, index, 2, 6));
      const noPattern = buildPersonalTrainingPatterns();
      Object.assign(state, normalizeImportedState(snapshot));
      renderAll();
      return { strong, lowData, noPattern, rendered, action, overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert(personalPatterns.strong.ready && personalPatterns.strong.confidenceLabel === "已有一定依据", "Ten paired training and recovery days should unlock an evidence-based personal pattern state.");
    assert(personalPatterns.strong.observations[0].id === "high-pain-safety", "High pain should take priority over performance patterns.");
    assert(personalPatterns.strong.observations.some(item => item.id === "sleep-completion") && personalPatterns.strong.observations.some(item => item.id === "sleep-rpe"), "Paired sleep data should produce explainable completion and effort observations when differences are substantial.");
    assert(personalPatterns.rendered.includes("有效观察 10/7 天") && personalPatterns.rendered.includes("不构成医疗诊断或因果结论") && personalPatterns.action === "查看下一次训练", "Pattern UI should show coverage, a clear non-causal boundary, and the P1 next-workout action.");
    assert(!personalPatterns.rendered.includes("PRIVATE_PATTERN") && !personalPatterns.rendered.includes("999") && !personalPatterns.rendered.includes("PRIVATE_PAIN_AREA"), "Pattern UI must not expose notes, exercises, weights, or pain-area text.");
    assert(!personalPatterns.lowData.ready && personalPatterns.lowData.summary.includes("暂不生成规律结论"), "Fewer than seven paired days must remain a progress state.");
    assert(personalPatterns.noPattern.ready && !personalPatterns.noPattern.observations.length && personalPatterns.noPattern.summary.includes("暂未出现足够一致"), "Enough but flat data should avoid inventing a personal pattern.");
    assert(!personalPatterns.overflow, "Personal pattern layout should not overflow on desktop.");

    const personalProgress = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const dates = getLastDays(56);
      state.dailyLogs = dates.map((date, index) => ({
        id: "progress-daily-" + index,
        date,
        sleepHours: index < 28 ? 6 : 7.5,
        waterMl: 2100,
        mood: 3,
        energy: 3,
        soreness: 1,
        pain: index < 28 ? 1 : 0,
        habits: {},
        note: "私密阶段备注"
      }));
      state.workouts = dates.filter((date, index) => index % 7 === 0 || index >= 28 && index % 7 === 3).map((date, index) => ({
        id: "progress-workout-" + index,
        date,
        title: "秘密动作",
        duration: 35,
        sessionRpe: 6,
        note: "私密训练备注",
        exercises: [{ name: "秘密深蹲", sets: [{ weight: 40, reps: 8, rpe: 6, note: "不应导出" }, { weight: 40, reps: 8, rpe: 6, note: "不应导出" }] }]
      }));
      state.settings = normalizeSettings({ ...state.settings, weeklyWorkoutTarget: 2 });
      renderAll();
      const report = buildPersonalProgressReport();
      const text = buildPersonalProgressReportText(report);
      const panelText = document.querySelector(".personal-progress-report")?.innerText;
      const originalClick = HTMLAnchorElement.prototype.click;
      let downloadName = "";
      HTMLAnchorElement.prototype.click = function captureDownload() { downloadName = this.download; };
      document.querySelector("#exportPersonalProgressReportBtn").click();
      HTMLAnchorElement.prototype.click = originalClick;
      Object.assign(state, snapshot);
      persistState();
      renderAll();
      return { report, text, panelText, downloadName, overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert(personalProgress.report.ready && personalProgress.report.title === "28 天个人进展", "A 28-day report should become available with enough local records.");
    assert(personalProgress.panelText.includes("训练节奏更稳定") && personalProgress.panelText.includes("下一阶段行动"), "The progress card should explain meaningful stage comparisons and next actions.");
    assert(personalProgress.text.includes("## 阶段概览") && personalProgress.text.includes("## 阶段发现"), "Personal progress export should include a readable stage summary.");
    assert(!personalProgress.text.includes("秘密动作") && !personalProgress.text.includes("秘密深蹲") && !personalProgress.text.includes("私密阶段备注") && !personalProgress.text.includes("40"), "Personal progress export must exclude exercise details and private notes.");
    assert(personalProgress.downloadName.includes("progress-report") && !personalProgress.overflow, "Personal progress should export locally and fit the desktop layout.");

    const proLongitudinal = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const liveSession = { ...accountSession };
      const liveEntitlements = { ...accountEntitlements };
      const liveAccessMode = aiAccessMode;
      const livePeriod = proReportPeriod;
      const storageBefore = localStorage.getItem(${JSON.stringify(storageKey)});
      aiAccessMode = "deployment_shared";
      renderProLongitudinalReport();
      const staticHidden = document.querySelector("#proLongitudinalReport")?.hidden;

      aiAccessMode = "account_quota";
      accountSession = { loading: false, configured: true, signedIn: false, unavailable: false, user: null };
      renderProLongitudinalReport();
      const signedOutText = document.querySelector("#proLongitudinalReport")?.innerText;
      const signedOutHidden = document.querySelector("#proLongitudinalReport")?.hidden;

      accountSession = { loading: false, configured: true, signedIn: true, unavailable: false, user: { email: "pro@example.com" } };
      accountEntitlements = { loading: false, configured: true, unavailable: true, plan: null, quota: null };
      renderProLongitudinalReport();
      const unavailableText = document.querySelector("#proLongitudinalReport")?.innerText;
      const unavailableHidden = document.querySelector("#proLongitudinalReport")?.hidden;

      state.dailyLogs = getLastDays(17).map((date, index) => ({ id: "short-90-" + index, date, sleepHours: 7, pain: 0 }));
      state.workouts = [];
      const insufficient90 = buildProLongitudinalReport("90d");
      state.dailyLogs = getLastDays(70).map((date, index) => ({ id: "short-annual-" + index, date, sleepHours: 7, pain: 0 }));
      const shortAnnual = buildProLongitudinalReport("annual");

      const dates = getLastDays(365);
      state.dailyLogs = dates.map((date, index) => ({
        id: "PRIVATE_LONG_DAILY_" + index,
        date,
        sleepHours: index < 90 ? 6.2 : index >= 275 ? 7.4 : 6.8,
        waterMl: 2100,
        mood: 3,
        energy: 3,
        soreness: 1,
        pain: index < 90 ? 1 : 0,
        habits: {},
        note: "PRIVATE_LONGITUDINAL_NOTE"
      }));
      state.workouts = dates.filter((date, index) => {
        if (index < 90) return index % 14 === 0;
        if (index >= 335) return index % 5 === 0;
        if (index >= 305) return index % 10 === 0;
        if (index >= 275) return index % 14 === 0;
        return index % 21 === 0;
      }).map((date, index) => ({
        id: "PRIVATE_LONG_WORKOUT_" + index,
        date,
        title: "PRIVATE_LONG_ACTION",
        duration: 35,
        sessionRpe: 6,
        note: "PRIVATE_LONG_WORKOUT_NOTE",
        exercises: [{ name: "PRIVATE_LONG_EXERCISE", sets: [{ weight: 987, reps: 13, rpe: 6, note: "PRIVATE_SET_NOTE" }, { weight: 987, reps: 13, rpe: 6, note: "PRIVATE_SET_NOTE" }] }]
      }));
      proReportPeriod = "90d";
      accountEntitlements = { loading: false, configured: true, unavailable: false, plan: "free", quota: { used: 0, pending: 0, remaining: 3, limit: 3, resetAt: "2026-08-01T00:00:00.000Z" } };
      renderProLongitudinalReport();
      const freeText = document.querySelector("#proLongitudinalReport")?.innerText;
      const freeHasExport = Boolean(document.querySelector("#exportProLongitudinalReportBtn"));
      const freeHidden = document.querySelector("#proLongitudinalReport")?.hidden;

      accountEntitlements = { ...accountEntitlements, plan: "pro" };
      renderProLongitudinalReport();
      const report90 = buildProLongitudinalReport("90d");
      const text90 = buildProLongitudinalReportText(report90);
      const panel90 = document.querySelector("#proLongitudinalReport")?.innerText;
      document.querySelector('[data-pro-report-period="annual"]')?.click();
      const annual = buildProLongitudinalReport("annual");
      const annualText = buildProLongitudinalReportText(annual);
      const annualPanel = document.querySelector("#proLongitudinalReport")?.innerText;
      const originalClick = HTMLAnchorElement.prototype.click;
      let downloadName = "";
      HTMLAnchorElement.prototype.click = function captureDownload() { downloadName = this.download; };
      document.querySelector("#exportProLongitudinalReportBtn")?.click();
      HTMLAnchorElement.prototype.click = originalClick;

      accountEntitlements = { ...accountEntitlements, plan: "free" };
      renderProLongitudinalReport();
      const downgradedText = document.querySelector("#proLongitudinalReport")?.innerText;
      const downgradedHasExport = Boolean(document.querySelector("#exportProLongitudinalReportBtn"));
      const downgradedHidden = document.querySelector("#proLongitudinalReport")?.hidden;
      const storageUnchanged = localStorage.getItem(${JSON.stringify(storageKey)}) === storageBefore;
      const overflow = document.documentElement.scrollWidth > innerWidth;

      window.__proLongitudinalSnapshot = { state: snapshot, accountSession: liveSession, accountEntitlements: liveEntitlements, aiAccessMode: liveAccessMode, proReportPeriod: livePeriod };
      accountEntitlements = { ...accountEntitlements, plan: "pro" };
      proReportPeriod = "annual";
      renderProLongitudinalReport();
      return {
        staticHidden,
        signedOutText,
        signedOutHidden,
        unavailableText,
        unavailableHidden,
        freeText,
        freeHasExport,
        freeHidden,
        insufficient90,
        shortAnnual,
        report90,
        text90,
        panel90,
        annual,
        annualText,
        annualPanel,
        downloadName,
        downgradedText,
        downgradedHasExport,
        downgradedHidden,
        storageUnchanged,
        overflow
      };
    })()`);
    assert(proLongitudinal.staticHidden, "Deployments without account quota should hide Pro longitudinal reports.");
    assert(proLongitudinal.signedOutHidden && !proLongitudinal.signedOutText, "Signed-out users should not see an unavailable Pro placeholder in the progress page.");
    assert(proLongitudinal.unavailableHidden && !proLongitudinal.unavailableText, "Entitlement failures should hide the commercial module instead of exposing internal states.");
    assert(!proLongitudinal.insufficient90.ready && proLongitudinal.insufficient90.readinessDetail.includes("还差 1 天状态记录"), "The 90-day report should enforce its minimum data threshold.");
    assert(!proLongitudinal.shortAnnual.ready && proLongitudinal.shortAnnual.readinessDetail.includes("记录跨度还差"), "Annual reports should require enough historical span even when record density is high.");
    assert(proLongitudinal.freeHidden && !proLongitudinal.freeText && !proLongitudinal.freeHasExport, "Free users should not see a Pro card without a real purchase path.");
    assert(proLongitudinal.report90.ready && proLongitudinal.report90.hasComparison && proLongitudinal.panel90.includes("近期训练节奏更稳定"), "A sufficiently recorded 90-day Pro report should compare early and recent stages.");
    assert(proLongitudinal.annual.ready && proLongitudinal.annual.hasComparison && proLongitudinal.annual.window.spanDays >= 365 && proLongitudinal.annual.window.recordedMonthCount >= 12, "Annual reports should enforce history span and summarize cross-year months.");
    assert(proLongitudinal.annualPanel.includes("年度纵向进展") && proLongitudinal.downloadName.includes("annual-report"), "Confirmed Pro users should switch periods and export the selected report.");
    assert(![proLongitudinal.text90, proLongitudinal.annualText].some(text => text.includes("PRIVATE_") || text.includes("987") || text.includes("具体训练日期：")), "Longitudinal exports must exclude private record details.");
    assert(proLongitudinal.downgradedHidden && !proLongitudinal.downgradedText && !proLongitudinal.downgradedHasExport, "Plan downgrade should immediately remove prior Pro report content and placeholders.");
    assert(proLongitudinal.storageUnchanged && !proLongitudinal.overflow, "Longitudinal reports should not mutate business storage or overflow desktop layout.");
    await evaluate(cdp, `document.querySelector("#proLongitudinalReport").scrollIntoView({ block: "center" })`);
    await screenshot(cdp, "smoke-desktop-pro-longitudinal.png");
    await evaluate(cdp, `Object.assign(state, window.__proLongitudinalSnapshot.state); accountSession = window.__proLongitudinalSnapshot.accountSession; accountEntitlements = window.__proLongitudinalSnapshot.accountEntitlements; aiAccessMode = window.__proLongitudinalSnapshot.aiAccessMode; proReportPeriod = window.__proLongitudinalSnapshot.proReportPeriod; delete window.__proLongitudinalSnapshot; renderAll();`);

    const trainingConsistency = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const currentWeek = startOfLocalWeek(today());
      state.settings = normalizeSettings({ ...state.settings, weeklyWorkoutTarget: 2 });
      state.workouts = [0, 1, 2].flatMap(week => [
        { id: "consistency-" + week + "-a", date: addLocalDays(currentWeek, -7 * week), title: "训练", duration: 30, sessionRpe: 6, note: "", exercises: [] },
        { id: "consistency-" + week + "-b", date: addLocalDays(currentWeek, -7 * week), title: "训练", duration: 30, sessionRpe: 6, note: "", exercises: [] }
      ]);
      const result = buildTrainingConsistency();
      Object.assign(state, snapshot);
      renderAll();
      return result;
    })()`);
    assert(trainingConsistency.streak === 3 && trainingConsistency.label === "连续达标 3 周", "Training consistency should count consecutive weekly target completion without a separate plan.");

    const targetCalibration = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      window.__targetCalibrationSnapshot = snapshot;
      const currentWeek = startOfLocalWeek(today());
      const makeDaily = (offset, sleepHours = 7.5, pain = 0) => [0, 2].map(day => ({
        id: "calibration-daily-" + offset + "-" + day,
        date: addLocalDays(currentWeek, -7 * offset + day),
        sleepHours,
        waterMl: 2000,
        mood: 3,
        energy: 3,
        soreness: 1,
        pain,
        habits: {},
        note: "PRIVATE_CALIBRATION_NOTE"
      }));
      const makeWorkouts = (offset, count) => Array.from({ length: count }, (_, index) => ({
        id: "calibration-workout-" + offset + "-" + index,
        date: addLocalDays(currentWeek, -7 * offset + Math.min(index, 5)),
        title: "PRIVATE_CALIBRATION_WORKOUT",
        duration: 30,
        sessionRpe: 6,
        note: "PRIVATE_CALIBRATION_WORKOUT_NOTE",
        exercises: []
      }));
      const setCompletedWeeks = (counts, target, sleepHours = 7.5, pain = 0) => {
        state.settings = normalizeSettings({ ...state.settings, weeklyWorkoutTarget: target });
        state.dailyLogs = counts.flatMap((_, index) => makeDaily(index + 1, sleepHours, pain));
        state.workouts = counts.flatMap((count, index) => makeWorkouts(index + 1, count));
        appliedWeeklyTargetCalibration = null;
      };

      state.settings = normalizeSettings({ ...state.settings, weeklyWorkoutTarget: 3 });
      state.dailyLogs = [{ ...makeDaily(0)[0], date: today() }];
      state.workouts = [];
      appliedWeeklyTargetCalibration = null;
      const insufficient = buildWeeklyTargetCalibration();

      setCompletedWeeks([2, 2, 2, 2], 2);
      const stable = buildWeeklyTargetCalibration();

      setCompletedWeeks([3, 3, 3, 3], 2);
      const overperforming = buildWeeklyTargetCalibration();

      setCompletedWeeks([1, 1, 1, 1], 4);
      state.workouts.push(...Array.from({ length: 8 }, (_, index) => ({
        id: "current-week-" + index,
        date: today(),
        title: "CURRENT_WEEK_PRIVATE",
        duration: 20,
        sessionRpe: 5,
        note: "",
        exercises: []
      })));
      const currentWeekExcluded = buildWeeklyTargetCalibration();
      renderAll();
      const reducePanel = document.querySelector("#personalProgressReport")?.innerText;
      document.querySelector("#applyWeeklyTargetCalibrationBtn")?.click();
      const applied = {
        target: state.settings.weeklyWorkoutTarget,
        calibration: buildWeeklyTargetCalibration(),
        hasButton: Boolean(document.querySelector("#applyWeeklyTargetCalibrationBtn")),
        panel: document.querySelector("#personalProgressReport")?.innerText
      };

      setCompletedWeeks([3, 3, 0, 0], 3, 5.5, 3);
      const recovery = buildWeeklyTargetCalibration();
      const reportText = buildPersonalProgressReportText(buildPersonalProgressReport());
      const privateDate = addLocalDays(currentWeek, -7);

      setCompletedWeeks([1, 1, 1, 1], 4);
      state.workouts.push({ id: "calibration-coverage", date: addLocalDays(today(), -40), title: "覆盖起点", duration: 20, sessionRpe: 5, note: "", exercises: [] });
      window.__targetCalibrationVisualState = JSON.parse(JSON.stringify(state));
      document.querySelector('[data-tab="insights"]').click();
      appliedWeeklyTargetCalibration = null;
      renderAll();
      document.querySelector(".weekly-target-calibration")?.scrollIntoView({ block: "center" });
      return { insufficient, stable, overperforming, currentWeekExcluded, reducePanel, applied, recovery, reportText, privateDate };
    })()`);
    assert(targetCalibration.insufficient.status === "insufficient" && !targetCalibration.insufficient.canApply, "Target calibration should not judge sparse or current-week-only data.");
    assert(targetCalibration.stable.status === "maintain" && targetCalibration.stable.recommendedTarget === 2, "Two or more achieved completed weeks should support maintaining the target when recovery is stable.");
    assert(targetCalibration.overperforming.status === "maintain" && targetCalibration.overperforming.recommendedTarget === 2, "Target calibration must never recommend an automatic increase.");
    assert(targetCalibration.currentWeekExcluded.status === "reduce" && targetCalibration.currentWeekExcluded.recommendedTarget === 3 && targetCalibration.reducePanel.includes("采用每周 3 次"), "Only completed weeks should drive a one-step target reduction and its explicit action.");
    assert(targetCalibration.applied.target === 3 && targetCalibration.applied.calibration.status === "maintain" && targetCalibration.applied.calibration.title === "新目标已采用" && !targetCalibration.applied.hasButton && targetCalibration.applied.panel.includes("本次不会连续下调"), "Applying a target should update settings and prevent repeated reductions from the same evidence in one session.");
    assert(targetCalibration.recovery.status === "reduce" && targetCalibration.recovery.recoveryPressure && targetCalibration.recovery.reachedWeeks === 2, "Sustained recovery pressure should allow a one-step reduction when half of observed weeks miss the target.");
    assert(targetCalibration.reportText.includes("## 周目标校准") && !targetCalibration.reportText.includes("PRIVATE_CALIBRATION") && !targetCalibration.reportText.includes(targetCalibration.privateDate), "Calibration exports should include only a summary without private notes, titles, or exact dates.");
    await delay(120);
    const desktopCalibrationLayout = await evaluate(cdp, `(() => {
      const panel = document.querySelector(".weekly-target-calibration");
      const button = document.querySelector("#applyWeeklyTargetCalibrationBtn");
      return {
        width: panel?.getBoundingClientRect().width,
        buttonWidth: button?.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        reportHidden: document.querySelector("#personalProgressReport")?.hidden,
        insightsHidden: document.querySelector("#insights")?.hidden,
        visibility: TrainingRotationModel.progressVisibility(state.workouts, state.dailyLogs)
      };
    })()`);
    assert(desktopCalibrationLayout.width <= desktopCalibrationLayout.viewportWidth && desktopCalibrationLayout.buttonWidth < desktopCalibrationLayout.width && !desktopCalibrationLayout.overflow, `Desktop target calibration should fit without overflow: ${JSON.stringify(desktopCalibrationLayout)}.`);
    await screenshot(cdp, "smoke-desktop-target-calibration.png");
    await evaluate(cdp, `Object.assign(state, window.__targetCalibrationSnapshot); appliedWeeklyTargetCalibration = null; renderAll();`);

    const historyBrowsing = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const days = getLastDays(12);
      state.dailyLogs = days.slice(0, 10).map((date, index) => ({
        id: "history-daily-" + index, date, sleepHours: 7, waterMl: 2000, mood: 3, energy: 3, soreness: 1, pain: 0, habits: {}, note: index === 3 ? "肩部状态稳定" : ""
      }));
      state.workouts = days.slice(10).map((date, index) => ({
        id: "history-workout-" + index, date, title: "历史训练 " + index, duration: 30, sessionRpe: 6, note: "",
        exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 10, rpe: 6, note: "" }] }]
      }));
      historyFilter = "all";
      historyExpanded = false;
      renderHistory();
      const initial = {
        cards: document.querySelectorAll("#historyList .history-card").length,
        firstDate: document.querySelector("#historyList .history-card strong")?.textContent,
        firstIsWorkout: document.querySelector("#historyList .history-card")?.hasAttribute("data-workout-id"),
        toggleText: document.querySelector("#toggleHistoryBtn").textContent
      };
      document.querySelector("#toggleHistoryBtn").click();
      const expanded = {
        cards: document.querySelectorAll("#historyList .history-card").length,
        toggleText: document.querySelector("#toggleHistoryBtn").textContent
      };
      const filter = document.querySelector("#historyFilter");
      filter.value = "workout";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      const filtered = {
        cards: document.querySelectorAll("#historyList .history-card").length,
        onlyWorkouts: !document.querySelector("#historyList .history-card[data-daily-date]"),
        toggleHidden: document.querySelector("#toggleHistoryBtn").hidden
      };
      filter.value = "all";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      const search = document.querySelector("#historySearch");
      search.value = "腿举";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      const exerciseSearch = {
        cards: document.querySelectorAll("#historyList .history-card").length,
        onlyWorkouts: !document.querySelector("#historyList .history-card[data-daily-date]")
      };
      search.value = "肩部状态";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      const noteSearch = {
        cards: document.querySelectorAll("#historyList .history-card").length,
        onlyDaily: !document.querySelector("#historyList .history-card[data-workout-id]")
      };
      filter.value = "workout";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      const combinedEmpty = document.querySelector("#historyList").textContent;
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      filter.value = "all";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      const restored = document.querySelectorAll("#historyList .history-card").length;
      Object.assign(state, normalizeImportedState(snapshot));
      historyFilter = "all";
      historySearch = "";
      historyExpanded = false;
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state));
      renderAll();
      return { initial, expanded, filtered, exerciseSearch, noteSearch, combinedEmpty, restored, latestDate: days[11], overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert(historyBrowsing.initial.cards === 8 && historyBrowsing.initial.toggleText.includes("12"), "History should initially show 8 of 12 records.");
    assert(historyBrowsing.initial.firstIsWorkout && historyBrowsing.initial.firstDate.includes(historyBrowsing.latestDate), "Unified history should put the latest mixed record first.");
    assert(historyBrowsing.expanded.cards === 12 && historyBrowsing.expanded.toggleText === "收起", "History expansion should reveal all records.");
    assert(historyBrowsing.filtered.cards === 2 && historyBrowsing.filtered.onlyWorkouts && historyBrowsing.filtered.toggleHidden, "Workout filter should show only workout records and hide unnecessary expansion.");
    assert(historyBrowsing.exerciseSearch.cards === 2 && historyBrowsing.exerciseSearch.onlyWorkouts, "History search should match exercise names across workouts.");
    assert(historyBrowsing.noteSearch.cards === 1 && historyBrowsing.noteSearch.onlyDaily, "History search should match daily notes.");
    assert(historyBrowsing.combinedEmpty.includes("没有找到匹配"), "History type and text filters should combine and explain empty results.");
    assert(historyBrowsing.restored === 8, "Clearing history search should restore the collapsed unified list.");
    assert(!historyBrowsing.overflow, "History controls and expanded records should not cause horizontal overflow.");

    await evaluate(cdp, `(() => {
      const days = getLastDays(7);
      const workouts = [days[1], days[3], days[6]].map((date, index) => ({
        id: "progress-workout-" + index,
        date,
        title: "动作进步 " + (index + 1),
        duration: 40,
        sessionRpe: index === 2 ? 6 : 7,
        note: "",
        exercises: [{
          name: "腿举",
          sets: [
            { weight: 20 + index * 5, reps: 10, rpe: index === 2 ? 6 : 7, note: "" },
            { weight: 20 + index * 5, reps: 8, rpe: 7, note: "" }
          ]
        }]
      }));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({
        dailyLogs: [],
        workouts,
        exercises: [{ name: "腿举", category: "力量", lastUsed: days[6] }],
        templates: [],
        adviceHistory: [],
        settings: { waterStepMl: 500, waterTargetMl: 2000, weeklyWorkoutTarget: 2, trainingGoal: "general", preferredEnvironment: "gym", conservativeMode: false }
      }));
    })()`);
    await reload(cdp);
    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    await delay(250);
    const progressReview = await evaluate(cdp, `(() => ({
      text: document.querySelector("#exerciseProgress")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(progressReview.text.includes("腿举"), "Exercise progress should show repeated exercise names.");
    assert(progressReview.text.includes("可判断"), "Exercise progress should mark exercises with enough sessions.");
    assert(progressReview.text.includes("小幅加重量") || progressReview.text.includes("多做一组"), "Exercise progress should suggest a next progression when RPE is manageable.");
    assert(!progressReview.overflow, "Exercise progress desktop layout should not overflow.");

    await evaluate(cdp, `activateTab("library"); window.scrollTo(0, 0);`);
    await delay(250);
    const trustCenter = await evaluate(cdp, `document.querySelector(".trust-center")?.innerText`);
    assert(trustCenter.includes("不是医疗诊断"), "Trust center should explain non-medical scope.");
    assert(trustCenter.includes("默认本地保存"), "Trust center should explain local-first storage.");
    assert(trustCenter.includes("云端建议可控"), "Trust center should explain cloud advice behavior.");

    const preferences = await evaluate(cdp, `(() => {
      const days = getLastDays(7);
      state.dailyLogs = days.slice(2).map((date, index) => ({
        id: "pref-daily-" + index,
        date,
        sleepHours: 7,
        waterMl: 2300,
        mood: 4,
        energy: 4,
        soreness: 2,
        pain: 0,
        habits: {},
        note: ""
      }));
      state.workouts = [days[2], days[4], days[6]].map((date, index) => ({
        id: "pref-workout-" + index,
        date,
        title: "偏好训练 " + (index + 1),
        duration: 40,
        sessionRpe: 6,
        note: "",
        exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 10, rpe: 6, note: "" }] }]
      }));
      document.querySelector("#trainingGoal").value = "fat_loss";
      document.querySelector("#preferredEnvironment").value = "home";
      document.querySelector("#weeklyWorkoutTarget").value = "3";
      document.querySelector("#waterTargetMl").value = "2400";
      document.querySelector("#conservativeMode").checked = true;
      document.querySelector("#dailyReminderEnabled").checked = true;
      document.querySelector("#dailyReminderTime").value = "20:30";
      document.querySelector("#workoutReminderEnabled").checked = true;
      document.querySelector("#workoutReminderTime").value = "18:15";
      document.querySelector('input[name="plannedWorkoutDays"][value="1"]').checked = true;
      document.querySelector('input[name="plannedWorkoutDays"][value="4"]').checked = true;
      document.querySelector("#savePreferencesBtn").click();
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      const reminderText = document.querySelector("#reminderStatus")?.innerText;
      document.querySelector('[data-tab="today"]').click();
      const todayText = document.querySelector("#todayDashboard")?.innerText;
      const weeklyTargetText = document.querySelector("#weeklyTargetPanel")?.innerText;
      document.querySelector('[data-tab="insights"]').click();
      const insightText = document.querySelector("#retentionInsights")?.innerText;
      const rhythm = buildRhythmReview();
      const normalizedHistory = normalizeSettings({
        weeklyRhythmHistory: [
          { effectiveDate: "not-a-date", days: [1, 4] },
          { effectiveDate: today(), days: [1, 9, 1] },
          { effectiveDate: today(), days: [4, 1] }
        ]
      }).weeklyRhythmHistory;
      return {
        settings: parsed.settings,
        reminderText,
        todayText,
        weeklyTargetText,
        insightText,
        rhythm,
        normalizedHistory
      };
    })()`);
    assert(preferences.settings.trainingGoal === "fat_loss", "Preferences should save training goal.");
    assert(preferences.settings.preferredEnvironment === "home", "Preferences should save preferred environment.");
    assert(preferences.settings.weeklyWorkoutTarget === 3, "Preferences should save weekly workout target.");
    assert(preferences.settings.waterTargetMl === 2400, "Preferences should save water target.");
    assert(preferences.settings.conservativeMode, "Preferences should save conservative mode.");
    assert(preferences.settings.dailyReminderEnabled, "Preferences should save daily reminder opt-in.");
    assert(preferences.settings.dailyReminderTime === "20:30", "Preferences should save daily reminder time.");
    assert(preferences.settings.workoutReminderEnabled, "Preferences should save workout reminder opt-in.");
    assert(preferences.settings.workoutReminderTime === "18:15", "Preferences should save workout reminder time.");
    assert(preferences.settings.plannedWorkoutDays.join(",") === "1,4", "Preferences should save weekly planned workout days.");
    assert(preferences.settings.weeklyRhythmHistory?.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(preferences.settings.weeklyRhythmHistory[0].effectiveDate) && preferences.settings.weeklyRhythmHistory[0].days.join(",") === "1,4", "Changing the weekly rhythm should start a dated local history.");
    assert(preferences.reminderText.includes("提醒已配置") || preferences.reminderText.includes("本地提醒已就绪"), "Reminder status should reflect saved reminder settings.");
    assert(preferences.todayText.includes("2400ml"), "Today dashboard should use preferred water target.");
    assert(preferences.weeklyTargetText.includes("/3 次训练"), "Weekly target panel should use preferred weekly workout target.");
    assert(preferences.weeklyTargetText.includes("周一、周四"), "Weekly target panel should show the selected training rhythm.");
    assert(preferences.insightText.includes("每周 3 次训练目标"), "Retention actions should use weekly workout target.");
    assert((preferences.rhythm.value === "--" || /^\d+%$/.test(preferences.rhythm.value)) && (preferences.rhythm.label.includes("尚未进入计划日") || preferences.rhythm.label.includes("近 4 周")) && preferences.normalizedHistory.length === 1 && preferences.normalizedHistory[0].days.join(",") === "1,4", "Rhythm review and imported history should use dated, normalized plan data without inventing prior adherence.");

    const reminderEngine = await evaluate(cdp, `(() => {
      window.__testNotificationPermission = "granted";
      window.__testNotifications = [];
      const snapshot = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      state.dailyLogs = [];
      state.workouts = [];
      state.settings = normalizeSettings({
        ...state.settings,
        weeklyWorkoutTarget: 2,
        dailyReminderEnabled: true,
        dailyReminderTime: "00:00",
        workoutReminderEnabled: true,
        workoutReminderTime: "00:00",
        plannedWorkoutDays: [weekdayIndex(today())],
        lastDailyReminderDate: "",
        lastWorkoutReminderDate: ""
      });
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state));
      const sentFirst = checkReminderSchedule(new Date(today() + "T23:59:00"));
      const sentAgain = checkReminderSchedule(new Date(today() + "T23:59:00"));
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      Object.assign(state, normalizeImportedState(snapshot));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state));
      renderAll();
      return {
        sentFirst,
        sentAgain,
        notifications: window.__testNotifications,
        lastDaily: parsed.settings.lastDailyReminderDate,
        lastWorkout: parsed.settings.lastWorkoutReminderDate
      };
    })()`);
    assert(reminderEngine.sentFirst.includes("daily") && reminderEngine.sentFirst.includes("workout"), "Reminder scheduler should trigger due daily and workout reminders.");
    assert(reminderEngine.sentAgain.length === 0, "Reminder scheduler should not duplicate reminders on the same day.");
    assert(reminderEngine.notifications.length === 2, "Reminder scheduler should deliver two local notifications in the test hook.");
    assert(reminderEngine.lastDaily && reminderEngine.lastWorkout, "Reminder scheduler should persist last sent dates.");

    const plannedReminderGate = await evaluate(cdp, `(() => {
      window.__testNotificationPermission = "granted";
      window.__testNotifications = [];
      const snapshot = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      state.dailyLogs = [{ id: "daily", date: today() }];
      state.workouts = [];
      state.settings = normalizeSettings({
        ...state.settings,
        weeklyWorkoutTarget: 2,
        workoutReminderEnabled: true,
        workoutReminderTime: "00:00",
        plannedWorkoutDays: [(weekdayIndex(today()) + 1) % 7],
        lastWorkoutReminderDate: ""
      });
      const sent = checkReminderSchedule(new Date(today() + "T12:00:00"));
      const notifications = window.__testNotifications;
      Object.assign(state, normalizeImportedState(snapshot));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state));
      renderAll();
      return { sent, notifications };
    })()`);
    assert(!plannedReminderGate.sent.includes("workout") && plannedReminderGate.notifications.length === 0, "A planned workout reminder should wait for the selected training day.");

    const jsonBackup = await evaluate(cdp, `(() => {
      state.settings = normalizeSettings({
        ...state.settings,
        supportEnabled: true,
        supportRole: "friend",
        supportCadence: "twice_weekly",
        supportStyle: "activity",
        supportBoundary: "no_pressure",
        supportNextDate: addLocalDays(today(), 3),
        supportCheckins: [{ date: today(), score: 4 }],
        supportPartners: [
          {
            id: "backup_friend",
            role: "friend",
            cadence: "twice_weekly",
            style: "activity",
            boundary: "no_pressure",
            nextDate: addLocalDays(today(), 3),
            checkins: [{ date: today(), score: 4 }]
          },
          {
            id: "backup_coach",
            role: "coach",
            cadence: "weekly",
            style: "accountability",
            boundary: "ask_first",
            nextDate: addLocalDays(today(), 7),
            checkins: []
          }
        ]
      });
      persistState();
      renderAll();
      const originalClick = HTMLAnchorElement.prototype.click;
      let downloadName = "";
      HTMLAnchorElement.prototype.click = function captureDownload() {
        downloadName = this.download;
      };
      exportData();
      HTMLAnchorElement.prototype.click = originalClick;
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      const payload = buildBackupPayload();
      return {
        downloadName,
        stateTimestamp: state.settings.lastBackupAt,
        storedTimestamp: parsed.settings.lastBackupAt,
        schemaVersion: payload.schemaVersion,
        exportedAt: payload.exportedAt,
        supportAgreement: payload.settings.supportEnabled ? {
          role: payload.settings.supportRole,
          cadence: payload.settings.supportCadence,
          nextDate: payload.settings.supportNextDate,
          reflectionScore: payload.settings.supportCheckins?.[0]?.score,
          partnerCount: payload.settings.supportPartners?.length
        } : null,
        rhythmHistoryCount: payload.settings.weeklyRhythmHistory?.length || 0,
        health: document.querySelector("#dataHealth")?.innerText,
        toast: document.querySelector("#toast")?.textContent
      };
    })()`);
    assert(jsonBackup.downloadName.endsWith(".json"), "Full backup should initiate a JSON download.");
    assert(Number.isFinite(Date.parse(jsonBackup.stateTimestamp)), "Full backup should record a valid timestamp in memory.");
    assert(jsonBackup.storedTimestamp === jsonBackup.stateTimestamp, "Full backup timestamp should persist locally.");
    assert(jsonBackup.schemaVersion === 1, "Full backup should declare schema version 1.");
    assert(jsonBackup.exportedAt === jsonBackup.stateTimestamp, "Full backup metadata should match the recorded backup time.");
    assert(jsonBackup.supportAgreement?.role === "friend" && jsonBackup.supportAgreement?.cadence === "twice_weekly" && jsonBackup.supportAgreement?.reflectionScore === 4 && jsonBackup.supportAgreement?.partnerCount === 2 && jsonBackup.rhythmHistoryCount > 0, "Full backup should preserve multi-partner support, reflections, and weekly rhythm history.");
    assert(jsonBackup.health.includes("完整备份") && jsonBackup.health.includes("今天"), "Data health should show a current full backup.");
    assert(jsonBackup.toast.includes("JSON 完整备份已导出"), "Full backup should confirm export to the user.");

    const futureBackup = await evaluate(cdp, `(() => {
      const preview = validateImportPayload({
        schemaVersion: 2,
        dailyLogs: [{ id: "future", date: today() }],
        workouts: [],
        exercises: [],
        templates: []
      }, "future-backup.json");
      return {
        canImport: preview.canImport,
        issues: preview.issues,
        metric: preview.metrics[0]
      };
    })()`);
    assert(!futureBackup.canImport, "A backup from a newer schema must be blocked.");
    assert(futureBackup.issues.some(issue => issue.includes("v2") && issue.includes("升级应用")), "A newer backup should explain the required upgrade.");
    assert(futureBackup.metric.value === "v2", "Import preview should expose the backup schema version.");

    const csvExport = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      state.dailyLogs = [{
        id: "csv-daily",
        date: today(),
        sleepHours: 7.5,
        waterMl: 2100,
        mood: 4,
        energy: 5,
        soreness: 1,
        pain: 0,
        habits: {},
        note: "备注, 含逗号和\\"引号\\""
      }];
      state.workouts = [{
        id: "csv-workout",
        date: today(),
        title: "CSV 训练",
        duration: 42,
        sessionRpe: 7,
        note: "训练备注",
        exercises: [
          { name: "腿举", sets: [{ weight: 40, reps: 10, rpe: 7, note: "" }] },
          { name: "卧推", sets: [{ weight: 30, reps: 8, rpe: 7, note: "" }] }
        ]
      }];
      const csv = buildCsvSummary();
      const hasButton = Boolean(document.querySelector("#exportCsvBtn"));
      const overflow = document.documentElement.scrollWidth > innerWidth;
      Object.assign(state, normalizeImportedState(snapshot));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state));
      renderAll();
      return { csv, hasButton, overflow };
    })()`);
    assert(csvExport.hasButton, "Data panel should expose a CSV export button.");
    assert(csvExport.csv.startsWith("type,date,title,metric_1,metric_2,metric_3,note"), "CSV export should include a stable header.");
    assert(csvExport.csv.includes("daily,") && csvExport.csv.includes("workout,"), "CSV export should include daily and workout rows.");
    assert(csvExport.csv.includes('"备注, 含逗号和""引号"""'), "CSV export should escape commas and quotes.");
    assert(csvExport.csv.includes("腿举 / 卧推"), "CSV export should summarize workout exercises.");
    assert(!csvExport.overflow, "Data panel with CSV export should not overflow.");

    await evaluate(cdp, `activateTab("library"); window.scrollTo(0, 0);`);
    await delay(100);
    const invalidImport = await evaluate(cdp, `(async () => {
      const file = new File([JSON.stringify({ dailyLogs: "broken" })], "broken-backup.json", { type: "application/json" });
      importData(file);
      await new Promise(resolve => setTimeout(resolve, 250));
      return {
        preview: document.querySelector("#importPreview")?.innerText,
        disabled: document.querySelector("#confirmImportBtn")?.disabled,
        workouts: JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).workouts.length
      };
    })()`);
    assert(invalidImport.preview.includes("需修复"), "Invalid import should show a blocked preview.");
    assert(invalidImport.disabled, "Invalid import should disable confirmation.");
    assert(invalidImport.workouts === 3, "Invalid import should not overwrite current data.");

    const validImport = await evaluate(cdp, `(async () => {
      const payload = {
        dailyLogs: [{ id: "import-daily", date: today(), sleepHours: 7, waterMl: 2000, mood: 4, energy: 4, soreness: 2, pain: 0, habits: {}, note: "" }],
        workouts: [{ id: "import-workout", date: today(), title: "导入训练", duration: 35, sessionRpe: 6, note: "", exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 10, rpe: 6, note: "" }] }] }],
        exercises: [{ name: "腿举", category: "力量", lastUsed: today() }],
        templates: [],
        adviceHistory: [],
        settings: { waterStepMl: 300 }
      };
      const file = new File([JSON.stringify(payload)], "valid-backup.json", { type: "application/json" });
      importData(file);
      await new Promise(resolve => setTimeout(resolve, 250));
      const before = document.querySelector("#importPreview")?.innerText;
      document.querySelector("#confirmImportBtn").click();
      await new Promise(resolve => setTimeout(resolve, 350));
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        before,
        dailyLogs: parsed.dailyLogs.length,
        workouts: parsed.workouts.length,
        waterStep: parsed.settings.waterStepMl,
        health: document.querySelector("#dataHealth")?.innerText,
        previewAfter: document.querySelector("#importPreview")?.innerText
      };
    })()`);
    assert(validImport.before.includes("可导入"), "Valid import should show an importable preview.");
    assert(validImport.dailyLogs === 1 && validImport.workouts === 1, "Confirmed import should overwrite local records.");
    assert(validImport.waterStep === 300, "Confirmed import should restore settings.");
    assert(validImport.health.includes("1 条") && validImport.health.includes("1 次"), "Data health should update after import.");
    assert(validImport.previewAfter.includes("导入前会先预览"), "Import preview should reset after confirmation.");

    const migrationCsv = [
      "\uFEFFDate,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
      `${todayCheck.localToday} 08:00:00,导入训练,35m,腿举,1,20,10,0,0,,,6`,
      `2026-07-01 10:00:00,\"Push, Day\",1h 5m,\"Cable, Fly\",1,15,12,0,0,\"第一行`,
      `第二行\",\"迁移备注\",7.5`,
      `2026-07-01 10:00:00,\"Push, Day\",1h 5m,\"Cable, Fly\",2,17.5,not-a-number,0,0,,,8`,
      `2026-07-02 10:00:00,Broken,20m,Row,1,10,10,0,0,,,6,extra-column`
    ].join("\r\n");
    const hevyCsv = [
      "title,start_time,end_time,description,exercise_title,set_index,set_type,weight_kg,reps,distance_meters,duration_seconds,rpe,exercise_notes,workout_duration",
      `Pull,\"12 Jul 2026, 18:30\",\"12 Jul 2026, 19:15\",晚间训练,Lat Pulldown,0,warmup,30,12,0,0,6,注意肩胛,45m`
    ].join("\n");
    const workoutMigration = await evaluate(cdp, `(async () => {
      const before = JSON.parse(JSON.stringify(state));
      const strong = buildWorkoutCsvMigration(${JSON.stringify(migrationCsv)}, "strong.csv");
      const hevy = buildWorkoutCsvMigration(${JSON.stringify(hevyCsv)}, "hevy.csv");
      const missing = buildWorkoutCsvMigration("Date,Workout Name\\n2026-07-01,Test", "missing.csv");
      let unclosed = "";
      try { parseWorkoutCsv('Date,Workout Name\\n\"unfinished'); } catch (error) { unclosed = error.message; }
      pendingImport = { mode: "workout_csv", ...strong };
      renderImportPreview();
      const preview = document.querySelector("#importPreview")?.innerText;
      const beforeConfirm = JSON.stringify(state) === JSON.stringify(before);
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      document.querySelector("#confirmImportBtn").click();
      await new Promise(resolve => setTimeout(resolve, 150));
      const stored = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      const imported = stored.workouts.find(workout => workout.title === "Push, Day");
      return {
        strong: strong.preview,
        hevy: hevy.preview,
        missing: missing.preview,
        unclosed,
        preview,
        beforeConfirm,
        overflow,
        workoutCount: stored.workouts.length,
        waterStep: stored.settings.waterStepMl,
        existingCategory: stored.exercises.find(exercise => exercise.name === "腿举")?.category,
        newExercise: stored.exercises.find(exercise => exercise.name === "Cable, Fly"),
        imported,
        previewAfter: document.querySelector("#importPreview")?.innerText
      };
    })()`);
    assert(workoutMigration.strong.canImport && workoutMigration.strong.metrics.some(metric => metric.label === "重复" && metric.value === "1 次"), "Strong migration should identify BOM input and skip an existing duplicate.");
    assert(workoutMigration.strong.metrics.some(metric => metric.label === "跳过行" && metric.value === "1 行"), "Rows with more columns than the header should be skipped and reported.");
    assert(workoutMigration.strong.issues.some(issue => issue.includes("无效重量、次数或 RPE")), "Invalid numeric values should be reported and left blank.");
    assert(workoutMigration.hevy.canImport && workoutMigration.hevy.metrics.some(metric => metric.value === "Hevy"), "Hevy migration should recognize its exported columns and quoted date.");
    assert(!workoutMigration.missing.canImport && workoutMigration.missing.issues.some(issue => issue.includes("缺少列")), "Missing required columns should block migration.");
    assert(workoutMigration.unclosed.includes("未闭合"), "Unclosed CSV quotes should be rejected explicitly.");
    assert(workoutMigration.beforeConfirm, "CSV preview must not mutate application state before confirmation.");
    assert(workoutMigration.preview.includes("可合并") && workoutMigration.preview.includes("合并 1 次训练"), "CSV preview should state merge semantics and import count.");
    assert(workoutMigration.workoutCount === 2 && workoutMigration.waterStep === 300, "Confirmed CSV migration should append workouts without changing settings.");
    assert(workoutMigration.existingCategory === "力量", "CSV migration should preserve existing exercise categories.");
    assert(workoutMigration.newExercise?.category === "其他" && workoutMigration.newExercise?.lastUsed === "2026-07-01", "New imported exercises should use the fallback category and refresh last-used date.");
    assert(workoutMigration.imported?.note === "迁移备注" && workoutMigration.imported?.exercises[0].sets[0].note.includes("第一行\n第二行"), "Quoted commas and newlines should survive local CSV parsing.");
    assert(workoutMigration.imported?.exercises[0].sets[1].reps === null, "Invalid reps should remain empty instead of becoming unsafe values.");
    assert(workoutMigration.previewAfter.includes("导入前会先预览"), "CSV preview should reset after confirmation.");
    assert(!workoutMigration.overflow, "CSV migration preview should not overflow on desktop.");
    await evaluate(cdp, `(() => {
      const migration = buildWorkoutCsvMigration(${JSON.stringify(hevyCsv)}, "hevy.csv");
      pendingImport = { mode: "workout_csv", ...migration };
      renderImportPreview();
      document.querySelector("#importPreview")?.scrollIntoView({ block: "center" });
    })()`);
    await screenshot(cdp, "smoke-desktop-workout-migration.png");
    await evaluate(cdp, `cancelImportData()`);

    const careSummary = await evaluate(cdp, `(() => {
      state.dailyLogs[0].note = "PRIVATE_DAILY_NOTE";
      state.workouts[0].note = "PRIVATE_WORKOUT_NOTE";
      state.workouts[0].exercises[0].name = "PRIVATE_EXERCISE_NAME";
      renderAll();
      document.querySelector('[data-tab="insights"]').click();
      document.querySelector("#openCareSummaryBtn").click();
      const defaultPreview = document.querySelector("#careSummaryPreview").value;
      const defaultState = {
        open: document.querySelector("#careSummaryDialog").open,
        focused: document.activeElement?.id,
        risksChecked: document.querySelector("#careIncludeRisks").checked,
        text: defaultPreview
      };
      document.querySelector("#careAudience").value = "coach";
      document.querySelector("#careIncludeRisks").checked = true;
      document.querySelector("#careSummaryForm").dispatchEvent(new Event("change", { bubbles: true }));
      const coachPreview = document.querySelector("#careSummaryPreview").value;
      document.querySelector("#careIncludeProgress").checked = false;
      document.querySelector("#careIncludeRisks").checked = false;
      document.querySelector("#careIncludeActions").checked = false;
      document.querySelector("#careSummaryForm").dispatchEvent(new Event("change", { bubbles: true }));
      const blocked = {
        disabled: document.querySelector("#shareCareSummaryBtn").disabled,
        error: document.querySelector("#careSummaryError").textContent
      };
      document.querySelector("#cancelCareSummaryBtn").click();
      return { defaultState, coachPreview, blocked, closed: !document.querySelector("#careSummaryDialog").open };
    })()`);
    assert(careSummary.defaultState.open && careSummary.defaultState.focused === "careAudience", "Care summary should open as an accessible preview dialog.");
    assert(!careSummary.defaultState.risksChecked, "Care summary should keep risk disclosure opt-in.");
    assert(careSummary.defaultState.text.includes("关怀摘要") && careSummary.defaultState.text.includes("你可以这样支持我"), "Care summary should provide context and an actionable support request.");
    assert(!careSummary.defaultState.text.includes("PRIVATE_DAILY_NOTE") && !careSummary.defaultState.text.includes("PRIVATE_WORKOUT_NOTE") && !careSummary.defaultState.text.includes("PRIVATE_EXERCISE_NAME"), "Care summary must exclude notes and exercise details.");
    assert(careSummary.coachPreview.includes("调整训练量与强度") && careSummary.coachPreview.includes("需要留意"), "Coach summary should tailor the support request and include explicitly selected risks.");
    assert(careSummary.blocked.disabled && careSummary.blocked.error.includes("至少选择一项"), "Care summary should prevent an empty disclosure.");
    assert(careSummary.closed, "Care summary should close without changing records.");

    const coachBrief = await evaluate(cdp, `(() => {
      document.querySelector("#openCoachBriefBtn").click();
      const defaultPreview = document.querySelector("#coachBriefPreview").value;
      const defaultState = {
        open: document.querySelector("#coachBriefDialog").open,
        focused: document.activeElement?.id,
        text: defaultPreview
      };
      document.querySelector("#coachBriefIncludePlan").checked = false;
      document.querySelector("#coachBriefIncludeAdherence").checked = false;
      document.querySelector("#coachBriefForm").dispatchEvent(new Event("change", { bubbles: true }));
      const reducedPreview = document.querySelector("#coachBriefPreview").value;
      document.querySelector("#cancelCoachBriefBtn").click();
      return { defaultState, reducedPreview, closed: !document.querySelector("#coachBriefDialog").open };
    })()`);
    assert(coachBrief.defaultState.open && coachBrief.defaultState.focused === "coachBriefIncludePlan", "Coach brief should open as an accessible collaboration dialog.");
    assert(coachBrief.defaultState.text.includes("训练协作简报") && coachBrief.defaultState.text.includes("训练设定") && coachBrief.defaultState.text.includes("计划兑现"), "Coach brief should include actionable planning and execution context.");
    assert(!coachBrief.defaultState.text.includes("PRIVATE_DAILY_NOTE") && !coachBrief.defaultState.text.includes("PRIVATE_WORKOUT_NOTE") && !coachBrief.defaultState.text.includes("PRIVATE_EXERCISE_NAME"), "Coach brief must exclude health notes and exercise details.");
    assert(!coachBrief.reducedPreview.includes("计划节奏") && !coachBrief.reducedPreview.includes("计划兑现") && coachBrief.reducedPreview.includes("执行概览") && coachBrief.closed, "Coach brief disclosure controls should update preview and close safely.");

    const storageFailure = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      const originalSetItem = Storage.prototype.setItem;
      let survived = true;
      Storage.prototype.setItem = function failingSetItem() {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };
      try {
        state.dailyLogs.push({
          id: "quota-daily",
          date: today(),
          sleepHours: 7,
          waterMl: 1800,
          mood: 4,
          energy: 4,
          soreness: 1,
          pain: 0,
          habits: {},
          note: ""
        });
        saveState();
      } catch {
        survived = false;
      }
      const toast = document.querySelector("#toast")?.textContent;
      const health = document.querySelector("#dataHealth")?.innerText;
      Storage.prototype.setItem = originalSetItem;
      Object.assign(state, normalizeImportedState(snapshot));
      persistState();
      renderAll();
      const toastElement = document.querySelector("#toast");
      toastElement?.classList.remove("visible");
      if (toastElement) toastElement.textContent = "";
      return { survived, toast, health };
    })()`);
    assert(storageFailure.survived, "Storage quota failure should not crash saveState.");
    assert(storageFailure.toast.includes("本地空间不足"), "Storage quota failure should explain the local storage issue.");
    assert(storageFailure.health.includes("存储需处理") && storageFailure.health.includes("需处理"), "Data health should expose storage failure status.");

    const dataReset = await evaluate(cdp, `(() => {
      const before = {
        dailyLogs: state.dailyLogs.length,
        workouts: state.workouts.length
      };
      document.querySelector("#resetDemoBtn").click();
      const opened = document.querySelector("#resetDataDialog").open;
      const focused = document.activeElement?.id;
      document.querySelector("#cancelResetDataBtn").click();
      const afterCancel = {
        open: document.querySelector("#resetDataDialog").open,
        dailyLogs: state.dailyLogs.length,
        workouts: state.workouts.length
      };
      document.querySelector("#resetDemoBtn").click();
      document.querySelector("#confirmResetDataBtn").click();
      return {
        before,
        opened,
        focused,
        afterCancel,
        afterConfirm: {
          open: document.querySelector("#resetDataDialog").open,
          dailyLogs: state.dailyLogs.length,
          workouts: state.workouts.length,
          storageRemoved: localStorage.getItem(${JSON.stringify(storageKey)}) === null,
          needsFirstWorkoutSetup: needsFirstWorkoutSetup(),
          hasSetupAction: Boolean(document.querySelector("#startCoachWorkoutBtn")),
          toast: document.querySelector("#toast")?.textContent
        }
      };
    })()`);
    assert(dataReset.opened, "Clear data should open an in-app confirmation dialog.");
    assert(dataReset.focused === "cancelResetDataBtn", "Clear data dialog should focus the safe action.");
    assert(!dataReset.afterCancel.open, "Cancel should close the clear data dialog.");
    assert(dataReset.afterCancel.dailyLogs === dataReset.before.dailyLogs && dataReset.afterCancel.workouts === dataReset.before.workouts, "Cancel should preserve all local data.");
    assert(!dataReset.afterConfirm.open, "Confirm should close the clear data dialog.");
    assert(dataReset.afterConfirm.dailyLogs === 0 && dataReset.afterConfirm.workouts === 0, "Confirm should reset local records.");
    assert(dataReset.afterConfirm.storageRemoved, "Confirm should remove the persisted local state.");
    assert(dataReset.afterConfirm.needsFirstWorkoutSetup && dataReset.afterConfirm.hasSetupAction, "Clearing all data should require first-workout setup again.");
    assert(dataReset.afterConfirm.toast.includes("所有本地数据已清空"), "Confirm should explain that local data was cleared.");

    await evaluate(cdp, `activateTab("help"); window.scrollTo(0, 0);`);
    await delay(150);
    const helpPage = await evaluate(cdp, `(() => ({
      activeTab: document.querySelector(".tab.active")?.dataset.tab,
      title: document.querySelector("#help h2")?.textContent,
      text: document.querySelector("#help")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(helpPage.activeTab === "mine", "Help should be reachable from the My area without occupying a primary tab.");
    assert(helpPage.title === "帮助与版本说明", "Help page should render its title.");
    assert(helpPage.text.includes("完整备份") && helpPage.text.includes("导出 CSV"), "Help page should explain backup and CSV export.");
    assert(helpPage.text.includes("PWA 安装") && helpPage.text.includes("离线可用"), "Help page should explain install and offline behavior.");
    assert(helpPage.text.includes("不是医疗诊断") && helpPage.text.includes("云端建议可控"), "Help page should explain safety and privacy boundaries.");
    assert(helpPage.text.includes("查看隐私政策") && helpPage.text.includes("查看使用条款"), "Help page should link to standalone legal pages.");
    assert(!helpPage.overflow, "Help desktop layout should not overflow.");
    const accountLogin = await evaluate(cdp, `(async () => {
      window.__accountBoundaryPreviousStorage = localStorage.getItem(${JSON.stringify(storageKey)});
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({ sentinel: "PRIVATE_LOCAL_RECORD", workouts: [{ id: "local-only" }] }));
      const storageBefore = localStorage.getItem(${JSON.stringify(storageKey)});
      const liveSession = { ...accountSession };
      accountSession = { loading: false, configured: true, signedIn: false, unavailable: true, user: null };
      renderAccountPanel();
      const unavailable = {
        header: document.querySelector("#accountStatus")?.textContent,
        emailHidden: document.querySelector("#accountEmailForm")?.hidden,
        panel: document.querySelector("#accountPanel")?.innerText
      };
      accountSession = liveSession;
      renderAccountPanel();
      const initial = {
        header: document.querySelector("#accountStatus")?.textContent,
        panel: document.querySelector("#accountPanel")?.innerText,
        emailVisible: !document.querySelector("#accountEmailForm")?.hidden
      };
      document.querySelector("#accountEmail").value = ${JSON.stringify(fakeAccountUser.email)};
      document.querySelector("#accountEmailForm").requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 300));
      const codeState = {
        panel: document.querySelector("#accountPanel")?.innerText,
        codeVisible: !document.querySelector("#accountCodeForm")?.hidden,
        emailStoredInBusinessState: localStorage.getItem(${JSON.stringify(storageKey)})?.includes(${JSON.stringify(fakeAccountUser.email)}) || false
      };
      document.querySelector("#accountCode").value = "000000";
      document.querySelector("#accountCodeForm").requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 300));
      const invalidCodeFeedback = document.querySelector("#accountFeedback")?.textContent;
      document.querySelector("#accountCode").value = "123456";
      document.querySelector("#accountCodeForm").requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 350));
      setAccountEntitlement({
        configured: true,
        plan: "pro",
        quota: { used: 12, pending: 0, remaining: 88, limit: 100, resetAt: "2026-08-01T00:00:00.000Z" }
      });
      return {
        unavailable,
        initial,
        codeState,
        invalidCodeFeedback,
        header: document.querySelector("#accountStatus")?.textContent,
        panel: document.querySelector("#accountPanel")?.innerText,
        signedInVisible: !document.querySelector("#accountSignedIn")?.hidden,
        entitlementVisible: !document.querySelector("#accountEntitlements")?.hidden,
        entitlementText: document.querySelector("#accountEntitlements")?.innerText,
        storageUnchanged: localStorage.getItem(${JSON.stringify(storageKey)}) === storageBefore,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(accountLogin.unavailable.header === "账号暂不可用" && accountLogin.unavailable.emailHidden && accountLogin.unavailable.panel.includes("本地记录"), "Unavailable account service should not expose a misleading login form or block local use.");
    assert(accountLogin.initial.header === "可连接账号" && accountLogin.initial.emailVisible, "Configured account UI should offer a real email code flow.");
    assert(accountLogin.initial.panel.includes("不会自动上传"), "Signed-out account UI should explain the local/cloud data boundary.");
    assert(accountLogin.codeState.codeVisible && accountLogin.codeState.panel.includes("验证码已发送"), "Requesting a code should advance to the verification state.");
    assert(accountLogin.invalidCodeFeedback.includes("无效或已过期"), "Invalid account code should produce a stable actionable error.");
    assert(!accountLogin.codeState.emailStoredInBusinessState, "Pending account email must not enter local business state.");
    assert(accountLogin.header === "身份已连接" && accountLogin.signedInVisible && accountLogin.panel.includes("本机记录没有上传"), "Verified account UI should show identity without implying sync.");
    assert(accountLogin.entitlementVisible && accountLogin.entitlementText.includes("Pro") && accountLogin.entitlementText.includes("剩余 88") && !accountLogin.entitlementText.includes("付费方案"), "Account UI should display only the server-provided entitlement summary without a fake purchase message.");
    assert(accountLogin.storageUnchanged && !accountLogin.overflow, "Account login should not mutate business storage or overflow desktop layout.");
    await evaluate(cdp, `document.querySelector("#accountPanel").scrollIntoView({ block: "center" })`);
    await screenshot(cdp, "smoke-desktop-account-boundary.png");
    const accountLogout = await evaluate(cdp, `(async () => {
      const storageBefore = localStorage.getItem(${JSON.stringify(storageKey)});
      document.querySelector("#signOutAccountBtn").click();
      await new Promise(resolve => setTimeout(resolve, 300));
      const result = {
        header: document.querySelector("#accountStatus")?.textContent,
        panel: document.querySelector("#accountPanel")?.innerText,
        emailVisible: !document.querySelector("#accountEmailForm")?.hidden,
        storageUnchanged: localStorage.getItem(${JSON.stringify(storageKey)}) === storageBefore
      };
      if (window.__accountBoundaryPreviousStorage === null) localStorage.removeItem(${JSON.stringify(storageKey)});
      else localStorage.setItem(${JSON.stringify(storageKey)}, window.__accountBoundaryPreviousStorage);
      delete window.__accountBoundaryPreviousStorage;
      return result;
    })()`);
    assert(accountLogout.header === "可连接账号" && accountLogout.emailVisible, "Sign out should return to the real signed-out state.");
    assert(accountLogout.panel.includes("本机记录保持不变") && accountLogout.storageUnchanged, "Sign out should preserve local business data and explain the outcome.");
    const updateFlow = await evaluate(cdp, `(() => {
      window.__updateMessage = null;
      const registration = { waiting: { postMessage: message => { window.__updateMessage = message; } } };
      showAppUpdate(registration);
      const shown = !document.querySelector("#appUpdateBanner").hidden;
      document.querySelector("#dismissAppUpdateBtn").click();
      const dismissed = document.querySelector("#appUpdateBanner").hidden;
      showAppUpdate(registration);
      document.querySelector("#applyAppUpdateBtn").click();
      return {
        version: document.querySelector("#appVersion").textContent,
        shown,
        dismissed,
        message: window.__updateMessage,
        buttonText: document.querySelector("#applyAppUpdateBtn").textContent,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(updateFlow.version.includes("v1.22.0"), "Help should display the current semantic app version.");
    assert(updateFlow.shown && updateFlow.dismissed, "App update banner should be visible and dismissible.");
    assert(updateFlow.message?.type === "SKIP_WAITING" && updateFlow.buttonText === "更新中", "Confirmed update should activate the waiting service worker with clear feedback.");
    assert(!updateFlow.overflow, "Update banner should not cause desktop overflow.");
    await screenshot(cdp, "smoke-desktop.png");

    await navigate(cdp, `${baseUrl}/privacy.html`);
    const privacyPage = await evaluate(cdp, `(() => ({
      title: document.title,
      heading: document.querySelector("h1")?.textContent,
      text: document.querySelector("main")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(privacyPage.title.includes("隐私政策") && privacyPage.heading === "隐私政策", "Privacy policy should have a clear document title.");
    assert(privacyPage.text.includes("本地优先") && privacyPage.text.includes("云端建议") && privacyPage.text.includes("清空全部本地数据"), "Privacy policy should explain local, cloud, and deletion data paths.");
    assert(privacyPage.text.includes("Supabase Auth") && privacyPage.text.includes("不会自动上传") && privacyPage.text.includes("配额事件不包含训练内容"), "Privacy policy should disclose identity, local-data, and quota-event boundaries.");
    assert(privacyPage.text.includes("Pro 长期报告") && privacyPage.text.includes("长期报告计算不会因此上传"), "Privacy policy should disclose the local-only Pro report data path.");
    assert(!privacyPage.overflow, "Privacy policy desktop layout should not overflow.");

    await navigate(cdp, `${baseUrl}/terms.html`);
    const termsPage = await evaluate(cdp, `(() => ({
      heading: document.querySelector("h1")?.textContent,
      text: document.querySelector("main")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(termsPage.heading === "使用条款", "Terms page should have a clear document title.");
    assert(termsPage.text.includes("不是医疗器械") && termsPage.text.includes("合理使用") && termsPage.text.includes("数据风险"), "Terms should cover health, acceptable use, and local data risks.");
    assert(termsPage.text.includes("服务器验证的服务权益") && termsPage.text.includes("不代表本机记录已同步") && termsPage.text.includes("月度额度"), "Terms should distinguish account entitlements from local data availability.");
    assert(termsPage.text.includes("90 天和年度纵向报告") && termsPage.text.includes("权益到期不会锁住"), "Terms should explain Pro report scope and expiry behavior.");
    assert(!termsPage.overflow, "Terms desktop layout should not overflow.");

    await navigate(cdp, appUrl);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 2,
      mobile: true
    });
    await reload(cdp);
    const mobileFirstSetup = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      Object.assign(state, normalizeImportedState({}));
      renderAll();
      document.querySelector("#startCoachWorkoutBtn").click();
      const dialog = document.querySelector("#firstWorkoutSetupDialog");
      const bounds = dialog.getBoundingClientRect();
      const targets = [
        ...dialog.querySelectorAll(".readiness-options span"),
        ...dialog.querySelectorAll(".confirm-dialog-actions button")
      ].map(element => element.getBoundingClientRect().height);
      dialog.scrollTop = dialog.scrollHeight;
      const result = {
        open: dialog.open,
        focusedName: document.activeElement?.name,
        width: bounds.width,
        viewportWidth: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        bottomReachable: dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 1,
        targets
      };
      closeFirstWorkoutSetup();
      Object.assign(state, snapshot);
      persistState();
      renderAll();
      return result;
    })()`);
    assert(mobileFirstSetup.open && mobileFirstSetup.focusedName === "firstWorkoutCondition", `The 390px setup dialog should open with reachable keyboard focus: ${JSON.stringify(mobileFirstSetup)}.`);
    assert(mobileFirstSetup.width <= mobileFirstSetup.viewportWidth - 24 && !mobileFirstSetup.overflow && mobileFirstSetup.bottomReachable, `The 390px setup dialog should fit horizontally and scroll to all content: ${JSON.stringify(mobileFirstSetup)}.`);
    assert(mobileFirstSetup.targets.every(height => height >= 44), `Every setup choice and action should provide a 44px mobile touch target: ${JSON.stringify(mobileFirstSetup.targets)}.`);
    const mobileNextPlanEdit = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      state.settings.trainingRotation = TrainingRotationModel.normalizeRotation({
        mode: "upper_lower",
        currentIndex: 0,
        days: [
          { id: "rotation_upper", label: "上肢", templateId: "beginner_upper" },
          { id: "rotation_lower", label: "下肢", templateId: "beginner_lower" }
        ]
      }, getAllTemplates());
      const source = {
        id: "mobile-remove-source", date: today(), title: "上肢训练", sessionRpe: 6, feeling: "right",
        rotationDayId: "rotation_upper", sourceTemplateId: "beginner_upper", completionSummary: { completed: 4, skipped: 0, pending: 0 },
        exercises: [{ name: "卧推", sets: [{ weight: 20, reps: 8, rpe: 6, note: "" }] }]
      };
      state.workouts = [source];
      state.nextWorkoutPlan = buildNextWorkoutPlan(source, { rotationDayId: "rotation_lower" });
      showNextWorkoutResult(source, state.nextWorkoutPlan);
      const dialog = document.querySelector("#nextWorkoutResultDialog");
      const buttons = [...dialog.querySelectorAll(".next-plan-decision-actions button")].filter(button => button.offsetParent !== null);
      const heights = buttons.map(button => button.getBoundingClientRect().height);
      dialog.scrollTop = dialog.scrollHeight;
      const lastButton = buttons.at(-1).getBoundingClientRect();
      const result = {
        action: Boolean(document.querySelector("#removeNextWorkoutExerciseBtn")),
        overflow: document.documentElement.scrollWidth > innerWidth,
        heights,
        bottomReachable: dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 1,
        lastActionVisible: lastButton.top < innerHeight && lastButton.bottom <= innerHeight
      };
      closeNextWorkoutResult();
      Object.assign(state, normalizeImportedState(snapshot));
      persistState();
      renderAll();
      return result;
    })()`);
    assert(mobileNextPlanEdit.action && !mobileNextPlanEdit.overflow, `The 390px next-plan edit should fit without horizontal overflow: ${JSON.stringify(mobileNextPlanEdit)}.`);
    assert(mobileNextPlanEdit.heights.every(height => height >= 44), `Every visible next-plan decision should provide a 44px touch target: ${JSON.stringify(mobileNextPlanEdit.heights)}.`);
    assert(mobileNextPlanEdit.bottomReachable && mobileNextPlanEdit.lastActionVisible, `The last next-plan action should be reachable by scrolling the dialog: ${JSON.stringify(mobileNextPlanEdit)}.`);
    await evaluate(cdp, `(() => {
      const mobileTemplate = beginnerTemplates.find(template => template.id === "beginner_full_body");
      startFocusedWorkoutSession(mobileTemplate, mobileTemplate.name);
      activateTab("workout", { scroll: false });
      document.querySelector("#completeFocusedSetBtn").click();
      window.scrollTo(0, 0);
    })()`);
    await delay(250);
    const mobile = await evaluate(cdp, `(() => {
      const companionControlIds = [
        "decreaseFocusedPrimaryBtn",
        "increaseFocusedPrimaryBtn",
        "decreaseFocusedWeightBtn",
        "increaseFocusedWeightBtn",
        "extendFocusedRestBtn",
        "resetFocusedRestBtn",
        "skipFocusedRestBtn",
        "completeFocusedSetBtn",
        "skipFocusedSetBtn"
      ];
      const controls = companionControlIds.map(id => {
        const element = document.getElementById(id);
        return { id, present: Boolean(element), height: element?.getBoundingClientRect().height || 0 };
      });
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        controls,
        restPanelWidth: document.querySelector(".focused-rest-panel")?.getBoundingClientRect().width || 0,
        sessionWidth: document.querySelector("#focusedWorkoutSession")?.getBoundingClientRect().width || 0
      };
    })()`);
    assert(mobile.width === 390, "Mobile viewport should be active.");
    assert(!mobile.overflow, "Mobile workout layout should not overflow.");
    assert(mobile.controls.every(control => control.present && control.height >= 44), `Mobile companion controls should all provide at least 44px touch targets: ${JSON.stringify(mobile.controls)}.`);
    assert(mobile.restPanelWidth > 0 && mobile.restPanelWidth <= mobile.sessionWidth, `Mobile rest companion should fit inside the focused workout surface: ${JSON.stringify(mobile)}.`);
    await screenshot(cdp, "smoke-mobile.png");
    await evaluate(cdp, `clearWorkoutDraft(); renderFocusedWorkoutSession();`);

    await evaluate(cdp, `activateTab("help"); window.scrollTo(0, 0);`);
    await delay(200);
    const mobileHelp = await evaluate(cdp, `(() => ({
      title: document.querySelector("#help h2")?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(mobileHelp.title === "帮助与版本说明", "Mobile help page should render.");
    assert(!mobileHelp.overflow, "Mobile help layout should not overflow.");
    const mobileAccount = await evaluate(cdp, `(() => {
      window.__mobileLiveSession = accountSession;
      window.__mobileLiveEntitlements = accountEntitlements;
      accountSession = { loading: false, configured: true, signedIn: true, unavailable: false, user: { email: "quota@example.com" } };
      setAccountEntitlement({ configured: true, plan: "free", quota: { used: 2, pending: 0, remaining: 1, limit: 3, resetAt: "2026-08-01T00:00:00.000Z" } });
      renderAccountPanel();
      const panel = document.querySelector("#accountPanel");
      panel?.scrollIntoView({ block: "center" });
      const bounds = panel.getBoundingClientRect();
      const result = {
        width: bounds.width,
        viewportWidth: innerWidth,
        entitlement: document.querySelector("#accountEntitlements")?.innerText,
        boundary: panel.innerText,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
      return result;
    })()`);
    assert(mobileAccount.width <= mobileAccount.viewportWidth && !mobileAccount.overflow, "Account boundary should fit the mobile viewport without horizontal overflow.");
    assert(mobileAccount.entitlement.includes("Free") && mobileAccount.entitlement.includes("剩余 1") && mobileAccount.boundary.includes("不会上传、删除或改写"), "Mobile account UI should fit verified quota and preserve the local data boundary.");
    await screenshot(cdp, "smoke-mobile-account-boundary.png");
    await evaluate(cdp, `accountSession = window.__mobileLiveSession; accountEntitlements = window.__mobileLiveEntitlements; delete window.__mobileLiveSession; delete window.__mobileLiveEntitlements; renderAccountPanel();`);

    await navigate(cdp, `${baseUrl}/privacy.html`);
    const mobilePrivacy = await evaluate(cdp, `(() => ({
      heading: document.querySelector("h1")?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(mobilePrivacy.heading === "隐私政策", "Mobile privacy policy should render.");
    assert(!mobilePrivacy.overflow, "Mobile privacy policy should not overflow.");

    await navigate(cdp, appUrl);
    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    await delay(250);
    const mobileInsights = await evaluate(cdp, `(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      title: document.querySelector("#retentionInsights h3")?.textContent,
      patternTitle: document.querySelector("#personalTrainingPatterns h4")?.textContent,
      exportButtonWidth: document.querySelector("#exportWeeklyReportBtn")?.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(mobileInsights.title === "复盘中心", "Mobile insights should render the review center.");
    assert(mobileInsights.patternTitle === "个人训练规律", "Mobile insights should render the personal pattern progress state.");
    assert(mobileInsights.exportButtonWidth <= mobileInsights.width, "Mobile report export button should fit.");
    assert(!mobileInsights.overflow, "Mobile insights layout should not overflow.");
    await screenshot(cdp, "smoke-mobile-insights.png");

    const mobileProReport = await evaluate(cdp, `(() => {
      window.__mobileProSnapshot = {
        state: JSON.parse(JSON.stringify(state)),
        accountSession,
        accountEntitlements,
        aiAccessMode,
        proReportPeriod
      };
      const dates = getLastDays(90);
      state.dailyLogs = dates.map((date, index) => ({ id: "mobile-pro-daily-" + index, date, sleepHours: 7.2, pain: 0 }));
      state.workouts = dates.filter((date, index) => index % 7 === 0).map((date, index) => ({
        id: "mobile-pro-workout-" + index,
        date,
        title: "训练",
        duration: 30,
        sessionRpe: 6,
        note: "",
        exercises: [{ name: "训练", sets: [{ weight: 1, reps: 1, rpe: 6, note: "" }] }]
      }));
      aiAccessMode = "account_quota";
      accountSession = { loading: false, configured: true, signedIn: true, unavailable: false, user: { email: "pro@example.com" } };
      accountEntitlements = { loading: false, configured: true, unavailable: false, plan: "pro", quota: { used: 0, pending: 0, remaining: 100, limit: 100, resetAt: "2026-08-01T00:00:00.000Z" } };
      proReportPeriod = "90d";
      renderProLongitudinalReport();
      const panel = document.querySelector("#proLongitudinalReport");
      panel.scrollIntoView({ block: "center" });
      const bounds = panel.getBoundingClientRect();
      const period = panel.querySelector(".pro-report-period").getBoundingClientRect();
      return {
        width: bounds.width,
        periodWidth: period.width,
        viewportWidth: innerWidth,
        text: panel.innerText,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    await delay(120);
    assert(mobileProReport.width <= mobileProReport.viewportWidth && mobileProReport.periodWidth <= mobileProReport.width && !mobileProReport.overflow, "Mobile Pro report and segmented period control should fit the viewport.");
    assert(mobileProReport.text.includes("90 天纵向进展") && mobileProReport.text.includes("导出长期报告"), "Mobile Pro report should preserve its complete ready state.");
    await screenshot(cdp, "smoke-mobile-pro-longitudinal.png");
    await evaluate(cdp, `Object.assign(state, window.__mobileProSnapshot.state); accountSession = window.__mobileProSnapshot.accountSession; accountEntitlements = window.__mobileProSnapshot.accountEntitlements; aiAccessMode = window.__mobileProSnapshot.aiAccessMode; proReportPeriod = window.__mobileProSnapshot.proReportPeriod; delete window.__mobileProSnapshot; renderAll();`);

    const mobileCalibrationLayout = await evaluate(cdp, `(() => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const currentWeek = startOfLocalWeek(today());
      state.settings = normalizeSettings({ ...state.settings, weeklyWorkoutTarget: 4 });
      state.dailyLogs = [1, 2, 3, 4].flatMap(offset => [0, 2].map(day => ({
        id: "mobile-calibration-daily-" + offset + "-" + day,
        date: addLocalDays(currentWeek, -7 * offset + day),
        sleepHours: 7.5,
        waterMl: 2000,
        mood: 3,
        energy: 3,
        soreness: 1,
        pain: 0,
        habits: {},
        note: ""
      })));
      state.workouts = [1, 2, 3, 4].map(offset => ({
        id: "mobile-calibration-workout-" + offset,
        date: addLocalDays(currentWeek, -7 * offset),
        title: "训练",
        duration: 30,
        sessionRpe: 6,
        note: "",
        exercises: []
      }));
      appliedWeeklyTargetCalibration = null;
      renderAll();
      const panel = document.querySelector(".weekly-target-calibration");
      panel?.scrollIntoView({ block: "center" });
      const button = document.querySelector("#applyWeeklyTargetCalibrationBtn");
      const result = {
        width: panel?.getBoundingClientRect().width,
        buttonWidth: button?.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
      window.__mobileCalibrationSnapshot = snapshot;
      return result;
    })()`);
    await delay(120);
    assert(mobileCalibrationLayout.width <= mobileCalibrationLayout.viewportWidth && mobileCalibrationLayout.buttonWidth <= mobileCalibrationLayout.width && !mobileCalibrationLayout.overflow, `Mobile target calibration and its action should fit without overflow: ${JSON.stringify(mobileCalibrationLayout)}`);
    await screenshot(cdp, "smoke-mobile-target-calibration.png");
    await evaluate(cdp, `Object.assign(state, window.__mobileCalibrationSnapshot); appliedWeeklyTargetCalibration = null; renderAll();`);

    const mobileRhythmReview = await evaluate(cdp, `(() => {
      const panel = document.querySelector(".weekly-rhythm-insight");
      panel.scrollIntoView({ block: "center" });
      const bounds = panel.getBoundingClientRect();
      return {
        width: bounds.width,
        viewportWidth: innerWidth,
        label: panel.querySelector("h4")?.textContent,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    await delay(120);
    assert(mobileRhythmReview.label?.length > 0 && mobileRhythmReview.width <= mobileRhythmReview.viewportWidth && !mobileRhythmReview.overflow, "Mobile rhythm review should render as a readable, non-overflowing insight.");
    await screenshot(cdp, "smoke-mobile-rhythm-review.png");

    await evaluate(cdp, `activateTab("library"); window.scrollTo(0, 0);`);
    await delay(150);
    const mobileWeeklyRhythm = await evaluate(cdp, `(() => {
      const panel = document.querySelector(".planned-workout-days");
      const options = document.querySelector(".planned-workout-day-options");
      const bounds = panel.getBoundingClientRect();
      return {
        width: bounds.width,
        viewportWidth: innerWidth,
        checkboxes: panel.querySelectorAll('input[name="plannedWorkoutDays"]').length,
        columns: getComputedStyle(options).gridTemplateColumns.split(" ").length,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(mobileWeeklyRhythm.checkboxes === 7 && mobileWeeklyRhythm.columns === 2, "Mobile weekly rhythm settings should expose seven days in a readable two-column grid.");
    assert(mobileWeeklyRhythm.width <= mobileWeeklyRhythm.viewportWidth && !mobileWeeklyRhythm.overflow, "Mobile weekly rhythm settings should fit without horizontal overflow.");
    await evaluate(cdp, `document.querySelector(".planned-workout-days").scrollIntoView({ block: "center" });`);
    await delay(120);
    await screenshot(cdp, "smoke-mobile-weekly-rhythm.png");

    const mobileWorkoutMigration = await evaluate(cdp, `(() => {
      const migration = buildWorkoutCsvMigration(${JSON.stringify(hevyCsv)}, "hevy.csv");
      pendingImport = { mode: "workout_csv", ...migration };
      renderImportPreview();
      const panel = document.querySelector("#importPreview");
      panel?.scrollIntoView({ block: "center" });
      return {
        width: panel?.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(mobileWorkoutMigration.width <= mobileWorkoutMigration.viewportWidth, "Workout migration preview should fit the mobile viewport.");
    assert(!mobileWorkoutMigration.overflow, "Workout migration preview should not cause mobile horizontal overflow.");
    await screenshot(cdp, "smoke-mobile-workout-migration.png");
    await evaluate(cdp, `cancelImportData()`);

    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    const mobileCareSummary = await evaluate(cdp, `(() => {
      document.querySelector("#openCareSummaryBtn").click();
      const dialog = document.querySelector("#careSummaryDialog");
      const bounds = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        width: bounds.width,
        viewportWidth: innerWidth,
        previewHeight: document.querySelector("#careSummaryPreview").getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(mobileCareSummary.open, "Mobile care summary should open.");
    assert(mobileCareSummary.width <= mobileCareSummary.viewportWidth - 24, "Mobile care summary should fit the viewport.");
    assert(mobileCareSummary.previewHeight >= 200 && !mobileCareSummary.overflow, "Mobile care summary preview should remain readable without horizontal overflow.");
    await screenshot(cdp, "smoke-mobile-care-summary.png");

    const mobileCoachBrief = await evaluate(cdp, `(() => {
      document.querySelector("#cancelCareSummaryBtn").click();
      document.querySelector("#openCoachBriefBtn").click();
      const dialog = document.querySelector("#coachBriefDialog");
      const bounds = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        width: bounds.width,
        viewportWidth: innerWidth,
        focused: document.activeElement?.id,
        previewHeight: document.querySelector("#coachBriefPreview").getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(mobileCoachBrief.open && mobileCoachBrief.focused === "coachBriefIncludePlan", "Mobile coach brief should open with usable focus.");
    assert(mobileCoachBrief.width <= mobileCoachBrief.viewportWidth - 24 && mobileCoachBrief.previewHeight >= 200 && !mobileCoachBrief.overflow, "Mobile coach brief should fit with a readable preview.");
    await screenshot(cdp, "smoke-mobile-coach-brief.png");

    const mobileSupportAgreement = await evaluate(cdp, `(() => {
      document.querySelector("#cancelCoachBriefBtn").click();
      document.querySelector('[data-tab="today"]').click();
      document.querySelector("#openSupportAgreementBtn").click();
      const dialog = document.querySelector("#supportAgreementDialog");
      const bounds = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        width: bounds.width,
        viewportWidth: innerWidth,
        focused: document.activeElement?.id,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(mobileSupportAgreement.open && mobileSupportAgreement.focused === "supportRole", "Mobile support agreement should open with usable focus.");
    assert(mobileSupportAgreement.width <= mobileSupportAgreement.viewportWidth - 24 && !mobileSupportAgreement.overflow, "Mobile support agreement should fit without horizontal overflow.");
    await screenshot(cdp, "smoke-mobile-support-agreement.png");

    const mobileSupportReflection = await evaluate(cdp, `(() => {
      document.querySelector("#supportAgreementForm").requestSubmit();
      document.querySelector('[data-support-action="checkin"]').click();
      const dialog = document.querySelector("#supportCheckinDialog");
      const bounds = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        width: bounds.width,
        viewportWidth: innerWidth,
        focused: document.activeElement?.value,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(mobileSupportReflection.open && mobileSupportReflection.focused === "3", "Mobile support reflection should open with the neutral score selected.");
    assert(mobileSupportReflection.width <= mobileSupportReflection.viewportWidth - 24 && !mobileSupportReflection.overflow, "Mobile support reflection should fit without horizontal overflow.");
    await screenshot(cdp, "smoke-mobile-support-reflection.png");

    const gracefulExit = new Promise(resolveExit => server.once("exit", (code, signal) => resolveExit({ code, signal })));
    server.kill("SIGTERM");
    const shutdownResult = await Promise.race([
      gracefulExit,
      delay(3000).then(() => ({ timeout: true }))
    ]);
    const expectedShutdown = process.platform === "win32"
      ? shutdownResult.signal === "SIGTERM"
      : shutdownResult.code === 0;
    assert(!shutdownResult.timeout && expectedShutdown, "Server should terminate predictably after SIGTERM.");

    console.log(JSON.stringify({
      ok: true,
      checks: {
        serverHttp,
        cloudSyncHttp,
        shutdownResult,
        today: todayCheck,
        supportAgreement,
        loadedWorkout,
        blockedSave,
        oneSetProgress,
        savedWorkout,
        riskReview,
        careSummary,
        dataReset,
        mobile,
        mobileInsights,
        mobileRhythmReview,
        mobileWeeklyRhythm,
        mobileCareSummary,
        mobileCoachBrief,
        mobileSupportAgreement,
        mobileSupportReflection
      },
      screenshots: [
        "output/playwright/smoke-desktop.png",
        "output/playwright/smoke-desktop-pro-longitudinal.png",
        "output/playwright/smoke-mobile.png",
        "output/playwright/smoke-mobile-insights.png",
        "output/playwright/smoke-mobile-pro-longitudinal.png",
        "output/playwright/smoke-desktop-account-boundary.png",
        "output/playwright/smoke-mobile-account-boundary.png",
        "output/playwright/smoke-desktop-workout-migration.png",
        "output/playwright/smoke-mobile-workout-migration.png",
        "output/playwright/smoke-desktop-target-calibration.png",
        "output/playwright/smoke-mobile-target-calibration.png",
        "output/playwright/smoke-mobile-rhythm-review.png",
        "output/playwright/smoke-mobile-weekly-rhythm.png",
        "output/playwright/smoke-mobile-care-summary.png",
        "output/playwright/smoke-mobile-coach-brief.png",
        "output/playwright/smoke-mobile-support-agreement.png",
        "output/playwright/smoke-mobile-support-reflection.png"
      ]
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    await stopChild(chrome, "Chrome");
    await stopChild(cloudUnconfiguredServer, "Cloud-unconfigured app server");
    await stopChild(server, "App server");
    await stopChild(unconfiguredServer, "Unconfigured app server");
    await stopChild(partialConfigServer, "Partially configured server");
    await closeHttpServer(authServer);
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
