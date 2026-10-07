import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantCatalogStatus } from '@prisma/client';

export class CreateServiceRequestDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 191 })
  name!: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 64,
    description: 'Optional code unique within the tenant.',
  })
  code?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 2000,
    nullable: true,
    description: 'Optional plain-text description. HTML markup is rejected.',
  })
  description?: string | null;
}

export class UpdateServiceRequestDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191 })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 64,
    nullable: true,
    description: 'Tenant-unique code; null clears the code.',
  })
  code?: string | null;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 2000,
    nullable: true,
    description: 'Plain-text description; null clears the description and HTML is rejected.',
  })
  description?: string | null;
}

export class ServiceResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  name!: string;

  @ApiProperty({ type: String, maxLength: 64, nullable: true })
  code!: string | null;

  @ApiProperty({ type: String, maxLength: 2000, nullable: true })
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

export class ServiceListResponseDto {
  @ApiProperty({ type: ServiceResponseDto, isArray: true })
  items!: ServiceResponseDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;
}
