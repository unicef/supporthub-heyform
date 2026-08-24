import {
  CaptchaKindEnum,
  FormKindEnum,
  FormStatusEnum,
  InteractiveModeEnum
} from '@heyform-inc/shared-types-enums'
import { InternalServerErrorException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

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
import { helper, hs, parseJson } from '@heyform-inc/utils'
import { FormModel, TeamModel, UserModel } from '@model'
import { Args, Mutation, Resolver } from '@nestjs/graphql'
import { FormService, OpenAIService } from '@service'
import { Logger, parseAIJson } from '@utils'
import { GraphQLJSONObject } from 'graphql-type-json'

interface AIFormResult {
  name?: string
  fields?: unknown[]
}



@Resolver()
@Auth()
export class AIResolver {
  private readonly logger = new Logger(AIResolver.name)

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly formService: FormService
  ) {}

  @Mutation(returns => String)
  @ProjectGuard()
  @UseGuards(GqlThrottlerGuard)
  @Throttle({
    default: {
      limit: 10,
      ttl: hs('1h')
    }
  })
  async createFormWithAI(
    @Team() team: TeamModel,
    @User() user: UserModel,
    @Args('input') input: CreateFormWithAIInput
  ): Promise<string> {

    const json = await this.createAIJson<AIFormResult>(
      createFormPrompt(input.topic, input.reference),
      'Failed to generate question object'
    )

    if (!helper.isObject(json) || !helper.isValidArray(json.fields)) {
      throw new InternalServerErrorException('Failed to generate question object')
    }

    return this.formService.create({
      teamId: team.id,
      projectId: input.projectId,
      memberId: user.id,
      name: helper.isValid(json.name?.trim()) ? json.name.trim() : input.topic,
      fields: [],
      _drafts: JSON.stringify(json.fields),
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
    @Form() form: FormModel,
    @Args('input') input: CreateFieldsWithAIInput
  ): Promise<Record<string, unknown>[]> {

    const fields = await this.createAIJson<Record<string, unknown>[]>(
      createFieldsPrompt(form.name, parseJson(form._drafts), input.prompt),
      'Failed to create fields'
    )

    if (!helper.isValidArray(fields)) {
      throw new InternalServerErrorException('Failed to create fields')
    }

    return fields
  }

  @Mutation(returns => [GraphQLJSONObject])
  @FormGuard()
  async createFormLogicsWithAI(
    @Team() team: TeamModel,
    @Form() form: FormModel,
    @Args('input') input: CreateFieldsWithAIInput
  ): Promise<Record<string, unknown>[]> {

    const logics = await this.createAIJson<Record<string, unknown>[]>(
      createLogicsPrompt(parseJson(form._drafts), form.logics, input.prompt),
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
    @Args('input') input: CreateFormThemeWithAIInput
  ): Promise<Record<string, unknown>> {
    const theme = await this.createAIJson<Record<string, unknown>>(
      createThemePrompt(input.theme, input.prompt),
      'Failed to create theme'
    )

    if (!helper.isObject(theme)) {
      throw new InternalServerErrorException('Failed to create theme')
    }

    return theme
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
