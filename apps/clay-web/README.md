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


## Reproducible build and function bundling

The app dependencies are pinned in `package.json` and committed in `package-lock.json`: `@neon/auth` 0.8.2, `@neondatabase/serverless` 1.2.1, `jose` 6.1.3, Vite 7.2.2 and Wrangler 4.166.0. The build runs the Vite static build and then `wrangler pages functions build` to compile the Pages Functions into a Worker bundle. CI verifies both outputs; this is a local build check, not a Pages deployment.

The CI build also starts a local Wrangler Pages preview without secrets and checks the static route, fail-closed Auth config response, missing-bearer rejection and cross-origin rejection. This does not exercise a live Auth provider or database.
