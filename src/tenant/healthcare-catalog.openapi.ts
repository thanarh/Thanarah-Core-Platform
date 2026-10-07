import { TenantCatalogStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHealthcareCatalogRequestDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 191 })
  name!: string;

  @ApiPropertyOptional({ type: String, maxLength: 512, nullable: true })
  description?: string | null;
}

export class UpdateHealthcareCatalogRequestDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191 })
  name?: string;

  @ApiPropertyOptional({ type: String, maxLength: 512, nullable: true })
  description?: string | null;
}

export class HealthcareCatalogResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  name!: string;

  @ApiProperty({ type: String, maxLength: 512, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, enum: TenantCatalogStatus })
  status!: TenantCatalogStatus;

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

export class DepartmentResponseDto extends HealthcareCatalogResponseDto {}

export class SpecialtyResponseDto extends HealthcareCatalogResponseDto {}

export class DepartmentListResponseDto {
  @ApiProperty({ type: DepartmentResponseDto, isArray: true })
  items!: DepartmentResponseDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;
}

export class SpecialtyListResponseDto {
  @ApiProperty({ type: SpecialtyResponseDto, isArray: true })
  items!: SpecialtyResponseDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;
}
