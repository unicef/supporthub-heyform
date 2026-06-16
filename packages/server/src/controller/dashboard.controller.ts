import { Controller, Get, Header, Redirect, Req, Res } from '@nestjs/common'
import { Request, Response } from 'express'

import {
  APP_DISABLE_REGISTRATION,
  APP_HOMEPAGE_URL,
  COOKIE_DOMAIN,
  ENABLE_GOOGLE_FONTS,
  GOOGLE_RECAPTCHA_KEY,
  HEYFORM_SSO_ONLY,
  STRIPE_PUBLISHABLE_KEY,
  VERIFY_EMAIL_RESEND_COOLDOWN
} from '@environments'
import { hs } from '@heyform-inc/utils'

@Controller()
export class DashboardController {
  private runtimeConfig() {
    return {
      homepageURL: APP_HOMEPAGE_URL,
      websiteURL: APP_HOMEPAGE_URL,
      appDisableRegistration: APP_DISABLE_REGISTRATION,
      ssoOnly: HEYFORM_SSO_ONLY,
      cookieDomain: COOKIE_DOMAIN,
      enableGoogleFonts: ENABLE_GOOGLE_FONTS,
      stripePublishableKey: STRIPE_PUBLISHABLE_KEY,
      googleRecaptchaKey: GOOGLE_RECAPTCHA_KEY,
      verifyEmailResendCooldownSeconds: Math.ceil(hs(VERIFY_EMAIL_RESEND_COOLDOWN) / 1000)
    }
  }

  @Get('/api/config')
  config() {
    return this.runtimeConfig()
  }

  @Get('/favicon.ico')
  @Redirect('/static/favicon.ico', 302)
  favicon() {}

  @Get('/sign-up')
  signUp(@Req() req: Request, @Res() res: Response) {
    if (APP_DISABLE_REGISTRATION) {
      return res.redirect(302, '/login')
    }

    return this.index(req, res)
  }

  @Get([
    '/',
    '/dashboard',
    '/dashboard/*',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/oauth/authorize',
    '/workspace/create',
    '/workspace',
    '/workspace/*'
  ])
  @Header('X-Frame-Options', 'SAMEORIGIN')
  index(@Req() req: Request, @Res() res: Response) {
    return res.render('index', {
      title: 'HeyForm Dashboard - Create and Manage Custom Forms Effortlessly',
      description:
        "Simplify your form creation process with HeyForm's intuitive dashboard. Design, customize, and manage forms all in one place, with no coding required.",
      // supporthub-fork: tenantReturnUrl is page-render-only (NOT in the shared
      // runtimeConfig() / /api/config) — it powers the embedded "Back to tenant" button.
      heyform: {
        ...this.runtimeConfig(),
        tenantReturnUrl: req.cookies?.HEYFORM_RETURN_URL
      }
    })
  }
}
