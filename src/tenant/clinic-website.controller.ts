import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClinicWebsiteService } from './clinic-website.service';
import {
  clinicWebsiteSlugParamSchema,
  clinicWebsiteVersionBodySchema,
  clinicWebsiteVersionParamSchema,
  saveClinicWebsiteDraftSchema,
  type ClinicWebsiteVersionInput,
  type SaveClinicWebsiteDraftInput,
} from './clinic-website.dto';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';

@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/clinic-website`)
export class ClinicWebsiteController {
  constructor(@Inject(ClinicWebsiteService) private readonly websites: ClinicWebsiteService) {}

  @Get()
  @RequireTenantPermissions('tenant.websites.manage')
  get(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ): ReturnType<ClinicWebsiteService['get']> {
    return this.websites.get(context, actor.userId);
  }

  @Get('catalog')
  @RequireTenantPermissions('tenant.websites.manage')
  catalog(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<ClinicWebsiteService['editorCatalog']> {
    return this.websites.editorCatalog(context);
  }

  @Post('draft')
  @RequireTenantPermissions('tenant.websites.manage')
  saveDraft(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(saveClinicWebsiteDraftSchema)) body: SaveClinicWebsiteDraftInput,
  ): ReturnType<ClinicWebsiteService['saveDraft']> {
    return this.websites.saveDraft(context, actor.userId, body.expectedVersion, body.draft);
  }

  @Post('publish')
  @RequireTenantPermissions('tenant.websites.manage')
  publish(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(clinicWebsiteVersionBodySchema)) body: ClinicWebsiteVersionInput,
  ): ReturnType<ClinicWebsiteService['publish']> {
    return this.websites.publish(context, actor.userId, body.expectedVersion);
  }

  @Get('versions')
  @RequireTenantPermissions('tenant.websites.manage')
  async versions(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): Promise<{ items: Awaited<ReturnType<ClinicWebsiteService['listVersions']>> }> {
    return { items: await this.websites.listVersions(context) };
  }

  @Post('versions/:version/restore')
  @RequireTenantPermissions('tenant.websites.manage')
  restore(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('version', new ZodValidationPipe(clinicWebsiteVersionParamSchema)) version: number,
    @Body(new ZodValidationPipe(clinicWebsiteVersionBodySchema)) body: ClinicWebsiteVersionInput,
  ): ReturnType<ClinicWebsiteService['restore']> {
    return this.websites.restore(context, actor.userId, version, body.expectedVersion);
  }
}

@Controller(`${APP_CONSTANTS.apiVersion}/public/clinic-sites`)
export class PublicClinicWebsiteController {
  constructor(@Inject(ClinicWebsiteService) private readonly websites: ClinicWebsiteService) {}

  @Get(':slug')
  @Public()
  get(
    @Param('slug', new ZodValidationPipe(clinicWebsiteSlugParamSchema)) slug: string,
  ): ReturnType<ClinicWebsiteService['publicSite']> {
    return this.websites.publicSite(slug);
  }
}
