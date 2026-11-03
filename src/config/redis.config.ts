import { registerAs } from "@nestjs/config";

export default registerAs('redis',()=>({
    REDIS_URL:process.env.REDIS_URL
}))