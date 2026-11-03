import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import bcrypt from 'bcrypt'
import * as crypto from 'crypto'
import { FallbackService } from '../fallback/fallback.service.js'
import { UserService } from '../user/user.service.js'
import { EmailService } from '../email/email.service.js'
import { otpVerifyDto } from './DTO/otp-verify.dto.js'
import { SendOtpDto } from './DTO/send-otp.dto.js'
import { getOtpPayload } from './types/get-otp.types.js'
import { Provider } from '../user/types/user.provider.type.js'
import { TokenService } from '../token/token.service.js'
import { TokenPayload } from '../token/interfaces/tokenPayload.interface.js'
import { loginDto } from './DTO/login.dto.js'

@Injectable()
export class AuthService {
  private readonly logger =new Logger(AuthService.name)
  constructor (
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly fallbackService: FallbackService,
    private readonly tokenService: TokenService,
  ) {}

  async registerUser (otpDto: SendOtpDto) {
    const existingUser = await this.userService.findByEmail(otpDto.email)
    // console.log(existingUser, 'existing user')
    this.logger.log(existingUser,"existing user")
    if (existingUser) {
      throw new ConflictException('email already exists')
    }
    try {
      const hashPassword = await bcrypt.hash(otpDto.password, 10)
      const otp = Math.floor(100000 + Math.random() * 900000).toString()
      const hashOtp = crypto.createHash('sha256').update(otp).digest('hex')
      console.log(otp, 'itp')
      // user's in JSON
      const tempUser = {
        email: otpDto.email,
        name: otpDto.name,
        password: hashPassword,
        otp: hashOtp,
      }
      const redis_key = `auth:register-otp:${otpDto.email}`
      Promise.all([
        await this.fallbackService.setCache(redis_key, tempUser, 300),
        process.env.NODE_ENV === 'production'
          ? await this.emailService.sendOtpEmail(otpDto.email, otp)
          : console.log(otp),
      ]).catch(error => {
        console.error('Error in Promise.all:', error)
        throw new ServiceUnavailableException('Failed to send OTP email')
      })
      return {
        message: 'otp sent to your email',
        email: otpDto.email,
        otp: otp,
      }
    } catch (error) {
      console.log(error)
      throw new BadRequestException('Something went wrong')
    }
  }
  /**
   *
   * @param otpVerifyDto
   * @returns access token and refresh token
   */
  async verifyOtp (otpVerifyDto: otpVerifyDto) {
    const redis_key = `auth:register-otp:${otpVerifyDto.email}`
    const tempUser = await this.fallbackService.getCache<getOtpPayload>(
      redis_key,
    )
    if (!tempUser.data) {
      throw new ConflictException('Invalid or expired OTP')
    }
    if (tempUser.data.attempts >= 5) {
      // await this.redisService.del(redis_key)
      Promise.all([await this.fallbackService.deleteCache(redis_key)]).catch(
        error => {
          console.error('Error in Promise.all:', error)
          throw new ServiceUnavailableException('Failed to delete cache')
        },
      )
      throw new ConflictException('Maximum OTP attempts exceeded')
    }
    const hashOtp = crypto
      .createHash('sha256')
      .update(otpVerifyDto.otp)
      .digest('hex')

    const expectedOtp = Buffer.from(tempUser.data.otp, 'hex')
    const inputOtp = Buffer.from(hashOtp, 'hex')
    const otpMatches =
      expectedOtp.length === inputOtp.length &&
      crypto.timingSafeEqual(expectedOtp, inputOtp)
    if (!otpMatches) {
      const remaining = Math.floor(
        (tempUser.data.otpExpiresAt - Date.now()) / 1000,
      )
      tempUser.data.attempts = (tempUser.data.attempts ?? 0) + 1
      if (remaining > 0) {
        await this.fallbackService.setCache(redis_key, tempUser, remaining)
      }
      throw new BadRequestException('Invalid OTP')
    }

    try {
      const res = await this.userService.registerUser({
        name: tempUser.data.name,
        email: tempUser.data.email,
        password: tempUser.data.password,
        provider: Provider.Local,
      })
      const payload: TokenPayload = {
        userId: String(res[2]),
        email: String(res[1]),
        provider: String(res[0]),
      }
      const accessToken = await this.tokenService.generateAccessToken(payload)
      const refreshToken = await this.tokenService.generateRefreshToken(payload)
      const hashRefreshToken=crypto.createHash('sha256').update(refreshToken).digest('hex')
      Promise.all([
        await this.fallbackService.setCache('refresh-token',hashRefreshToken,604800)
      ]).catch(err=>{
        console.error(err)
      })
      return {
        message: 'user register success fully',
        res,
        payload,
        accessToken,
        refreshToken,
      }
    } catch (error) {
      console.log(error, 'error')
      throw new ServiceUnavailableException('session timeout')
    }
  }

  async loginUser (loginDto: loginDto) {
    const existingUser = await this.userService.findByEmailWithPassword(
      loginDto.email,
    )
    if (!existingUser || !existingUser.password) {
      console.log('in error')
      throw new UnauthorizedException('invalid email or password')
    }
    try {
      const matchPassword = await bcrypt.compare(
        loginDto.password,
        existingUser.password,
      )
      if (!matchPassword) {
        console.log('error')
        throw new UnauthorizedException('invalid email or password')
      }
      const payload: TokenPayload = {
        userId: String(existingUser._id),
        email: String(existingUser.email),
        provider: String(existingUser.provider),
      }
      const accessToken = await this.tokenService.generateAccessToken(payload)
      const refreshToken = await this.tokenService.generateRefreshToken(payload)
      const hashRefreshToken=crypto.createHash('sha256').update(refreshToken).digest('hex')
      Promise.all([
        await this.fallbackService.setCache('refresh-token',hashRefreshToken,604800)
      ])
      return {
        message: 'login success fully',
        payload,
        accessToken,
        refreshToken,
      }
    } catch (error) {
      // console.error(error)
      this.logger.error(error)
      throw new ServiceUnavailableException('internal server error')
    }
  }

  async validateOAuthLogin(profileData: {
    provider: string;
    providerId: string;
    email: string;
    username?: string;
    avatarUrl?: string;
    accessToken?: string;
  }){
    // this.logger.log(g)
    const {provider, providerId, email, username, avatarUrl, accessToken} = profileData

   try {
     let user = await this.userService.findByGithubProviderId(providerId)
    if(!user&&email){
      user = await this.userService.findByEmail(email)
    }
    if(!user) {
      // Register new user
      const newUser = await this.userService.registerUser({
        email,
        provider: provider as Provider,
        providerId,
        name: username,
        profileImage: avatarUrl,
       githubAccessToken: provider === 'github' ? accessToken : undefined,
      })
      this.logger.log(`Created new user: ${email} `)
      return {user:newUser}
    }
    else if(!user.providerId&& provider==='github'){
     const userId=user._id

     const updateUser=await this.userService.updateUser(userId,{
      providerId,
      githubAccessToken:accessToken
     })
     return {user:updateUser}
    }
   } catch (error) {
    throw new InternalServerErrorException('internal server error')
   }

  }
}
