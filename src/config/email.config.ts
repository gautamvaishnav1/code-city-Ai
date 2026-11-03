import { registerAs } from '@nestjs/config'

export default registerAs('email', () => ({
  sender_email: process.env.EMAIL_FROM,
  sender_name: process.env.EMAIL_FROM_NAME,
  smtp_email: process.env.MAIL_USER,
  smtp_pass: process.env.MAIL_PASS,
  smtp_port: process.env.MAIL_PORT,
}))
