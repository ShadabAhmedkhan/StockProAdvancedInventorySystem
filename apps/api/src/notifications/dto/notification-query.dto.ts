import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { NotificationType } from '../../generated/prisma/enums';
import { toBoolean } from '../../common/utils/transform.util';

export class NotificationQueryDto extends PaginationQueryDto {
  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  isRead?: boolean;
}
