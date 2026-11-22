# Clay × Beauty Intelligence — Architecture Baseline

**Status:** Initial repository-backed discovery; review required before implementation  
**Date:** 22 November 2026  
**Baseline:** `main` at `c131b749806df193a35fc23b2ff8adde2ce63f24` (PR #15 squash merge)  
**Scope:** Clay application, Ingredient Intelligence, shared product/research data, user persistence and future database-provider decision

## Executive summary

Clay is a functioning, data-rich browser application with a growing set of tests and a useful deterministic Ingredient Intelligence module. Its architecture is still transitional: the main user experience remains a large HTML/JavaScript application; current personal-data sync is coupled to the Claude artifact runtime; and a separate Supabase migration path has been scaffolded but is not wired into the application.

The new Neon connection makes Neon a serious candidate for the future PostgreSQL layer. It is not yet an approved replacement. The durable choice is to define provider-neutral identity, persistence and domain interfaces first, then compare Neon against the existing Supabase scaffold against real requirements. No cloud project, credentials, production data or migration are part of this baseline.

## 1. What exists today

### 1.1 Product/application layer

- `apps/clay.html` is the canonical **repository source under test** (approximately 432 KB at this baseline). The root README describes it as the Clay app file, and `tests/clay/README.md` explicitly says the browser tests load `apps/clay.html`; the boot test expects the page title `Clay Web`.
- `apps/clay-web.html` is a second artifact (approximately 291 KB) and is not covered by the Clay browser test harness. Its relationship to the current published artifact remains unverified. The source repository alone does not establish which artifact is currently live or the release/publishing path.
- `apps/safe-batch.html` and `apps/scent-atlas.html` are separate applications in the same repository. They should not be folded into the Clay runtime merely because they share data infrastructure.
- The app's current local/offline cache uses browser `localStorage`. Product, hair, log, preferences and scent records are represented by separate keys.

**Finding:** the application boundary is currently a large single-file experience, not a set of independently deployable services. Refactor incrementally around explicit modules; do not start with a framework rewrite.

### 1.2 Personal-data persistence

The sync code in both files calls `window.claude.use('db')` and `window.claude.use('user')`, obtains the artifact user id from that runtime, and stores five documents under `data/users/<uid>/<key>`: `clay-products`, `clay-hair`, `clay-log`, `clay-prefs`, and `clay-scents`. The browser copy is retained as an offline cache.

The two artifacts are not equivalent. `apps/clay.html` tracks explicit empty intent and prevents an empty or missing local snapshot from replacing a non-empty remote document. `apps/clay-web.html` still uses a simpler timestamp-based whole-document sync without those safeguards. Both remain timestamp/whole-document based; neither has per-record versions, tombstones or transactional conflict resolution. If both artifacts are used by the same account, their different sync behavior could matter. Do not treat the older artifact as a safe migration or release target until its status is confirmed.

The main app's browser storage inventory includes `clay-products`, `clay-hair`, `clay-log`, `clay-scents`, `clay-am-tone`, `clay-web`, `clay-trip`, `clay-trip-tab`, `clay-trip-where`, `clay-mig-hato`, `clay-sync-ts`, and `clay-sync-empty-intent`. Five logical documents sync remotely; `clay-am-tone` is also represented inside the synced `clay-prefs` document. The remaining page/travel state and migration/sync metadata are local-only in the inspected code. Their future migration scope needs a deliberate product decision rather than an automatic copy of all localStorage keys.

**Finding:** the current live identity and persistence dependency is the Claude artifact runtime, not Supabase or Neon. The artifact uid must not be treated as a portable authentication credential or reused as proof of identity in a new backend.

### 1.3 Supabase scaffold already in the repository

The repository contains a substantial but isolated Supabase path:

- `supabase/migrations/20261119000000_clay_record_sync.sql`: per-user collections and per-record storage, generation/revision counters, optimistic concurrency, tombstones, clear-all generation changes, RLS and authenticated mutation RPCs.
- `apps/clay-sync/supabase-auth.js`: an authentication controller for existing-account email magic links.
- `apps/clay-sync/supabase-records.js`: a per-record adapter using authenticated reads and transactional RPCs.
- `supabase/tests/clay_record_sync.test.sql`: pgTAP coverage for ownership, stale writes, tombstones, clear-all, invalid inputs and unauthenticated writes.
- `tests/clay/supabase-auth.test.mjs` and `tests/clay/supabase-records.test.mjs`: synthetic adapter/controller tests.

The existing backend design note (`docs/clay-sync-backend.md`) explicitly states that no hosted Supabase project or credentials were provisioned, no real user data was migrated, and the adapter/auth slices are not wired into `apps/clay.html`. The current Claude artifact sync remains active.

**Finding:** this is valuable reusable engineering work, not a live backend. Keep it as a reference implementation and migration design input; do not assume it must be deployed unchanged.

### 1.4 Shared product facts and research data

The repository README distinguishes shared reference data from personal data:

- `data/clay/`, `data/safe-batch/` and `data/scents/` hold curated/shared datasets.
- `index/clay/products/` is built from the separate Skincare Data Hub.
- `scripts/bridge-hub.mjs` transforms hub facts into app-ready product indexes and ingredient facts.
- GitHub Actions validates data and versions, refreshes the Hub bridge daily, runs verdict regression checks and runs the weekly Scent Atlas checks.

The README's stated rule is that personal ratings, notes, logs, plans and profiles do not belong in shared public datasets.

**Finding:** retain a clear boundary between public/shared knowledge and private user-owned records. A database migration should not automatically move the public product catalogue or research registries into the transactional user database.

### 1.5 Ingredient Intelligence

- The deterministic engine lives in `apps/ingredient-intelligence/src/engine.js`.
- The Clay adapter lives in `apps/ingredient-intelligence/src/clay-adapter.js`.
- Canonical ingredient, pairing-rule and source data live in versioned JSON files.
- `apps/ingredient-intelligence/data/product.schema.json` describes a proposed product intelligence record.
- `apps/ingredient-intelligence/tools/bundle.mjs` generates the inline bundle consumed by the single-file app.
- The engine is read-only and explainable; product directions and applicable regulatory warnings take precedence over generic pairing advice.

**Finding:** keep the engine independent of the UI, database vendor and account system. Its inputs and outputs should be stable domain contracts, not database rows or UI-specific objects.

## 2. Current architecture map

```text
Skincare Data Hub ──daily bridge──> Shared product facts / indexes (GitHub)
                                         │
Curated research + reviewed rules ───────┤
                                         ▼
                                  Clay browser app
                              (large HTML / JS bundle)
                                  │             │
                             localStorage   Ingredient Intelligence
                                  │          (deterministic module)
                                  ▼
                         Claude artifact DB + user
                         (current active sync path)

Separate, not yet wired:
  Supabase Auth controller
  Supabase per-record adapter
  Supabase Postgres schema + RLS/RPC migration
  Synthetic JS and pgTAP tests
```

This diagram reflects source-code inspection, not a live cloud-account audit.

## 3. Target architecture direction

Use a modular application with explicit boundaries. Avoid microservices until independently scaling or releasing components becomes a demonstrated need.

1. **Experience layer:** Clay screens and other consumer apps. UI renders results; it does not own scientific rules or database conflict policy.
2. **Application layer:** use cases such as add product, verify product evidence, read shelf, update a routine and import existing records.
3. **Domain/intelligence layer:** product identity, ingredient normalization, evidence evaluation, routine analysis and explainable output. Deterministic logic remains provider-neutral.
4. **Identity boundary:** a verified authentication provider supplies the authenticated principal. Domain code does not trust a caller-supplied uid or a legacy artifact uid.
5. **Persistence boundary:** a provider-neutral repository/adapter contract for user-owned records, versions, tombstones, clear-all and conflict responses.
6. **Shared knowledge boundary:** curated public product facts, ingredient registry, evidence sources and reviewed rules remain independently versioned and traceable.
7. **Operations:** CI, schema migration tests, backups/restore, observability, release gates and documented rollback.

### Data ownership

| Data class | Authoritative source (current/proposed) | Initial direction |
|---|---|---|
| Shared product catalogue facts | Skincare Data Hub | Keep in Hub and generated read-only indexes initially |
| Ingredient identities and reviewed rules | Curated repository data | Keep versioned, reviewed and source-linked |
| Product identity/directions evidence | Product-level evidence record | Preserve source URL, market, variant and checked date |
| User shelf, routine, logs and preferences | Current artifact store; future authenticated database | Migrate only after explicit account linking and verified import |
| Derived intelligence results | Deterministic engine + versioned evidence | Recompute from known inputs; store snapshots only when there is a clear need |

## 4. Neon evaluation and migration posture

**Neon is the preferred candidate to evaluate, not yet a final provider decision.** Neon provides PostgreSQL and now offers managed authentication and a Data API as additional products. Its Auth offering is based on Better Auth and stores identity/session data in the Neon database; its Data API supports JWT-backed access and Postgres RLS. These capabilities may make Neon a viable integrated destination, but we must verify current product availability, SDK fit, plan limits, region, backup/restore and operational requirements before committing.

Relevant official references:
- [Neon — What's new with the Neon backend (10 Nov 2026)](https://neon.com/blog/whats-new-with-the-neon-backend)
- [Neon — New Neon Auth architecture (10 Dec 2025)](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)
- [Neon — PostgREST-compatible Data API](https://neon.com/blog/a-postgrest-compatible-data-api-now-on-neon)

Important compatibility point: the current Supabase migration uses Supabase-specific `auth.uid()`, grants and RPC conventions. PostgreSQL tables and much of the transactional design can be reused, but the authentication identity function, JWT verification path, client SDK and RLS policies must be deliberately adapted if Neon Auth or another identity provider is selected. Neon is not a drop-in replacement for the existing Supabase client.

### Migration principles

- Do not migrate until the target identity provider and authorization model are selected.
- Keep the current artifact store intact and readable during the migration window.
- Build a user-initiated export/import with preview counts, record validation and explicit confirmation.
- Use stable record ids, per-record versions, tombstones and explicit conflict handling.
- Test with synthetic accounts and non-production data first.
- Verify record counts, payload hashes, ownership isolation, deletion semantics and cross-device behavior.
- Preserve a rollback path; do not delete the old copy until parity and recovery have been demonstrated.
- Never expose database owner credentials, service-role keys or unrestricted connection strings in browser code.

## 5. Principal risks and technical debt

| Risk | Evidence / impact | Required response |
|---|---|---|
| Runtime coupling | Current sync calls `window.claude.use()` directly | Isolate behind auth and persistence ports before provider migration |
| Monolithic app | Main app is a large single HTML/JS file | Extract modules gradually with parity tests |
| Two app artifacts | `clay.html` and `clay-web.html` both exist | Confirm canonical app, release target and code-sharing strategy |
| Sync conflict model | Existing active path uses document timestamps | Do not carry this model into multi-device Postgres sync |
| Supabase/Neon divergence | Existing scaffold is Supabase-specific | Reuse domain semantics; adapt identity/RLS/SDK only after provider decision |
| No real migration evidence | No hosted backend or real-data import is recorded | Treat all adapter tests as synthetic until a controlled pilot |
| Data ownership ambiguity | Shared catalogue and private shelf coexist in one repo/app | Maintain separate source-of-truth and access policies |
| Release confidence | Clay test workflow is described as advisory | Decide separately which checks must block merges/releases |

## 6. Milestone 1 acceptance criteria

This baseline is ready for review when the following are confirmed:

- [ ] Canonical Clay application and release target identified (`clay.html` vs `clay-web.html`).
- [ ] Every user-data key and its read/write path documented.
- [ ] Shared datasets and their authoritative source documented.
- [ ] Existing Supabase scaffold mapped and its tests understood.
- [ ] Neon connection type and available capabilities confirmed without exposing credentials.
- [ ] Provider decision criteria agreed; no premature database migration.
- [ ] Target module boundaries and first end-to-end product journey agreed.
- [ ] Open technical risks ranked by data-loss, privacy, correctness and maintenance impact.

## 7. Next engineering slice

After reviewing this baseline, the next implementation is the **provider-neutral identity and persistence contract** in [PR #17](https://github.com/Arnitah/Curated-Database-/pull/17), not a live Neon migration. The contract defines the minimal verified principal, read collection, write record, delete record, clear collection, versioned snapshot, tombstone and conflict response. The existing Supabase adapters now implement and validate it with synthetic tests. The next slice is to close app/release and local-only data scope questions, then evaluate a Neon adapter behind the same contract.

No production configuration, database provisioning, real user data access, data migration, app runtime change or deployment is included in this document-only baseline.


## Discovery refinement · 22 Nov 2026

The repository and test harness clarify one part of the app ambiguity: `apps/clay.html` is the canonical source file currently covered by the Clay browser suite. This does **not** prove it is the live/published artifact. `apps/clay-web.html` is not covered by that suite and has an older whole-document timestamp sync path without the empty-state safeguards now present in `clay.html`.

The inspected `clay.html` storage keys and five remote documents are listed in section 1.2. The trip/page-state keys are not part of the five remote documents. Before designing import/export, decide which of these local-only records are meaningful user data versus disposable interface state. Do not blindly migrate all localStorage.

The provider-neutral contract implementation is proposed in [PR #17](https://github.com/Arnitah/Curated-Database-/pull/17), based on main commit `c131b749806df193a35fc23b2ff8adde2ce63f24`. It remains a draft pending CI and review. No app wiring, cloud access, Neon provisioning, real user data or migration has occurred.

Last updated · ChatGPT · 22 Nov 2026: clarified the canonical tested source versus the still-unverified live artifact, documented storage-key scope and the older Clay Web sync gap, and linked the provider-neutral contract PR.


## Neon public-capability review · 22 Nov 2026

This is a public-product review only; the user's Neon account/project has not yet been inspected.

- Neon announced its backend GA on 17 Sep 2026: Lakebase Postgres, Managed Better Auth, Functions, Object Storage and AI Gateway. Realtime is a separate beta feature (15 Oct 2026). Clay does not need to adopt every primitive; the first evaluation should stay focused on Postgres, identity, secure data access and recovery. Sources: [Neon backend GA](https://neon.com/blog/neon-backend-is-ga), [Neon Realtime beta](https://neon.com/blog/neon-now-has-realtime), [Neon backend update, 10 Nov 2026](https://neon.com/blog/whats-new-with-the-neon-backend).
- Managed Better Auth stores users, sessions and organizations in the `neon_auth` schema and branches that auth state with the database. Neon documents it as Better Auth-based, but not a drop-in replacement for a self-hosted Better Auth server: it requires Neon SDKs and does not currently support arbitrary Better Auth plugins or custom server-side handlers. This must be checked against Clay's account-linking and recovery needs before choosing it. Source: [Neon Auth architecture](https://neon.com/blog/neon-auth-branchable-identity-in-your-database).
- Neon Data API is PostgREST-compatible and uses JWT plus PostgreSQL RLS. Neon recommends the Data API or direct PostgreSQL RLS rather than the older Neon RLS/Authorize product. This is promising for a browser client, but the existing Supabase adapter's `.from()`, `.rpc()`, transactional functions and `auth.uid()` assumptions must be tested/mapped explicitly; compatibility at the HTTP/query layer is not proof of identical auth semantics. Source: [Neon Data API](https://neon.com/blog/a-postgrest-compatible-data-api-now-on-neon).
- Branching and point-in-time recovery are useful for isolated schema/migration tests and recovery investigations. A branch captures the parent branch's schema **and data**, not an empty database. If a parent contains personal data, use synthetic/schema-only data for testing; Neon documents anonymized branches as beta, so do not rely on that feature as the sole privacy control. Protected production branches can issue separate credentials to child branches, but credential isolation does not remove copied personal data. Retention and resource limits are plan/configuration-dependent; inspect the actual project settings before treating branches as a backup policy. Sources: [Neon branching workflows](https://neon.com/branching), [Neon branching and PITR guide](https://neon.com/blog/practical-guide-to-database-branching).
- The evaluation must still cover: account/identity lifecycle, JWT issuer/audience/claims and RLS policy mapping, transactional record RPC support, connection pooling, region/latency, quotas and costs, branch permissions, restore retention, and export/rollback. Do not put database-owner credentials in the browser.
- The Neon integration is not yet connected in this ChatGPT workspace, so no project, branch, auth configuration, schema, role, credential or billing settings have been inspected. A connection option has been presented to the user; project-specific review remains pending that connection.

Decision: Neon remains the preferred candidate to evaluate, not a selected provider. No Neon provisioning, schema changes, migration or deployment is authorized by this review.


## Connected Neon project audit · read-only · 22 Nov 2026

### Project mapping

The connected Neon organization contains one project: `datachick` (`delicate-dream-75946663`), PostgreSQL 18 in AWS `us-east-2`, on the Free plan. The project has a default `production` branch and a Vercel-created `vercel-dev` child branch.

The Vercel workspace exposes one project, `smart-butler`, with a production deployment in READY state and domains `smart-butler-two.vercel.app` and `smart-butler-datachick.vercel.app`. Its Neon integration has generated `DATABASE_URL` and `DATABASE_URL_UNPOOLED` variables for Development and Production. This establishes that the connected Neon project is wired to the Smart Butler Vercel project. It does **not** establish that it is the intended database for Clay.

### Production schema and identity model

The production database contains seven `public` tables: `users`, `sessions`, `login_attempts`, `requests`, `approvals`, `tasks`, and `calendar_events`. The schema is consistent with a server-backed assistant/workflow product. It includes custom identity/session structures (`users.password_hash`, `sessions.token_hash`, and login-attempt email/IP metadata), with task/calendar data and approval/request records.

No Clay-specific shelf, skincare product, routine, ingredient, or beauty-research tables were found. The Vercel-created `vercel-dev` branch currently has no application tables. No row data, emails, hashes, IP addresses, message bodies or other personal records were read; this audit inspected structure and access metadata only.

### Database security and operations observed

- Neon Auth is not enabled on either branch. Realtime is disabled on production.
- All seven application tables have Row Level Security disabled and there are no RLS policies.
- No application SQL functions or triggers were found.
- The only customer-created login role visible is `neondb_owner`; it can bypass RLS. The SQL inspection connection also ran as this role. The `PUBLIC` pseudo-role cannot select, insert, update or delete from `public.users`. No separate least-privilege application role was found.
- This appears designed around a server-side custom-auth model rather than direct client access. The Vercel application code was not inspected in this Neon audit, so the correctness of per-user authorization in its server queries is unverified. Do not expose the database connection to browser code.
- The default `production` branch and `vercel-dev` branch are both reported as unprotected. Project history retention is 21,600 seconds (6 hours); the branch logical-size limit is 1 GiB. Public connections are not blocked and the IP allow-list is empty. These settings are recorded for review, not changed.
- The project is Free-plan, with 0.25–2.0 CU default autoscaling. No pricing or capacity forecast was performed.
- Vercel environment metadata marks the Production `DATABASE_URL` and `DATABASE_URL_UNPOOLED` entries with `securityIssues: readable-secret`. Their values were not decrypted or retrieved. Verify that these credentials are stored as write-only Secrets under Vercel's current Config/Secret model, and rotate them if they have been readable to people who should not access database credentials. Sources: [Vercel Config and Secret types, 24 Aug 2026](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types), [Secret environment variable guidance](https://vercel.com/academy/optimize-your-vercel-account/sensitive-env-vars).

### Architecture recommendation

Keep `datachick` attached to Smart Butler unless the product owner explicitly decides to share its database with Clay. Do not wire the Clay repository or browser app to this database based on the available evidence. The existing database has a separate custom-auth model, no RLS policies, and no Clay domain tables. Reusing it would couple product identities and require a deliberately designed cross-product authorization boundary.

Preferred next decision: provision a **separate Clay Neon project** (only after explicit approval) with a clear project identity, isolated authentication, RLS-backed user data, a protected production branch, a synthetic-data development branch, an appropriately sized recovery window, and server-only credentials or a verified JWT/RLS client path. Keep shared product/ingredient reference datasets in the repository/data pipeline rather than copying them into transactional user storage by default.

No project, branch, role, endpoint, environment variable, authentication setting, table, policy, data row, migration or deployment was changed during this read-only audit.
