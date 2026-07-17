(function attachCloudSyncModel(global) {
  "use strict";

  const VERSION = 1;
  const SUPPORTED_SNAPSHOT_SCHEMA_VERSION = 1;
  const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
  const VALID_STATUSES = new Set(["disabled", "synced", "pending", "syncing", "conflict", "error"]);
  const VALID_CONFLICT_CODES = new Set(["REVISION_CONFLICT", "INTEGRITY_CONFLICT"]);
  const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const REALM_OBJECT_PROTOTYPE = Object.getPrototypeOf({});
  const REALM_ARRAY_PROTOTYPE = Object.getPrototypeOf([]);
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  const DEFAULT_METADATA = Object.freeze({
    version: VERSION,
    accountId: "",
    enabled: false,
    revision: 0,
    lastSyncedAt: "",
    localChecksum: "",
    remoteChecksum: "",
    status: "disabled",
    pending: false,
    conflict: null,
    error: ""
  });

  function codedError(code, message, ErrorType = Error) {
    const error = new ErrorType(message);
    error.code = code;
    return error;
  }

  function isPlainDataRecord(value, { rejectDangerousKeys = true } = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return false;
    }
    if (prototype !== null && prototype !== REALM_OBJECT_PROTOTYPE) return false;
    return Reflect.ownKeys(descriptors).every(key => (
      typeof key === "string"
      && (!rejectDangerousKeys || !FORBIDDEN_RECORD_KEYS.has(key))
      && descriptors[key].enumerable
      && !descriptors[key].get
      && !descriptors[key].set
    ));
  }

  function ownValue(record, key, fallback) {
    if (!isPlainDataRecord(record)) return fallback;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor ? descriptor.value : fallback;
  }

  function cleanText(value, maximumLength = 240) {
    return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
  }

  function cleanChecksum(value) {
    const checksum = cleanText(value, 64).toLowerCase();
    return CHECKSUM_PATTERN.test(checksum) ? checksum : "";
  }

  function cleanRevision(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function cleanTimestamp(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "";
    return new Date(value).toISOString();
  }

  function freshMetadata(accountId = "") {
    return { ...DEFAULT_METADATA, accountId: cleanText(accountId, 160) };
  }

  function normalizeConflict(value) {
    if (!isPlainDataRecord(value)) return null;
    const checksum = cleanChecksum(ownValue(value, "checksum", ""));
    if (!checksum) return null;
    const code = ownValue(value, "code", "REVISION_CONFLICT");
    return {
      revision: cleanRevision(ownValue(value, "revision", 0)),
      checksum,
      detectedAt: cleanTimestamp(ownValue(value, "detectedAt", "")),
      code: VALID_CONFLICT_CODES.has(code) ? code : "REVISION_CONFLICT"
    };
  }

  function normalizeMetadata(metadata = {}, expectedAccountId) {
    const source = isPlainDataRecord(metadata) ? metadata : null;
    const sourceAccountId = cleanText(ownValue(source, "accountId", ""), 160);
    const accountWasSupplied = arguments.length >= 2;
    const accountId = accountWasSupplied ? cleanText(expectedAccountId, 160) : sourceAccountId;
    const sourceVersion = ownValue(source, "version", undefined);

    if (!source
      || (sourceVersion !== undefined && sourceVersion !== VERSION)
      || (accountWasSupplied && sourceAccountId !== accountId)) {
      return freshMetadata(accountId);
    }

    const enabled = ownValue(source, "enabled", false) === true && Boolean(accountId);
    const revision = cleanRevision(ownValue(source, "revision", 0));
    const lastSyncedAt = cleanTimestamp(ownValue(source, "lastSyncedAt", ""));
    const localChecksum = cleanChecksum(ownValue(source, "localChecksum", ""));
    const remoteChecksum = cleanChecksum(ownValue(source, "remoteChecksum", ""));
    const candidateConflict = enabled ? normalizeConflict(ownValue(source, "conflict", null)) : null;
    const conflict = candidateConflict && candidateConflict.revision >= revision
      ? {
          ...candidateConflict,
          code: candidateConflict.revision === revision
            ? "INTEGRITY_CONFLICT"
            : candidateConflict.code
        }
      : null;
    const requestedStatus = ownValue(source, "status", "");
    const requestedError = cleanText(ownValue(source, "error", ""));
    const dirty = Boolean(localChecksum) && localChecksum !== remoteChecksum;

    let status = "disabled";
    let pending = false;
    let error = "";
    if (enabled && conflict) {
      status = "conflict";
      pending = true;
    } else if (enabled && requestedStatus === "syncing") {
      status = "syncing";
      pending = dirty;
    } else if (enabled && requestedStatus === "error" && requestedError) {
      status = "error";
      pending = dirty;
      error = requestedError;
    } else if (enabled && dirty) {
      status = "pending";
      pending = true;
      error = requestedStatus === "pending" ? requestedError : "";
    } else if (enabled) {
      status = "synced";
    }

    return {
      version: VERSION,
      accountId,
      enabled,
      revision,
      lastSyncedAt,
      localChecksum,
      remoteChecksum,
      status: VALID_STATUSES.has(status) ? status : "disabled",
      pending,
      conflict,
      error
    };
  }

  function accountExpectation(options, explicitAccountId, explicitWasSupplied = false) {
    if (explicitWasSupplied) {
      return { supplied: true, accountId: cleanText(explicitAccountId, 160) };
    }
    if (isPlainDataRecord(options) && hasOwn(options, "expectedAccountId")) {
      return { supplied: true, accountId: cleanText(ownValue(options, "expectedAccountId", ""), 160) };
    }
    return { supplied: false, accountId: "" };
  }

  function requiredAccountExpectation(options, explicitAccountId, explicitWasSupplied = false) {
    const expectation = accountExpectation(options, explicitAccountId, explicitWasSupplied);
    if (!expectation.supplied) {
      throw codedError("EXPECTED_ACCOUNT_REQUIRED", "Async synchronization completion requires an expected account ID.");
    }
    return expectation;
  }

  function transitionMetadata(metadata, expectation = { supplied: false, accountId: "" }) {
    if (expectation.supplied) {
      const sourceAccountId = cleanText(ownValue(metadata, "accountId", ""), 160);
      if (sourceAccountId && sourceAccountId !== expectation.accountId) {
        throw codedError("ACCOUNT_CHANGED", "The signed-in account changed before synchronization completed.");
      }
      return normalizeMetadata(metadata, expectation.accountId);
    }
    return normalizeMetadata(metadata);
  }

  function unsupportedSnapshotValue(message) {
    return codedError("UNSUPPORTED_SNAPSHOT_VALUE", message, TypeError);
  }

  function assertCanonicalEnvironment() {
    if (hasOwn(REALM_OBJECT_PROTOTYPE, "toJSON") || hasOwn(REALM_ARRAY_PROTOTYPE, "toJSON")) {
      throw unsupportedSnapshotValue("Built-in JSON prototypes were modified with toJSON.");
    }
  }

  function canonicalStringify(value) {
    assertCanonicalEnvironment();
    const ancestors = new Set();

    function encode(current) {
      if (current === null) return "null";
      const type = typeof current;
      if (type === "string" || type === "boolean") return JSON.stringify(current);
      if (type === "number") {
        if (!Number.isFinite(current)) throw unsupportedSnapshotValue("Cloud snapshots require finite numbers.");
        return JSON.stringify(current);
      }
      if (type === "bigint" || type === "undefined" || type === "function" || type === "symbol") {
        throw unsupportedSnapshotValue(`Cloud snapshots do not support ${type} values.`);
      }
      if (type !== "object") throw unsupportedSnapshotValue("Cloud snapshot contains an unsupported value.");
      if (ancestors.has(current)) throw unsupportedSnapshotValue("Cloud snapshots cannot contain circular references.");

      ancestors.add(current);
      try {
        if (Array.isArray(current)) {
          if (Object.getPrototypeOf(current) !== REALM_ARRAY_PROTOTYPE) {
            throw unsupportedSnapshotValue("Cloud snapshots require current-realm JSON arrays.");
          }
          const descriptors = Object.getOwnPropertyDescriptors(current);
          for (let index = 0; index < current.length; index += 1) {
            const descriptor = descriptors[index];
            if (!descriptor) {
              throw unsupportedSnapshotValue("Cloud snapshot arrays cannot contain empty slots.");
            }
            if (!descriptor.enumerable || descriptor.get || descriptor.set) {
              throw unsupportedSnapshotValue("Cloud snapshot arrays require enumerable data items.");
            }
          }
          const extraKeys = Reflect.ownKeys(descriptors).filter(key => (
            key !== "length" && !(typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < current.length)
          ));
          if (extraKeys.length) throw unsupportedSnapshotValue("Cloud snapshot arrays cannot contain custom properties.");
          return `[${Array.from({ length: current.length }, (_, index) => encode(descriptors[index].value)).join(",")}]`;
        }
        if (!isPlainDataRecord(current, { rejectDangerousKeys: false })) {
          throw unsupportedSnapshotValue("Cloud snapshots require plain JSON objects.");
        }
        const keys = Reflect.ownKeys(current);
        if (keys.some(key => typeof key !== "string" || FORBIDDEN_RECORD_KEYS.has(key))) {
          throw unsupportedSnapshotValue("Cloud snapshot contains a forbidden object key.");
        }
        return `{${keys.sort().map(key => `${JSON.stringify(key)}:${encode(ownValue(current, key, undefined))}`).join(",")}}`;
      } finally {
        ancestors.delete(current);
      }
    }

    return encode(value);
  }

  function serializeSnapshot(snapshot) {
    return canonicalStringify(snapshot);
  }

  function bytesToHex(value) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
    if (!bytes) throw new TypeError("The SHA-256 adapter must return a hexadecimal digest or bytes.");
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function defaultSha256(value) {
    if (!global.crypto?.subtle || typeof TextEncoder !== "function") {
      throw new Error("Web Crypto SHA-256 is unavailable; inject a SHA-256 adapter.");
    }
    return global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  }

  async function snapshotChecksum(snapshot, sha256Adapter = defaultSha256) {
    if (typeof sha256Adapter !== "function") throw new TypeError("A SHA-256 adapter must be a function.");
    const digest = await sha256Adapter(serializeSnapshot(snapshot));
    const checksum = typeof digest === "string" ? digest.trim().toLowerCase() : bytesToHex(digest);
    if (!CHECKSUM_PATTERN.test(checksum)) throw new TypeError("The SHA-256 adapter returned an invalid digest.");
    return checksum;
  }

  function markLocalChange(metadata, checksum, expectedAccountId) {
    const expectation = accountExpectation(null, expectedAccountId, arguments.length >= 3);
    const current = transitionMetadata(metadata, expectation);
    const localChecksum = cleanChecksum(checksum);
    if (!localChecksum) throw new TypeError("A valid local snapshot checksum is required.");
    if (!current.enabled) return { ...current, localChecksum };
    if (current.conflict) return { ...current, localChecksum };
    return normalizeMetadata({ ...current, localChecksum, status: "pending", error: "" });
  }

  function validateConflictIdentity(current, options, resolution) {
    if (ownValue(options, "resolveConflict", "") !== resolution) {
      throw codedError("UNRESOLVED_CONFLICT", "An explicit, current conflict resolution is required.");
    }
    const revision = cleanRevision(ownValue(options, "conflictRevision", -1));
    const checksum = cleanChecksum(ownValue(options, "conflictChecksum", ""));
    if (revision !== current.conflict.revision || checksum !== current.conflict.checksum) {
      throw codedError("STALE_CONFLICT_RESOLUTION", "The cloud conflict changed before it was resolved.");
    }
  }

  function beginSync(metadata, options = {}, explicitAccountId) {
    const expectation = accountExpectation(options, explicitAccountId, arguments.length >= 3);
    const current = transitionMetadata(metadata, expectation);
    if (!current.enabled) return current;
    if (current.conflict) {
      if (ownValue(options, "resolveConflict", "") !== "keep-local") return current;
      validateConflictIdentity(current, options, "keep-local");
      const remoteRevision = cleanRevision(ownValue(options, "remoteRevision", -1));
      const remoteChecksum = cleanChecksum(ownValue(options, "remoteChecksum", ""));
      if (!remoteChecksum || remoteRevision < current.conflict.revision) {
        throw codedError("STALE_CONFLICT_RESOLUTION", "Keep-local resolution requires a current cloud revision.");
      }
      if (remoteRevision === current.conflict.revision && remoteChecksum !== current.conflict.checksum) {
        throw codedError("INTEGRITY_CONFLICT", "The same cloud revision was returned with different content.");
      }
      return {
        ...current,
        conflict: {
          revision: remoteRevision,
          checksum: remoteChecksum,
          detectedAt: current.conflict.detectedAt,
          code: current.conflict.code
        }
      };
    }
    return normalizeMetadata({ ...current, status: "syncing", error: "" });
  }

  function completePush(metadata, result = {}, options = {}, explicitAccountId) {
    const expectation = requiredAccountExpectation(options, explicitAccountId, arguments.length >= 4);
    const current = transitionMetadata(metadata, expectation);
    if (!current.enabled) return current;
    if (current.conflict) validateConflictIdentity(current, options, "keep-local");
    if (!isPlainDataRecord(result)) throw new TypeError("A plain push result is required.");
    const revision = cleanRevision(ownValue(result, "revision", -1));
    const checksum = cleanChecksum(ownValue(result, "checksum", ""));
    if (!checksum || checksum !== current.localChecksum) {
      if (revision === current.revision && checksum && checksum !== current.remoteChecksum) {
        throw codedError("INTEGRITY_CONFLICT", "The same cloud revision was returned with different content.");
      }
      throw new TypeError("A push result must match the current local checksum.");
    }

    const baseRevision = current.conflict ? current.conflict.revision : current.revision;
    if (revision === baseRevision) {
      if (checksum !== (current.conflict ? current.conflict.checksum : current.remoteChecksum)) {
        throw codedError("INTEGRITY_CONFLICT", "The same cloud revision was returned with different content.");
      }
      return current;
    }
    if (revision < baseRevision) throw codedError("STALE_SYNC_RESULT", "The push result revision is stale.");

    return normalizeMetadata({
      ...current,
      revision,
      lastSyncedAt: cleanTimestamp(ownValue(result, "syncedAt", "")) || new Date().toISOString(),
      localChecksum: checksum,
      remoteChecksum: checksum,
      status: "synced",
      pending: false,
      conflict: null,
      error: ""
    });
  }

  function unsupportedSchemaError(schemaVersion) {
    return codedError(
      "UNSUPPORTED_SCHEMA",
      `Cloud snapshot schema ${schemaVersion} is newer than supported schema ${SUPPORTED_SNAPSHOT_SCHEMA_VERSION}.`,
      RangeError
    );
  }

  function completePull(metadata, remote = {}, options = {}, explicitAccountId) {
    const expectation = requiredAccountExpectation(options, explicitAccountId, arguments.length >= 4);
    const current = transitionMetadata(metadata, expectation);
    if (!current.enabled) return current;
    if (current.conflict) validateConflictIdentity(current, options, "use-cloud");
    if (!isPlainDataRecord(remote)) throw new TypeError("A plain pull result is required.");
    const schemaVersion = Number(ownValue(remote, "schemaVersion", 0));
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new TypeError("A valid cloud snapshot schema version is required.");
    }
    if (schemaVersion > SUPPORTED_SNAPSHOT_SCHEMA_VERSION) throw unsupportedSchemaError(schemaVersion);
    const revision = cleanRevision(ownValue(remote, "revision", -1));
    const checksum = cleanChecksum(ownValue(remote, "checksum", ""));
    if (!checksum) throw new TypeError("A pull result must contain a valid checksum.");

    if (current.conflict) {
      if (revision !== current.conflict.revision || checksum !== current.conflict.checksum) {
        if (revision === current.conflict.revision) {
          throw codedError("INTEGRITY_CONFLICT", "The same cloud revision was returned with different content.");
        }
        throw codedError("STALE_CONFLICT_RESOLUTION", "The cloud conflict changed before it was resolved.");
      }
    } else if (revision < current.revision) {
      throw codedError("STALE_SYNC_RESULT", "The pull result revision is stale.");
    } else if (revision === current.revision) {
      if (checksum !== current.remoteChecksum) {
        return markConflict(current, {
          revision,
          checksum,
          detectedAt: ownValue(remote, "syncedAt", ""),
          code: "INTEGRITY_CONFLICT"
        }, expectation.supplied ? { expectedAccountId: expectation.accountId } : {});
      }
      return current;
    } else if (current.pending && current.localChecksum !== checksum) {
      return markConflict(current, {
        revision,
        checksum,
        detectedAt: ownValue(remote, "syncedAt", ""),
        code: "REVISION_CONFLICT"
      }, expectation.supplied ? { expectedAccountId: expectation.accountId } : {});
    }

    return normalizeMetadata({
      ...current,
      revision,
      lastSyncedAt: cleanTimestamp(ownValue(remote, "syncedAt", "")) || new Date().toISOString(),
      localChecksum: checksum,
      remoteChecksum: checksum,
      status: "synced",
      pending: false,
      conflict: null,
      error: ""
    });
  }

  function markConflict(metadata, remote = {}, options = {}, explicitAccountId) {
    const expectation = requiredAccountExpectation(options, explicitAccountId, arguments.length >= 4);
    const current = transitionMetadata(metadata, expectation);
    if (!current.enabled) return current;
    if (!isPlainDataRecord(remote)) throw new TypeError("Plain conflict details are required.");
    const checksum = cleanChecksum(ownValue(remote, "checksum", ""));
    const revision = cleanRevision(ownValue(remote, "revision", -1));
    if (!checksum || revision < current.revision) {
      throw codedError("STALE_SYNC_RESULT", "Conflict details contain a stale cloud revision.");
    }
    const inferredCode = revision === current.revision && checksum !== current.remoteChecksum
      ? "INTEGRITY_CONFLICT"
      : "REVISION_CONFLICT";
    const requestedCode = ownValue(remote, "code", inferredCode);
    return normalizeMetadata({
      ...current,
      status: "conflict",
      pending: true,
      conflict: {
        revision,
        checksum,
        detectedAt: cleanTimestamp(ownValue(remote, "detectedAt", "")) || new Date().toISOString(),
        code: VALID_CONFLICT_CODES.has(requestedCode) ? requestedCode : inferredCode
      },
      error: ""
    });
  }

  function markFailure(metadata, error, options = {}, explicitAccountId) {
    const expectation = requiredAccountExpectation(options, explicitAccountId, arguments.length >= 4);
    const current = transitionMetadata(metadata, expectation);
    if (!current.enabled || current.conflict) return current;
    const message = cleanText(error instanceof Error ? error.message : error) || "Cloud synchronization failed.";
    const dirty = Boolean(current.localChecksum) && current.localChecksum !== current.remoteChecksum;
    return normalizeMetadata({
      ...current,
      status: ownValue(options, "offline", false) === true && dirty ? "pending" : "error",
      pending: dirty,
      error: message
    });
  }

  global.CloudSyncModel = Object.freeze({
    VERSION,
    SUPPORTED_SNAPSHOT_SCHEMA_VERSION,
    normalizeMetadata,
    canonicalStringify,
    serializeSnapshot,
    snapshotChecksum,
    markLocalChange,
    beginSync,
    completePush,
    completePull,
    markConflict,
    markFailure
  });
})(globalThis);
