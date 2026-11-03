import { IsString } from "class-validator";

export class AnalyzeRepoPathDto {
  @IsString()
  repoPath: string;
}