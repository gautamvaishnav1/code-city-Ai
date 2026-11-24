import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JsonWebTokenError, JwtService } from '@nestjs/jwt'
import { TokenPayload } from './interfaces/tokenPayload.interface.js'

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name)
  constructor (
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}
  async generateAccessToken (payload: TokenPayload): Promise<string> {
    const expiresIn=this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRES')||'15m'
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn:expiresIn as any
    })
  }

  async generateRefreshToken(payload:TokenPayload):Promise<string>{
    const expiresIn=this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRES')||'7d'
    return this.jwtService.signAsync(payload,{
        secret:this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn:expiresIn as any
    })
  }

  async verifyToken (token: string, secretKey: string): Promise<TokenPayload> {
    try {
      const secret = this.configService.get<string>(secretKey)
      if (!secret) {
        throw new Error(`missing secret key:${secretKey}`)
      }
      return this.jwtService.verifyAsync(token, {
        secret,
      })
    } catch (error) {
      throw new JsonWebTokenError('Invalid or expired token')
    }
  }
}
