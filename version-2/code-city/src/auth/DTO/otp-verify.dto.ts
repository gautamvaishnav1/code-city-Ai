import { IsEmail, IsNotEmpty, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";

export class otpVerifyDto{
    @IsEmail({},{message:'invalid email'})
    email!:string;

    @IsString({message:'invalid otp'})
    @IsNotEmpty({message:'provide valid otp'})
    @Length(6,6,{message:'otp must be 6 digits'})
    @Matches(/^[0-9]+$/, { message: 'OTP must contain only numbers' })
    otp!:string;
}