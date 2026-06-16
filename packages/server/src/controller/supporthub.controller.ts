import { FormStatusEnum } from '@heyform-inc/shared-types-enums'
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common'

import { COOKIE_DEVICE_ID_NAME } from '@config'
import { COOKIE_DOMAIN, HEYFORM_SSO_SECRET, NODE_ENV } from '@environments'
import { helper, nanoid } from '@heyform-inc/utils'
import { TeamRoleEnum } from '@model'
import {
  AuthService,
  FormService,
  ProjectService,
  RedisService,
  TeamService,
  UserService
} from '@service'
import {
  Logger,
  passwordHash,
  readFormsClaims,
  readProvisionClaims,
  readSsoClaims,
  verifyHandoff
} from '@utils'

/**
 * SupportHub integration endpoints (fork-only).
 *
 * - POST /api/provision         create-or-reuse a Team + default Project + one User per admin
 * - GET  /api/provision/forms   read-only list of a project's forms (scoped purely from the signed claim)
 * - GET  /sso                   cookie-session SSO landing (sets HEYFORM_SESSION/LOGGED_IN/DEVICE_ID, 302 to dest)
 *
 * All three verify a short-lived (<=60s) HS256 JWT signed by SupportHub with HEYFORM_SSO_SECRET.
 * Roles, team/project scope and the dest allowlist are pinned server-side here — never trusted from the JWT body.
 * See SUPPORTHUB_FORK_NOTES.md for the contract.
 */

const SYNTHETIC_EMAIL_DOMAIN = 'heyform.local'
const DEFAULT_PROJECT_NAME = 'Default'
const SSO_JTI_TTL_SECONDS = 60

// supporthub-fork: cookie the server injects into window.heyform.tenantReturnUrl
// at page render (httpOnly: the SPA never reads it directly).
const COOKIE_RETURN_URL_NAME = 'HEYFORM_RETURN_URL'

// Only allow absolute http(s) URLs as a return target — reject javascript:/data:/etc.
function isSafeReturnUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Server-enforced dest allowlist (see plan S2.3). Reject anything else.
const DEST_ALLOWLIST: RegExp[] = [
  /^\/$/,
  /^\/workspace\/[A-Za-z0-9_-]+\/project\/[A-Za-z0-9_-]+\/form\/[A-Za-z0-9_-]+\/submissions$/,
  /^\/workspace\/[A-Za-z0-9_-]+\/project\/[A-Za-z0-9_-]+$/
]

function isDestAllowed(dest: string): boolean {
  return DEST_ALLOWLIST.some(re => re.test(dest))
}

function syntheticEmail(remoteId: string): string {
  return `admin+${remoteId}@${SYNTHETIC_EMAIL_DOMAIN}`
}

@Controller()
export class SupporthubController {
  private readonly logger = new Logger(SupporthubController.name)

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly teamService: TeamService,
    private readonly projectService: ProjectService,
    private readonly formService: FormService,
    private readonly redisService: RedisService
  ) {}

  /**
   * Send a JSON error directly on the response.
   *
   * heyform's global AllExceptionsFilter routes through a GraphQL context and
   * does NOT reliably respond to thrown HttpExceptions on plain REST routes
   * (the connection hangs). So these fork endpoints never `throw` for client
   * errors — they write the response explicitly via @Res().
   */
  private fail(res: any, status: number, message: string): void {
    res.status(status).json({ statusCode: status, message })
  }

  private isConfigured(): boolean {
    return !helper.isEmpty(HEYFORM_SSO_SECRET)
  }

  /**
   * Create-or-reuse a synthetic admin user. Idempotent by the stable synthetic
   * email so re-calls return the same heyform userId (no duplicate users).
   */
  private async ensureAdminUser(remoteId: string, displayName?: string): Promise<string> {
    const email = syntheticEmail(remoteId)
    const existing = await this.userService.findByEmail(email)

    if (helper.isValid(existing)) {
      return existing!.id
    }

    // Random, never-usable password (login is SSO-only). deviceId is per-user and stable.
    const lockedPassword = await passwordHash(nanoid(32))
    const userId = await this.userService.create({
      name: displayName || remoteId,
      email,
      password: lockedPassword,
      isEmailVerified: true,
      source: 'supporthub'
    })

    if (helper.isEmpty(userId)) {
      throw new Error('Failed to provision admin user')
    }

    return userId!
  }

  @Post('/api/provision')
  async provision(@Body() body: { token?: string }, @Res() res: any): Promise<void> {
    if (!this.isConfigured()) {
      return this.fail(res, 400, 'SupportHub SSO is not configured')
    }

    if (helper.isEmpty(body?.token)) {
      return this.fail(res, 400, 'Missing token')
    }

    let claims
    try {
      claims = readProvisionClaims(verifyHandoff(body!.token!, HEYFORM_SSO_SECRET))
    } catch (err) {
      this.logger.error(`provision token verify failed: ${(err as Error).message}`)
      return this.fail(res, 400, 'Invalid token')
    }

    try {
      // One heyform user per admin, keyed by stable synthetic email.
      const adminUserIds: Record<string, string> = {}
      for (const admin of claims.admins) {
        adminUserIds[admin.remoteId] = await this.ensureAdminUser(admin.remoteId, admin.displayName)
      }

      const ownerId = adminUserIds[claims.admins[0].remoteId]

      // Idempotency key (heyform-side): the owner user. Reuse the team owned by them.
      let teamId: string
      let projectId: string
      const ownedTeams = await this.teamService.findAllBy({ ownerId })

      if (helper.isValidArray(ownedTeams)) {
        teamId = ownedTeams[0].id
        const projects = await this.projectService.findAllInTeam(teamId)
        if (helper.isValidArray(projects)) {
          projectId = projects[0].id
        } else {
          await this.projectService.createByNewTeam(teamId, ownerId, DEFAULT_PROJECT_NAME)
          const created = await this.projectService.findAllInTeam(teamId)
          projectId = created[0].id
        }
      } else {
        teamId = await this.teamService.create({
          ownerId,
          name: claims.tenantName,
          storageQuota: 0
        })
        // Owner membership: role pinned to ADMIN server-side (never from JWT).
        await this.teamService.createMember({
          teamId,
          memberId: ownerId,
          role: TeamRoleEnum.ADMIN
        })
        // createByNewTeam writes the owner's project-member row too.
        await this.projectService.createByNewTeam(teamId, ownerId, DEFAULT_PROJECT_NAME)
        const created = await this.projectService.findAllInTeam(teamId)
        projectId = created[0].id
      }

      // Reconcile EVERY admin (owner included) additively as an ADMIN team
      // member AND a member of the tenant's single default project — both
      // idempotent. Team membership alone is not enough: forms live in the
      // project and the HeyForm UI gates form visibility on project
      // membership, so a team-only admin lands in the workspace but sees no
      // forms. The owner already holds both from createByNewTeam; the guards
      // make re-adding a no-op.
      for (const admin of claims.admins) {
        const memberId = adminUserIds[admin.remoteId]

        const teamMember = await this.teamService.findMemberById(teamId, memberId)
        if (helper.isEmpty(teamMember)) {
          await this.teamService.createMember({
            teamId,
            memberId,
            role: TeamRoleEnum.ADMIN
          })
        }

        const projectMember = await this.projectService.findMemberById(projectId, memberId)
        if (helper.isEmpty(projectMember)) {
          await this.projectService.createMember({
            projectId,
            memberId
          })
        }
      }

      this.logger.info(
        `provision tenantRef=${claims.tenantRef} teamId=${teamId} projectId=${projectId} admins=${claims.admins.length}`
      )

      res.status(200).json({ teamId, projectId, adminUserIds })
    } catch (err) {
      this.logger.error(`provision failed: ${(err as Error).message}`)
      this.fail(res, 500, 'Provision failed')
    }
  }

  @Get('/api/provision/forms')
  async forms(@Query('token') token: string | undefined, @Res() res: any): Promise<void> {
    if (!this.isConfigured()) {
      return this.fail(res, 400, 'SupportHub SSO is not configured')
    }

    if (helper.isEmpty(token)) {
      return this.fail(res, 400, 'Missing token')
    }

    let claims
    try {
      claims = readFormsClaims(verifyHandoff(token!, HEYFORM_SSO_SECRET))
    } catch (err) {
      this.logger.error(`forms token verify failed: ${(err as Error).message}`)
      return this.fail(res, 400, 'Invalid token')
    }

    // Scope purely from the signed projectId claim — no query-param projectId (server-pinned trust).
    const forms = await this.formService.findAll(claims.projectId, FormStatusEnum.NORMAL)

    res.status(200).json(
      forms.map(form => ({
        id: form.id,
        name: helper.isEmpty(form.name) ? 'Untitled' : form.name,
        active: form.status === FormStatusEnum.NORMAL
      }))
    )
  }

  @Get('/sso')
  async sso(
    @Query('token') token: string | undefined,
    @Query('dest') dest: string | undefined,
    @Req() req: any,
    @Res() res: any
  ): Promise<void> {
    if (!this.isConfigured()) {
      return this.fail(res, 400, 'SupportHub SSO is not configured')
    }

    if (helper.isEmpty(token)) {
      // Do not echo the token; generic message (token-in-URL leak mitigation).
      return this.fail(res, 400, 'Missing token')
    }

    let claims
    try {
      claims = readSsoClaims(verifyHandoff(token!, HEYFORM_SSO_SECRET))
    } catch (err) {
      this.logger.error(`sso token verify failed: ${(err as Error).message}`)
      return this.fail(res, 400, 'Invalid token')
    }

    const targetDest = helper.isValid(dest) ? dest! : '/'
    if (!isDestAllowed(targetDest)) {
      this.logger.error(`sso dest rejected: ${targetDest}`)
      return this.fail(res, 400, 'Invalid destination')
    }

    // sub user must exist; 503 (not 401) avoids a re-provision login loop.
    const user = await this.userService.findById(claims.sub)
    if (helper.isEmpty(user)) {
      res.status(503).send('User not provisioned')
      return
    }

    // Single-use jti via Redis NX — reject replay.
    const accepted = await this.redisService.setNx(
      `sso:jti:${claims.jti}`,
      '1',
      SSO_JTI_TTL_SECONDS
    )
    if (!accepted) {
      return this.fail(res, 400, 'Token already used')
    }

    // C1 deviceId: reuse the incoming HEYFORM_DEVICE_ID cookie if present; else mint a
    // per-session random id. Pin the session to whatever id is used (never derive from sub).
    const incomingDeviceId = req.cookies?.[COOKIE_DEVICE_ID_NAME]
    const deviceId = helper.isValid(incomingDeviceId) ? incomingDeviceId : nanoid(12)

    // authService.login sets HEYFORM_SESSION (httpOnly) + HEYFORM_LOGGED_IN, and the Redis sess: entry.
    await this.authService.login({ res, userId: claims.sub, deviceId })

    // Pin HEYFORM_DEVICE_ID with explicit attributes matching heyform's scheme.
    // Not httpOnly: the SPA's getDeviceId() must read it to send x-device-id.
    res.cookie(COOKIE_DEVICE_ID_NAME, deviceId, {
      domain: COOKIE_DOMAIN,
      sameSite: 'lax',
      secure: NODE_ENV === 'production',
      httpOnly: false,
      path: '/'
    })

    // supporthub-fork: persist the tenant's SupportHub admin URL so the dashboard
    // controller can inject it into window.heyform.tenantReturnUrl. httpOnly: the
    // server injects it at render, the SPA never reads the cookie directly.
    if (helper.isValid(claims.returnUrl) && isSafeReturnUrl(claims.returnUrl!)) {
      res.cookie(COOKIE_RETURN_URL_NAME, claims.returnUrl, {
        domain: COOKIE_DOMAIN,
        sameSite: 'lax',
        secure: NODE_ENV === 'production',
        httpOnly: true,
        path: '/'
      })
    }

    this.logger.info(`sso login sub=${claims.sub} jti=${claims.jti} dest=${targetDest}`)

    // 302 to dest. dest carries no token (no Referer leak).
    res.redirect(302, targetDest)
  }
}
