import { registerAs } from "@nestjs/config";

export default registerAs('JWT',()=>({
    ACCESS_TOKEN_SECRET:process.env.JWT_ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN:process.env.JWT_REFRESH_TOKEN_SECRET,
    refresh_token_expires:process.env.EXPIRES_REFRESH_TOKEN,
    access_token_expires:process.env.EXPIRES_ACCESS_TOKEN
}))