// export class CloneRepoDto {
//   owner: string;
//   repo: string;
//   ref?: string; // branch, tag, or commit
// }

import { IsOptional, IsString, Matches } from 'class-validator';

export class CloneRepoDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,100}$/, {
    message: 'Invalid owner',
  })
  owner: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,100}$/, {
    message: 'Invalid repo',
  })
  repo: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._/-]{1,120}$/, {
    message: 'Invalid ref',
  })
  ref?: string;
}