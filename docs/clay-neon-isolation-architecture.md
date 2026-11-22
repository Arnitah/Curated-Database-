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

The application must depend on the existing provider-neutral ports in `apps/clay-sync/contracts.js`, not directly on Neon SDK objects, SQL rows, JWT claims or vendor-specific session shapes.

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

The current Clay reference auth controller supports existing-account-only email-link sign-in. Do not silently change that behavior to automatic account creation. Any account creation or account-linking UX must be a deliberate product decision.

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

The existing provider-neutral contract is the application boundary:

- Identity: `getState()`, `requestEmailSignIn(email)`, `signOut()`, `onStateChange(listener)`.
- Records: `readCollection(collection)`, `writeRecord(input)`, `deleteRecord(input)`, `clearCollection(input)`.
- Allow-listed collections: `products`, `hair`, `log`, `prefs`, `scents`.
- Snapshot shape: collection generation, revision and versioned records.
- Mutation outcomes: `applied`, `cleared`, `conflict`.

The existing Supabase SQL design is a useful semantic reference, not a drop-in Neon deployment. Preserve its useful concurrency behavior while replacing provider-specific auth helpers and adapter calls.

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
| D. Adapter | Neon identity and records adapters implementing existing ports | Contract suite passes; no vendor leakage |
| E. App integration | Opt-in sign-in and backend mode behind a feature flag | Browser/mobile regression passes; existing sync unchanged by default |
| F. Migration rehearsal | Preview/import/export/rollback on synthetic and then explicitly authorized test data | Counts, hashes, ownership and recovery verified |
| G. Release decision | Production readiness report | Separate explicit approval for provisioning, real-data import and cutover |

No stage is automatically authorized by completion of the prior stage.

## 12. Open decisions before provisioning

- Confirm the intended Clay hosting/release target and environment-origin list.
- Confirm data residency and select the Neon region after checking current availability.
- Complete Neon Auth vs external identity-provider evaluation.
- Select Data API vs trusted server-side PostgreSQL access.
- Confirm email delivery, OAuth and account recovery requirements.
- Confirm retention, export, deletion and backup objectives.
- Confirm plan limits, budget and production availability requirements.
- Confirm which local-only state is genuinely user-owned and should be exportable.

## 13. Official technical references

- [Neon project and branch model](https://neon.com/docs/get-started/signing-up) — project isolation and branch workflow.
- [Neon Auth architecture](https://neon.com/blog/neon-auth-branchable-identity-in-your-database) — managed identity stored in the project database and branch behavior.
- [Neon authentication flow](https://neon.com/docs/auth/authentication-flow) — JWT subject and RLS identity helpers.
- [Neon Data API access control](https://neon.com/docs/data-api/access-control) — GRANT and RLS requirements; no separate Data API permission layer.
- [Neon Data API](https://neon.com/blog/a-postgrest-compatible-data-api-now-on-neon) — REST access, JWT and RLS integration.

## 14. Decision record

**Accepted:** Separate Clay and Smart Butler data domains. Design a dedicated Clay Neon project.

**Recommended, not yet selected:** Neon Auth; Neon Data API or a server-side adapter; project branch topology described above.

**Not authorized:** Neon project/branch/database provisioning, credentials, auth activation, schema deployment, app wiring, deployment, real-user data access, account linking, migration, dual writes or cutover.

**Reason:** Establish a durable security and ownership boundary first, preserve the existing working Clay sync path, and validate the Neon-specific identity/RLS model before exposing any personal records to a new backend.

Last updated · ChatGPT · 22 November 2026.
