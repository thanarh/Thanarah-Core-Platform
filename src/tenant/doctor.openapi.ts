import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffStatus, TenantCatalogStatus } from '@prisma/client';

export class CreateDoctorRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  staffId!: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191 })
  professionalDisplayName?: string;

  @ApiPropertyOptional({ type: [String], items: { type: 'string', format: 'uuid' }, maxItems: 100 })
  departmentIds?: string[];

  @ApiPropertyOptional({ type: [String], items: { type: 'string', format: 'uuid' }, maxItems: 100 })
  specialtyIds?: string[];
}

export class UpdateDoctorRequestDto {
  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 191,
    nullable: true,
    description: 'Optional professional display name; null clears the override.',
  })
  professionalDisplayName?: string | null;
}

export class DoctorDepartmentDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  name!: string;

  @ApiProperty({ type: String, enum: TenantCatalogStatus })
  status!: TenantCatalogStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;
}

export class DoctorSpecialtyDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  name!: string;

  @ApiProperty({ type: String, enum: TenantCatalogStatus })
  status!: TenantCatalogStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;
}

export class DoctorStaffDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  displayName!: string;

  @ApiProperty({ type: String, enum: StaffStatus })
  status!: StaffStatus;
}

export class DoctorResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  staffId!: string;

  @ApiProperty({ type: DoctorStaffDto })
  staff!: DoctorStaffDto;

  @ApiProperty({ type: String, enum: StaffStatus })
  status!: StaffStatus;

  @ApiProperty({ type: String, maxLength: 191, nullable: true })
  professionalDisplayName!: string | null;

  @ApiProperty({ type: Boolean })
  operationallyActive!: boolean;

  @ApiProperty({ type: [DoctorDepartmentDto] })
  departments!: DoctorDepartmentDto[];

  @ApiProperty({ type: [DoctorSpecialtyDto] })
  specialties!: DoctorSpecialtyDto[];

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

export class DoctorListResponseDto {
  @ApiProperty({ type: [DoctorResponseDto] })
  items!: DoctorResponseDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;
}

export class DoctorDepartmentListResponseDto {
  @ApiProperty({ type: [DoctorDepartmentDto] })
  items!: DoctorDepartmentDto[];
}

export class DoctorSpecialtyListResponseDto {
  @ApiProperty({ type: [DoctorSpecialtyDto] })
  items!: DoctorSpecialtyDto[];
}

export class AssignDoctorDepartmentRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  departmentId!: string;
}

export class AssignDoctorSpecialtyRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  specialtyId!: string;
}
