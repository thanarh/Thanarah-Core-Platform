import { ApiProperty } from '@nestjs/swagger';

export class TenantWorkspaceItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ type: String, isArray: true })
  permissionCodes!: string[];
}

export class TenantWorkspaceListResponseDto {
  @ApiProperty({ type: TenantWorkspaceItemDto, isArray: true })
  items!: TenantWorkspaceItemDto[];
}
