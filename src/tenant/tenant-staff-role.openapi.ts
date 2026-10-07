import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantStaffRoleAssignmentRequestDto {
  @ApiProperty({ format: 'uuid', description: 'An existing tenant role ID' })
  roleId!: string;
}

export class TenantStaffRoleAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiProperty()
  roleCode!: string;

  @ApiProperty()
  roleName!: string;

  @ApiProperty({ nullable: true })
  roleDescription!: string | null;

  @ApiProperty()
  isSystemRole!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;
}

export class TenantStaffRoleAssignmentListResponseDto {
  @ApiProperty({ type: TenantStaffRoleAssignmentResponseDto, isArray: true })
  items!: TenantStaffRoleAssignmentResponseDto[];
}
