import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FacilitySchedulingPolicyRevisionAction,
  FacilitySchedulingPolicyStatus,
} from '@prisma/client';

export class SchedulingPolicyInputDto {
  @ApiProperty({
    type: String,
    maxLength: 64,
    description: 'An IANA time-zone identifier. No facility default is assumed.',
  })
  timeZone!: string;

  @ApiProperty({
    type: Object,
    description:
      'Explicit rules: operatingHours, providerAvailability, allowedDurationsMinutes, serviceDurationRules, bookingHorizonDays, minimumAdvanceNoticeMinutes, minimumCancellationNoticeMinutes, and minimumRescheduleNoticeMinutes.',
  })
  rules!: Record<string, unknown>;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description: 'Required when updating an existing policy; omit when creating one.',
  })
  expectedVersion?: number;
}

export class SchedulingPolicyTransitionDto {
  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export class SchedulingPolicyResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  facilityId!: string;

  @ApiProperty({ enum: FacilitySchedulingPolicyStatus })
  status!: FacilitySchedulingPolicyStatus;

  @ApiProperty({ type: String, maxLength: 64 })
  timeZone!: string;

  @ApiProperty({ type: Object })
  rules!: Record<string, unknown>;

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class SchedulingPolicyRevisionDto {
  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ enum: FacilitySchedulingPolicyRevisionAction })
  action!: FacilitySchedulingPolicyRevisionAction;

  @ApiProperty({ enum: FacilitySchedulingPolicyStatus })
  status!: FacilitySchedulingPolicyStatus;

  @ApiProperty({ type: String, maxLength: 64 })
  timeZone!: string;

  @ApiProperty({ type: Object })
  rules!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'uuid' })
  actorUserId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class SchedulingPolicyRevisionListDto {
  @ApiProperty({ type: [SchedulingPolicyRevisionDto] })
  items!: SchedulingPolicyRevisionDto[];

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  offset!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  total!: number;

  @ApiProperty({ type: Boolean })
  hasNext!: boolean;
}
