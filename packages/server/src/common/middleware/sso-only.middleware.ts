import { Request, Response } from 'express'

import { HEYFORM_SSO_ONLY } from '@environments'

/**
 * SupportHub SSO-only choke point (fork-only).
 *
 * When HEYFORM_SSO_ONLY is ON this is the single enforced guarantee that native
 * heyform authentication is unreachable: it rejects (403 JSON) every request that
 * could establish a session outside the SupportHub handoff:
 *
 *   - POST /graphql carrying a native-auth GraphQL operation
 *     (login / signUp / resetPassword / sendResetPasswordEmail)
 *   - any /connect/... social-OAuth route
 *   - /logout
 *
 * It deliberately does NOT touch:
 *   - the SupportHub endpoints (/api/provision, /api/provision/forms, /sso)
 *   - health checks, static assets
 *   - non-auth /graphql traffic (the dashboard needs /graphql)
 *
 * When the flag is OFF the middleware is a pure no-op.
 *
 * Registered in main.ts via app.use(...) AFTER the body parsers (so req.body is
 * populated for /graphql) and BEFORE Nest routing.
 */

// GraphQL field names of the native-auth operations we block.
const BLOCKED_AUTH_OPERATIONS = ['login', 'signUp', 'resetPassword', 'sendResetPasswordEmail']

// Matches `login(` / `signUp (` etc. as a GraphQL root field — i.e. the operation
// name immediately followed by an argument list. Word-boundary + lookahead for `(`
// keeps it from matching substrings (e.g. a `loginHint` field) or selection sets.
const AUTH_OPERATION_REGEX = new RegExp(`\\b(${BLOCKED_AUTH_OPERATIONS.join('|')})\\s*\\(`)

function rejectForbidden(res: Response): void {
  res.status(403).json({
    statusCode: 403,
    message: 'Native authentication is disabled; sign in through SupportHub.'
  })
}

function isBlockedGraphqlAuth(req: Request): boolean {
  if (req.method !== 'POST') {
    return false
  }

  const body = req.body as { operationName?: unknown; query?: unknown } | undefined

  if (!body) {
    return false
  }

  // Fast path: the client sent an explicit operationName matching a blocked op.
  if (
    typeof body.operationName === 'string' &&
    BLOCKED_AUTH_OPERATIONS.includes(body.operationName)
  ) {
    return true
  }

  // Fallback: scan the query text for a blocked root field. Covers anonymous
  // operations (no operationName) and clients that name the operation freely.
  if (typeof body.query === 'string') {
    return AUTH_OPERATION_REGEX.test(body.query)
  }

  return false
}

export function ssoOnlyChokePoint(req: Request, res: Response, next: () => void): void {
  if (!HEYFORM_SSO_ONLY) {
    return next()
  }

  // express strips the query string from req.path; compare against the pathname only.
  const path = req.path

  // Social OAuth + logout — REST routes that mint a session.
  if (path === '/logout' || path === '/connect' || path.startsWith('/connect/')) {
    return rejectForbidden(res)
  }

  // GraphQL: only block the native-auth operations, never the dashboard's traffic.
  if (path === '/graphql' && isBlockedGraphqlAuth(req)) {
    return rejectForbidden(res)
  }

  next()
}
