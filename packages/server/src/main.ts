import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import * as bodyParser from 'body-parser'
import * as cookieParser from 'cookie-parser'
import * as rateLimit from 'express-rate-limit'
import * as helmet from 'helmet'
import { extname } from 'path'
import * as serveStatic from 'serve-static'

import { ssoOnlyChokePoint } from './common/middleware'
import { corsOrigin } from '@config'
import {
  APP_LISTEN_HOSTNAME,
  APP_LISTEN_PORT,
  STATIC_DIR,
  UPLOAD_DIR,
  VIEW_DIR
} from '@environments'
import { helper, ms } from '@heyform-inc/utils'
import { Logger, hbs } from '@utils'

import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filter'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false
  })

  // Apollo Server 4 expects req.body to be populated before the GraphQL middleware runs.
  app.use('/graphql', bodyParser.json({ limit: '1mb' }))

  // supporthub-fork: bodyParser is disabled globally, so the SupportHub provision
  // endpoint needs its own JSON parser for the `{ token }` body.
  app.use('/api/provision', bodyParser.json({ limit: '64kb' }))

  // supporthub-fork: single enforced SSO-only choke point. Runs AFTER the body
  // parsers (so it can read req.body.operationName / req.body.query on /graphql)
  // and BEFORE Nest routing. No-op unless HEYFORM_SSO_ONLY is ON.
  app.use(ssoOnlyChokePoint)

  // Verify all params
  app.useGlobalPipes(
    new ValidationPipe({
      forbidUnknownValues: false
    })
  )

  // Catch all exceptions
  app.useGlobalFilters(new AllExceptionsFilter())

  app.enableCors({
    origin: corsOrigin,
    credentials: true
  })

  // Enable cookie
  app.use(cookieParser())

  // see https://expressjs.com/en/guide/behind-proxies.html
  app.set('trust proxy', 1)

  // Static assets
  app.use('/static/upload', (req, res, next) => {
    if (['.svg', '.svgz'].includes(extname(req.path).toLowerCase())) {
      return res.status(403).end()
    }

    next()
  })

  app.use(
    '/static/upload',
    serveStatic(UPLOAD_DIR, {
      fallthrough: false,
      maxAge: '30d',
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      setHeaders: res => {
        const { attname } = res.req.query

        if (helper.isValid(attname)) {
          res.setHeader('Content-Disposition', `attachment; filename="${attname}"`)
        }

        res.setHeader('X-Content-Type-Options', 'nosniff')
      }
    })
  )

  app.use(
    '/static',
    serveStatic(STATIC_DIR, {
      maxAge: '30d',
      extensions: ['jpg', 'jpeg', 'bmp', 'webp', 'gif', 'png', 'svg', 'js', 'css'],
      setHeaders: res => {
        const { attname } = res.req.query

        if (helper.isValid(attname)) {
          res.setHeader('Content-Disposition', `attachment; filename="${attname}"`)
        }
      }
    })
  )

  // Template rendering
  app.engine('html', hbs.__express)
  app.setBaseViewsDir(VIEW_DIR)
  app.setViewEngine('html')

  /**
   * Limit the number of user's requests
   * 1000 requests per minute
   */
  app.use(
    rateLimit({
      headers: false,
      windowMs: ms('1m'),
      max: 1000
    })
  )

  // Security
  app.use(
    helmet({
      // see https://github.com/helmetjs/helmet#reference
      frameguard: false,
      contentSecurityPolicy: false,
      dnsPrefetchControl: false,
      referrerPolicy: false
    })
  )

  await app.listen(APP_LISTEN_PORT, APP_LISTEN_HOSTNAME, () => {
    Logger.info(
      `Server is running on http://${APP_LISTEN_HOSTNAME}:${APP_LISTEN_PORT}`,
      'NestApplication'
    )
  })
}

bootstrap()
