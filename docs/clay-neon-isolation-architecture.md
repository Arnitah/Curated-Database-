# Clay dedicated Neon project — architecture decision and implementation blueprint

**Status:** Approved architecture direction; design only  
**Decision date:** 22 November 2026  
**Owner:** Clay  
**Repository baseline:** `main` at `fe7614034c7c599c9ac0cf04f6c86e4c82cd9652`  
**Related work:** [PR #16 — architecture baseline](https://github.com/Arnitah/Curated-Database-/pull/16) · [PR #17 — provider-neutral contracts](https://github.com/Arnitah/Curated-Database-/pull/17)  
**Scope boundary:** No Neon project, branch, database, credential, auth provider, application wiring, deployment, import or migration is created or changed by this document.

## 1. Decision

Clay and Smart Butler are separate products and separate data domains.

- Clay will have its own dedicated Neon project, provisioned only after the design and operational gates in this document are approved.
- Smart Butler retains its existing Neon project, `datachick`.
- No shared database, schema, role, credential, auth tenant, user table or implicit cross-product access.
- A future shared sign-in experience, if ever desired, must use an explicit identity federation/account-linking design. It must not create shared database ownership or silently merge product accounts.
- This decision does not authorize provisioning, app wiring, authentication activation, data transfer or migration.

The separation is a security and lifecycle boundary, not merely a naming convention. Each product must be independently deployable, recoverable, permissioned and capable of being retired without affecting the other.

## 2. Product and data boundaries

### Clay owns

- User-owned product shelf records and status.
- Hair profile and hair-care records.
- Personal logs and routine history.
- User preferences.
- Personal scent records.
- Future user-owned evidence annotations and saved product context, subject to explicit data classification.

### Clay does not own as transactional user data

- The shared skincare product catalogue and generated indexes.
- The curated ingredient registry, reviewed rules and evidence-source registry.
- Shared research datasets and source records maintained in GitHub / the Skincare Data Hub.

Those remain versioned, reviewed shared knowledge. Clay may consume them read-only through the existing build/bridge path. Do not bulk-copy shared catalogues into the personal-record database without a separately justified use case.

### Smart Butler owns

Its own application data, user identities, operational records and future integrations within `datachick`. Clay must not query or write those records.

## 3. Target logical architecture

```text
Clay browser application
  ├── Experience / screens
  ├── Application use cases
  ├── Ingredient Intelligence (deterministic, provider-neutral)
  ├── Identity port
  └── Personal-records port
          │
          ▼
  Dedicated Clay Neon project
  ├── Managed Auth candidate / verified JWT identity
  ├── PostgreSQL personal-record schema
  ├── Ownership enforcement with GRANT + RLS
  ├── Transactional mutation functions
  ├── Version / generation / tombstone semantics
  └── Isolated environment branches
          
Shared reference knowledge remains outside this database:
Skincare Data Hub → reviewed bridge/indexes → Clay read-only consumers

Smart Butler → separate datachick project (no Clay connection)
```

The application should depend on the provider-neutral ports proposed in PR #17 (apps/clay-sync/contracts.js), not directly on Neon SDK objects, SQL rows, JWT claims or vendor-specific session shapes. Important repository-state note: PR #17 is still open and unmerged, so this contract is a proposed dependency rather than code present on this document's base branch.

## 4. Neon project and environment topology

### Project boundary

Proposed project name: `clay` (subject to availability and naming confirmation at provisioning).

The project is the top-level isolation unit. It must not be created inside or as a branch of `datachick`. Select its region only after checking current Neon region availability, the user's data-residency requirements, latency to the expected user base, supported services and plan limits. Do not infer Clay's region from Smart Butler's existing project.

### Branch topology

| Environment | Purpose | Data policy |
|---|---|---|
| Production branch | Live Clay accounts and records, only after release approval | Real user data; tightly restricted |
| Staging branch | Release-candidate integration and acceptance | Synthetic accounts and synthetic records only |
| Development branches | Adapter, schema and feature development | Synthetic fixtures only |
| Migration/test branch | Validate schema changes and import tooling | Synthetic or explicitly anonymized fixtures only |

Neon branches copy database state from their parent. Because Neon Auth stores users, sessions and configuration in the database and branches that state too, never create a developer or staging branch from production and then assume it is safe. Build non-production branches from a schema-and-synthetic-seed baseline, or apply an independently tested scrub process before any access is granted. Do not put production sessions or real personal records in test branches.

Use schema migrations as the reproducible source of structure. Keep branch-specific environment variables and auth origins separate. Do not share production OAuth callback URLs, cookies, API endpoints or secrets with non-production environments.

## 5. Identity and authentication decision

### Preferred candidate to evaluate: Neon Auth

Neon Auth is the leading candidate because it stores identity/session state in the same project and supports branch-aware auth. It is not yet selected as the production identity provider.

Before selection, validate:

- Existing-account sign-in and account creation policy.
- Email verification, magic-link or passwordless flows and deliverability.
- Supported OAuth providers and redirect/callback behavior, if needed.
- Session lifecycle, revocation, expiry, sign-out and account deletion.
- User export and account recovery expectations.
- SDK compatibility with the current Clay app and its hosting environment.
- RLS identity claims and test coverage on the selected access path.
- Regional availability, service limits, pricing and support.

The reference auth controller proposed in PR #17 supports existing-account-only email-link sign-in. PR #17 remains open and unmerged; this is not yet an active Clay sign-in feature. Do not silently change the proposed behavior to automatic account creation. Any account creation or account-linking UX must be a deliberate product decision.

### Identity invariants

- The authenticated principal must come from a verified provider session or verified JWT.
- The legacy Claude artifact user id is not portable identity proof and must never authorize access to Neon.
- Never accept a caller-supplied user id as the authority for a write.
- Never expose a database owner, migration, service-role or unrestricted connection credential to browser code.
- The normalized identity port exposes only the minimal verified principal and signed-in/out state; no raw tokens or SDK session objects.
- Clay and Smart Butler accounts remain independent even if the same person uses both.

If Neon Auth fails the evaluation, an external identity provider may be considered with a documented JWT/JWKS and account-lifecycle design. That alternative still must preserve separate Clay project ownership.

## 6. Data access and authorization

Evaluate two supported access patterns against the same security requirements:

1. **Neon Data API + verified JWT + PostgreSQL RLS.** Suitable for browser access only when table privileges and RLS are correctly configured. Neon documents that the Data API delegates authorization to PostgreSQL GRANTs and RLS; the endpoint URL alone is not a security boundary.
2. **A trusted server-side adapter using a serverless PostgreSQL driver and verified JWT/RLS context.** Use when transactional operations, application orchestration or API shape justify a server boundary.

Do not implement both access paths by default. Choose the smallest path that passes the contract, security and operational tests.

### Required authorization model

- Separate migration/owner privileges from application runtime privileges.
- Runtime roles must not have `BYPASSRLS`, ownership privileges or permission to alter policies.
- Enable RLS on every user-owned table; default-deny access until explicit policies are installed.
- Policies must bind each row to the verified JWT subject using the selected Neon Auth/JWT helper, not a client-supplied uid.
- Apply least-privilege GRANTs as well as RLS. RLS does not replace table privileges.
- Security-definer functions, if used for transactional mutations, must pin a safe search path, validate all inputs, derive the principal from verified database auth context and expose only the minimum execution grants.
- Add negative tests for anonymous requests, forged user ids, cross-account reads/writes, stale JWTs, revoked sessions, unknown collections and privilege escalation.
- Keep owner credentials and migration secrets in a server-side secret manager / deployment environment, never in source control or browser bundles.

## 7. Persistence model and contract mapping

The provider-neutral contract proposed in PR #17 is the intended application boundary (subject to review and merge):

- Identity: `getState()`, `requestEmailSignIn(email)`, `signOut()`, `onStateChange(listener)`.
- Records: `readCollection(collection)`, `writeRecord(input)`, `deleteRecord(input)`, `clearCollection(input)`.
- Allow-listed collections: `products`, `hair`, `log`, `prefs`, `scents`.
- Snapshot shape: collection generation, revision and versioned records.
- Mutation outcomes: `applied`, `cleared`, `conflict`.

The Supabase SQL design and adapter work in the open PRs are reference semantics, not a selected production backend or a drop-in Neon deployment. Preserve their useful concurrency behavior while replacing provider-specific auth helpers and adapter calls.

### Required record semantics

- Stable record ids scoped to an authenticated user and allow-listed collection.
- Per-record monotonically increasing version.
- Collection generation and revision.
- Deletions represented by versioned tombstones.
- Clear-all increments generation; it does not blindly bulk-delete and permit stale clients to resurrect old records.
- Writes include expected generation and expected record version.
- Stale writes return explicit conflicts. Never silently retry as unconditional writes or overwrite the newer record.
- Tombstone compaction is prohibited until supported-device acknowledgement and retention semantics are designed.
- Payload validation, size limits and collection-specific schema evolution must be enforced at the server boundary.

A normalized relational design may use one collection metadata table and one record table as in the existing scaffold. Final DDL and indexes are a later implementation artifact and must be tested against actual query patterns before approval.

## 8. Application and shared-knowledge boundaries

- The Ingredient Intelligence engine remains deterministic, read-only and independent of the database vendor.
- Product directions, applicable warnings and source limitations retain precedence over generic ingredient-family screening.
- Shared product facts and research registries remain versioned in their current source-of-truth pipeline.
- Personal product identity, package verification, notes and routine records remain private user-owned records.
- Do not persist a derived screening verdict as authoritative truth unless a specific product requirement defines snapshot versioning, provenance and recomputation behavior.
- Keep the existing Claude artifact persistence path active until a later, explicit cutover decision. Do not run dual writes during this architecture phase.

## 9. Migration and account-linking plan (future phase only)

Migration is a user-visible, user-initiated operation. It must not occur on first sign-in or silently in the background.

1. Establish a verified Clay account in the new identity system.
2. Explain which legacy artifact account is being linked; require explicit confirmation.
3. Read the five known legacy documents only through an authorized export path.
4. Present a preview: record counts, collection names, validation failures, duplicates and unsupported fields.
5. Normalize and validate each record against the target schema without changing the source.
6. Import into an isolated test account/branch first; compare counts, stable ids and canonical payload hashes.
7. Require explicit confirmation before importing real personal records.
8. Verify per-user isolation, versions, tombstones, clear-all semantics and cross-device behavior.
9. Preserve the legacy source and a documented rollback window. Do not delete or disable it until recovery and parity have been demonstrated and the user approves cutover.
10. Provide an export and account-deletion path consistent with the final retention policy.

Local-only state such as travel page navigation and temporary UI state must not be swept into the migration. Classify each key deliberately and include only user-owned, useful, supported data.

## 10. Backup, recovery, operations and cost controls

Before production use, document and test:

- Neon restore and point-in-time recovery capabilities available on the selected plan, including retention limits and restore procedure.
- Schema migration ordering, forward-fix policy and tested rollback/restore path.
- Production access audit, secret rotation and incident response ownership.
- Connection pooling, compute sizing, scale-to-zero behavior and expected latency.
- Data export, account deletion and retention behavior.
- Monitoring for auth failures, RLS denials, conflict rates, sync failures, database capacity and unusual access patterns.
- Cost thresholds and alerts; do not select a higher plan or always-on compute without measured need.

## 11. Delivery sequence and gates

| Stage | Deliverable | Exit gate |
|---|---|---|
| A. Architecture | This decision and open-question register | Product separation approved; no provisioning |
| B. Provider spike | Neon Auth / external JWT and Data API / server adapter comparison | Synthetic auth and RLS tests pass; plan, region and SDK fit documented |
| C. Schema prototype | Neon-compatible DDL, functions and migrations on a disposable test environment | Concurrency, ownership, tombstone and clear-all tests pass |
| D. Adapter | Neon identity and records adapters implementing the PR #17 ports after that contract is reviewed and merged (or otherwise explicitly reconciled) | Contract suite passes; no vendor leakage |
| E. App integration | Opt-in sign-in and backend mode behind a feature flag | Browser/mobile regression passes; existing sync unchanged by default |
| F. Migration rehearsal | Preview/import/export/rollback on synthetic and then explicitly authorized test data | Counts, hashes, ownership and recovery verified |
| G. Release decision | Production readiness report | Separate explicit approval for provisioning, real-data import and cutover |

No stage is automatically authorized by completion of the prior stage.

## 12. Provider evaluation matrix and test protocol

The choices below are deliberately open. The evaluation should use synthetic accounts and records only, and should compare complete end-to-end behavior rather than selecting a service from feature checklists.

### Identity

| Candidate | Advantages to test | Risks / questions | Pass condition |
|---|---|---|---|
| Neon Auth in the dedicated Clay project | Project-local identity lifecycle; branch-aware development model; JWT claims can be evaluated directly with the database | Confirm current feature maturity, supported sign-in methods, email delivery, recovery/deletion/export, SDK fit, region/plan availability and safe branch workflow | Synthetic account lifecycle passes; JWT subject maps unambiguously to database principal; session revocation and account deletion behave as required |
| External OIDC/Auth provider | Decouples identity lifecycle from the database vendor; may provide mature account recovery and sign-in options | Adds provider configuration, JWT/JWKS validation, issuer/audience management, callback origins and another operational dependency | Only verified issuer/audience/signature claims establish identity; rotation, revocation/expiry and account deletion are tested; no client-supplied user id is trusted |

Do not choose Neon Auth solely because it is co-located with the database. Equally, do not add an external identity provider unless it materially improves lifecycle, compatibility or product requirements.

### Data access

| Candidate | Advantages to test | Risks / questions | Pass condition |
|---|---|---|---|
| Neon Data API + JWT + GRANT/RLS | Direct PostgreSQL-backed HTTP access; fewer application-server components; policy enforcement remains in PostgreSQL | Confirm current API availability/limits, supported JWT claim shape, function/RPC behavior, payload constraints, CORS/origins and operational fit | Anonymous and cross-user requests are denied; valid user can perform only allow-listed operations; mutation functions preserve atomic concurrency semantics; runtime role cannot bypass RLS |
| Trusted server-side adapter + PostgreSQL driver | Central place for validation, orchestration, rate limits and stable app-facing API; may fit transactional operations cleanly | Requires a verified server-side hosting target, secure secret handling, deployment/monitoring and explicit database auth context; a broad server credential could bypass user isolation | Server verifies JWT issuer/audience/signature, derives principal from verified claims, applies user-scoped DB context in each transaction, and cannot be tricked into cross-user access |

Do not expose a database-owner, migration or unrestricted service credential to the browser. A server-side adapter is not automatically safer: it must prove tenant isolation and must not use a broad credential without safely setting and enforcing the verified user context.

### Minimum synthetic evaluation suite

1. Anonymous read/write denied.
2. User A cannot read, modify, delete or clear User B's records, including by changing request payloads or ids.
3. Forged uid, altered JWT subject, wrong issuer/audience, expired token and revoked session are rejected.
4. Runtime role lacks BYPASSRLS, table ownership, policy-alteration and migration privileges.
5. Same-record concurrent writes produce one applied mutation and an explicit conflict, never silent last-write-wins.
6. Clear-all racing with an old-generation write cannot resurrect cleared records.
7. Tombstones remain visible to the synchronization contract and are not compacted prematurely.
8. All five allow-listed collections work; unknown collection names and malformed/oversized payloads are rejected.
9. Sign-out, account deletion, export and recovery behavior match the agreed product policy.
10. A clean synthetic non-production branch can be recreated from migrations and seed fixtures without production identity or personal data.

Record results, tested product versions, dates, limitations and failed cases. A candidate only passes when all required security and contract tests pass; a passing happy-path demo is insufficient.

## 13. Hosting and release-path verification

The repository README describes the current prototype distribution model as a Claude artifact with bundled data and a GitHub raw-data fallback; the exact live artifact version, canonical embedded source and republish procedure still require independent verification. The existing Clay Notion handoff lists [the Claude artifact](https://claude.ai/artifact/54Waeahtn8vBRU8LmHJnXL) as the prototype/review surface.
**Hosting decision update · 19 Nov 2026:** Nitah approved Cloudflare Pages Free as the provider for a separate hosted Clay web app. This is a provider/architecture decision only. No Cloudflare Pages project, deployment, production domain, preview URL, auth callback or runtime environment has been created or verified. A preparation branch was created but no files were changed or deployed. The connected Vercel inspection did not establish a Clay project; the known `datachick` mapping belongs to Smart Butler.
The separate hosted Clay app is therefore the selected direction, while the actual Cloudflare Pages project and exact preview/production origins remain unverified. The current repository app still contains Claude artifact-specific `window.claude.use('db')` and `window.claude.use('user')` integrations; it is not yet proven to run as a standalone Cloudflare Pages app. Confirm the hosted build and origin list before choosing OAuth callbacks, CORS allowlists, cookie domains or production secrets. This is a prerequisite to final auth wiring, not a reason to provision Neon now.
Treat Claude artifact publishing as the leading release-path hypothesis, not yet a verified production deployment contract. Confirm the canonical artifact and the process used to publish `apps/clay.html` plus its bundled data. Do not configure OAuth callbacks, CORS allowlists, cookie domains, webhook endpoints or production secrets until the artifact runtime's supported auth/network model and any separate web-hosting target are confirmed. This is a prerequisite to choosing an auth flow, not a reason to provision infrastructure now.

## 14. Repository dependency and review status

At the time of this review, PR #16 (architecture baseline), PR #17 (provider-neutral contract and Supabase reference adapter slice), and PR #18 (this Neon isolation architecture) are all open and unmerged. PRs #16 and #17 are based on main commit `c131b749806df193a35fc23b2ff8adde2ce63f24`; PR #18 is based on the later main commit `fe7614034c7c599c9ac0cf04f6c86e4c82cd9652`, which adds a daily Skincare Data Hub refresh. Their changed files are separate: #16 adds the architecture baseline, #17 changes the sync contracts/adapters/tests and backend note, and #18 adds this architecture document. This suggests a low-conflict merge path, but does not replace GitHub's conflict check after each merge.

PR #17's two CI jobs (`database-tests` and `clay-tests`) passed on code/test head `8682ba35c70c9de58a9d67ae5c4ca7be0a46eb82`; its only later commit `bbc1ec2` is documentation-only. PR #16 received a documentation correction at commit `02cf5855330f6b88b2b4724efc6add89913d2bdf`. PR #18 is documentation-only; no CI checks were scheduled for its docs-only change, and no reviewer comments or approvals were present at the time of inspection.

Recommended merge/reconciliation sequence (not an authorization to merge): review and merge #16 and #17 in either order after approval; then refresh PR #18 against the resulting main, verify its dependency statements against the merged contract and baseline, and run the final repository checks that apply. Keep #18 draft until that reconciliation is complete. Do not treat an open PR as an implemented production capability.

## 15. Open decisions before provisioning

- Confirm the intended Clay hosting/release target and environment-origin list.
- Confirm data residency and select the Neon region after checking current availability.
- Complete Neon Auth vs external identity-provider evaluation.
- Validate the Cloudflare Pages Functions runtime, Managed Auth JWT verification, transaction-scoped RLS claims and least-privilege database role on a synthetic Neon branch.
- Confirm email delivery, OAuth and account recovery requirements.
- Confirm retention, export, deletion and backup objectives.
- Confirm plan limits, budget and production availability requirements.
- Confirm which local-only state is genuinely user-owned and should be exportable.

## 16. Official technical references

- [Neon project and branch model](https://neon.com/docs/get-started/signing-up) — project isolation and branch workflow.
- [Neon Auth architecture](https://neon.com/blog/neon-auth-branchable-identity-in-your-database) — managed identity stored in the project database and branch behavior.
- [Neon authentication flow](https://neon.com/docs/auth/authentication-flow) — JWT subject and RLS identity helpers.
- [Neon Data API access control](https://neon.com/docs/data-api/access-control) — GRANT and RLS requirements; no separate Data API permission layer.
- [Neon Data API](https://neon.com/blog/a-postgrest-compatible-data-api-now-on-neon) — REST access, JWT and RLS integration.

## 17. Decision record

**Accepted:** Separate Clay and Smart Butler data domains. Design a dedicated Clay Neon project.

**Preferred implementation candidate (not provisioned or production-approved):** Managed Neon Auth with new-user registration disabled for email magic links; Cloudflare Pages Functions as the same-origin API; Neon serverless driver over HTTP; JWT verification against the branch's injected JWKS and issuer; transaction-scoped JWT claims for PostgreSQL RLS using a database role without `BYPASSRLS`. The Neon Data API is not preferred because the inspected Clay app does not currently use PostgREST or a Supabase database client.

**Not authorized:** Neon project/branch/database provisioning, credentials, auth activation, schema deployment, app wiring, deployment, real-user data access, account linking, migration, dual writes or cutover.

**Reason:** Establish a durable security and ownership boundary first, preserve the existing working Clay sync path, and validate the Neon-specific identity/RLS model before exposing any personal records to a new backend.

Last reviewed and updated · ChatGPT · 22 November 2026.


## 18. Runtime and identity review · 24 November 2026 · ChatGPT

### Repository evidence

A fresh read of `main` confirms that `apps/clay.html` is still a single-file Claude artifact app. Its persistence bootstrap calls `window.claude.use('db')` and `window.claude.use('user')`; if those host capabilities are absent it falls back to local-only mode. The inspected file has no Supabase client import or browser PostgREST calls. The Supabase auth and records adapters in `apps/clay-sync/` are provider reference implementations for the new contract, not proof that the running Clay app already uses a Supabase database client.

### Corrected data-access decision

The earlier Neon Data API direction is superseded. Current Neon guidance says to use Data API for an existing PostgREST / `supabase-js` database-client migration; new applications should query Postgres from a server-side handler or Function. The fact that a provider-neutral contract and a synthetic PostgREST-style adapter exist does not make Data API an existing runtime dependency.

Preferred candidate for the selected hosting direction:

1. **Frontend:** extract and adapt the current Clay UI into a standalone static web build for Cloudflare Pages. Preserve the current artifact path until a separately approved cutover.
2. **Same-origin API:** Cloudflare Pages Functions under `/api/clay/*` handle short CRUD/sync requests. Keep database credentials exclusively in encrypted Pages Function secrets; the browser never receives a database URL or database role credential.
3. **Identity:** Managed Neon Auth is the leading candidate. Its Magic Link settings expose an explicit `Allow New User Registration` control; setting this off gives existing-account-only email-link sign-in, matching the current Supabase reference adapter's `shouldCreateUser: false` intent. This must be validated on a disposable synthetic branch before acceptance.
4. **API authentication:** the browser obtains a short-lived Managed Auth session JWT and sends it as a bearer token to the same-origin Pages Function. The Function verifies signature with `NEON_AUTH_JWKS_URL` and issuer against `NEON_AUTH_BASE_URL`, then derives the principal only from the verified `sub` claim. Reject missing, malformed, expired, wrong-issuer and wrong-key tokens.
5. **Database access:** use `@neondatabase/serverless` over HTTP from the Pages Function. In one non-interactive transaction, set `request.jwt.claims` from the verified JWT payload and execute the user-scoped query or mutation. PostgreSQL RLS reads the transaction-local claims. Use a dedicated database role without `BYPASSRLS`; do not use `neondb_owner` as the runtime connection role.
6. **Data API:** do not enable it for this design unless a future product decision deliberately adopts a PostgREST/Supabase database client.

Cloudflare Pages Functions run on the Workers runtime and support encrypted secrets through the Function environment. This is technically compatible with the proposed server-side boundary, but no Pages project, binding, secret, deployment or origin has been created.

### Session lifecycle constraint

Managed Auth exposes documented `getSession()`, `signIn.magicLink()` and `signOut()` methods. The session JWT is short-lived (15 minutes); request a fresh token when making protected API calls rather than persisting it in local storage. The current Clay sync identity contract includes `onStateChange`; the vanilla single-file app must use only a documented SDK surface. If the SDK does not expose a supported vanilla subscription, implement and test a refresh-on-load, post-callback, sign-out and tab-focus strategy rather than depending on private store internals.

### Evidence and references checked 24 November 2026

- [Neon overview and provider selection](https://neon.com/docs/ai/skills/neon/SKILL.md) — Data API is for existing PostgREST / Supabase DB-client compatibility; new apps use handlers or Functions.
- [Neon Functions authentication](https://neon.com/docs/compute/functions/authentication) — verify Managed Auth JWTs against injected JWKS and issuer; derive identity from `sub`.
- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) — HTTP queries and non-interactive transactions work in serverless/edge environments.
- [Neon serverless driver JWT/RLS transactions](https://neon.com/docs/serverless/serverless-driver-configuration#using-transactions-with-jwt-self-verification) — set `request.jwt.claims` within a transaction; runtime role must not have `BYPASSRLS` and should not be `neondb_owner`.
- [Managed Neon Auth Magic Link](https://neon.com/docs/auth/guides/plugins/magic-link) — Magic Link can disable new-user registration through the `disable_sign_up` setting.
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/) and [bindings/secrets](https://developers.cloudflare.com/pages/functions/bindings/) — Pages Functions provide a server-side Worker runtime and encrypted environment secrets.

### Updated next sequence

1. Keep PR #19 as a draft synthetic Data API prototype; do not merge it. Its adapter and migration are not the selected target architecture.
2. Implement a Cloudflare Pages-compatible standalone build boundary and same-origin API adapter without touching the live Claude artifact.
3. Add a server-side JWT verification and Neon HTTP transaction/RLS spike with synthetic tokens and mocked database tests.
4. Validate the SQL against PostgreSQL 17 using the exact `request.jwt.claims` transaction pattern and a non-`BYPASSRLS` runtime role.
5. Only after code-level tests pass, request separate approval for a disposable Neon project/branch to verify real Managed Auth JWTs, sign-in-only behavior, and actual RLS. No provisioning is authorized by this design review.

**Authority boundary unchanged:** no Neon resource, Auth setting, credential, schema deployment, Cloudflare project, application cutover, real-user access or migration has been created or changed. Smart Butler remains untouched.

Last reviewed and updated · ChatGPT · 24 November 2026.
