# Clay × Neon implementation design

**Status:** implementation candidate; synthetic-only; not provisioned  
**Date:** 23 November 2026  
**Parent contract:** `apps/clay-sync/contracts.js` on `feat/clay-provider-neutral-sync-contract`

## Decision direction

Proceed with a candidate architecture of **Managed Neon Auth + Neon Data API + PostgreSQL RLS**, subject to the remaining authentication and hosting acceptance checks. This is a candidate implementation, not a production-provider approval.

Why this is the first candidate:
- Neon Auth issues JWTs whose `sub` identifies the managed-auth user.
- Neon Data API validates those JWTs and exposes the verified subject through `auth.user_id()`.
- The Data API is PostgREST-compatible and supports table queries plus RPC.
- The current Clay records adapter already has a narrow PostgREST-style query/RPC shape.
- The combined Neon SDK can keep session/JWT handling in the managed client instead of inventing a second token transport.

Official references:
- [Neon Auth and Data API architecture](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)
- [Neon Data API access control](https://neon.com/docs/data-api/access-control)
- [Neon Auth authentication flow](https://neon.com/docs/auth/authentication-flow)
- [Neon Auth email OTP](https://neon.com/docs/auth/guides/plugins/email-otp)
- [Neon SDK](https://github.com/neondatabase/neon-js)

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

## Environment design

| Environment | Source | Data policy | Purpose |
|---|---|---|---|
| Development | Dedicated dev project/branch | Synthetic identities and fixtures only | Adapter and schema work |
| Staging | Isolated branch/project from schema + synthetic seed | No copied production auth/session or user records | End-to-end auth and RLS verification |
| Production | Dedicated Clay project/branch | Real user data only after explicit migration approval | Future live Clay sync |
| Migration/test | Disposable synthetic baseline | Destroy after verification under approved cleanup | Import, rollback and concurrency tests |

Do not branch a production branch for testing unless a separately tested scrub process proves all copied user and auth state is removed. Prefer recreating environments from migrations and synthetic seed fixtures.

## Required gates before provisioning

1. Confirm Clay's actual hosting/runtime origin and whether it can load the required Neon SDK and complete Auth callback/session flow.
2. Verify Managed Auth can enforce the desired account-creation policy; no implicit sign-up is accepted without an explicit product decision.
3. Confirm the SDK's supported session-state subscription or define a documented refresh-on-navigation strategy without relying on private SDK internals.
4. Confirm AWS region availability and Canadian data-residency requirements, whether IP Allow/Private Networking is required, project plan/limits and custom SMTP.
5. Validate migration SQL and RLS with synthetic JWT identities, including anonymous denial, forged subject, cross-user read/write/delete/clear denial, direct table-write denial, malformed input, stale write conflict, clear/write race and tombstone behavior.
6. Confirm account export, deletion, retention, recovery and backup objectives.
7. Obtain separate explicit approval before creating any Neon project/branch, enabling Auth/Data API, configuring trusted domains or SMTP, or adding credentials.

## Explicit exclusions

No Neon project, branch, database, credential, Auth service, Data API, schema, application wiring, deployment, account linking, dual write, real-user data access, import or migration has been performed or authorized by this implementation branch.
