import { BadRequestException } from '@nestjs/common'

import { Auth, FormGuard, Team } from '@decorator'
import { FormDetailInput } from '@graphql'
import { TeamModel } from '@model'
import { Args, Mutation, Resolver } from '@nestjs/graphql'
import { FormService } from '@service'

@Resolver()
@Auth()
export class RevokeStripeAccountResolver {
  constructor(private readonly formService: FormService) {}

  @Mutation(returns => Boolean)
  @FormGuard()
  async revokeStripeAccount(
    @Team() team: TeamModel,
    @Args('input') input: FormDetailInput
  ): Promise<boolean> {
    if (!team.isOwner) {
      throw new BadRequestException(
        "You don't have permission to connect a Stripe account for this workspace"
      )
    }

    return this.formService.update(input.formId, {
      $unset: {
        stripeAccount: 1
      }
    })
  }
}
