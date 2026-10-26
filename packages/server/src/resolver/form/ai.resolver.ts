import {
  CaptchaKindEnum,
  FormKindEnum,
  FormStatusEnum,
  InteractiveModeEnum
} from '@heyform-inc/shared-types-enums'
import { BadRequestException, InternalServerErrorException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import { normalizeAIFields } from '../../utils/ai-fields'
import {
  createFieldsPrompt,
  createFormPrompt,
  createLogicsPrompt,
  createThemePrompt
} from '@config'
import { Auth, Form, FormGuard, ProjectGuard, Team, User } from '@decorator'
import {
  CreateFieldsWithAIInput,
  CreateFormThemeWithAIInput,
  CreateFormWithAIInput
} from '@graphql'
import { GqlThrottlerGuard } from '@guard'
import { helper, ms, parseJson } from '@heyform-inc/utils'
import { FormModel, TeamModel, UserModel } from '@model'
import { Args, Mutation, Resolver } from '@nestjs/graphql'
import { FormService, OpenAIService, RedisService } from '@service'
import {
  Logger,
  fillAIFieldDefaults,
  parseAIJson,
  repairAIFieldKinds,
  sanitizeFormDrafts
} from '@utils'
import { GraphQLJSONObject } from 'graphql-type-json'

interface AIFormResult {
  name?: string
  fields?: unknown[]
}

interface TeamPlan {
  aiForm?: boolean
  themeCustomization?: boolean
}

type TeamWithPlan = TeamModel & {
  plan?: TeamPlan
}

const AI_USER_HOURLY_LIMIT = 20
const AI_TEAM_HOURLY_LIMIT = 100
const AI_RATE_LIMIT_DURATION = '1h'

@Resolver()
@Auth()
@UseGuards(GqlThrottlerGuard)
@Throttle({
  default: {
    limit: AI_USER_HOURLY_LIMIT,
    ttl: ms(AI_RATE_LIMIT_DURATION)
  }
})
export class AIResolver {
  private readonly logger = new Logger(AIResolver.name)

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly formService: FormService,
    private readonly redisService: RedisService
  ) {}

  /**
   * Everything the model produces passes through here before it is stored or
   * returned:
   *
   *  - `repairAIFieldKinds` (fork) — map aliased and unknown kinds, which
   *    upstream's schema would reject the whole generation over.
   *  - `normalizeAIFields` (upstream) — validate and normalise the shape;
   *    throws when the output is still unusable.
   *  - `fillAIFieldDefaults` (fork) — add the properties a kind cannot work
   *    without (yes_no choices, rating total, ...), which upstream accepts
   *    missing and which then render broken.
   *  - `sanitizeFormDrafts` — is the rich text SAFE? Every human save already
   *    goes through it via `updateFormSchemas`/`publishForm`.
   *
   * Repairs are logged rather than swallowed. A count that starts climbing is
   * the signal that the prompt has drifted from the schema again.
   */
  private sanitizeFields(fields: unknown, context: string, errorMessage: string): any[] {
    const kinds = repairAIFieldKinds(fields)
    const defaults = fillAIFieldDefaults(this.normalizeFields(kinds.fields, errorMessage))
    const repairs = [...kinds.repairs, ...defaults.repairs]
    if (repairs.length > 0) {
      this.logger.info(
        `${context}: repaired ${repairs.length} problem(s) in AI output — ${repairs.join('; ')}`
      )
    }
    return sanitizeFormDrafts(defaults.fields)
  }

  @Mutation(returns => String)
  @ProjectGuard()
  async createFormWithAI(
    @Team() team: TeamModel,
    @User() user: UserModel,
    @Args('input') input: CreateFormWithAIInput
  ): Promise<string> {
    if (!this.getPlan(team).aiForm) {
      throw new BadRequestException('Upgrade your plan to create form with AI')
    }

    await this.enforceAIUsageLimits(team.id, user.id)

    const json = await this.createAIJson<AIFormResult>(
      createFormPrompt(input.topic, input.reference),
      'Failed to generate question object'
    )

    if (!helper.isObject(json) || !helper.isValidArray(json.fields)) {
      throw new InternalServerErrorException('Failed to generate question object')
    }

    // Sanitised BEFORE the emptiness check below, not after: a response made
    // entirely of unusable fields is a failed generation, and storing a form
    // with zero questions would look like a success to the author.
    const fields = this.sanitizeFields(
      json.fields,
      'createFormWithAI',
      'Failed to generate question object'
    )
    if (!helper.isValidArray(fields)) {
      throw new InternalServerErrorException('Failed to generate question object')
    }

    return this.formService.create({
      teamId: team.id,
      projectId: input.projectId,
      memberId: user.id,
      name: typeof json.name === 'string' && json.name.trim() ? json.name.trim() : input.topic,
      fields: [],
      _drafts: JSON.stringify(fields),
      fieldsUpdatedAt: 0,
      settings: {
        active: false,
        captchaKind: CaptchaKindEnum.NONE,
        filterSpam: false,
        allowArchive: true,
        requirePassword: false,
        locale: 'en',
        enableQuestionList: true,
        enableNavigationArrows: true,
        enableEmailNotification: true
      },
      hiddenFields: [],
      version: 0,
      kind: FormKindEnum.SURVEY,
      interactiveMode: InteractiveModeEnum.GENERAL,
      status: FormStatusEnum.NORMAL
    })
  }

  @Mutation(returns => [GraphQLJSONObject])
  @FormGuard()
  async createFieldsWithAI(
    @Team() team: TeamModel,
    @User() user: UserModel,
    @Form() form: FormModel,
    @Args('input') input: CreateFieldsWithAIInput
  ): Promise<Record<string, unknown>[]> {
    if (!this.getPlan(team).aiForm) {
      throw new BadRequestException('Upgrade your plan to edit form with AI')
    }

    await this.enforceAIUsageLimits(team.id, user.id)

    const generated = await this.createAIJson<Record<string, unknown>[]>(
      createFieldsPrompt(form.name, parseJson(form._drafts), input.prompt),
      'Failed to create fields'
    )

    if (!helper.isValidArray(generated)) {
      throw new InternalServerErrorException('Failed to create fields')
    }

    // This mutation EDITS existing questions, so the ids coming back may be ones
    // already referenced by logic rules. `normalizeAIFields` keeps any id it is
    // given and only mints a replacement for a missing or duplicate one,
    // which is what makes it safe to run here.
    const fields = this.sanitizeFields(generated, 'createFieldsWithAI', 'Failed to create fields')
    if (!helper.isValidArray(fields)) {
      throw new InternalServerErrorException('Failed to create fields')
    }

    return fields
  }

  @Mutation(returns => [GraphQLJSONObject])
  @FormGuard()
  async createFormLogicsWithAI(
    @Team() team: TeamModel,
    @User() user: UserModel,
    @Form() form: FormModel,
    @Args('input') input: CreateFieldsWithAIInput
  ): Promise<Record<string, unknown>[]> {
    if (!this.getPlan(team).aiForm) {
      throw new BadRequestException('Upgrade your plan to setup logics with AI')
    }

    await this.enforceAIUsageLimits(team.id, user.id)

    const logics = await this.createAIJson<Record<string, unknown>[]>(
      createLogicsPrompt(parseJson(form._drafts), form.draftLogics ?? form.logics, input.prompt),
      'Failed to generate logics'
    )

    if (!helper.isValidArray(logics)) {
      throw new InternalServerErrorException('Failed to generate logics')
    }

    return logics
  }

  @Mutation(returns => GraphQLJSONObject)
  @FormGuard()
  async createFormThemeWithAI(
    @Team() team: TeamModel,
    @User() user: UserModel,
    @Args('input') input: CreateFormThemeWithAIInput
  ): Promise<Record<string, unknown>> {
    const plan = this.getPlan(team)

    if (!plan.themeCustomization) {
      throw new BadRequestException('Upgrade your plan to setup theme customization')
    }

    if (!plan.aiForm) {
      throw new BadRequestException('Upgrade your plan to setup theme with AI')
    }

    await this.enforceAIUsageLimits(team.id, user.id)

    const theme = await this.createAIJson<Record<string, unknown>>(
      createThemePrompt(input.theme, input.prompt),
      'Failed to create theme'
    )

    if (!helper.isObject(theme)) {
      throw new InternalServerErrorException('Failed to create theme')
    }

    return theme
  }

  private getPlan(team: TeamModel): TeamPlan {
    return (team as TeamWithPlan).plan ?? { aiForm: true, themeCustomization: true }
  }

  private normalizeFields(fields: unknown, errorMessage: string): Record<string, unknown>[] {
    try {
      return normalizeAIFields(fields)
    } catch (error) {
      this.logger.error(error)
      throw new InternalServerErrorException(errorMessage)
    }
  }

  private async enforceAIUsageLimits(teamId: string, userId: string): Promise<void> {
    await this.redisService.throttler(
      `ai:user:${userId}`,
      AI_USER_HOURLY_LIMIT,
      AI_RATE_LIMIT_DURATION
    )
    await this.redisService.throttler(
      `ai:team:${teamId}`,
      AI_TEAM_HOURLY_LIMIT,
      AI_RATE_LIMIT_DURATION
    )
  }

  private async createAIJson<T>(prompt: string, errorMessage: string): Promise<T> {
    const result = await this.openAIService.chatCompletion({
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
    const choice = result.choices[0]
    const content = choice?.message?.content

    this.logger.info(content)

    // A completion cut off at `max_completion_tokens` returns valid-looking but
    // truncated JSON, which would otherwise fail in `parseAIJson` as an
    // indistinguishable "bad model output". Logged separately because the fix is
    // a different one: raise the ceiling, or ask for fewer fields.
    if (choice?.finish_reason === 'length') {
      this.logger.error(
        `AI completion truncated at max_completion_tokens; ${errorMessage.toLowerCase()}`
      )
      throw new InternalServerErrorException(errorMessage)
    }

    if (helper.isEmpty(content)) {
      throw new InternalServerErrorException(errorMessage)
    }

    try {
      return parseAIJson<T>(content)
    } catch (error) {
      this.logger.error(error)
      throw new InternalServerErrorException(errorMessage)
    }
  }
}
