import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import {
  RESOURCES,
  actionSchema,
  commandSchema,
  accrualSchema,
  type Resource,
} from './operations.model';
import { OperationsError, fail } from './operations.errors';
import { OperationsRecords } from './operations.records';
import { OperationsActions } from './operations.actions';
import { OperationsFinance } from './operations.finance';
import { OperationsService } from './operations.service';

@ApiTags('Internal company operations')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller('v1/internal')
export class OperationsController {
  constructor(
    readonly records: OperationsRecords,
    readonly actions: OperationsActions,
    readonly finance: OperationsFinance,
    readonly service: OperationsService,
  ) {}
  async boundary<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof OperationsError) throw e.toHttp();
      throw e;
    }
  }
  resource(value: string): Resource {
    if (!RESOURCES.includes(value as Resource))
      fail('COMPANY_RESOURCE_INVALID', 'نوع السجل غير متاح.', 404);
    return value as Resource;
  }
  parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) fail('COMPANY_INPUT_INVALID', 'تحقق من البيانات المطلوبة وصيغها.', 400);
    return parsed.data;
  }
  page(query: Record<string, unknown>) {
    return this.parse(
      z.object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        q: z.string().trim().max(100).default(''),
      }),
      query,
    );
  }
  @Get('session')
  session(@CurrentPlatformUser() actor: AuthenticatedPlatformUser) {
    return this.boundary(() => this.service.session(actor.userId));
  }
  @Get('records/:kind')
  list(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.boundary(() =>
      this.records.list(actor.userId, this.resource(kind), this.page(query)),
    );
  }
  @Post('records/:kind')
  create(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    return this.boundary(() =>
      this.records.write(actor.userId, this.resource(kind), this.parse(commandSchema, body)),
    );
  }
  @Put('records/:kind/:id')
  update(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.boundary(() =>
      this.records.write(
        actor.userId,
        this.resource(kind),
        this.parse(commandSchema, body),
        this.parse(z.string().uuid(), id),
      ),
    );
  }
  @Post('records/:kind/:id/actions')
  action(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.boundary(() =>
      this.actions.apply(
        actor.userId,
        this.resource(kind),
        this.parse(z.string().uuid(), id),
        this.parse(actionSchema, body),
      ),
    );
  }
  @Post('accruals')
  accrue(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Body() body: unknown) {
    return this.boundary(() => this.finance.accrue(actor.userId, this.parse(accrualSchema, body)));
  }
  @Get('finance')
  report(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Query('period') period: string) {
    return this.boundary(() =>
      this.finance.report(
        actor.userId,
        this.parse(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), period),
      ),
    );
  }
  @Get('audit')
  audit(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.boundary(() => {
      const p = this.page(query);
      return this.service.audit(actor.userId, p.page, p.limit);
    });
  }
  @Get('dashboard/:view')
  dashboard(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Param('view') view: string) {
    return this.boundary(() => this.service.dashboard(actor.userId, view));
  }
}
