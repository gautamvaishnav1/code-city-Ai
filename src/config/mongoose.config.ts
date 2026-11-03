import {registerAs} from '@nestjs/config'

export default registerAs('mongo',()=>({
    uri:process.env.MONGO_URI,
    password:process.env.MONGO_PASS,
    database:process.env.MONGO_DB_NAME,
    user:process.env.MONGO_USER
}))