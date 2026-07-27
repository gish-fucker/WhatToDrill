# Release Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remote-deletion handling deterministic, align cloud-backup promises, and make package version 1.23.0 the release metadata source of truth.

**Architecture:** Keep local records and cloud-sync metadata independent. Resolve an accepted remote tombstone as a local, generation-guarded stop operation with no fallible network preflight; serialize destructive cloud operations behind the existing mutex and use revision CAS. Derive runtime and deployment versions from `package.json`, with a repository check preventing drift.

**Tech Stack:** Browser JavaScript, Node.js HTTP server, Supabase RPC adapter, GitHub Actions, GitHub Pages, Render Blueprint.

## Global Constraints

- Do not add product features.
- Preserve all unrelated tracked and untracked user files.
- GitHub Pages and Node without complete Supabase configuration remain local-only.
- Login never uploads records; cloud backup starts only after explicit opt-in.
- Local reset, stop sync, sign out, cloud deletion, and account deletion remain distinct operations.
- Do not claim real Supabase or two-device verification without performing it.

---

### Task 1: Remote deletion state transition

**Files:**
- Modify: `public/cloud-sync-model.js`
- Modify: `public/app.js`
- Test: `scripts/cloud-sync-test.mjs`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Produces: `CloudSyncModel.stopSync(metadata, remote, options)` returning disabled metadata with acknowledged revision, cleared remote checksum/conflict/error, and unchanged local checksum.
- Consumes: existing account expectation, operation mutex, generation guard, and revisioned DELETE API.

- [ ] Add failing model assertions for accepting a tombstone while preserving local checksum and account identity.
- [ ] Add browser assertions that acceptance persists disabled metadata, retains local storage, makes no extra sync API call, and stays disabled after delayed stale work settles.
- [ ] Implement the model transition and a browser helper that increments generation, clears timers, persists the disabled metadata, and leaves business data untouched.
- [ ] Resolve `REMOTE_DELETED/use-cloud` before network refresh; serialize cloud deletion after an in-flight PUT and issue DELETE directly with the latest acknowledged revision.
- [ ] Run `npm.cmd run test:cloud-sync` and focused full smoke until both race cases pass.

### Task 2: Product promise alignment

**Files:**
- Modify: `README.md`
- Modify: `public/privacy.html`
- Modify: `public/terms.html`
- Modify: `public/app/index.html`
- Modify: `public/app.js`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Produces: consistent deployment and operation boundaries across public documentation and in-app account/cloud help.

- [ ] Replace obsolete no-sync claims with the three deployment modes and explicit opt-in behavior.
- [ ] Document what browser storage, the Node server, Supabase Auth/database, and optional AI provider process.
- [ ] State retention/deletion semantics, remote tombstone local preservation, and that account deletion is not implemented in-app.
- [ ] Update privacy and terms effective dates to 2026-07-27.
- [ ] Add browser/static assertions for the required promises and distinct account/sign-out controls.

### Task 3: Version and brand source of truth

**Files:**
- Modify: `package.json`
- Modify: `server.js`
- Modify: `render.yaml`
- Modify: `.env.example`
- Modify: `public/app.js`
- Modify: `public/app/index.html`
- Modify: `public/sw.js`
- Create: `scripts/release-metadata-check.mjs`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Produces: package version as the runtime/page version and `npm.cmd run check:release-metadata` as the drift guard.

- [ ] Read `package.json` in `server.js` for health and startup version; remove duplicated APP_VERSION deployment values.
- [ ] Rename the Render service to `what-to-drill` and align README deployment examples.
- [ ] Update the service-worker cache identifier for this release and verify manifest has no independent app version.
- [ ] Inject the runtime version into served app HTML so the page display matches health metadata; keep static Pages display aligned through the checked package-version marker.
- [ ] Add a metadata check and include it in `npm.cmd run check`.

### Task 4: Release verification and delivery

**Files:** all task files above only.

- [ ] Run `npm.cmd run check`, `npm.cmd run test:cloud-sync`, and `npm.cmd run test:cloud-sync-server`.
- [ ] Run `npm.cmd run test:smoke` twice consecutively without changes between runs.
- [ ] Review `git status` and `git diff --check`; stage only task files and create one clear release-fix commit.
- [ ] Fast-forward local `main`, push `main`, verify the GitHub Pages workflow, and browser-check the public home and app including console errors and version/copy boundaries.
- [ ] Report the commit SHA, workflow URL, exact test outcomes, and the unverified real Supabase/two-device boundary.
