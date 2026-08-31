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
| `OPENAI_API_VERSION` | Set → talk to an Azure Model Inference / APIM gateway (`api-key` header + `api-version` param). Unset → plain OpenAI. |
| `OPENAI_REASONING_EFFORT` | `minimal`/`low`/`medium`/`high`, or `none` to omit the param. Defaults to `low` on the gateway path, `none` otherwise. |
| `OPENAI_MAX_COMPLETION_TOKENS` | Ceiling on one completion, reasoning tokens included. Defaults to 8000 on the gateway path, `0` (omitted) otherwise. |
| `OPENAI_REQUEST_TIMEOUT_MS` | Budget for one user-facing completion. Default 100000. |
| `WEBHOOK_SIGNING_SECRET` | HMAC-SHA256 key for signing outgoing submission webhooks. Unset → deliveries are unsigned (upstream behaviour). |

### AI request timeouts

Form generation waits on a whole completion, so three ceilings are stacked and
the innermost must be the smallest, or the user gets someone else's error page:

| Layer | Where | Dev value |
|-------|-------|-----------|
| Completion | `OPENAI_REQUEST_TIMEOUT_MS` (`open-ai.service.ts`, per-request, no retries) | 100s |
| Browser | `AI_REQUEST_TIMEOUT_MS` (`webapp/src/utils/apollo.ts`, per-operation) | 110s |
| Ingress | `appgw.ingress.kubernetes.io/request-timeout` in `supporthub_ops` | 120s |

Raising one alone does nothing — the next one down still cuts the request. The
default Apollo ceiling stays at 30s for every non-AI operation.

---

## Signed submission webhooks — `WEBHOOK_SIGNING_SECRET`

Upstream's webhook integration authenticates **nothing**. `apps/webhook.ts` POSTs
the submission to the configured URL and that is all — no secret, no header, no
signature. So the endpoint URL was the only thing standing between an anonymous
POST and whatever the receiver does with a submission, and a URL that lives in
this database, is editable by any workspace admin, and is logged by every proxy
in between is not a secret.

That mattered as soon as SupportHub pointed the `/ticket` bug-report form at a
receiver that creates **forum topics in a members-only category** (see
unicef/supporthub#401): anybody who learned the URL could file topics authored
by the shared `support-hub` account.

### The scheme

When `WEBHOOK_SIGNING_SECRET` is set, every delivery carries two headers:

| Header | Value |
|---|---|
| `X-Heyform-Timestamp` | unix **seconds** |
| `X-Heyform-Signature` | `sha256=<hex HMAC-SHA256 of `${timestamp}.${rawBody}`>` |

Same shape as Stripe and GitHub, so a receiver written against either is already
almost right. Implementation: `src/utils/webhook-signature.ts`, tested by
`test/webhook-signature.test.ts`.

Three things about it are deliberate:

1. **The timestamp is inside the MAC, not merely alongside it.** Signing the body
   alone produces a credential that never expires — capture one valid delivery
   and it replays for ever. Binding the timestamp in is what lets a stateless
   receiver enforce a freshness window (SupportHub uses ±300s), and that window
   is the only replay bound that does not require the receiver to remember every
   delivery it has ever seen.
2. **The body is serialised once and sent as a raw `body`**, not via got's
   `json:` option. The signature has to cover the exact bytes on the wire, and
   `JSON.parse` → `JSON.stringify` does not round-trip byte-for-byte.
3. **The secret is global config, not a per-integration setting.** A per-form
   field would sit in this database in plain text, be visible to every workspace
   admin, and could not be entered anyway: the integration settings UI
   (`webapp/src/pages/form/Integrations/IntegrationSettingsItem.tsx`) renders
   only `type: 'url'` and silently renders nothing for any other type.

### Why unsigned delivery is still allowed

Unset means unsigned, exactly as upstream behaves. This integration also serves
ordinary self-hosted users pointing forms at Zapier and the like, and silently
breaking them is not ours to do. **Fail-closed lives on the receiver**:
SupportHub's `/hooks/heyform-ticket` answers `503` when its own secret is unset
rather than accepting an unsigned POST, and `401` when the signature does not
verify.

### Retries, which the receiver has to cope with

Integrations are dispatched through Bull (`queue/integration-queue.ts`) with
`attempts: BULL_JOB_ATTEMPTS`, 3 by default. `got` itself does **not** retry the
POST — got 11's default `retry.methods` is GET/PUT/HEAD/DELETE/OPTIONS/TRACE and
excludes POST — so Bull is the only retry in this path. A receiver whose 2xx was
lost will therefore see the same submission again, minutes later, which is why
SupportHub keys on the submission id rather than trusting a single delivery.

---

`docker-compose.supporthub-spike.yml` boots heyform + FerretDB + Redis standalone for testing
the fork in isolation.
