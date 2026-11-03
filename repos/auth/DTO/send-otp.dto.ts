import { IsEmail, IsString, MinLength } from "class-validator";
export class SendOtpDto{
    @IsEmail({},{message:'enter a valid email'})
    email:string;

    @IsString({ message: 'invalid name' })
    name:string

    @IsString({message:'invalid password'})
    @MinLength(6)
    password:string
}