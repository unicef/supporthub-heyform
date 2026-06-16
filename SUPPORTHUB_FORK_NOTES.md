# SupportHub Fork Notes

Implementation notes for the SupportHub ↔ heyform integration. This `supporthub-fork`
branch adds SSO/provision endpoints, an SSO-only auth mode, and a FerretDB-pointed
Mongo URI so heyform runs on Postgres (no MongoDB).

## Branch

`supporthub-fork` off `next@6f8cdc7`.

---

## Database — FerretDB (Postgres, no MongoDB)

heyform's Mongoose layer runs unmodified against **FerretDB** (Mongo wire protocol on
Postgres/DocumentDB). No query changes were needed — heyform uses no transactions, only
standard aggregation stages (`$match/$group/$unwind/$sort/$limit/$project` with
`$push/$slice/$subtract/$avg/$sum`), and no `$text` search.

Connection nuances:
- Credentials go via `MONGO_USER` / `MONGO_PASSWORD` (the driver negotiates **SCRAM-SHA-256**;
  `authMechanism=PLAIN` is unavailable on FerretDB 2.x).
- The URI needs `directConnection=true` (single node, no replica set).
- The eval image (`ghcr.io/ferretdb/ferretdb-eval:2`) requires `POSTGRES_PASSWORD`.

Example: `MONGO_URI=mongodb://ferretdb:27017/heyform?authMechanism=SCRAM-SHA-256&directConnection=true`,
`MONGO_USER=postgres`, `MONGO_PASSWORD=<pg password>`.

---

## Handoff JWTs

All three SupportHub endpoints consume JWTs signed **HS256** with `HEYFORM_SSO_SECRET`
(≥32 bytes, independent of heyform's `SESSION_KEY`). Each is short-lived (exp ≤ 60s) and
carries a `jti`. Roles, team/project scope, and the `dest` allowlist are pinned
server-side — never trusted from the JWT body.

### Provision JWT — `POST /api/provision` body `{ "token": "<jwt>" }`

Claims: `{ tenantRef, tenantName, domain, admins: [{ remoteId, displayName? }], exp, jti }`.

Creates-or-reuses a Team (owner = first admin's heyform userId), a default Project, and one
heyform User per admin (synthetic email `admin+<remoteId>@heyform.local`, locked password;
team role pinned to `ADMIN`). **Idempotent by input** — re-sending the same admins returns
the same IDs (keyed on the synthetic email + owner-team reuse); no duplicate teams/projects/users.

Response: `{ "teamId": "<id>", "projectId": "<id>", "adminUserIds": { "<remoteId>": "<heyformUserId>" } }`.

### Forms-list JWT — `GET /api/provision/forms?token=<jwt>`

Claims: `{ tenantRef, teamId, projectId, exp, jti }`. Scope comes **purely from the signed
`projectId` claim** (no query-param projectId). Read-only — short TTL bounds replay, no
single-use jti.

Response: `[{ "id": "<formId>", "name": "<name>", "active": <bool> }]` for the project's
`NORMAL` forms. Bypasses the GraphQL `@Auth()`/`@ProjectGuard()` stack.

### SSO JWT — `GET /sso?token=<jwt>&dest=<path>`

Claims: `{ sub, exp, jti }` where `sub` is the heyform userId. `dest` is a **query param**,
not a claim. Single-use `jti` (Redis `SET sso:jti:<jti> 1 NX EX 60`) — replay → 400.
Unknown `sub` → 503 (not 401, to avoid a re-provision loop).

Mints a heyform **cookie session** (`HEYFORM_SESSION` + `HEYFORM_LOGGED_IN` +
`HEYFORM_DEVICE_ID`, attrs pinned) via `authService.login`, then 302s to `dest`.

`dest` allowlist (server-enforced regex):
- `^/$`
- `^/workspace/[A-Za-z0-9_-]+/project/[A-Za-z0-9_-]+$`  (create — project page)
- `^/workspace/[A-Za-z0-9_-]+/project/[A-Za-z0-9_-]+/form/[A-Za-z0-9_-]+/submissions$`  (view results)

**deviceId (C1):** the SSO endpoint reuses an incoming `HEYFORM_DEVICE_ID` cookie if present
(else mints one) and pins the session to it — it never derives the id from `sub`. The webapp's
`getDeviceId()` was patched to trust the server-set cookie over a stale `localStorage` id, so a
returning browser does not 403. token-in-URL: `/sso` does not log the full URL/token, and the
302 `dest` carries no token.

---

## SSO-only mode — `HEYFORM_SSO_ONLY`

When truthy, native heyform authentication is unreachable. The **enforced** guarantee is a
single Express-layer choke point (`common/middleware/sso-only.middleware.ts`, registered in
`main.ts` after the body parsers, before Nest routing) that 403s:
- `POST /graphql` carrying a native-auth operation (`login`, `signUp`, `resetPassword`,
  `sendResetPasswordEmail` — matched by `operationName` and a query-text scan);
- any `/connect/...` (social OAuth) route and `/logout`.

It does **not** touch `/api/provision`, `/api/provision/forms`, `/sso`, `/health*`, or non-auth
`/graphql` (the dashboard). Per-resolver/controller 403s provide defense-in-depth, and the
webapp hides the `/login`, `/sign-up`, `/forgot-password`, `/reset-password` routes.

Keep `HEYFORM_SSO_ONLY` **off** until the SSO round-trip is verified, then flip it on
(break-glass: unset the flag).

---

## Environment variables

| Name                 | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `HEYFORM_SSO_SECRET` | Shared HS256 secret for the handoff JWTs (≥32 bytes).          |
| `HEYFORM_SSO_ONLY`   | Truthy → block native auth; only the `/sso` handoff signs in.  |
| `MONGO_URI`/`MONGO_USER`/`MONGO_PASSWORD` | Point at FerretDB (see Database above).   |

`docker-compose.supporthub-spike.yml` boots heyform + FerretDB + Redis standalone for testing
the fork in isolation.
