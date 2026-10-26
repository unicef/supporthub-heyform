import { BullModuleOptions } from '@nestjs/bull'

import {
  BULL_JOB_ATTEMPTS,
  BULL_JOB_BACKOFF_DELAY,
  BULL_JOB_BACKOFF_TYPE,
  BULL_JOB_TIMEOUT,
  REDIS_DB
} from '@environments'
import { ms } from '@heyform-inc/utils'

import { createRedisOptions } from '../redis'

export const BullOptionsFactory = (): BullModuleOptions | Promise<BullModuleOptions> => ({
  redis: createRedisOptions(REDIS_DB + 1),
  defaultJobOptions: {
    attempts: BULL_JOB_ATTEMPTS,
    timeout: ms(BULL_JOB_TIMEOUT),
    removeOnComplete: true,
    removeOnFail: false,
    backoff: {
      delay: BULL_JOB_BACKOFF_DELAY,
      type: BULL_JOB_BACKOFF_TYPE
    }
  }
})
