import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
}
await import(new URL("../public/cloud-sync-model.js", import.meta.url));
const model = globalThis.CloudSyncModel;

const NOW = "2026-07-16T12:00:00.000Z";
const LOCAL = "1".repeat(64);
const REMOTE = "2".repeat(64);
const REPLACEMENT = "3".repeat(64);
const sha256 = async value => createHash("sha256").update(value, "utf8").digest("hex");
const hasCode = code => error => error?.code === code;

const empty = model.normalizeMetadata();
assert.deepEqual(JSON.parse(JSON.stringify(empty)), {
  version: 1,
  accountId: "",
  enabled: false,
  revision: 0,
  lastSyncedAt: "",
  localChecksum: "",
  remoteChecksum: "",
  status: "disabled",
  pending: false,
  conflict: null,
  error: "",
  localResetPending: false
});

const sanitized = model.normalizeMetadata({
  accountId: "account-a",
  enabled: true,
  accessToken: "must-not-survive",
  serviceRoleKey: "must-not-survive",
  status: "synced"
}, "account-a");
assert.equal("accessToken" in sanitized, false);
assert.equal("serviceRoleKey" in sanitized, false);

let getterWasRead = false;
const accessorMetadata = {};
Object.defineProperty(accessorMetadata, "accountId", {
  enumerable: true,
  get() {
    getterWasRead = true;
    return "account-a";
  }
});
assert.equal(model.normalizeMetadata(accessorMetadata, "account-a").enabled, false);
assert.equal(getterWasRead, false, "Metadata normalization must not invoke accessors.");
const inheritedMetadata = Object.create({
  accountId: "account-a",
  enabled: true,
  revision: 99,
  status: "synced"
});
assert.equal(model.normalizeMetadata(inheritedMetadata, "account-a").enabled, false);
assert.equal(model.normalizeMetadata(inheritedMetadata, "account-a").revision, 0);
const forgedMetadataPrototype = { constructor: function Object() {} };
const forgedMetadata = Object.create(forgedMetadataPrototype);
Object.assign(forgedMetadata, { accountId: "account-a", enabled: true, revision: 42 });
assert.equal(model.normalizeMetadata(forgedMetadata, "account-a").enabled, false);
assert.equal(model.normalizeMetadata(forgedMetadata, "account-a").revision, 0);
const protoKeyMetadata = JSON.parse('{"accountId":"account-a","enabled":true,"__proto__":{"pending":true}}');
assert.equal(Object.prototype.toString.call(model.normalizeMetadata(protoKeyMetadata, "account-a")), "[object Object]");
assert.equal(Object.hasOwn(model.normalizeMetadata(protoKeyMetadata, "account-a"), "__proto__"), false);

const switched = model.normalizeMetadata({
  accountId: "account-a",
  enabled: true,
  revision: 8,
  localChecksum: LOCAL,
  remoteChecksum: LOCAL,
  status: "synced",
  lastSyncedAt: NOW
}, "account-b");
assert.equal(switched.accountId, "account-b");
assert.equal(switched.enabled, false);
assert.equal(switched.revision, 0);
assert.equal(switched.localChecksum, "");
assert.equal(switched.status, "disabled");

const enabled = model.normalizeMetadata({ accountId: "account-a", enabled: true }, "account-a");
const derivedDirty = model.normalizeMetadata({
  accountId: "account-a",
  enabled: true,
  localChecksum: LOCAL,
  remoteChecksum: REMOTE,
  status: "synced",
  pending: false,
  error: "stale"
}, "account-a");
assert.equal(derivedDirty.status, "pending");
assert.equal(derivedDirty.pending, true);
assert.equal(derivedDirty.error, "");
const derivedClean = model.normalizeMetadata({
  accountId: "account-a",
  enabled: true,
  localChecksum: LOCAL,
  remoteChecksum: LOCAL,
  status: "pending",
  pending: true,
  error: "stale"
}, "account-a");
assert.equal(derivedClean.status, "synced");
assert.equal(derivedClean.pending, false);
assert.equal(derivedClean.error, "");
const dirty = model.markLocalChange(enabled, LOCAL);
assert.equal(dirty.status, "pending");
assert.equal(dirty.pending, true);
assert.equal(dirty.localChecksum, LOCAL);
assert.equal(enabled.localChecksum, "", "Transitions must not mutate their input.");

const syncing = model.beginSync(dirty);
assert.equal(syncing.status, "syncing");
assert.equal(syncing.pending, true);

const pushed = model.completePush(syncing, {
  revision: 1,
  checksum: LOCAL,
  syncedAt: NOW
}, { expectedAccountId: "account-a" });
assert.equal(pushed.revision, 1);
assert.equal(pushed.localChecksum, LOCAL);
assert.equal(pushed.remoteChecksum, LOCAL);
assert.equal(pushed.status, "synced");
assert.equal(pushed.pending, false);
assert.equal(pushed.lastSyncedAt, NOW);

const noOp = model.markLocalChange(pushed, LOCAL);
assert.equal(noOp.status, "synced");
assert.equal(noOp.pending, false);
assert.equal(noOp.revision, 1);

const offline = model.markFailure(model.markLocalChange(pushed, REPLACEMENT), "Failed to fetch", {
  offline: true,
  expectedAccountId: "account-a"
});
assert.equal(offline.status, "pending");
assert.equal(offline.pending, true);
assert.equal(offline.localChecksum, REPLACEMENT);
assert.equal(offline.error, "Failed to fetch");

const conflicted = model.markConflict(
  model.markLocalChange(pushed, REPLACEMENT),
  { revision: 2, checksum: REMOTE, detectedAt: NOW },
  { expectedAccountId: "account-a" }
);
assert.equal(conflicted.status, "conflict");
assert.equal(conflicted.pending, true);
assert.equal(conflicted.localChecksum, REPLACEMENT, "A 409 must preserve the unsynced local checksum.");
assert.equal(conflicted.revision, 1, "A 409 must preserve the last accepted base revision.");
assert.deepEqual(JSON.parse(JSON.stringify(conflicted.conflict)), {
  revision: 2,
  checksum: REMOTE,
  detectedAt: NOW,
  code: "REVISION_CONFLICT"
});

const remoteDeleted = model.markConflict(
  model.markLocalChange(pushed, REPLACEMENT),
  { revision: 2, exists: false, checksum: null, detectedAt: NOW, code: "REMOTE_DELETED" },
  { expectedAccountId: "account-a" }
);
assert.deepEqual(JSON.parse(JSON.stringify(remoteDeleted.conflict)), {
  revision: 2,
  checksum: "",
  detectedAt: NOW,
  code: "REMOTE_DELETED",
  exists: false
});
assert.equal(remoteDeleted.localChecksum, REPLACEMENT, "A remote tombstone must not erase the unsynced local snapshot.");
assert.equal(model.markFailure(remoteDeleted, "offline", { expectedAccountId: "account-a", offline: true }).status, "conflict", "Ordinary failure handling must not clear a tombstone conflict.");
const rebuildingAfterDelete = model.beginSync(remoteDeleted, {
  resolveConflict: "keep-local",
  conflictRevision: 2,
  conflictChecksum: null,
  remoteRevision: 2,
  remoteChecksum: null,
  remoteExists: false,
  expectedAccountId: "account-a"
});
assert.equal(rebuildingAfterDelete.conflict.exists, false);
const rebuiltAfterDelete = model.completePush(rebuildingAfterDelete, {
  revision: 3,
  checksum: REPLACEMENT,
  syncedAt: NOW
}, {
  resolveConflict: "keep-local",
  conflictRevision: 2,
  conflictChecksum: null,
  expectedAccountId: "account-a"
});
assert.equal(rebuiltAfterDelete.status, "synced");
assert.equal(rebuiltAfterDelete.revision, 3);
assert.equal(rebuiltAfterDelete.remoteChecksum, REPLACEMENT);

const resetAgainstActiveRemote = model.markConflict(
  model.normalizeMetadata({
    accountId: "account-a",
    enabled: true,
    revision: 3,
    localChecksum: LOCAL,
    remoteChecksum: REMOTE,
    localResetPending: true
  }, "account-a"),
  { revision: 4, checksum: REMOTE, detectedAt: NOW, code: "LOCAL_RESET" },
  { expectedAccountId: "account-a" }
);
assert.equal(resetAgainstActiveRemote.conflict.code, "LOCAL_RESET", "An empty local reset must retain its explicit remote-restore/overwrite choice.");
const restoredAfterReset = model.completePull(resetAgainstActiveRemote, {
  revision: 4,
  checksum: REMOTE,
  schemaVersion: 1,
  syncedAt: NOW
}, {
  resolveConflict: "use-cloud",
  conflictRevision: 4,
  conflictChecksum: REMOTE,
  expectedAccountId: "account-a"
});
assert.equal(restoredAfterReset.localResetPending, false, "Restoring the active remote completes the local-reset boundary.");

assert.throws(
  () => model.completePull(conflicted, {
    revision: 2,
    checksum: REMOTE,
    schemaVersion: 1,
    syncedAt: NOW
  }, { expectedAccountId: "account-a" }),
  hasCode("UNRESOLVED_CONFLICT"),
  "A normal pull completion must not clear a conflict."
);
const useCloud = model.completePull(conflicted, {
  revision: 2,
  checksum: REMOTE,
  schemaVersion: 1,
  syncedAt: NOW
}, {
  resolveConflict: "use-cloud",
  conflictRevision: 2,
  conflictChecksum: REMOTE,
  expectedAccountId: "account-a"
});
assert.equal(useCloud.revision, 2);
assert.equal(useCloud.localChecksum, REMOTE);
assert.equal(useCloud.remoteChecksum, REMOTE);
assert.equal(useCloud.status, "synced");
assert.equal(useCloud.pending, false);
assert.equal(useCloud.conflict, null);

const keepingLocal = model.beginSync(conflicted, {
  resolveConflict: "keep-local",
  conflictRevision: 2,
  conflictChecksum: REMOTE,
  remoteRevision: 2,
  remoteChecksum: REMOTE
});
assert.equal(keepingLocal.revision, 1, "The accepted base revision must not advance before overwrite succeeds.");
assert.equal(keepingLocal.localChecksum, REPLACEMENT);
assert.equal(keepingLocal.remoteChecksum, LOCAL);
assert.equal(keepingLocal.status, "conflict");
assert.equal(keepingLocal.conflict.revision, 2);
assert.throws(
  () => model.completePush(keepingLocal, {
    revision: 3,
    checksum: REPLACEMENT,
    syncedAt: NOW
  }, { expectedAccountId: "account-a" }),
  hasCode("UNRESOLVED_CONFLICT"),
  "A normal push completion must not clear a conflict."
);
const keptLocal = model.completePush(keepingLocal, {
  revision: 3,
  checksum: REPLACEMENT,
  syncedAt: NOW
}, {
  resolveConflict: "keep-local",
  conflictRevision: 2,
  conflictChecksum: REMOTE,
  expectedAccountId: "account-a"
});
assert.equal(keptLocal.revision, 3);
assert.equal(keptLocal.localChecksum, REPLACEMENT);
assert.equal(keptLocal.remoteChecksum, REPLACEMENT);
assert.equal(keptLocal.status, "synced");

assert.throws(
  () => model.beginSync(conflicted, {
    resolveConflict: "keep-local",
    conflictRevision: 2,
    conflictChecksum: REMOTE,
    remoteRevision: 1,
    remoteChecksum: REMOTE
  }),
  hasCode("STALE_CONFLICT_RESOLUTION")
);
const NEWER_REMOTE = "4".repeat(64);
const refreshedKeepLocal = model.beginSync(conflicted, {
  resolveConflict: "keep-local",
  conflictRevision: 2,
  conflictChecksum: REMOTE,
  remoteRevision: 3,
  remoteChecksum: NEWER_REMOTE
});
assert.equal(refreshedKeepLocal.revision, 1);
assert.equal(refreshedKeepLocal.conflict.revision, 3);
assert.equal(refreshedKeepLocal.conflict.checksum, NEWER_REMOTE);
assert.equal(model.completePush(refreshedKeepLocal, {
  revision: 4,
  checksum: REPLACEMENT,
  syncedAt: NOW
}, {
  resolveConflict: "keep-local",
  conflictRevision: 3,
  conflictChecksum: NEWER_REMOTE,
  expectedAccountId: "account-a"
}).revision, 4);
assert.throws(
  () => model.completePull(conflicted, {
    revision: 2,
    checksum: REMOTE,
    schemaVersion: 1,
    syncedAt: NOW
  }, {
    resolveConflict: "use-cloud",
    conflictRevision: 2,
    conflictChecksum: LOCAL,
    expectedAccountId: "account-a"
  }),
  hasCode("STALE_CONFLICT_RESOLUTION")
);

const pullIntegrityConflict = model.completePull(pushed, {
  revision: 1,
  checksum: REMOTE,
  schemaVersion: 1,
  syncedAt: NOW
}, { expectedAccountId: "account-a" });
assert.equal(pullIntegrityConflict.status, "conflict");
assert.equal(pullIntegrityConflict.localChecksum, LOCAL);
assert.equal(pullIntegrityConflict.conflict.code, "INTEGRITY_CONFLICT");
assert.throws(
  () => model.completePush(pushed, { revision: 1, checksum: REMOTE, syncedAt: NOW }, { expectedAccountId: "account-a" }),
  hasCode("INTEGRITY_CONFLICT")
);

const beforeUnsupported = JSON.stringify(pushed);
assert.throws(
  () => model.completePull(pushed, {
    revision: 3,
    checksum: REMOTE,
    schemaVersion: model.SUPPORTED_SNAPSHOT_SCHEMA_VERSION + 1,
    syncedAt: NOW
  }, { expectedAccountId: "account-a" }),
  error => error?.code === "UNSUPPORTED_SCHEMA"
);
assert.equal(JSON.stringify(pushed), beforeUnsupported, "Rejected remote data must not change local metadata.");

const missingExpectedAccountCalls = [
  () => model.completePush(syncing, { revision: 1, checksum: LOCAL }),
  () => model.completePull(pushed, { revision: 1, checksum: LOCAL, schemaVersion: 1 }),
  () => model.markConflict(model.markLocalChange(pushed, REPLACEMENT), { revision: 2, checksum: REMOTE }),
  () => model.markFailure(model.markLocalChange(pushed, REPLACEMENT), "late failure")
];
missingExpectedAccountCalls.forEach(call => assert.throws(call, hasCode("EXPECTED_ACCOUNT_REQUIRED")));

const accountB = model.normalizeMetadata(pushed, "account-b");
assert.equal(accountB.accountId, "account-b");
assert.equal(accountB.enabled, false);
const staleTransitionCalls = [
  () => model.markLocalChange(accountB, REPLACEMENT, "account-a"),
  () => model.beginSync(accountB, { expectedAccountId: "account-a" }),
  () => model.completePush(accountB, { revision: 2, checksum: LOCAL }, { expectedAccountId: "account-a" }),
  () => model.completePull(accountB, { revision: 2, checksum: REMOTE, schemaVersion: 1 }, { expectedAccountId: "account-a" }),
  () => model.markConflict(accountB, { revision: 2, checksum: REMOTE }, { expectedAccountId: "account-a" }),
  () => model.markFailure(accountB, "late failure", { expectedAccountId: "account-a" })
];
staleTransitionCalls.forEach(call => assert.throws(call, hasCode("ACCOUNT_CHANGED")));
assert.throws(
  () => model.completePush(pushed, { revision: 2, checksum: LOCAL }, { expectedAccountId: "" }),
  hasCode("ACCOUNT_CHANGED"),
  "A completion arriving after sign-out must be rejected."
);
assert.deepEqual(JSON.parse(JSON.stringify(accountB)), {
  version: 1,
  accountId: "account-b",
  enabled: false,
  revision: 0,
  lastSyncedAt: "",
  localChecksum: "",
  remoteChecksum: "",
  status: "disabled",
  pending: false,
  conflict: null,
  error: "",
  localResetPending: false
});

const hashA = await model.snapshotChecksum({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] }, sha256);
const hashB = await model.snapshotChecksum({ list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 }, sha256);
assert.equal(hashA, hashB, "Object key order must not affect snapshot checksums.");
assert.match(hashA, /^[a-f0-9]{64}$/);
assert.notEqual(
  hashA,
  await model.snapshotChecksum({ z: 1, nested: { a: 1, b: 3 }, list: [{ x: 1, y: 2 }] }, sha256)
);
assert.equal(
  await model.snapshotChecksum({ list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 }),
  hashA,
  "The default Web Crypto implementation must match the injected Node adapter."
);
const byteDigest = await model.snapshotChecksum(
  { list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 },
  async value => new Uint8Array(createHash("sha256").update(value, "utf8").digest())
);
assert.equal(byteDigest, hashA);
assert.equal(model.serializeSnapshot({ z: 2, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":2}');
assert.equal(model.canonicalStringify({ z: 2, a: 1 }), '{"a":1,"z":2}');
let checksumInput = "";
await model.snapshotChecksum({ z: 2, a: 1 }, async value => {
  checksumInput = value;
  return sha256(value);
});
assert.equal(checksumInput, model.serializeSnapshot({ z: 2, a: 1 }));

const circular = {};
circular.self = circular;
const inheritedSnapshot = Object.create({ polluted: true });
inheritedSnapshot.value = 1;
const forgedPrototype = { constructor: function Object() {} };
const forgedPrototypeSnapshot = Object.create(forgedPrototype);
forgedPrototypeSnapshot.value = 1;
const inheritedToJsonPrototype = {
  constructor: Object,
  toJSON() { return { hidden: true }; }
};
const inheritedToJsonSnapshot = Object.create(inheritedToJsonPrototype);
inheritedToJsonSnapshot.value = 1;
const accessorArray = [];
Object.defineProperty(accessorArray, 0, { enumerable: true, get() { return 1; } });
accessorArray.length = 1;
const unsupportedSnapshots = [
  { value: Number.NaN },
  { value: Number.POSITIVE_INFINITY },
  { value: Number.NEGATIVE_INFINITY },
  { value: undefined },
  { list: [undefined] },
  { list: Array(1) },
  { value: 1n },
  circular,
  inheritedSnapshot,
  forgedPrototypeSnapshot,
  inheritedToJsonSnapshot,
  { list: accessorArray },
  JSON.parse('{"__proto__":{"polluted":true}}'),
  { value: new Date(NOW) },
  { value: { toJSON() { return "hidden"; } } },
  { value: "before\u0000after" },
  { value: "lone-high-\ud800" },
  { value: "lone-low-\udc00" },
  { ["key-\u0000"]: true },
  { ["key-\ud800"]: true },
  { ["key-\udc00"]: true }
];
for (const [index, snapshot] of unsupportedSnapshots.entries()) {
  await assert.rejects(
    model.snapshotChecksum(snapshot, sha256),
    hasCode("UNSUPPORTED_SNAPSHOT_VALUE"),
    `Unsupported snapshot fixture ${index} must be rejected.`
  );
}

const emojiKey = "动作\u{1f600}";
const emojiSnapshot = {
  [emojiKey]: "深蹲\u{1f3cb}\ufe0f\u200d\u2640\ufe0f",
  nested: ["\u2705", "\u{1f1e8}\u{1f1f3}"]
};
const serializedEmoji = model.serializeSnapshot(emojiSnapshot);
assert.deepEqual(JSON.parse(serializedEmoji), emojiSnapshot);
assert.ok(serializedEmoji.includes(JSON.stringify(emojiKey)));
assert.match(await model.snapshotChecksum(emojiSnapshot, sha256), /^[a-f0-9]{64}$/);

try {
  Object.defineProperty(Object.prototype, "toJSON", {
    configurable: true,
    value() { return { polluted: true }; }
  });
  await assert.rejects(model.snapshotChecksum({ value: 1 }, sha256), hasCode("UNSUPPORTED_SNAPSHOT_VALUE"));
} finally {
  delete Object.prototype.toJSON;
}

try {
  Object.defineProperty(Array.prototype, "toJSON", {
    configurable: true,
    value() { return ["polluted"]; }
  });
  await assert.rejects(model.snapshotChecksum({ list: [1] }, sha256), hasCode("UNSUPPORTED_SNAPSHOT_VALUE"));
} finally {
  delete Array.prototype.toJSON;
}

console.log("Cloud sync model tests passed.");
