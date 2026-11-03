import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
@Injectable()
export class EmailService {
    private transporter:nodemailer.Transporter
    constructor(private configService:ConfigService){
        
        this.transporter = nodemailer.createTransport({
            host:'smtp.gmail.com',
            port:587,
            secure:false,
            auth:{
                user:this.configService.get<string>('MAIL_USER'),
                pass:this.configService.get<string>('MAIL_PASS')
            }
        })
    }
     private async sendEmail(to: string, subject: string, html: string) {
    const fromEmail = this.configService.get<string>('EMAIL_FROM');
    const fromName = this.configService.get<string>('EMAIL_FROM_NAME');

    try {
      const info = await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
      });
      console.log(`✅ Email sent to ${to} | Message ID: ${info.messageId}`);
      return info;
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      throw new Error('Email sending failed');
    }
  }
   async sendOtpEmail(to: string, otp: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>Your OTP Code</h1>
        <h2 style="letter-spacing: 5px; background: #f4f4f4; padding: 10px; display: inline-block;">
          ${otp}
        </h2>
        <p>This OTP is valid for 5 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `;

    return this.sendEmail(to, 'Your OTP Code', html);
  }

}
