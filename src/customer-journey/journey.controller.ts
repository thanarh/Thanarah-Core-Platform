import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { OperationsError } from '../internal-operations/operations.errors';
import { readReceiptMultipartForm } from '../common/receipt-upload';
import { id } from './journey.model';
import { parse } from './journey.store';
import { JourneyAccounts } from './journey.accounts';
import { JourneyOrders } from './journey.orders';
import { JourneyDocuments } from './journey.documents';
import { JourneyAdmin } from './journey.admin';
import { JourneyBilling } from './journey.billing';
import { JourneyIntegrations } from './journey.integrations';

async function boundary<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof OperationsError) throw e.toHttp();
    throw e;
  }
}
@ApiTags('Customer public catalog')
@Controller('v1/customer-public')
export class JourneyPublicController {
  constructor(readonly accounts: JourneyAccounts) {}
  @Get('catalog')
  catalog() {
    return boundary(() => this.accounts.publicCatalog());
  }
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() body: unknown) {
    return boundary(() => this.accounts.register(body));
  }
}
@ApiTags('Customer journey')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller('v1/customer')
export class JourneyCustomerController {
  constructor(
    readonly accounts: JourneyAccounts,
    readonly orders: JourneyOrders,
    readonly documents: JourneyDocuments,
    readonly integrations: JourneyIntegrations,
  ) {}
  @Get('me')
  me(@CurrentPlatformUser() actor: AuthenticatedPlatformUser) {
    return boundary(() => this.accounts.me(actor.userId));
  }
  @Put('profile')
  profile(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Body() body: unknown) {
    return boundary(() => this.accounts.profile(actor.userId, body));
  }
  @Post('whatsapp/send')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  whatsapp(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Body() body: unknown) {
    return boundary(() => this.accounts.sendWhatsApp(actor.userId, body));
  }
  @Post('whatsapp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  verifyWhatsApp(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Body() body: unknown) {
    return boundary(() => this.accounts.verifyWhatsApp(actor.userId, body));
  }
  @Post('ai/bootstrap')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  aiBootstrap(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ) {
    const originHeader = request.headers.origin;
    const origin = typeof originHeader === 'string' ? originHeader : undefined;
    return boundary(() => this.integrations.embedBootstrap(actor.userId, origin));
  }
  @Post('orders')
  create(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Body() body: unknown) {
    return boundary(() => this.orders.create(actor.userId, body));
  }
  @Get('orders/:id')
  get(@CurrentPlatformUser() actor: AuthenticatedPlatformUser, @Param('id') value: string) {
    return boundary(() => this.orders.get(actor.userId, parse(id, value)));
  }
  @Post('orders/:id/actions')
  @HttpCode(200)
  action(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return boundary(() => this.orders.action(actor.userId, parse(id, value), body));
  }
  @Post('orders/:id/documents')
  upload(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Req() request: FastifyRequest,
  ) {
    return boundary(async () => {
      const orderId = parse(id, value);
      const { receipt, fields } = await readReceiptMultipartForm(request);
      return this.documents.upload(actor.userId, orderId, receipt, fields);
    });
  }
  @Get('documents/:id/download')
  download(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Res() reply: FastifyReply,
  ) {
    return boundary(async () =>
      sendFile(reply, await this.documents.download(actor.userId, parse(id, value))),
    );
  }
  @Post('orders/:id/review')
  review(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return boundary(() => this.orders.review(actor.userId, parse(id, value), body));
  }
}
function sendFile(
  reply: FastifyReply,
  file: { bytes: Buffer; mimeType: string; fileName: string },
) {
  reply
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Type', file.mimeType)
    .header(
      'Content-Disposition',
      `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
  return reply.send(file.bytes);
}
@ApiTags('Customer operations administration')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller('v1/customer-admin')
export class JourneyAdminController {
  constructor(
    readonly admin: JourneyAdmin,
    readonly documents: JourneyDocuments,
    readonly billing: JourneyBilling,
  ) {}
  @Get('session')
  session(@CurrentPlatformUser() a: AuthenticatedPlatformUser) {
    return boundary(() => this.admin.session(a.userId));
  }
  @Get('catalog')
  catalog(@CurrentPlatformUser() a: AuthenticatedPlatformUser) {
    return boundary(() => this.admin.catalog(a.userId));
  }
  @Put('catalog')
  save(@CurrentPlatformUser() a: AuthenticatedPlatformUser, @Body() body: unknown) {
    return boundary(() => this.admin.saveCatalog(a.userId, body));
  }
  @Post('catalog/publish')
  @HttpCode(200)
  publish(@CurrentPlatformUser() a: AuthenticatedPlatformUser, @Body() body: unknown) {
    return boundary(() => this.admin.publish(a.userId, body));
  }
  @Get('orders')
  list(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Query() query: Record<string, unknown>,
  ) {
    return boundary(() => this.admin.list(a.userId, query));
  }
  @Get('orders/:id')
  get(@CurrentPlatformUser() a: AuthenticatedPlatformUser, @Param('id') value: string) {
    return boundary(() => this.admin.get(a.userId, parse(id, value)));
  }
  @Post('orders/:id/actions')
  @HttpCode(200)
  action(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return boundary(() => this.admin.action(a.userId, parse(id, value), body));
  }
  @Post('documents/:id/review')
  @HttpCode(200)
  review(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return boundary(() => this.documents.review(a.userId, parse(id, value), body));
  }
  @Get('documents/:id/download')
  download(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Res() reply: FastifyReply,
  ) {
    return boundary(async () =>
      sendFile(reply, await this.documents.download(a.userId, parse(id, value), true)),
    );
  }
  @Post('orders/:id/invoices')
  invoice(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return boundary(() => this.billing.create(a.userId, parse(id, value), body));
  }
  @Post('invoices/:id/actions')
  @HttpCode(200)
  invoiceAction(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Param('id') value: string,
    @Body() body: unknown,
  ) {
    return boundary(() => this.billing.action(a.userId, parse(id, value), body));
  }
  @Get('events')
  events(
    @CurrentPlatformUser() a: AuthenticatedPlatformUser,
    @Query() query: Record<string, unknown>,
  ) {
    return boundary(() => this.admin.events(a.userId, query));
  }
}
