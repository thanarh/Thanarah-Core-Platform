import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus } from './appointment.model';

export class CreateAppointmentRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  patientId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  doctorId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  facilityId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  branchId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  serviceId?: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'ISO 8601 timestamp with an explicit UTC offset.',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'ISO 8601 timestamp with an explicit UTC offset; must be after startsAt.',
  })
  endsAt!: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 500,
    nullable: true,
    description: 'Optional plain-text reason; excluded from audit logs.',
  })
  reason?: string | null;
}

export class UpdateAppointmentRequestDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  patientId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Optional service reference; null clears it.',
  })
  serviceId?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: 500,
    nullable: true,
    description: 'Optional plain-text reason; null clears it.',
  })
  reason?: string | null;
}

export class RescheduleAppointmentRequestDto {
  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  endsAt!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  doctorId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  facilityId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Optional branch reference; null clears branch placement.',
  })
  branchId?: string | null;
}

export class AppointmentResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  patientId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  doctorId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  facilityId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  serviceId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  endsAt!: Date;

  @ApiProperty({ type: String, enum: AppointmentStatus })
  status!: AppointmentStatus;

  @ApiProperty({ type: String, maxLength: 500, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;
}

export class AppointmentListResponseDto {
  @ApiProperty({ type: AppointmentResponseDto, isArray: true })
  items!: AppointmentResponseDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  total!: number;

  @ApiProperty({ type: Boolean })
  hasNext!: boolean;
}

export class AppointmentErrorResponseDto {
  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  message!: string;
}
