import { FormSettingType } from '@graphql'
import { ResolveField, Resolver } from '@nestjs/graphql'

@Resolver(of => FormSettingType)
export class FormSettingResolver {
  // Form access passwords are one-way credentials. Keep the nullable field for API compatibility,
  // but never expose either legacy plaintext or the stored bcrypt hash to GraphQL clients.
  @ResolveField(returns => String, { nullable: true })
  password(): null {
    return null
  }
}
