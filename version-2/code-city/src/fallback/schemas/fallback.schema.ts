import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

@Schema({ timestamps: true })
export class CacheFallback extends Document {
  @Prop({ required: true, index: true, unique: true, type: String })
  redis_key: string

  @Prop({ required: true, type: Object })
  value: Record<string, any>

  @Prop({ required: true, type: Date, index: true })
  expiresAt: Date
}

export const CacheFallbackSchema = SchemaFactory.createForClass(CacheFallback)
// MongoDB automatically deletes the document when expiresAt passes
CacheFallbackSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
