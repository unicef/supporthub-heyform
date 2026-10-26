import { E2EClient } from './client'
import { SIGN_UP_GQL, USER_DETAIL_GQL } from './gql'
import { strongPassword, uniqueEmail, uniqueName } from './random'

export interface SignedUpUser {
  client: E2EClient
  id: string
  name: string
  email: string
  password: string
}

/**
 * Sign up a fresh user and return a client with its own cookie jar — caller
 * keeps the client around and reuses it across tests so we never re-auth.
 */
export async function signUpUser(
  baseUrl: string,
  overrides: Partial<{
    name: string
    email: string
    password: string
    teamId: string
    inviteCode: string
  }> = {}
): Promise<SignedUpUser> {
  const client = new E2EClient({ baseUrl })
  const name = overrides.name ?? uniqueName('E2E User')
  const email = overrides.email ?? uniqueEmail()
  const password = overrides.password ?? strongPassword()

  await client.gqlOk('signUp', SIGN_UP_GQL, {
    input: {
      name,
      email,
      password,
      teamId: overrides.teamId,
      inviteCode: overrides.inviteCode
    }
  })

  const detail = await client.gqlOk<{ id: string }>('userDetail', USER_DETAIL_GQL)

  return { client, id: detail.id, name, email, password }
}
