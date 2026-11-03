import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AnalysisRunDocument = HydratedDocument<AnalysisRun>;

@Schema({ timestamps: true })
export class AnalysisRun {
  @Prop({ type: Types.ObjectId, ref: 'Repo', required: true })
  repoId: Types.ObjectId;

  @Prop({ required: true })
  repoUrl: string;

  @Prop()
  requestedRef?: string;

  @Prop()
  resolvedCommit?: string;

  @Prop({ default: 'babel-graph-v1' })
  analyzerVersion: string;

  @Prop({
    enum: ['pending', 'running', 'completed', 'partial', 'failed'],
    default: 'pending',
  })
  status: string;

  @Prop({ default: 'queued' })
  stage: string;

  @Prop({ default: 0 })
  progress: number;

  @Prop()
  error?: string;

  @Prop({ type: Object, default: {} })
  summary: Record<string, any>;

  @Prop()
  startedAt?: Date;

  @Prop()
  finishedAt?: Date;
}

export const AnalysisRunSchema =
  SchemaFactory.createForClass(AnalysisRun);

AnalysisRunSchema.index({ repoId: 1, createdAt: -1 });
AnalysisRunSchema.index({ status: 1 });
AnalysisRunSchema.index({ repoUrl: 1, requestedRef: 1, status: 1 });