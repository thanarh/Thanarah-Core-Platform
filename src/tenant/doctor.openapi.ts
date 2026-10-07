import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffStatus, TenantCatalogStatus } from '@prisma/client';

export class CreateDoctorRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  staffId!: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191 })
  professionalDisplayName?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 191,
    description: 'Descriptive professional title, not a role or permission.',
  })
  professionalTitle?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 64,
    description: 'Optional code unique within the tenant; never used for authentication.',
  })
  professionalCode?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 2000,
    description: 'Plain-text professional biography. HTML markup is rejected.',
  })
  bio?: string;

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

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 191,
    nullable: true,
    description: 'Descriptive title; null clears the value.',
  })
  professionalTitle?: string | null;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 64,
    nullable: true,
    description: 'Tenant-unique professional code; null clears the value.',
  })
  professionalCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 2000,
    nullable: true,
    description: 'Plain-text biography; null clears the value and HTML markup is rejected.',
  })
  bio?: string | null;
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

  @ApiProperty({ type: String, maxLength: 191, nullable: true })
  professionalTitle!: string | null;

  @ApiProperty({ type: String, maxLength: 64, nullable: true })
  professionalCode!: string | null;

  @ApiProperty({ type: String, maxLength: 2000, nullable: true })
  bio!: string | null;

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
