import { plainToInstance } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator'

class EnvironmentVariables {
  @IsOptional()
  @IsEnum(['development', 'production', 'test'], {
    message: 'NODE_ENV must be one of development, production, or test',
  })
  NODE_ENV!: 'development' | 'production' | 'test'

  @IsNotEmpty({ message: 'PORT is required' })
  @IsInt({ message: 'PORT must be an integer' })
  PORT!: number

  @IsString({ message: 'MongoDB connection string is required' })
  MONGO_URI!: string

  @IsString({ message: 'Redis connection string is required' })
  REDIS_URL!: string

  @IsString({ message: 'JWT access secret is required' })
  JWT_ACCESS_SECRET!: string

  @IsString({ message: 'JWT refresh secret is required' })
  JWT_REFRESH_SECRET!: string

  @IsString({ message: 'JWT access token expiration must be  time duration' })
  JWT_ACCESS_TOKEN_EXPIRES!: string

  @IsString({ message: 'JWT refresh token expiration must be  time duration' })
  JWT_REFRESH_TOKEN_EXPIRES!: string

  @IsString({ message: 'Email sender address is required' })
  EMAIL_FROM!: string

  @IsString({ message: 'Email sender name is required' })
  EMAIL_FROM_NAME!: string

  @IsString({ message: 'SMTP email is required' })
  MAIL_USER!: string

  @IsString({ message: 'SMTP password is required' })
  MAIL_PASS!: string

  @IsInt({ message: 'SMTP port must be an integer' })
  MAIL_PORT!: number

  @IsString({ message: 'github client id required ' })
  GITHUB_CLIENT_ID!: string

  @IsString({message:'github client secret required'})
  GITHUB_CLIENT_SECRET!:string

  // @IsString({message:'github callback url required'})
  // GITHUB_CALLBACK_URL!:string

  @IsInt({ message: 'OTP expiration time must be an integer' })
  OTP_EXPIRES!: number

  @IsInt({ message: 'OTP length must be an integer' })
  OTP_LENGTH!: number


  @IsInt({ message: 'OTP max attempts must be an integer' })
  OTP_MAX_ATTEMPTS!: number
}

export function validate (config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  })

  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    const messages = errors
      .map(error => Object.values(error.constraints ?? {}).join(', '))
      .join('\n')

    throw new Error(` Config validation failed:\n${messages}`)
  }

  return validated
}
