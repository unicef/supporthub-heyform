import * as jwt from 'jsonwebtoken'

/**
 * SupportHub handoff JWT verification (fork-only).
 *
 * SupportHub signs short-lived (<=60s) HS256 tokens with HEYFORM_SSO_SECRET and
 * hands them to this fork's /api/provision, /api/provision/forms and /sso
 * endpoints. We verify signature + expiry with the shared secret here and expose
 * narrow readers for each claim shape so callers never trust unverified fields.
 */

export interface ProvisionClaims {
  tenantRef: string
  tenantName: string
  domain: string
  admins: ProvisionAdmin[]
  jti: string
  exp: number
}

export interface ProvisionAdmin {
  remoteId: string
  displayName?: string
}

export interface FormsClaims {
  tenantRef: string
  teamId: string
  projectId: string
  jti?: string
  exp: number
}

export interface SsoClaims {
  sub: string
  jti: string
  exp: number
  returnUrl?: string
}

/**
 * Verify an HS256 handoff token. Throws (jsonwebtoken errors) on bad signature,
 * wrong algorithm, or expiry. `clockTolerance` is small because TTL is <=60s.
 */
export function verifyHandoff(token: string, secret: string): jwt.JwtPayload {
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    clockTolerance: 5
  })

  if (typeof decoded === 'string') {
    throw new Error('Invalid handoff token payload')
  }

  return decoded
}

export function readProvisionClaims(payload: jwt.JwtPayload): ProvisionClaims {
  const admins = Array.isArray(payload.admins) ? (payload.admins as ProvisionAdmin[]) : []

  if (
    typeof payload.tenantRef !== 'string' ||
    typeof payload.tenantName !== 'string' ||
    typeof payload.domain !== 'string' ||
    typeof payload.jti !== 'string' ||
    admins.length === 0
  ) {
    throw new Error('Malformed provision claims')
  }

  return {
    tenantRef: payload.tenantRef,
    tenantName: payload.tenantName,
    domain: payload.domain,
    admins: admins.map(admin => ({
      remoteId: String(admin.remoteId),
      displayName: admin.displayName
    })),
    jti: payload.jti,
    exp: Number(payload.exp)
  }
}

export function readFormsClaims(payload: jwt.JwtPayload): FormsClaims {
  if (
    typeof payload.tenantRef !== 'string' ||
    typeof payload.teamId !== 'string' ||
    typeof payload.projectId !== 'string'
  ) {
    throw new Error('Malformed forms claims')
  }

  return {
    tenantRef: payload.tenantRef,
    teamId: payload.teamId,
    projectId: payload.projectId,
    jti: typeof payload.jti === 'string' ? payload.jti : undefined,
    exp: Number(payload.exp)
  }
}

export function readSsoClaims(payload: jwt.JwtPayload): SsoClaims {
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw new Error('Malformed sso claims')
  }

  return {
    sub: payload.sub,
    jti: payload.jti,
    exp: Number(payload.exp),
    returnUrl: typeof payload.returnUrl === 'string' ? payload.returnUrl : undefined
  }
}
