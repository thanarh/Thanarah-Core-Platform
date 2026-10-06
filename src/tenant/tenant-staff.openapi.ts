import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffStatus } from '@prisma/client';

export class TenantStaffResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'TenantMembership linked to this staff profile' })
  membershipId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  jobTitle!: string | null;

  @ApiProperty({ enum: Object.values(StaffStatus) })
  status!: StaffStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  statusChangedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  suspendedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deactivatedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class TenantStaffListResponseDto {
  @ApiProperty({ type: TenantStaffResponseDto, isArray: true })
  items!: TenantStaffResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
