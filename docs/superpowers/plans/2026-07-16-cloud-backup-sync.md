# Cloud Backup And Multi-Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in automatic cloud backup and multi-device state synchronization with explicit conflict resolution, while preserving full local/offline use.

**Architecture:** The browser keeps localStorage as the immediate source of truth and synchronizes a validated whole-state snapshot through same-origin Node endpoints. The server derives the account from HttpOnly cookies and stores one revisioned snapshot per Supabase user through service-role-only RPCs. Compare-and-swap revisions prevent silent last-write-wins; offline changes remain local and retry later.

**Tech Stack:** Browser JavaScript, Node.js HTTP server, Supabase Postgres/RPC, localStorage, CDP multi-context smoke tests.

## Global Constraints

- Sync is opt-in and requires a signed-in account.
- GitHub Pages remains local-only and must not show a fake cloud-enable action.
- Authentication tokens and the Supabase service-role key never enter browser state, exports, logs, or responses.
- Canonical snapshot payload size is at most exactly 1,048,576 UTF-8 bytes; the HTTP envelope has a separate bounded overhead limit.
- GET, PUT, and DELETE require strict same-origin requests, authentication, IP and account rate limiting.
- All writes use `baseRevision`; stale writes return HTTP 409 and never overwrite silently.
- Conflict metadata cannot be cleared by ordinary pull/push completion; only explicit use-cloud or keep-local actions may resolve it, and every transition is bound to the current account ID.
- A revision identifies immutable content: the same revision with a different checksum is an integrity conflict.
- DELETE creates a content-free tombstone with an incremented revision; revisions never reset after deletion.
- The server recomputes canonical SHA-256 and rejects any checksum mismatch.
- Sync metadata uses a separate localStorage key and is excluded from manual JSON export.
- Logout, local reset, and cloud deletion are three distinct actions.
- TLS and provider-managed encryption at rest may be documented; do not claim end-to-end encryption.
- Without a real migrated Supabase project and public same-origin Node deployment, report local fake-backend verification only, not live cross-device availability.

## File Map

- `supabase/migrations/20260716_cloud_sync.sql`: revisioned snapshot table and service-role-only RPCs.
- `server/cloud-sync.js`: strict snapshot validation and Supabase RPC client.
- `server.js`: authenticated sync API routes, limits, and health capability.
- `public/cloud-sync-model.js`: pure sync metadata, checksum, and conflict state transitions.
- `public/app.js`: opt-in lifecycle, debounced push, foreground pull, offline queue, and conflict choices.
- `public/app/index.html`, `public/styles.css`: honest account-panel sync states and controls.
- `public/sw.js`: cache the model without intercepting API requests.
- `scripts/cloud-sync-test.mjs`: deterministic server/model tests.
- `scripts/smoke-test.mjs`: two-device browser behavior with a fake Supabase provider.
- `.env.example`, `render.yaml`, `README.md`, `public/privacy.html`, `public/terms.html`: deployment and privacy truth.

---

### Task 1: Build the pure sync model and tests

**Files:**
- Create: `public/cloud-sync-model.js`
- Create: `scripts/cloud-sync-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `CloudSyncModel.normalizeMetadata`, `snapshotChecksum`, `markLocalChange`, `beginSync`, `completePush`, `completePull`, `markConflict`, `markFailure`.

- [ ] **Step 1: Write failing deterministic tests**

Cover empty metadata, own-property/plain-object enforcement, account changes during every async transition, clean/dirty invariant derivation, same-checksum no-op, successful revision advance, same-revision/different-checksum integrity conflict, offline pending state, 409 conflict preserving the local checksum, ordinary completion being unable to clear conflict, explicit use-cloud resolution, explicit keep-local resolution at no older than the known conflict revision, and newer unsupported schema refusal. Hash tests cover browser Web Crypto, injected byte/string adapters, non-finite numbers, undefined, sparse arrays, cycles, BigInt, and prototype-polluted input.

- [ ] **Step 2: Prove tests fail**

Run: `node scripts/cloud-sync-test.mjs`

Expected: FAIL because the model is missing.

- [ ] **Step 3: Implement a versioned pure model**

Expose one browser/Node-compatible namespace with metadata shaped as:

```js
{
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
  error: ""
}
```

Use Web Crypto in the browser and `node:crypto` in tests through an injected SHA-256 adapter; canonicalize object keys before hashing.

- [ ] **Step 4: Add the test script and pass it**

Add `test:cloud-sync` to `package.json` and include it in `test:smoke`.

Expected: `Cloud sync model tests passed.`

### Task 2: Add revisioned Supabase storage and strict server validation

**Files:**
- Create: `supabase/migrations/20260716_cloud_sync.sql`
- Create: `server/cloud-sync.js`
- Create: `scripts/cloud-sync-server-test.mjs`

**Interfaces:**
- Consumes: authenticated `user.id`, `{baseRevision,schemaVersion,checksum,payload}`.
- Produces: `getSyncState`, `putSyncState`, `deleteSyncState`, `validateSyncPayload`.

- [ ] **Step 1: Write validator and compare-and-swap tests**

Test an exact outer envelope allow-list, schema version, arrays and record-count caps, string-length caps, checksum format and content, canonical UTF-8 payload at and above 1,048,576 bytes, safe-integer revisions, create at revision 0, update at matching revision, stale 409, tombstone delete at matching revision, and stale-device ABA prevention after delete and recreate.

- [ ] **Step 2: Write the migration**

Create `cloud_sync_states(user_id uuid primary key references auth.users(id) on delete cascade, revision bigint not null, schema_version integer, payload jsonb, checksum text, deleted_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null)`. Add a constraint requiring either a complete active snapshot or a content-free tombstone. Enable RLS; revoke table access from `PUBLIC`, `anon`, `authenticated`, and `service_role`. Implement `SECURITY DEFINER` get/put/delete RPCs with fixed `search_path`, fully qualified names, explicit revoke from default public/anon/authenticated execution, and execute granted only to `service_role`. Put/delete acquire a namespaced advisory lock and enforce `base_revision` atomically. DELETE increments revision and clears content; GET reports `exists:false` while retaining that revision; a later PUT must use the tombstone revision.

- [ ] **Step 3: Implement the server module**

Reuse the entitlement module's timeout and service-role fetch pattern but keep cloud-sync configuration independent from the entitlement feature switch. Never accept a user ID from request JSON. Recompute canonical SHA-256 on both inbound PUT and outbound GET data. Map validation or checksum mismatch to 422, size to 413, stale revisions to 409, unavailable configuration to 503, provider timeout to 504, malformed/unexpected provider data to 502, and other provider failure to 502. RPCs return structured conflict results; do not parse provider error messages.

- [ ] **Step 4: Pass server tests**

Run: `node scripts/cloud-sync-server-test.mjs`

Expected: validator and fake RPC tests pass without network access.

### Task 3: Expose authenticated same-origin APIs

**Files:**
- Modify: `server.js`
- Modify: `.env.example`, `render.yaml`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Produces: `GET`, `PUT`, `DELETE /api/account/sync-state`.

- [ ] **Step 1: Add failing HTTP security tests**

Assert unauthenticated requests return 401; cross-origin or same-site-subdomain GET/PUT/DELETE return 403; all methods have independent IP/account limits and `Retry-After`; malformed or checksum-mismatched payload returns 422; oversized raw envelope or canonical payload returns 413 including multi-byte UTF-8 boundaries; unconfigured server returns 503; provider timeout returns 504; malformed provider data returns 502; responses set `cache-control: no-store` and never expose tokens, anon key, service-role key, upstream messages, or request payloads.

- [ ] **Step 2: Add the routes**

Before authentication, require exact `Origin` match when present and accept only `Sec-Fetch-Site: same-origin`, a reasonable `none`, or a missing header for non-browser clients. Apply an IP limit, resolve the account with `resolveAccountUser(req)`, apply refreshed cookies, then apply an account limit and pass only `resolution.user.id` to the sync module. GET returns either an active snapshot or `{configured:true,exists:false,revision:<current tombstone revision>}`. PUT strictly accepts only `{baseRevision,schemaVersion,checksum,payload}`; DELETE only `{baseRevision}`. Extend body reading with a method-specific byte limit and distinguish invalid JSON, JSON `null`, and read failure. Place routes before the generic `/api/account/*` 405 branch and return `Allow: GET, PUT, DELETE` for unsupported methods.

- [ ] **Step 3: Extend health and configuration truth**

Add `cloudSyncConfigured` to `/api/health`. Document required Supabase URL, anon key, and service-role key; do not add secret values to tracked files. Enabling cloud sync must not implicitly enable entitlement/quota behavior unless its own schema and explicit feature configuration are present.

- [ ] **Step 4: Pass HTTP smoke tests**

Run: `npm.cmd run test:smoke`

Expected: all existing account and entitlement tests remain green.

### Task 4: Integrate opt-in local-first synchronization

**Files:**
- Modify: `public/app/index.html`, `public/app.js`, `public/styles.css`
- Modify: `public/sw.js`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: `CloudSyncModel`, account session, existing export/import normalization, sync APIs.
- Produces: `buildCloudSnapshot`, `enableCloudSync`, `pullCloudState`, `queueCloudPush`, `pushCloudState`, `resolveCloudConflict`.

- [ ] **Step 1: Add failing two-device flows**

Use two isolated browser contexts/localStorage stores with the same fake account. Verify device A opt-in and upload revision 1; device B pull and exact normalized restoration; B upload revision 2; A foreground pull; simultaneous edits causing one 409; both conflict choices; offline pending and online retry; signout preserving both local and cloud data.

- [ ] **Step 2: Build and validate cloud snapshots**

Reuse the JSON export allow-list and normalization but return an object, not a download. Before applying a remote payload, validate and normalize into a temporary value; replace live state only after success. Reject schema versions newer than the client without changing local data.

- [ ] **Step 3: Add local-first lifecycle**

Persist sync metadata under `what_to_drill_cloud_sync_v1`. Wrap existing state persistence with a debounced checksum-and-push trigger only when sync is enabled. Pull on login, startup, `online`, and visible foreground; skip uploads whose checksum equals the remote checksum. Network failure sets `pending=true` and leaves state fully usable.

- [ ] **Step 4: Add explicit conflict controls**

On 409, stop automatic writes and show two buttons: `使用云端版本` and `保留本机并覆盖`. The first fetches and applies the remote snapshot. The second refetches its revision then performs an explicit overwrite; it must not occur automatically.

- [ ] **Step 5: Add honest account-panel UI**

Show `未开启`, `同步中`, `已备份`, `离线待同步`, `有冲突`, or `同步失败`, plus enable/disable, sync now, conflict actions, and separately confirmed cloud deletion. On static hosting, hide enable controls and retain the existing “数据仅保存在这台设备” explanation.

- [ ] **Step 6: Pass two-device and offline smoke tests**

Run: `npm.cmd run test:smoke`

Expected: both devices converge when uncontested, conflicts never lose the local edit, and offline use remains functional.

### Task 5: Privacy, delivery, and final verification

**Files:**
- Modify: `README.md`, `public/privacy.html`, `public/terms.html`
- Modify: `public/app.js`, `public/app/index.html`, `public/sw.js`, `package.json`, `server.js`
- Test: all scripts

**Interfaces:**
- Produces: accurate user disclosures, fresh PWA assets, and acceptance evidence.

- [ ] **Step 1: Update product disclosures**

State which data is uploaded, why, how long it is retained, how deletion works, that provider/deployment administrators can technically access plaintext JSON, and that this is not end-to-end encrypted. Distinguish GitHub Pages local-only behavior from Node deployment sync.

- [ ] **Step 2: Set delivery version 1.23.0**

Set the app, package, and server default versions to `1.23.0`; set HTML and service-worker asset queries to `20260716-cloud-sync-v1`; set `CACHE_NAME` to `what-to-drill-shell-v20260716-cloud-sync-v1`. Cache `cloud-sync-model.js`; never cache or intercept `/api/account/sync-state`.

- [ ] **Step 3: Run the complete suite**

```powershell
npm.cmd run check
npm.cmd run test:workout-session
npm.cmd run test:training-rotation
npm.cmd run test:entitlements
npm.cmd run test:cloud-sync
node scripts/cloud-sync-server-test.mjs
npm.cmd run test:smoke
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Real-browser acceptance**

At desktop and 390px verify enable, sync-now, offline pending, conflict dialog, cloud delete confirmation, focus order, touch targets, no overflow, and zero console errors. Save screenshots under `output/playwright/` with `cloud-sync-desktop` and `cloud-sync-mobile` names.

- [ ] **Step 5: Commit and report deployment boundary**

Commit only intended files with message `Add revisioned cloud backup and sync`. Report code/fake-provider verification separately from live availability. Do not claim real cross-device completion until the migration and secrets exist on a public HTTPS Node deployment and two isolated real clients have passed the flow.
