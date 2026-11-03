import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type RepoDocument = HydratedDocument<Repo>
@Schema({ timestamps: true })
export class Repo {
  @Prop({ default: 'github' })
  provider: string

  @Prop({ required: true })
  owner: string

  @Prop({ required: true })
  repo: string
  @Prop({ required: true, unique: true })
  repoUrl: string

  @Prop({ default: 'public' })
  visibility: string

  @Prop({ default: 'main' })
  branch: string
}

export const repoSchema = SchemaFactory.createForClass(Repo)