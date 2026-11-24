import { IsString } from "class-validator";

export class RefreshTokenDto{
    @IsString({message:'invalid refresh token'})
    refreshToken:string;
}