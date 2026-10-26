import { ExecutionContext, createParamDecorator } from '@nestjs/common'
import 'reflect-metadata'

import { GqlExecutionContext } from '@nestjs/graphql'

export function ip(req: any): string {
  // Express resolves req.ip according to the configured trust proxy policy.
  // Reading X-Forwarded-For directly would allow clients to spoof this value.
  return req.ip
}

export const GqlIP = createParamDecorator((_: any, context: ExecutionContext): string => {
  const ctx = GqlExecutionContext.create(context)
  const { req } = ctx.getContext()
  return ip(req)
})

export const HttpIP = createParamDecorator((_: any, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest()
  return ip(req)
})
