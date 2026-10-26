import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled'
import { ApolloDriverConfig } from '@nestjs/apollo'
import { HttpStatus, Injectable } from '@nestjs/common'

import { GqlOptionsFactory } from '@nestjs/graphql'
import { lowerDirective, lowerDirectiveTransformer } from '@utils'

const CLIENT_SAFE_GRAPHQL_CODES = new Set([
  'BAD_USER_INPUT',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED'
])

interface ClientSafeHttpError {
  code: string
  message: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function firstMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  if (Array.isArray(value)) {
    return value.find(row => typeof row === 'string' && row.length > 0)
  }
}

function clientSafeHttpError(value: unknown): ClientSafeHttpError | undefined {
  const originalError = asRecord(value)

  if (!originalError) {
    return
  }

  const nestedResponse = asRecord(originalError.response)
  const response = nestedResponse || originalError
  const statusCode = Number(response.statusCode ?? originalError.status)

  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode >= 500) {
    return
  }

  const message = firstMessage(
    nestedResponse
      ? nestedResponse.message
      : typeof originalError.response === 'string'
        ? originalError.response
        : originalError.message
  )

  if (!message) {
    return
  }

  const explicitCode = response.code
  const errorName = response.error
  const code =
    typeof explicitCode === 'string' && explicitCode.length > 0
      ? explicitCode
      : typeof errorName === 'string' && errorName.length > 0
        ? errorName.replace(/\s+/g, '_').toUpperCase()
        : HttpStatus[statusCode] || 'BAD_USER_INPUT'

  return { code, message }
}

@Injectable()
export class GraphqlService implements GqlOptionsFactory<ApolloDriverConfig> {
  async createGqlOptions(): Promise<ApolloDriverConfig> {
    return {
      buildSchemaOptions: {
        directives: [lowerDirective]
      },
      resolverValidationOptions: {
        requireResolversForResolveType: 'ignore'
      },
      autoSchemaFile: true,
      introspection: true,
      plugins: [ApolloServerPluginLandingPageDisabled()],
      transformSchema: schema => lowerDirectiveTransformer(schema),
      formatError: e => {
        const safeHttpError = clientSafeHttpError(e.extensions?.originalError)
        let code = e.extensions?.code
        let message = 'Internal server error'

        if (safeHttpError) {
          code = safeHttpError.code
          message = safeHttpError.message
        } else if (code && CLIENT_SAFE_GRAPHQL_CODES.has(String(code))) {
          message = e.message
        } else {
          code = 'INTERNAL_SERVER_ERROR'
        }

        return {
          code,
          message
        }
      },
      context: ({ req, res }) => ({ req, res })
    }
  }
}
