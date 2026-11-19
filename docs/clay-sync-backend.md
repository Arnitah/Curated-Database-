# Clay external sync backend

Status: approved direction; implementation scaffold only. No cloud project has been created, no credentials have been added, and no user data has been migrated.

## Recommended provider: Supabase (managed PostgreSQL)

Supabase is the proposed small external backend because it provides PostgreSQL transactions, database functions callable through RPC, Supabase Auth, and Row Level Security. The browser uses a publishable key plus a Supabase Auth session; never put a service-role/secret key in Clay.

Official references:
- [Database functions](https://supabase.com/docs/guides/database/functions)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Transactions and batched writes](https://www.postgresql.org/docs/current/tutorial-transactions.html)

## Identity and privacy boundary

The existing Claude artifact user id is not a credential and must never be trusted as proof of identity by a new backend. Clay must authenticate independently with Supabase Auth (initial candidate: email OTP/magic link). Every row is keyed by `auth.uid()`; RLS limits reads to the signed-in user. Mutation RPCs verify `auth.uid()` server-side. No anonymous access and no service-role key in browser code.

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
