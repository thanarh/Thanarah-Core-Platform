import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { OperationsError } from '../internal-operations/operations.errors';
import { JourneyInquiries } from './journey.inquiries';

@ApiTags('Public website inquiries')
@Controller('v1/customer-public/inquiries')
export class JourneyPublicInquiryController {
  constructor(@Inject(JourneyInquiries) readonly inquiries: JourneyInquiries) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  create(@Body() input: unknown): Promise<{ reference: string; receivedAt: string }> {
    return this.inquiries.create(input);
  }
}

@ApiTags('Customer operations administration')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller('v1/customer-admin/inquiries')
export class JourneyAdminInquiryController {
  constructor(@Inject(JourneyInquiries) readonly inquiries: JourneyInquiries) {}

  @Get()
  async list(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ): ReturnType<JourneyInquiries['list']> {
    try {
      return await this.inquiries.list(actor.userId);
    } catch (error) {
      if (error instanceof OperationsError) throw error.toHttp();
      throw error;
    }
  }
}
