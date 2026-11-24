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

- Use the managed Neon Auth user id from the verified session as the stable Clay principal.
- Never accept a user id from a record payload, URL, local storage or app caller as proof of identity.
- The Data API must receive the Auth SDK's current JWT on every request; the SDK owns token refresh and bearer transport.
- The records adapter checks that a session exists before issuing a query. PostgreSQL RLS independently enforces ownership.
- The existing provider-neutral contract exposes only `{ id, email }`; raw session and JWT objects stay inside the provider SDK.
- The existing Supabase controller's existing-account-only email-link behavior is not assumed to map one-for-one to Managed Neon Auth. Managed Auth supports email OTP and magic links, but the precise sign-in-only/no-implicit-sign-up policy and session subscription API must be verified against the installed Managed SDK before a Neon identity adapter is accepted.
- Managed Auth is available only in AWS regions and cannot be enabled on projects using IP Allow or Private Networking; region and network posture therefore need an explicit review before provider selection.
- Magic links are disabled by default. Email OTP and magic links are supported by Managed Auth, but production email delivery requires dedicated SMTP; the shared SMTP is only a getting-started path. Do not send a real email or configure a provider during this stage.
- The managed SDK is a fixed Better Auth wrapper, not a self-managed Better Auth server. It does not expose arbitrary plugins or custom server handlers. Its public browser API includes `getSession()`, `signIn.*` and `signOut()`, but the exact session subscription and sign-in-only policy must be proven before mapping the existing Supabase auth port.

## Data and authorization model

- Five private collections only: `products`, `hair`, `log`, `prefs`, `scents`.
- Tables use `user_id text`, because Neon Auth JWT `sub` is exposed as text by `auth.user_id()`; do not assume UUID identity.
- Authenticated Data API role receives SELECT only on the two tables and EXECUTE only on two narrowly scoped mutation functions.
- Anonymous role receives no grants.
- RLS filters every read by `auth.user_id() = user_id`; record reads also require the current collection generation.
- No direct table INSERT/UPDATE/DELETE grants. Mutations execute through security-definer functions with empty search_path, explicit schema-qualified objects, verified `auth.user_id()`, strict input validation and collection-row locking.
- The mutation functions retain optimistic concurrency, per-record versions, tombstones, clear-all generations and explicit conflict results.
- Do not expose owner/migration credentials to the browser or use a role with BYPASSRLS for user requests.

## Adapter

`apps/clay-sync/neon-records.js` implements the existing records port using the combined Neon Auth + Data API client. It is intentionally not imported by the Clay app. The caller must construct the SDK client with the target branch Auth URL and Data API URL after provisioning is approved. The adapter does not create projects, enable services, configure URLs, or store credentials.

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
2. Verify Managed Auth can enforce the desired account-creation policy; no implicit sign-up is accepted without an explicit product decision.
3. Confirm the SDK's supported session-state subscription or define a documented refresh-on-navigation strategy without relying on private SDK internals.
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
