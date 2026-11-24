import { IsEmail, IsString } from "class-validator";

export class loginDto{
   
    @IsEmail({},{message:'invalid email'})
    email:string;
    @IsString({message:'invalid password'})
    password:string;     
}       