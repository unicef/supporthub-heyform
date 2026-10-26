import {
  RedisModuleOptions,
  RedisModuleOptionsFactory
} from '@svtslv/nestjs-ioredis/dist/redis.interfaces'
import { RedisOptions } from 'ioredis'

import {
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
  REDIS_TLS,
  REDIS_USERNAME
} from '@environments'
import { toJSON } from '@heyform-inc/utils'

export function createRedisOptions(db: number = REDIS_DB, tls: string = REDIS_TLS): RedisOptions {
  const tlsOptions = tls ? toJSON<NonNullable<RedisOptions['tls']>>(tls, {}) : undefined

  return {
    host: REDIS_HOST,
    port: REDIS_PORT,
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    db,
    ...(tlsOptions ? { tls: tlsOptions } : {})
  }
}

export class RedisService implements RedisModuleOptionsFactory {
  createRedisModuleOptions(): Promise<RedisModuleOptions> | RedisModuleOptions {
    return {
      config: createRedisOptions()
    }
  }
}
