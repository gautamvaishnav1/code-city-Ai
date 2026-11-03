import {registerAs} from '@nestjs/config'

export default registerAs('otp',()=>({
    otp_expires:process.env.OTP_EXPIRES,
    otp_length:process.env.OTP_LENGTH,
    otp_max_attempts:process.env.OTP_MAX_ATTEMPTS,
    
}))