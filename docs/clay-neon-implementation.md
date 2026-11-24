# Clay × Neon implementation design

**Status:** synthetic-only Data API prototype; superseded by the 24 Nov 2026 runtime review; not approved for merge or provisioning  
**Date:** 23 November 2026  
**Parent contract:** `apps/clay-sync/contracts.js` on `feat/clay-provider-neutral-sync-contract`

## Decision direction

**Historical prototype only:** this branch implemented Managed Neon Auth + Neon Data API + PostgreSQL RLS as a synthetic compatibility experiment. After inspecting the actual Clay app and the current Neon architecture guidance on 24 Nov 2026, this is no longer the preferred data-access design. Do not merge this Data API adapter or enable the Data API for Clay on the basis of this prototype.

The current Clay artifact app uses Claude host database/user capabilities and local fallback; it does not currently use PostgREST or a Supabase database client. The Supabase adapters in this repository are reference implementations of the provider-neutral contract, not a live database-client dependency.

**Preferred replacement candidate:** Managed Neon Auth (Magic Link with new-user registration disabled) + Cloudflare Pages Functions as a same-origin API + `@neondatabase/serverless` HTTP transactions + JWT self-verification and transaction-scoped `request.jwt.claims` for PostgreSQL RLS. Use a runtime DB role without `BYPASSRLS`; never use `neondb_owner` for application requests.

Official references:
- [Neon architecture and provider-selection guidance](https://neon.com/docs/ai/skills/neon/SKILL.md)
- [Neon Functions JWT authentication](https://neon.com/docs/compute/functions/authentication)
- [Neon serverless driver HTTP and transactions](https://neon.com/docs/serverless/serverless-driver)
- [Neon JWT self-verification and RLS transactions](https://neon.com/docs/serverless/serverless-driver-configuration#using-transactions-with-jwt-self-verification)
- [Managed Neon Auth Magic Link and existing-account-only setting](https://neon.com/docs/auth/guides/plugins/magic-link)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)

## Identity design

- Use the managed Neon Auth user id from the verified session JWT `sub` as the stable Clay principal.
- Never accept a user id from a record payload, URL, local storage or app caller as proof of identity.
- The browser obtains a fresh short-lived user JWT through the documented Managed Auth client `token()` method (`data.token`) and sends it as a bearer token to the same-origin Cloudflare Pages Function. Use `getSession()` for the minimal identity projection; do not persist the JWT in local storage.
- The Pages Function verifies the JWT signature against the branch `NEON_AUTH_JWKS_URL`, checks the issuer against `NEON_AUTH_BASE_URL`, and derives identity only from the verified `sub`.
- The provider-neutral identity contract exposes only `{ id, email }`; raw session and JWT objects stay inside the identity adapter/API boundary.
- Managed Auth Magic Link supports an explicit `Allow New User Registration` setting. Set it off to preserve existing-account-only email-link sign-in; validate this setting on a disposable synthetic branch before accepting the provider.
- Managed Auth is available only in AWS regions and cannot be enabled on projects using IP Allow or Private Networking; region and network posture still require an explicit review.
- Magic links are disabled by default. Production email delivery requires dedicated SMTP; shared SMTP is only a getting-started path. Do not send a real email or configure a provider during this stage.
- The managed SDK is a fixed Better Auth wrapper, not a self-managed Better Auth server. Its documented vanilla client includes `getSession()`, `token()` (then `data.token`), `signIn.magicLink()` and `signOut()`. The new identity adapter uses only those public methods and refreshes state on load, after callback, on sign-out and when the tab regains focus; it does not depend on private store internals.

## Data and authorization model

- Five private collections only: `products`, `hair`, `log`, `prefs`, `scents`.
- Tables use `user_id text`; Managed Auth JWT subjects are text identifiers, not assumed UUIDs.
- The Pages Function uses `@neondatabase/serverless` over HTTP. Configure `CLAY_NEON_AUTH_JWKS_URL` and `CLAY_NEON_AUTH_BASE_URL` separately for Cloudflare Pages Preview and Production; Neon does not inject Neon Function variables into Cloudflare. Use `new URL(CLAY_NEON_AUTH_BASE_URL).origin` as the JWT issuer, and read these values plus encrypted `DATABASE_URL` from the Pages Function `context.env` (not `process.env`). Each read/write runs in one non-interactive transaction that first sets `request.jwt.claims` to the verified JWT payload using `set_config(..., true)`.
- RLS reads the current user from `current_setting('request.jwt.claims', true)::jsonb ->> 'sub'`. A missing or empty subject returns no rows and fails closed.
- The app connection uses a dedicated login role without `BYPASSRLS`, not `neondb_owner`. The runtime role may SELECT rows under RLS and EXECUTE the two scoped mutation functions, but receives no direct table INSERT/UPDATE/DELETE grants.
- Mutation functions are `SECURITY DEFINER` with an empty `search_path`, schema-qualified objects, strict input validation and collection-row locking. Their dedicated non-login owner must also have `NOBYPASSRLS`; FORCE ROW LEVEL SECURITY ensures table-owner access is not an accidental bypass.
- The two function paths retain optimistic concurrency, per-record versions, tombstones, clear-all generations and explicit conflict results.
- No database URL, login password, owner credential or migration credential reaches browser code.

## Adapter

The existing `apps/clay-sync/neon-records.js` is a Data API-only synthetic prototype and is not the selected runtime adapter. Keep it isolated; do not wire it into the Clay app or merge it as the next backend.

The replacement adapter should preserve the provider-neutral records contract but call a same-origin Pages Function endpoint. The server-side handler reads branch-specific `CLAY_NEON_AUTH_JWKS_URL` and `CLAY_NEON_AUTH_BASE_URL` values configured separately in the Cloudflare Pages Preview/Production environments (Neon does not inject Neon Function variables into Cloudflare), verifies the Managed Auth bearer JWT against that JWKS and issuer `new URL(CLAY_NEON_AUTH_BASE_URL).origin`, then creates the Neon HTTP query client from the encrypted `context.env.DATABASE_URL` secret, sets transaction-local JWT claims, and executes the collection read or mutation. The handler must never accept a caller-supplied owner id. Implement the function wrapper and tests with injected verification/database dependencies before adding real package/runtime configuration.

## Hosting dependency\n\nCloudflare Pages Free is the approved hosting direction for a separate hosted Clay app; this is not a claim that the project has been provisioned or deployed. The exact Pages project, preview and production origins remain unknown. The Claude artifact remains the prototype/review surface, and its `window.claude.use('db')` / `window.claude.use('user')` calls are not portable identity or database credentials. Keep the Neon adapter isolated until a standalone hosted build and its origin/callback behavior are verified.\n\n## Environment design

| Environment | Source | Data policy | Purpose |
|---|---|---|---|
| Development | Dedicated dev project/branch | Synthetic identities and fixtures only | Adapter and schema work |
| Staging | Isolated branch/project from schema + synthetic seed | No copied production auth/session or user records | End-to-end auth and RLS verification |
| Production | Dedicated Clay project/branch | Real user data only after explicit migration approval | Future live Clay sync |
| Migration/test | Disposable synthetic baseline | Destroy after verification under approved cleanup | Import, rollback and concurrency tests |

Do not branch a production branch for testing unless a separately tested scrub process proves all copied user and auth state is removed. Prefer recreating environments from migrations and synthetic seed fixtures.

## Required gates before provisioning

1. Confirm the actual Cloudflare Pages project, preview/production URLs and runtime origin. Cloudflare Pages Free was selected for the separate hosted Clay app on 19 Nov 2026, but no project or deployment has been created or verified. The current repository app still contains Claude artifact-specific database/user hooks, so confirm the standalone hosted build can load the Neon SDK and complete the Auth callback/session flow before wiring it.
2. Validate the Managed Auth Magic Link `Allow New User Registration` setting with new-user registration disabled; the documented setting matches the existing-account-only product requirement.
3. Confirm the vanilla SDK's documented session refresh/state behavior or implement a tested refresh-on-load, post-callback, sign-out and tab-focus strategy without private SDK internals.
4. Confirm AWS region availability and Canadian data-residency requirements, whether IP Allow/Private Networking is required, project plan/limits and custom SMTP.
5. Validate migration SQL and RLS with synthetic JWT identities, including anonymous denial, forged subject, cross-user read/write/delete/clear denial, direct table-write denial, malformed input, stale write conflict, clear/write race and tombstone behavior.
6. Confirm account export, deletion, retention, recovery and backup objectives.
7. Obtain separate explicit approval before creating any Neon project/branch, enabling Auth/Data API, configuring trusted domains or SMTP, or adding credentials.

## Explicit exclusions

No Neon project, branch, database, credential, Auth service, Data API, schema, application wiring, deployment, account linking, dual write, real-user data access, import or migration has been performed or authorized by this implementation branch.


## Architecture correction · 24 November 2026

This PR's Data API implementation is retained only as a synthetic technical experiment. It is not the selected Clay architecture and must not be merged as the next production adapter. Neon guidance reserves Data API for existing PostgREST/Supabase database-client compatibility; the inspected Clay runtime has no such client.

The preferred replacement is a same-origin Cloudflare Pages Function API. It verifies Managed Neon Auth JWTs against the branch JWKS and issuer, derives the user id from the verified JWT `sub`, and runs Neon serverless-driver HTTP transactions that set `request.jwt.claims` before accessing RLS-protected tables. The database runtime role must not have `BYPASSRLS` and must not be `neondb_owner`. Managed Neon Auth Magic Link has an explicit setting to disable new-user registration, preserving the existing-account-only email-link behavior.

The Data API migration and adapter in this PR use Data API-specific roles/helpers and therefore are not drop-in artifacts for the replacement architecture. Reuse the provider-neutral records contract and concurrency semantics, but implement a new server-side adapter and migration after the Cloudflare Pages app boundary is established.

No Neon project, branch, Auth setting, Data API, credentials, Cloudflare project, schema deployment or real-user data access was created or changed. This PR remains draft and held.

Sources checked 24 Nov 2026:
- https://neon.com/docs/ai/skills/neon/SKILL.md
- https://neon.com/docs/compute/functions/authentication
- https://neon.com/docs/serverless/serverless-driver
- https://neon.com/docs/serverless/serverless-driver-configuration#using-transactions-with-jwt-self-verification
- https://neon.com/docs/auth/guides/plugins/magic-link
- https://developers.cloudflare.com/pages/functions/
