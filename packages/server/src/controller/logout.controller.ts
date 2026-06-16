import { Controller, Get, Req, Res } from '@nestjs/common'

import { HEYFORM_SSO_ONLY } from '@environments'
import { AuthService } from '@service'

@Controller()
export class LogoutController {
  constructor(private readonly authService: AuthService) {}

  @Get('/logout')
  async index(@Req() req: any, @Res() res: any) {
    // supporthub-fork defense-in-depth: the Express choke point already blocks this
    // when SSO-only is ON; reject here too. Write the response explicitly (REST
    // routes don't reliably surface thrown HttpExceptions — see SupporthubController).
    if (HEYFORM_SSO_ONLY) {
      res.status(403).json({ statusCode: 403, message: 'Native authentication is disabled' })
      return
    }

    await this.authService.removeSession(req, res)
    res.redirect(302, '/login')
  }
}
