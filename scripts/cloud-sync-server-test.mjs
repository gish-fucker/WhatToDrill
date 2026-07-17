import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const moduleUrl = new URL("../server/cloud-sync.js", import.meta.url);
const {
  CLOUD_SYNC_LIMITS,
  CloudSyncError,
  canonicalizeSyncPayload,
  validateSyncPayload,
  loadCloudSyncConfig,
  getSyncState,
  putSyncState,
  deleteSyncState
} = await import(moduleUrl);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_KEY = "service-role-test-secret";
const NOW = "2026-07-16T12:00:00.000Z";
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const envelopeFor = (payload, overrides = {}) => ({
  baseRevision: 0,
  schemaVersion: 1,
  checksum: sha256(canonicalizeSyncPayload(payload)),
  payload,
  ...overrides
});
const hasStatus = status => error => error instanceof CloudSyncError && error.status === status;

assert.deepEqual(validateSyncPayload(envelopeFor({ b: 2, a: [1, { z: true }] })), {
  ...envelopeFor({ b: 2, a: [1, { z: true }] }),
  canonicalPayload: '{"a":[1,{"z":true}],"b":2}',
  payloadBytes: 26
});
for (const mutation of [
  value => ({ ...value, extra: true }),
  value => { const copy = { ...value }; delete copy.payload; return copy; },
  value => ({ ...value, baseRevision: "0" }),
  value => ({ ...value, baseRevision: Number.MAX_SAFE_INTEGER + 1 }),
  value => ({ ...value, baseRevision: -1 }),
  value => ({ ...value, schemaVersion: 2 }),
  value => ({ ...value, schemaVersion: 1.0, checksum: value.checksum.toUpperCase() }),
  value => ({ ...value, checksum: "a".repeat(63) }),
  value => ({ ...value, checksum: "f".repeat(64) }),
  value => ({ ...value, payload: [] }),
  value => ({ ...value, payload: { value: undefined } }),
  value => Object.assign(Object.create({ baseRevision: 0 }), value)
]) {
  assert.throws(() => validateSyncPayload(mutation(envelopeFor({ value: 1 }))), hasStatus(422));
}

let accessorRead = false;
const accessorPayload = {};
Object.defineProperty(accessorPayload, "value", {
  enumerable: true,
  get() { accessorRead = true; return 1; }
});
assert.throws(() => validateSyncPayload(envelopeFor(accessorPayload)), hasStatus(422));
assert.equal(accessorRead, false, "Validation must not invoke accessors.");
try {
  Object.defineProperty(Object.prototype, "toJSON", {
    configurable: true,
    value() { return { rewritten: true }; }
  });
  assert.throws(() => validateSyncPayload(envelopeFor({ value: 1 })), hasStatus(422));
} finally {
  delete Object.prototype.toJSON;
}
try {
  Object.defineProperty(Array.prototype, "toJSON", {
    configurable: true,
    value() { return ["rewritten"]; }
  });
  assert.throws(() => validateSyncPayload(envelopeFor({ list: [1] })), hasStatus(422));
} finally {
  delete Array.prototype.toJSON;
}

assert.throws(
  () => validateSyncPayload(envelopeFor({ values: Array(CLOUD_SYNC_LIMITS.maxArrayItems + 1).fill(0) })),
  hasStatus(422)
);
assert.throws(
  () => validateSyncPayload(envelopeFor({ value: "x".repeat(CLOUD_SYNC_LIMITS.maxStringLength + 1) })),
  hasStatus(422)
);
assert.throws(
  () => validateSyncPayload(envelopeFor({ ["k".repeat(CLOUD_SYNC_LIMITS.maxStringLength + 1)]: true })),
  hasStatus(422)
);
const tooManyRecords = {};
for (let index = 0; index <= CLOUD_SYNC_LIMITS.maxRecordEntries; index += 1) tooManyRecords[`k${index}`] = 0;
assert.throws(() => validateSyncPayload(envelopeFor(tooManyRecords)), hasStatus(422));

function payloadAtCanonicalBytes(targetBytes) {
  const overhead = Buffer.byteLength('{"value":""}', "utf8");
  return { value: "x".repeat(targetBytes - overhead) };
}
const exactLimitPayload = payloadAtCanonicalBytes(CLOUD_SYNC_LIMITS.maxCanonicalBytes);
const exactValidated = validateSyncPayload(envelopeFor(exactLimitPayload));
assert.equal(exactValidated.payloadBytes, 1_048_576);
const overLimitPayload = payloadAtCanonicalBytes(CLOUD_SYNC_LIMITS.maxCanonicalBytes + 1);
assert.throws(() => validateSyncPayload(envelopeFor(overLimitPayload)), hasStatus(413));
const multibyteOverhead = Buffer.byteLength('{"value":""}', "utf8");
const multibyteCount = Math.floor((CLOUD_SYNC_LIMITS.maxCanonicalBytes - multibyteOverhead) / 3);
const multibytePayload = { value: "界".repeat(multibyteCount) };
const multibyteEnvelope = envelopeFor(multibytePayload);
assert.ok(validateSyncPayload(multibyteEnvelope).payloadBytes <= CLOUD_SYNC_LIMITS.maxCanonicalBytes);
assert.throws(
  () => validateSyncPayload(envelopeFor({ value: `${multibytePayload.value}界` })),
  hasStatus(413),
  "The canonical limit must count UTF-8 bytes, not JavaScript characters."
);
for (const invalidString of ["\u0000", "\ud800", "\udfff", "before\ud800after", "before\udfffafter"]) {
  assert.throws(
    () => validateSyncPayload(envelopeFor({ value: invalidString })),
    hasStatus(422),
    "NUL and unpaired UTF-16 surrogates must not enter canonical snapshots."
  );
  assert.throws(
    () => validateSyncPayload(envelopeFor({ [invalidString]: true })),
    hasStatus(422),
    "Object keys must use the same safe Unicode subset as string values."
  );
}
assert.equal(validateSyncPayload(envelopeFor({ emoji: "paired \ud83d\ude80" })).payload.emoji, "paired 🚀");

assert.equal(loadCloudSyncConfig(null, 1000, {}).configured, false);
assert.throws(() => loadCloudSyncConfig(
  { baseUrl: "http://attacker.example" },
  1000,
  { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, NODE_ENV: "production" },
  async () => {}
), /HTTPS/);
assert.throws(() => loadCloudSyncConfig(
  null,
  1000,
  { SUPABASE_URL: "https://user:pass@example.supabase.co/path?secret=1", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY },
  async () => {}
), /SUPABASE_URL/);
assert.equal(loadCloudSyncConfig(
  { baseUrl: "http://[::1]:54321" },
  1000,
  { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, NODE_ENV: "development" },
  async () => {}
).baseUrl, "http://[::1]:54321");
const config = loadCloudSyncConfig(
  { baseUrl: "https://example.supabase.co" },
  1000,
  { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY },
  async () => { throw new Error("Network should be injected per test."); }
);
assert.equal(config.configured, true);
assert.equal("entitlementsEnabled" in config, false, "Cloud storage configuration must not depend on entitlement flags.");

function jsonResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); }
  };
}

function createFakeProvider() {
  let row = null;
  let floorRevision = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    const name = String(url).split("/").pop();
    const body = JSON.parse(options.body);
    calls.push({ name, body, headers: options.headers });
    assert.equal(options.headers.apikey, SERVICE_KEY);
    assert.equal(options.headers.authorization, `Bearer ${SERVICE_KEY}`);
    assert.equal(options.redirect, "error");
    assert.equal(body.p_user_id, USER_ID);
    assert.equal("userId" in body, false);
    const conflict = () => ({
      ok: false,
      conflict: {
        revision: row?.revision ?? floorRevision,
        exists: Boolean(row),
        checksum: row?.checksum ?? null
      }
    });
    if (name === "get_cloud_sync_state") {
      return jsonResponse(row
        ? { ok: true, exists: true, ...row }
        : { ok: true, exists: false, revision: floorRevision });
    }
    if (name === "put_cloud_sync_state") {
      const currentRevision = row?.revision ?? floorRevision;
      if (body.p_base_revision !== currentRevision) return jsonResponse(conflict());
      row = {
        revision: currentRevision + 1,
        schemaVersion: body.p_schema_version,
        checksum: body.p_checksum,
        payload: body.p_payload,
        updatedAt: NOW
      };
      floorRevision = row.revision;
      return jsonResponse({ ok: true, exists: true, ...row });
    }
    if (name === "delete_cloud_sync_state") {
      const currentRevision = row?.revision ?? floorRevision;
      if (body.p_base_revision !== currentRevision) return jsonResponse(conflict());
      floorRevision = currentRevision + 1;
      row = null;
      return jsonResponse({ ok: true, exists: false, revision: floorRevision, deletedAt: NOW });
    }
    throw new Error("Unexpected RPC.");
  };
  return { fetchImpl, calls };
}

const provider = createFakeProvider();
const fakeConfig = { ...config, fetchImpl: provider.fetchImpl };
assert.deepEqual(await getSyncState(fakeConfig, USER_ID), {
  configured: true,
  exists: false,
  revision: 0
});
const firstEnvelope = envelopeFor({ workouts: [], settings: { goal: "general" } });
const created = await putSyncState(fakeConfig, USER_ID, firstEnvelope);
assert.equal(created.revision, 1);
assert.equal(created.checksum, firstEnvelope.checksum);
assert.equal(created.exists, true);
const fetched = await getSyncState(fakeConfig, USER_ID);
assert.deepEqual(fetched.payload, firstEnvelope.payload);

await assert.rejects(
  putSyncState(fakeConfig, USER_ID, envelopeFor({ workouts: [1] }, { baseRevision: 0 })),
  error => error instanceof CloudSyncError
    && error.status === 409
    && error.code === "REVISION_CONFLICT"
    && error.conflict?.revision === 1
    && error.conflict?.checksum === firstEnvelope.checksum
);
const deleted = await deleteSyncState(fakeConfig, USER_ID, { baseRevision: 1 });
assert.deepEqual(deleted, { configured: true, exists: false, revision: 2, deletedAt: NOW });
assert.deepEqual(await getSyncState(fakeConfig, USER_ID), { configured: true, exists: false, revision: 2 });
await assert.rejects(
  putSyncState(fakeConfig, USER_ID, envelopeFor({ stale: true }, { baseRevision: 0 })),
  error => error?.status === 409 && error.conflict?.revision === 2,
  "A tombstone revision must prevent stale-device ABA recreation."
);
const recreatedEnvelope = envelopeFor({ fresh: true }, { baseRevision: 2 });
assert.equal((await putSyncState(fakeConfig, USER_ID, recreatedEnvelope)).revision, 3);
await assert.rejects(
  deleteSyncState(fakeConfig, USER_ID, { baseRevision: 1 }),
  error => error?.status === 409 && error.conflict?.revision === 3
);

assert.throws(() => deleteSyncState(fakeConfig, USER_ID, { baseRevision: "3" }), hasStatus(422));
assert.throws(() => getSyncState({ configured: false }, USER_ID), hasStatus(503));
assert.throws(() => getSyncState(fakeConfig, "not-a-user-id"), hasStatus(422));

const checksumMismatchProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: true,
    exists: true,
    revision: 4,
    schemaVersion: 1,
    checksum: "0".repeat(64),
    payload: { tampered: true },
    updatedAt: NOW
  })
};
await assert.rejects(getSyncState(checksumMismatchProvider, USER_ID), hasStatus(502));
const malformedProvider = { ...config, fetchImpl: async () => jsonResponse({ ok: true, exists: false, revision: "4" }) };
await assert.rejects(getSyncState(malformedProvider, USER_ID), hasStatus(502));
const unexpectedProvider = { ...config, fetchImpl: async () => jsonResponse({ ok: true, exists: false, revision: 4, secret: SERVICE_KEY }) };
await assert.rejects(getSyncState(unexpectedProvider, USER_ID), hasStatus(502));
const malformedShapeHooks = {};
let malformedShapeSignal;
const malformedShapeProvider = {
  ...config,
  fetchImpl: async (_url, options) => {
    malformedShapeSignal = options.signal;
    return streamedResponse([
      new TextEncoder().encode(JSON.stringify({ ok: true, exists: false, revision: 4, unexpected: true }))
    ], malformedShapeHooks);
  }
};
await assert.rejects(
  getSyncState(malformedShapeProvider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
assert.equal(malformedShapeHooks.bodyCancelled, true);
assert.equal(malformedShapeSignal.aborted, true);
const getConflictProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: false,
    conflict: { revision: 1, exists: true, checksum: "a".repeat(64) }
  })
};
await assert.rejects(
  getSyncState(getConflictProvider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID",
  "GET has no CAS operation, so a provider conflict is malformed provider data rather than HTTP 409."
);
const invalidActiveConflictProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: false,
    conflict: { revision: 0, exists: true, checksum: "a".repeat(64) }
  })
};
await assert.rejects(
  putSyncState(invalidActiveConflictProvider, USER_ID, envelopeFor({ value: 1 })),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
const invalidTombstoneConflictProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: false,
    conflict: { revision: 1, exists: false, checksum: "a".repeat(64) }
  })
};
await assert.rejects(
  putSyncState(invalidTombstoneConflictProvider, USER_ID, envelopeFor({ value: 1 })),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
const validEmptyConflictProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: false,
    conflict: { revision: 0, exists: false, checksum: null }
  })
};
await assert.rejects(
  putSyncState(validEmptyConflictProvider, USER_ID, envelopeFor({ value: 1 }, { baseRevision: 1 })),
  error => error?.status === 409 && error?.conflict?.revision === 0 && error?.conflict?.exists === false
);
const validTombstoneConflictProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: false,
    conflict: { revision: 2, exists: false, checksum: null }
  })
};
await assert.rejects(
  putSyncState(validTombstoneConflictProvider, USER_ID, envelopeFor({ value: 1 })),
  error => error?.status === 409 && error?.conflict?.revision === 2 && error?.conflict?.checksum === null
);
const impossibleSameBaseConflictProvider = {
  ...config,
  fetchImpl: async () => jsonResponse({
    ok: false,
    conflict: { revision: 0, exists: false, checksum: null }
  })
};
await assert.rejects(
  putSyncState(impossibleSameBaseConflictProvider, USER_ID, envelopeFor({ value: 1 }, { baseRevision: 0 })),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID",
  "A CAS provider cannot report a conflict when its current revision equals baseRevision."
);
const failedProvider = { ...config, fetchImpl: async () => ({ ok: false, status: 500, async text() { return `upstream leaked ${SERVICE_KEY}`; } }) };
await assert.rejects(
  getSyncState(failedProvider, USER_ID),
  error => error?.status === 502 && !error.message.includes(SERVICE_KEY) && !error.message.includes("upstream")
);
let failedBodyCancelled = false;
let failedSignal;
const cancellableFailedProvider = {
  ...config,
  fetchImpl: async (_url, options) => {
    failedSignal = options.signal;
    return {
      ok: false,
      status: 500,
      body: {
        cancel() {
          failedBodyCancelled = true;
          return Promise.reject(new Error("cancel failure must not replace the provider error"));
        }
      },
      async text() { return "must-not-be-read"; }
    };
  }
};
await assert.rejects(
  getSyncState(cancellableFailedProvider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_FAILURE"
);
assert.equal(failedBodyCancelled, true);
assert.equal(failedSignal.aborted, true);
const timeoutProvider = {
  ...config,
  timeoutMs: 5,
  fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("secret timeout detail"), { name: "AbortError" })));
  })
};
await assert.rejects(getSyncState(timeoutProvider, USER_ID), hasStatus(504));

function streamedResponse(chunks, hooks = {}) {
  let index = 0;
  return {
    ok: true,
    headers: { get() { return null; } },
    body: {
      async cancel() { hooks.bodyCancelled = true; },
      getReader() {
        return {
          async read() {
            hooks.reads = (hooks.reads || 0) + 1;
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
          },
          async cancel() { hooks.cancelled = true; }
        };
      }
    },
    async text() { throw new Error("Streaming responses must not use response.text()."); }
  };
}

const encoder = new TextEncoder();
const streamedMissing = JSON.stringify({ ok: true, exists: false, revision: 0 });
const streamedProvider = {
  ...config,
  fetchImpl: async () => streamedResponse([
    encoder.encode(streamedMissing.slice(0, 7)),
    encoder.encode(streamedMissing.slice(7))
  ])
};
assert.deepEqual(await getSyncState(streamedProvider, USER_ID), { configured: true, exists: false, revision: 0 });

const oversizedHooks = {};
const oversizedChunk = new Uint8Array(Math.floor(CLOUD_SYNC_LIMITS.maxProviderBytes / 2) + 1);
const oversizedStreamProvider = {
  ...config,
  fetchImpl: async () => streamedResponse([oversizedChunk, oversizedChunk, encoder.encode("must-not-be-read")], oversizedHooks)
};
await assert.rejects(
  getSyncState(oversizedStreamProvider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
assert.equal(oversizedHooks.reads, 2, "The provider stream must stop as soon as the byte cap is crossed.");
assert.equal(oversizedHooks.cancelled, true, "An oversized provider stream must be cancelled.");

let contentLengthTextRead = false;
const contentLengthProvider = {
  ...config,
  fetchImpl: async () => ({
    ok: true,
    headers: { get(name) { return name.toLowerCase() === "content-length" ? String(CLOUD_SYNC_LIMITS.maxProviderBytes + 1) : null; } },
    body: null,
    async text() { contentLengthTextRead = true; return "{}"; }
  })
};
await assert.rejects(
  getSyncState(contentLengthProvider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
assert.equal(contentLengthTextRead, false, "A declared oversized fallback body must be rejected before response.text().");

const invalidUtf8Hooks = {};
let invalidUtf8Signal;
const invalidUtf8Provider = {
  ...config,
  fetchImpl: async (_url, options) => {
    invalidUtf8Signal = options.signal;
    const response = streamedResponse([new Uint8Array([0xff])], invalidUtf8Hooks);
    response.body.getReader = () => ({
      read: async () => invalidUtf8Hooks.read
        ? { done: true, value: undefined }
        : (invalidUtf8Hooks.read = true, { done: false, value: new Uint8Array([0xff]) }),
      cancel() {
        invalidUtf8Hooks.cancelled = true;
        throw new Error("cancel failure must not replace invalid UTF-8");
      }
    });
    return response;
  }
};
await assert.rejects(
  getSyncState(invalidUtf8Provider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
assert.equal(invalidUtf8Hooks.cancelled, true);
assert.equal(invalidUtf8Signal.aborted, true);

const malformedHooks = {};
let malformedSignal;
const malformedStreamProvider = {
  ...config,
  fetchImpl: async (_url, options) => {
    malformedSignal = options.signal;
    return streamedResponse([encoder.encode("{")], malformedHooks);
  }
};
await assert.rejects(
  getSyncState(malformedStreamProvider, USER_ID),
  error => error?.status === 502 && error?.code === "CLOUD_SYNC_PROVIDER_INVALID"
);
assert.equal(malformedHooks.bodyCancelled, true);
assert.equal(malformedSignal.aborted, true);

const migration = await readFile(new URL("../supabase/migrations/20260716_cloud_sync.sql", import.meta.url), "utf8");
for (const pattern of [
  /create table public\.cloud_sync_states/i,
  /revision bigint not null check \(revision > 0\)/i,
  /enable row level security/i,
  /revoke all on table public\.cloud_sync_states from public, anon, authenticated, service_role/i,
  /security definer/i,
  /set search_path = pg_catalog/i,
  /pg_catalog\.jsonb_typeof\(payload\) = 'object'/i,
  /pg_advisory_xact_lock\s*\(\s*pg_catalog\.hashtextextended\('what_to_drill\.cloud_sync_states:'\s*\|\|\s*p_user_id::text,\s*0\)\s*\)/i,
  /where user_id = p_user_id\s+for update/i,
  /revoke all on function public\.get_cloud_sync_state\(uuid\) from public, anon, authenticated/i,
  /grant execute on function public\.get_cloud_sync_state\(uuid\) to service_role/i,
  /revoke all on function public\.put_cloud_sync_state\(uuid, bigint, integer, text, jsonb\) from public, anon, authenticated/i,
  /grant execute on function public\.put_cloud_sync_state\(uuid, bigint, integer, text, jsonb\) to service_role/i,
  /revoke all on function public\.delete_cloud_sync_state\(uuid, bigint\) from public, anon, authenticated/i,
  /grant execute on function public\.delete_cloud_sync_state\(uuid, bigint\) to service_role/i
]) {
  assert.match(migration, pattern);
}
assert.match(migration, /deleted_at is null[\s\S]*schema_version is not null[\s\S]*payload is not null[\s\S]*checksum is not null/i);
assert.match(migration, /deleted_at is not null[\s\S]*schema_version is null[\s\S]*payload is null[\s\S]*checksum is null/i);

console.log("Cloud sync server tests passed.");
