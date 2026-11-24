import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { SendOtpDto } from './DTO/send-otp.dto.js'
import { otpVerifyDto } from './DTO/otp-verify.dto.js'
import { loginDto } from './DTO/login.dto.js'
import { GithubStrategy } from './strategies/github.strategy.js'
import type { Request, Response } from 'express'
import { AuthGuard } from '@nestjs/passport'
import { TokenService } from '../token/token.service.js'
import { TokenPayload } from '../token/interfaces/tokenPayload.interface.js'
@Controller('auth')
export class AuthController {
  constructor (
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}
  @Post('register')
  async register (@Body() otpSendDto: SendOtpDto) {
    return this.authService.registerUser({ ...otpSendDto })
  }
  @Post('verify-otp')
  async verifyOtp (@Body() otpVerifyDto: otpVerifyDto) {
    const res = await this.authService.verifyOtp(otpVerifyDto)
    // console.log(otpVerifyDto, 'otp verify')
    return res
  }
  @Post('login')
  async Login (@Body() loginDto: loginDto) {
    const res = await this.authService.loginUser(loginDto)
    return res
  }
  @Post('oauth/google')
  async google () {}

  @Get('oauth/github')
  @UseGuards(AuthGuard('github'))
  async githubLogin () {}

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubCallback (@Req() req: Request, @Res() res: Response) {
    const user = req?.user as any
    const payload: TokenPayload = {
      userId: String(user._id),
      email: user.email,
      provider: 'github',
    }
    const accessToken = await this.tokenService.generateAccessToken(payload)
    const refreshToken = await this.tokenService.generateRefreshToken(payload)
    res.json({
      accessToken,
      refreshToken,
    })
  }
}
