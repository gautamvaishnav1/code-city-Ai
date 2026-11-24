export interface getOtpPayload {
  name: string;
  email:string;
  password: string;
  otp: string;
  otpExpiresAt: number;
  attempts: number;
}