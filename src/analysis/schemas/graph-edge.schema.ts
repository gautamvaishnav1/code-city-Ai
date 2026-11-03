import{Prop,Schema,SchemaFactory} from '@nestjs/mongoose'
import {HydratedDocument,Types} from 'mongoose'

export type GraphEdgeDocument =  HydratedDocument<GraphEdge>

@Schema({timestamps:true})
export class GraphEdge{
    
}