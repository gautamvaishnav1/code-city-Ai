// export class AnalyzeFolderDto {
//   repoPath: string;
// }
import { IsString } from 'class-validator';

export class AnalyzeFolderDto {
  @IsString()
  repoPath: string;
}