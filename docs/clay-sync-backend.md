# Clay external sync backend

Status: Supabase reference implementation only; no production provider has been selected. No cloud project has been created, no credentials have been added, and no user data has been migrated.

## Original scaffold provider: Supabase (reference implementation)

Supabase was used for the first reference scaffold because it provides PostgreSQL transactions, database functions callable through RPC, Supabase Auth, and Row Level Security. This does not select Supabase as Clay's production backend. If this adapter is ever used, the browser must use a publishable key plus a Supabase Auth session; never put a service-role/secret key in Clay.

Official references:
- [Database functions](https://supabase.com/docs/guides/database/functions)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Transactions and batched writes](https://www.postgresql.org/docs/current/tutorial-transactions.html)

## Identity and privacy boundary

The existing Claude artifact user id is not a credential and must never be trusted as proof of identity by a new backend. Clay must authenticate independently with the selected provider. In this Supabase reference implementation, that means Supabase Auth (existing-account email OTP/magic link), rows keyed by `auth.uid()`, RLS scoped to the signed-in user, and mutation RPCs verifying `auth.uid()` server-side. A Neon implementation must deliberately replace those provider-specific assumptions with verified Neon Auth/JWT claims and equivalent PostgreSQL ownership enforcement. No anonymous access and no database-owner/service key in browser code.

## Data model

- `clay_sync_collections`: one row per user and collection, with a monotonically increasing generation and revision.
- `clay_sync_records`: one row per user, collection and stable record id, with generation, per-record version, payload, and optional deletion timestamp.
- Existing collection names are allow-listed: products, hair, log, prefs, scents.

## Concurrency and deletion semantics

- Each record write calls `clay_sync_apply_record` with the generation and record version last read. The SQL function locks the collection row, verifies generation and record version, then applies the mutation and increments revision in one transaction. Stale writes return a conflict; clients must fetch and resolve rather than silently overwrite.
- A record deletion writes a tombstone, not a physical delete. Tombstones remain until a later, explicit compaction policy proves all supported devices have advanced beyond them.
- Clear-all calls `clay_sync_clear_collection`. It locks the same collection row and increments generation. Records from older generations become invisible without a destructive bulk delete. A racing old-generation write is rejected.
- Different record ids can be updated independently. Two devices editing the same record conflict instead of silently losing one edit.
- The collection lock serializes writes within one user's collection. This is intentionally conservative and appropriate for a personal shelf.

## Migration and rollout

1. Create a Supabase project and configure Auth.
2. Apply the migration in `supabase/migrations/` and run the pgTAP test in `supabase/tests/`.
3. Add only the Supabase project URL and publishable key to the client configuration. No secret key goes to the browser.
4. Add explicit Supabase sign-in and account-linking UX. Do not infer a Supabase identity from the Claude artifact uid.
5. Add a user-triggered one-time import from the existing five artifact documents. Preview counts first; require confirmation; never overwrite existing remote records automatically.
6. Verify read/write isolation and cross-device sync with synthetic accounts before moving the real shelf.
7. Keep the current artifact sync read-only during migration, then retire it only after successful parity checks and a rollback window.

## Current limitations / next implementation tasks

- This scaffold does not yet include the browser Supabase client, auth UI, realtime/polling adapter, import flow, deployment config, or real account migration.
- A same-record conflict is rejected safely; UI resolution (reload/compare/choose) must be implemented before multi-device editing is enabled.
- Offline edits should queue locally with base generation/version. On reconnect, apply sequentially; conflicts must be surfaced, never retried as unconditional writes.
- Do not compact tombstones until retention/acknowledgement semantics for all active devices are implemented.
- No backend is provisioned and no data has left the existing Claude artifact store.


## Database validation gate · 18 Nov 2026

- The records SELECT policy must enforce both ownership and equality with the current collection generation. This makes pre-clear records invisible through direct authenticated reads, not merely through client-side filtering. Current-generation tombstones remain readable so clients can learn about deletions.
- Both mutation RPCs explicitly reject a NULL collection argument; SQL three-valued logic otherwise allows a NULL value to bypass a simple `NOT IN` guard.
- The pgTAP suite now covers current-generation visibility, old-generation invisibility, NULL/unknown collection rejection, invalid payload rejection, and missing authenticated identity in addition to stale writes, tombstones, clear-all, and cross-user read isolation.
- Local validation is automated by `.github/workflows/clay-tests.yml` (the existing pull-request workflow's `database-tests` job): start the local Supabase stack, run `supabase test db`, and run `supabase db lint --fail-on error`. The workflow has no hosted-project credentials and does not link to or mutate a remote Supabase project.
- Run locally with `supabase start`, `supabase test db`, and `supabase db lint --fail-on error`. Stop the local stack with `supabase stop`.
- This gate validates the migration and database policies only. It does not authorize project provisioning, real-data import, production deployment, or PR merge.

## Browser adapter implementation slice · 19 Nov 2026

- (ChatGPT · 2026-11-19) Started the first application-side integration slice on branch `feat/clay-supabase-record-adapter`, based on merged main commit [bb6c60c](https://github.com/Arnitah/Curated-Database-/commit/bb6c60c312f8e07bb289bbf857b4721b945319ca).
- Added an isolated browser-compatible adapter at `apps/clay-sync/supabase-records.js`. It requires a Supabase Auth user before every operation, accepts no caller-supplied uid, reads only the current collection generation, preserves per-record versions and tombstones, and sends writes/deletes/clear-all through the existing transactional RPCs.
- The adapter deliberately returns stale-generation/record conflicts unchanged. It does not silently retry, overwrite, infer identity from the Claude artifact account, or queue offline edits.
- Added synthetic unit tests for authenticated reads, empty collections, generation filtering, per-record version forwarding, tombstone deletion, clear-all, unauthenticated denial, invalid input and conflict propagation.
- This is an isolated adapter and test slice, not yet wired into `apps/clay.html`; no Supabase SDK, URL, publishable key, auth UI, cloud project, or real shelf data is present. Existing Claude artifact sync remains the active path. No deployment or data migration.
- Next: validate this slice in CI; then design the explicit sign-in/account-linking state and connect the adapter behind an opt-in backend mode. Do not switch or import real shelf data until the user signs in and separately confirms a previewed import.

## Email authentication controller slice · 19 Nov 2026

- (ChatGPT · 2026-11-19) Added `apps/clay-sync/supabase-auth.js` on branch `feat/clay-supabase-email-auth`, based on the validated record-adapter branch.
- The controller delegates identity to Supabase Auth, reports only a minimal verified user id/email state, supports email magic-link sign-in for existing accounts only (`shouldCreateUser: false`), supports sign-out, and exposes a minimal auth-state subscription with unsubscribe.
- No external uid can be supplied, no account is implicitly created, no token/session secret is exposed, and no Supabase project URL or publishable key is embedded.
- Added synthetic tests for signed-in/out state, minimal user projection, normalized email OTP, invalid email rejection, service errors, sign-out, subscription lifecycle and invalid client interfaces.
- This is still an unconnected controller: no sign-in UI, callback/deep-link setup, Supabase SDK dependency, environment configuration, hosted project, deployment or real data migration. Existing artifact sync remains active.
- Next: validate CI; then add an opt-in auth panel and a configuration contract only after the user provisions a Supabase project and supplies its project URL and publishable key through an appropriate secure client configuration. Do not create an account or initiate an email to the user without their direct action.


## CI runner isolation · 19 Nov 2026

- The local Supabase database test job assigns run-specific API, database, shadow and Studio ports before starting its Docker stack. This prevents concurrent workflow runs from colliding on the default local ports; it changes CI runtime configuration only, not any hosted or production project.


## Provider-neutral application contract · 22 Nov 2026

The provider decision remains open. The initial shared application boundary now lives in `apps/clay-sync/contracts.js`:

- Identity port: `getState()`, `requestEmailSignIn(email)`, `signOut()`, and `onStateChange(listener)`. The normalized state exposes only `signed_in | signed_out` and a minimal verified principal `{ id, email }`; it never exposes raw tokens or SDK session objects.
- Records port: `readCollection(collection)`, `writeRecord(input)`, `deleteRecord(input)`, and `clearCollection(input)`.
- The five allow-listed collections remain `products`, `hair`, `log`, `prefs`, and `scents`.
- Read results normalize to a collection generation/revision and versioned records. Deletions remain explicit tombstones. Mutations return `applied`, `cleared`, or `conflict`; a conflict is never silently retried.
- Provider adapters must derive the authenticated principal from their verified session and enforce ownership remotely. A caller-supplied uid, legacy artifact uid, client-side filter or browser-held database-owner credential is not an authorization boundary.

The existing Supabase auth and records adapters implement these contracts and validate their normalized outputs. This is still an isolated adapter/test slice: it does not connect to the app, select Supabase, connect Neon, provision a backend, or migrate user data.

Tests: `tests/clay/sync-contract.test.mjs`, `tests/clay/supabase-auth.test.mjs`, and `tests/clay/supabase-records.test.mjs`. They use synthetic identities and records only.
