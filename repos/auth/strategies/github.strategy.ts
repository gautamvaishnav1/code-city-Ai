import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-github2'
import { AuthService } from '../auth.service.js'

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor (
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GITHUB_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GITHUB_CALLBACK_URL'),
      scope: ['user:email'],
    })
  }
  async validate (
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: Function,
  ) {
    try {
      const githubData = {
        provider: 'github',
        providerId: profile.id,
        email:
          profile.emails?.[0]?.value ||
          `${profile.username}@users.noreply.github.com`,
        username: profile.username,
        avatarUrl: profile.photos?.[0]?.value,
        accessToken: accessToken, // Save this to access repos later!
      }

      const user = await this.authService.validateOAuthLogin(githubData)
      done(null, user)
    } catch (err) {
      done(err, false)
    }
  }
}
