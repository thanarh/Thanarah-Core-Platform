import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantStaffFacilityAssignmentRequestDto {
  @ApiProperty({ format: 'uuid', description: 'An active facility in the trusted tenant' })
  facilityId!: string;
}

export class CreateTenantStaffBranchAssignmentRequestDto {
  @ApiProperty({ format: 'uuid', description: 'An active branch in the trusted tenant' })
  branchId!: string;
}

export class TenantStaffFacilityAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty()
  facilityName!: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] })
  facilityStatus!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;
}

export class TenantStaffFacilityAssignmentListResponseDto {
  @ApiProperty({ type: TenantStaffFacilityAssignmentResponseDto, isArray: true })
  items!: TenantStaffFacilityAssignmentResponseDto[];
}

export class TenantStaffBranchAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] })
  branchStatus!: string;

  @ApiProperty({
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
    },
  })
  facility!: { id: string; name: string; status: string };

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;
}

export class TenantStaffBranchAssignmentListResponseDto {
  @ApiProperty({ type: TenantStaffBranchAssignmentResponseDto, isArray: true })
  items!: TenantStaffBranchAssignmentResponseDto[];
}
