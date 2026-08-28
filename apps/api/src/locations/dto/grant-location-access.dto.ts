import { IsUUID } from 'class-validator';

export class GrantLocationAccessDto {
  @IsUUID()
  userId: string;
}
