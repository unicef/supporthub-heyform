import Redis from 'ioredis'

export async function readLatestVerificationCode(key: string): Promise<string> {
  const redis = new Redis({
    host: process.env.E2E_REDIS_HOST || process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.E2E_REDIS_PORT || process.env.REDIS_PORT || 9514),
    username: process.env.E2E_REDIS_USERNAME || process.env.REDIS_USERNAME,
    password: process.env.E2E_REDIS_PASSWORD || process.env.REDIS_PASSWORD,
    db: Number(process.env.E2E_REDIS_DB || process.env.REDIS_DB || 0),
    lazyConnect: true,
    maxRetriesPerRequest: 1
  })

  try {
    await redis.connect()
    const codes = await redis.hgetall(key)
    const latest = Object.entries(codes).sort(([, a], [, b]) => Number(b) - Number(a))[0]

    if (!latest) {
      throw new Error(`No verification code found for ${key}`)
    }

    return latest[0]
  } finally {
    redis.disconnect()
  }
}
