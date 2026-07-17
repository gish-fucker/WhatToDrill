import { createHash } from "node:crypto";

const SUPPORTED_SCHEMA_VERSION = 1;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const OBJECT_PROTOTYPE = Object.prototype;
const ARRAY_PROTOTYPE = Array.prototype;

export const CLOUD_SYNC_LIMITS = Object.freeze({
  maxCanonicalBytes: 1_048_576,
  maxEnvelopeBytes: 1_114_112,
  maxArrayItems: 10_000,
  maxRecordEntries: 10_000,
  maxStringLength: 1_048_576,
  maxDepth: 64,
  maxProviderBytes: 1_114_112
});

export class CloudSyncError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "CloudSyncError";
    this.status = status;
    this.code = code;
    if (details.conflict) this.conflict = details.conflict;
  }
}

function fail(status, code, message, details) {
  throw new CloudSyncError(status, code, message, details);
}

function isPlainDataRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) return false;
  return Reflect.ownKeys(descriptors).every(key => (
    typeof key === "string"
    && !FORBIDDEN_KEYS.has(key)
    && descriptors[key].enumerable
    && !descriptors[key].get
    && !descriptors[key].set
  ));
}

function exactKeys(value, requiredKeys) {
  if (!isPlainDataRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === requiredKeys.length
    && requiredKeys.every(key => hasOwn(value, key));
}

function ownDataValue(record, key) {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function isSafeRevision(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validationFailure(message) {
  fail(422, "INVALID_SYNC_PAYLOAD", message);
}

function isSafeUnicodeString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertCanonicalEnvironment() {
  if (hasOwn(OBJECT_PROTOTYPE, "toJSON") || hasOwn(ARRAY_PROTOTYPE, "toJSON")) {
    validationFailure("Built-in JSON prototypes were modified with toJSON.");
  }
}

function sizeFailure() {
  fail(413, "SYNC_PAYLOAD_TOO_LARGE", "The cloud snapshot exceeds the maximum allowed size.");
}

export function canonicalizeSyncPayload(payload) {
  assertCanonicalEnvironment();
  if (!isPlainDataRecord(payload)) validationFailure("The cloud snapshot payload must be a plain object.");
  let recordEntries = 0;
  const ancestors = new Set();

  function encode(value, depth) {
    if (depth > CLOUD_SYNC_LIMITS.maxDepth) validationFailure("The cloud snapshot is nested too deeply.");
    if (value === null) return "null";
    const type = typeof value;
    if (type === "string") {
      if (value.length > CLOUD_SYNC_LIMITS.maxStringLength) {
        validationFailure("A cloud snapshot string exceeds the allowed length.");
      }
      if (!isSafeUnicodeString(value)) {
        validationFailure("Cloud snapshot strings must use valid Unicode and cannot contain NUL.");
      }
      return JSON.stringify(value);
    }
    if (type === "boolean") return value ? "true" : "false";
    if (type === "number") {
      if (!Number.isFinite(value)) validationFailure("Cloud snapshots require finite numbers.");
      return JSON.stringify(value);
    }
    if (type !== "object") validationFailure("The cloud snapshot contains an unsupported value.");
    if (ancestors.has(value)) validationFailure("Cloud snapshots cannot contain circular references.");

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== ARRAY_PROTOTYPE) {
          validationFailure("Cloud snapshot arrays must use the standard array prototype.");
        }
        if (value.length > CLOUD_SYNC_LIMITS.maxArrayItems) {
          validationFailure("A cloud snapshot array contains too many items.");
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const encoded = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[index];
          if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
            validationFailure("Cloud snapshot arrays must contain only data items and no empty slots.");
          }
          encoded.push(encode(descriptor.value, depth + 1));
        }
        const allowed = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
        if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !allowed.has(key))) {
          validationFailure("Cloud snapshot arrays cannot contain custom properties.");
        }
        return `[${encoded.join(",")}]`;
      }

      if (!isPlainDataRecord(value)) validationFailure("Cloud snapshots require plain data objects.");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(descriptors).sort();
      if (keys.some(key => key.length > CLOUD_SYNC_LIMITS.maxStringLength)) {
        validationFailure("A cloud snapshot field name exceeds the allowed length.");
      }
      if (keys.some(key => !isSafeUnicodeString(key))) {
        validationFailure("Cloud snapshot field names must use valid Unicode and cannot contain NUL.");
      }
      recordEntries += keys.length;
      if (recordEntries > CLOUD_SYNC_LIMITS.maxRecordEntries) {
        validationFailure("The cloud snapshot contains too many record fields.");
      }
      return `{${keys.map(key => `${JSON.stringify(key)}:${encode(descriptors[key].value, depth + 1)}`).join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }

  return encode(payload, 0);
}

function checksumOf(canonicalPayload) {
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

export function validateSyncPayload(value) {
  if (!exactKeys(value, ["baseRevision", "schemaVersion", "checksum", "payload"])) {
    validationFailure("The cloud sync request must contain exactly the supported fields.");
  }
  const baseRevision = ownDataValue(value, "baseRevision");
  const schemaVersion = ownDataValue(value, "schemaVersion");
  const checksum = ownDataValue(value, "checksum");
  const payload = ownDataValue(value, "payload");
  if (!isSafeRevision(baseRevision)) validationFailure("The base revision must be a non-negative safe integer.");
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    validationFailure("The cloud snapshot schema version is unsupported.");
  }
  if (typeof checksum !== "string" || !CHECKSUM_PATTERN.test(checksum)) {
    validationFailure("The cloud snapshot checksum is invalid.");
  }
  const canonicalPayload = canonicalizeSyncPayload(payload);
  const payloadBytes = Buffer.byteLength(canonicalPayload, "utf8");
  if (payloadBytes > CLOUD_SYNC_LIMITS.maxCanonicalBytes) sizeFailure();
  if (checksumOf(canonicalPayload) !== checksum) {
    validationFailure("The cloud snapshot checksum does not match its content.");
  }
  return { baseRevision, schemaVersion, checksum, payload, canonicalPayload, payloadBytes };
}

function unavailableConfig(timeoutMs = 10_000) {
  return Object.freeze({ configured: false, timeoutMs });
}

export function loadCloudSyncConfig(accountAuth, upstreamTimeoutMs = 10_000, env = process.env, fetchImpl = globalThis.fetch) {
  const timeoutMs = Number(upstreamTimeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("Cloud sync timeout must be an integer between 1 and 120000 milliseconds.");
  }
  const rawBaseUrl = accountAuth?.baseUrl || env?.SUPABASE_URL || "";
  const serviceRoleKey = (env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!rawBaseUrl || !serviceRoleKey) return unavailableConfig(timeoutMs);
  if (typeof rawBaseUrl !== "string") throw new Error("SUPABASE_URL must be a valid URL.");
  let url;
  try {
    url = new URL(rawBaseUrl.trim());
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }
  const isLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(env?.NODE_ENV !== "production" && url.protocol === "http:" && isLoopback)) {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("SUPABASE_URL must be a credential-free origin without a path, query, or fragment.");
  }
  const baseUrl = url.origin;
  if (typeof fetchImpl !== "function") throw new Error("Cloud sync requires a fetch implementation.");
  return Object.freeze({ configured: true, baseUrl, serviceRoleKey, timeoutMs, fetchImpl });
}

function requireConfig(config) {
  if (!config?.configured
    || typeof config.baseUrl !== "string"
    || !config.baseUrl
    || typeof config.serviceRoleKey !== "string"
    || !config.serviceRoleKey
    || typeof config.fetchImpl !== "function") {
    fail(503, "CLOUD_SYNC_UNAVAILABLE", "Cloud backup is not configured on this server.");
  }
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    fail(422, "INVALID_ACCOUNT", "The authenticated account is invalid.");
  }
  return userId.toLowerCase();
}

async function callRpc(config, rpcName, body, normalizeResult) {
  requireConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await config.fetchImpl(`${config.baseUrl}/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response || typeof response.text !== "function" || response.ok !== true) {
      cancelProviderResources(response, controller);
      fail(502, "CLOUD_SYNC_PROVIDER_FAILURE", "The cloud backup provider did not complete the request.");
    }
    const raw = await readLimitedProviderBody(response, controller);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      cancelProviderResources(response, controller);
      fail(502, "CLOUD_SYNC_PROVIDER_INVALID", "The cloud backup provider returned an invalid response.");
    }
    if (typeof normalizeResult !== "function") return parsed;
    try {
      return normalizeResult(parsed);
    } catch (error) {
      if (error instanceof CloudSyncError && error.code === "CLOUD_SYNC_PROVIDER_INVALID") {
        cancelProviderResources(response, controller);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CloudSyncError) throw error;
    if (controller.signal.aborted || error?.name === "AbortError") {
      fail(504, "CLOUD_SYNC_PROVIDER_TIMEOUT", "The cloud backup provider timed out.");
    }
    fail(502, "CLOUD_SYNC_PROVIDER_FAILURE", "The cloud backup provider did not complete the request.");
  } finally {
    clearTimeout(timeout);
  }
}

function startCancellation(receiver, methodName) {
  const method = receiver?.[methodName];
  if (typeof method !== "function") return;
  try {
    const result = method.call(receiver);
    if (result && typeof result.then === "function") {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    // Cancellation is best-effort and must never replace the classified provider error.
  }
}

function cancelProviderResources(response, controller, reader) {
  startCancellation(reader, "cancel");
  startCancellation(response?.body, "cancel");
  if (!controller.signal.aborted) controller.abort();
}

function rejectInvalidProvider(response, controller, reader) {
  cancelProviderResources(response, controller, reader);
  providerInvalid();
}

async function readLimitedProviderBody(response, controller) {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined && declaredLength !== "") {
    if (!/^\d+$/.test(declaredLength)) rejectInvalidProvider(response, controller);
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > CLOUD_SYNC_LIMITS.maxProviderBytes) {
      rejectInvalidProvider(response, controller);
    }
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let totalBytes = 0;
    let raw = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (!chunk || chunk.done === true) break;
        if (!(chunk.value instanceof Uint8Array)) rejectInvalidProvider(response, controller, reader);
        totalBytes += chunk.value.byteLength;
        if (totalBytes > CLOUD_SYNC_LIMITS.maxProviderBytes) {
          rejectInvalidProvider(response, controller, reader);
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
      return raw;
    } catch (error) {
      if (error instanceof CloudSyncError) throw error;
      if (controller.signal.aborted || error?.name === "AbortError") throw error;
      rejectInvalidProvider(response, controller, reader);
    }
  }

  if (typeof response.text !== "function") rejectInvalidProvider(response, controller);
  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw error;
    cancelProviderResources(response, controller);
    fail(502, "CLOUD_SYNC_PROVIDER_FAILURE", "The cloud backup provider did not complete the request.");
  }
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > CLOUD_SYNC_LIMITS.maxProviderBytes) {
    rejectInvalidProvider(response, controller);
  }
  return raw;
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function providerInvalid() {
  fail(502, "CLOUD_SYNC_PROVIDER_INVALID", "The cloud backup provider returned an invalid response.");
}

function normalizeConflictResult(value) {
  if (!exactKeys(value, ["ok", "conflict"]) || ownDataValue(value, "ok") !== false) return null;
  const conflict = ownDataValue(value, "conflict");
  if (!exactKeys(conflict, ["revision", "exists", "checksum"])) providerInvalid();
  const revision = ownDataValue(conflict, "revision");
  const exists = ownDataValue(conflict, "exists");
  const checksum = ownDataValue(conflict, "checksum");
  if (!isSafeRevision(revision)
    || typeof exists !== "boolean"
    || (exists && revision < 1)
    || (exists ? typeof checksum !== "string" || !CHECKSUM_PATTERN.test(checksum) : checksum !== null)) {
    providerInvalid();
  }
  return { revision, exists, checksum };
}

function throwIfConflict(value, baseRevision) {
  const conflict = normalizeConflictResult(value);
  if (conflict) {
    if (conflict.revision === baseRevision) providerInvalid();
    fail(409, "REVISION_CONFLICT", "The cloud snapshot changed on another device.", { conflict });
  }
}

function normalizeMissingResult(value) {
  if (!exactKeys(value, ["ok", "exists", "revision"])
    || ownDataValue(value, "ok") !== true
    || ownDataValue(value, "exists") !== false
    || !isSafeRevision(ownDataValue(value, "revision"))) {
    providerInvalid();
  }
  return {
    configured: true,
    exists: false,
    revision: ownDataValue(value, "revision")
  };
}

function normalizeActiveResult(value) {
  if (!exactKeys(value, ["ok", "exists", "revision", "schemaVersion", "checksum", "payload", "updatedAt"])
    || ownDataValue(value, "ok") !== true
    || ownDataValue(value, "exists") !== true
    || !isSafeRevision(ownDataValue(value, "revision"))
    || ownDataValue(value, "revision") < 1
    || !validTimestamp(ownDataValue(value, "updatedAt"))) {
    providerInvalid();
  }
  const envelope = {
    baseRevision: ownDataValue(value, "revision"),
    schemaVersion: ownDataValue(value, "schemaVersion"),
    checksum: ownDataValue(value, "checksum"),
    payload: ownDataValue(value, "payload")
  };
  let validated;
  try {
    validated = validateSyncPayload(envelope);
  } catch {
    providerInvalid();
  }
  return {
    configured: true,
    exists: true,
    revision: envelope.baseRevision,
    schemaVersion: validated.schemaVersion,
    checksum: validated.checksum,
    payload: validated.payload,
    updatedAt: new Date(ownDataValue(value, "updatedAt")).toISOString()
  };
}

function normalizeDeleteResult(value) {
  if (!exactKeys(value, ["ok", "exists", "revision", "deletedAt"])
    || ownDataValue(value, "ok") !== true
    || ownDataValue(value, "exists") !== false
    || !isSafeRevision(ownDataValue(value, "revision"))
    || ownDataValue(value, "revision") < 1
    || !validTimestamp(ownDataValue(value, "deletedAt"))) {
    providerInvalid();
  }
  return {
    configured: true,
    exists: false,
    revision: ownDataValue(value, "revision"),
    deletedAt: new Date(ownDataValue(value, "deletedAt")).toISOString()
  };
}

export function getSyncState(config, userId) {
  requireConfig(config);
  const accountId = requireUserId(userId);
  return callRpc(config, "get_cloud_sync_state", { p_user_id: accountId }, result => {
    if (exactKeys(result, ["ok", "conflict"]) && ownDataValue(result, "ok") === false) {
      providerInvalid();
    }
    if (exactKeys(result, ["ok", "exists", "revision"]) && ownDataValue(result, "exists") === false) {
      return normalizeMissingResult(result);
    }
    return normalizeActiveResult(result);
  });
}

export function putSyncState(config, userId, value) {
  requireConfig(config);
  const accountId = requireUserId(userId);
  const validated = validateSyncPayload(value);
  return callRpc(config, "put_cloud_sync_state", {
    p_user_id: accountId,
    p_base_revision: validated.baseRevision,
    p_schema_version: validated.schemaVersion,
    p_checksum: validated.checksum,
    p_payload: validated.payload
  }, result => {
    throwIfConflict(result, validated.baseRevision);
    const normalized = normalizeActiveResult(result);
    if (normalized.revision !== validated.baseRevision + 1
      || normalized.schemaVersion !== validated.schemaVersion
      || normalized.checksum !== validated.checksum
      || canonicalizeSyncPayload(normalized.payload) !== validated.canonicalPayload) {
      providerInvalid();
    }
    return normalized;
  });
}

function validateDeleteEnvelope(value) {
  if (!exactKeys(value, ["baseRevision"]) || !isSafeRevision(ownDataValue(value, "baseRevision"))) {
    validationFailure("A delete request must contain exactly one valid base revision.");
  }
  return ownDataValue(value, "baseRevision");
}

export function deleteSyncState(config, userId, value) {
  requireConfig(config);
  const accountId = requireUserId(userId);
  const baseRevision = validateDeleteEnvelope(value);
  return callRpc(config, "delete_cloud_sync_state", {
    p_user_id: accountId,
    p_base_revision: baseRevision
  }, result => {
    throwIfConflict(result, baseRevision);
    const normalized = normalizeDeleteResult(result);
    if (normalized.revision !== baseRevision + 1) providerInvalid();
    return normalized;
  });
}
