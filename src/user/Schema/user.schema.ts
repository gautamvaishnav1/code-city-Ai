import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { Provider } from '../types/user.provider.type.js'

export type UserDocument = HydratedDocument<User>

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String })
  name?: string

  @Prop({ sparse: true, unique: true,required:true, type: String, index: true })
  email: string

  @Prop({ select: false, type: String })
  password?: string

  @Prop({
    required: true,
    enum: Object.values(Provider),
    index: true,
    default: Provider.Local,
    type: String,
  })
  provider: Provider

  @Prop({ type: String, index: true })
  providerId?: string

  @Prop({ type: String })
  profileImage?: string

  @Prop({type:String,select:false})
  GitHubAccessToken?:string
}

export const UserSchema = SchemaFactory.createForClass(User)
