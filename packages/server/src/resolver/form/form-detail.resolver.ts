import { Auth, FormGuard, Team } from '@decorator'
import { FormDetailInput, FormType, PublicFormType } from '@graphql'
import { date, helper } from '@heyform-inc/utils'
import { FormModel, TeamModel } from '@model'
import { Args, Query, Resolver } from '@nestjs/graphql'
import { FormService, SubmissionService, TeamService } from '@service'

const DEFAULT_FORM_NAME = 'Untitled'

@Resolver()
@Auth()
export class FormDetailResolver {
  constructor(
    private readonly formService: FormService,
    private readonly submissionService: SubmissionService
  ) {}

  @Query(returns => FormType)
  @FormGuard()
  async formDetail(
    @Team() team: TeamModel,
    @Args('input') input: FormDetailInput
  ): Promise<FormModel> {
    const [form, submissionCount] = await Promise.all([
      this.formService.findById(input.formId),
      this.submissionService.count({ formId: input.formId })
    ])

    //@ts-ignore
    form.updatedAt = date(form.get('updatedAt')).unix()

    //@ts-ignore
    form.submissionCount = submissionCount

    if (helper.isEmpty(form.name)) {
      form.name = DEFAULT_FORM_NAME
    }

    return form
  }
}

/**
 * supporthub-fork: `removeBranding` is a TEAM flag (see team.model.ts), but the
 * form renderer reads it off the form's `settings` (`Branding.tsx` bails on
 * `state.settings?.removeBranding`). Nothing bridged the two, so flipping the
 * workspace toggle had no effect on a public form.
 *
 * It is resolved HERE rather than in `FormService.findPublicForm` because that
 * method has three return paths — the active form plus two "closed" stubs — and
 * every one of them rebuilds `settings` through an explicit `pickObject`
 * allowlist. Injecting the flag in the resolver covers all three in one place,
 * and the closed-form view renders the badge too.
 */
@Resolver()
export class PublicFormResolver {
  constructor(
    private readonly formService: FormService,
    private readonly teamService: TeamService
  ) {}

  @Query(returns => PublicFormType)
  async publicForm(@Args('input') input: FormDetailInput): Promise<PublicFormType> {
    const form = await this.formService.findPublicForm(input.formId)

    if (!form) {
      throw new Error('Form not found')
    }

    if (!form.teamId) {
      throw new Error('Form teamId is required')
    }

    if (!form.projectId) {
      throw new Error('Form projectId is required')
    }

    // Team lookup is by id on an already-validated `teamId`, so this adds one
    // indexed read to the public form path and cannot fail the render: a
    // missing team degrades to "badge shown", never to an error.
    const team = await this.teamService.findById(form.teamId)

    const integrations: Record<string, any> = {}

    if (form.settings?.active) {
      // const apps = await this.appService.findAllByUniqueIds(['googleanalytics', 'facebookpixel'])
      // const result = await this.integrationService.findAllInFormByApps(
      //   input.formId,
      //   apps.map(app => app.id)
      // )
      // for (const row of result) {
      //   const app = apps.find(app => app.id === row.appId)
      //   integrations[app.uniqueId] = (row.attributes as any).get('trackingCode')
      // }
    }

    return {
      id: form.id,
      teamId: form.teamId,
      projectId: form.projectId,
      memberId: form.memberId,
      name: helper.isEmpty(form.name) ? DEFAULT_FORM_NAME : form.name,
      description: form.description,
      interactiveMode: form.interactiveMode,
      kind: form.kind,
      settings: {
        ...form.settings,
        // Default ON when the flag is unset. These forms are always embedded in
        // a tenant's own site, so the badge showing is the wrong default — and
        // the per-workspace toggle is effectively unreachable here: it is
        // owner-gated (`update-team.resolver.ts` throws unless
        // `team.ownerId === user.id`), the owner is whichever admin happened to
        // be first in the provision claims, and the sidebar link is hidden in
        // SSO-only mode. An explicit `false` is still honoured, so a tenant
        // that genuinely wants the badge can have it.
        removeBranding: team?.removeBranding !== false
      },
      drafts: form.drafts || form.fields || [],
      fields: form.fields || [],
      translations: form.translations || {},
      hiddenFields: form.hiddenFields || [],
      logics: form.logics || [],
      variables: form.variables || [],
      fieldsUpdatedAt: form.fieldsUpdatedAt || Date.now(),
      themeSettings: form.themeSettings || {},
      retentionAt: form.retentionAt,
      suspended: form.suspended || false,
      isDraft: form.isDraft || false,
      status: form.status,
      stripeAccount: form.stripeAccount,
      version: form.version || 1,
      canPublish: form.canPublish || false,
      customReport: form.customReport || {
        id: '',
        hiddenFields: [],
        theme: {},
        enablePublicAccess: false
      },
      integrations
    }
  }
}
