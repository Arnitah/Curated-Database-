# Clay standalone Pages app

Configure Cloudflare Pages with this directory (`apps/clay-web`) as the project root, `npm run build` as the build command, and `dist` as the output directory. The Pages Functions live under this same project root.

This directory is the isolated build root for the Cloudflare Pages version of Clay. The source artifact remains `apps/clay.html` and is not edited by the build.

## Build

From this directory:

```sh
npm install
npm run build
```

The builder preserves the first `ii-engine` inline script, extracts the app script, rewrites its direct Web Storage references to the per-user namespace, and defers app execution until the authenticated bootstrap installs the host shim.

## Pages environment

Set these only after a dedicated Clay Neon branch and Pages project are separately approved and provisioned:

- `DATABASE_URL` — encrypted secret using the restricted `clay_app_runtime` role, never an owner URL.
- `CLAY_NEON_AUTH_BASE_URL` — public branch Managed Auth base URL.
- `CLAY_NEON_AUTH_JWKS_URL` — branch-specific JWKS URL.

No values are committed. The config endpoint exposes only the public Auth base URL; the database URL and JWKS URL remain server-side.

The Managed Auth branch must have Magic Link enabled and new-user registration disabled. Add the actual Pages production and preview origins to the branch trusted-domain allowlist only after those origins exist.

The Pages Function verifies EdDSA JWTs against the configured branch JWKS and issuer before constructing the Neon records adapter. Database RLS remains the final authorization boundary.
