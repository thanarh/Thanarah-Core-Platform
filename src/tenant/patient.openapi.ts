import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PatientStatus } from './patient.model';

export class CreatePatientRequestDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 64 })
  patientNumber!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 191 })
  firstName!: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191, nullable: true })
  middleName?: string | null;

  @ApiProperty({ type: String, minLength: 1, maxLength: 191 })
  lastName!: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Date-only value in YYYY-MM-DD form; future dates are rejected.',
  })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: 32,
    nullable: true,
    description: 'Optional bounded text; no gender terminology is imposed by this phase.',
  })
  gender?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: 32,
    nullable: true,
    description: 'Optional phone number with 5–15 digits and limited formatting characters.',
  })
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    maxLength: 191,
    nullable: true,
  })
  email?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: 64,
    nullable: true,
    description: 'Optional text; no country-specific format is assumed.',
  })
  nationalId?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: 2000,
    nullable: true,
    description: 'Optional plain text; HTML-like markup is rejected.',
  })
  address?: string | null;
}

export class UpdatePatientRequestDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 64 })
  patientNumber?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191 })
  firstName?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191, nullable: true })
  middleName?: string | null;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191 })
  lastName?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 191, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 32, nullable: true })
  gender?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 32, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', maxLength: 191, nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 64, nullable: true })
  nationalId?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  address?: string | null;
}

export class PatientResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, maxLength: 64 })
  patientNumber!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  firstName!: string;

  @ApiProperty({ type: String, maxLength: 191, nullable: true })
  middleName!: string | null;

  @ApiProperty({ type: String, maxLength: 191 })
  lastName!: string;

  @ApiProperty({ type: String, maxLength: 191, nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  dateOfBirth!: string | null;

  @ApiProperty({ type: String, maxLength: 32, nullable: true })
  gender!: string | null;

  @ApiProperty({ type: String, maxLength: 32, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, format: 'email', maxLength: 191, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, maxLength: 64, nullable: true })
  nationalId!: string | null;

  @ApiProperty({ type: String, maxLength: 2000, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, enum: PatientStatus })
  status!: PatientStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class PatientDirectoryEntryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, maxLength: 64 })
  patientNumber!: string;

  @ApiProperty({ type: String, maxLength: 191 })
  firstName!: string;

  @ApiProperty({ type: String, maxLength: 191, nullable: true })
  middleName!: string | null;

  @ApiProperty({ type: String, maxLength: 191 })
  lastName!: string;

  @ApiProperty({ type: String, maxLength: 191, nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, maxLength: 32, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, format: 'email', maxLength: 191, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, enum: PatientStatus })
  status!: PatientStatus;
}

export class PatientListResponseDto {
  @ApiProperty({ type: PatientDirectoryEntryDto, isArray: true })
  items!: PatientDirectoryEntryDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Total matching patients before applying limit and offset.',
  })
  total!: number;

  @ApiProperty({ type: Boolean, description: 'Whether another result slice is available.' })
  hasNext!: boolean;
}
