import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireTenantPermissions } from '../tenant/tenant-require-permissions.decorator';
import { TenantAuthorizationGuard } from '../tenant/tenant-authorization.guard';
import { TenantContextGuard } from '../tenant/tenant-context.guard';
import { CurrentTenantContext } from '../tenant/tenant-current-context.decorator';
import type { TrustedTenantContext } from '../tenant/tenant-context.contract';
import {
  AiAgentDto,
  AiAgentListDto,
  AiBudgetDto,
  AiKnowledgeDto,
  aiAgentIdSchema,
  aiKnowledgeIdSchema,
  createAiAgentSchema,
  createAiKnowledgeSchema,
  runAiAgentSchema,
  saveAiBudgetSchema,
  updateAiAgentSchema,
} from './ai-platform.dto';
import type {
  CreateAiAgentInput,
  CreateAiKnowledgeInput,
  RunAiAgentInput,
  SaveAiBudgetInput,
  UpdateAiAgentInput,
} from './ai-platform.dto';
import { AiPlatformService } from './ai-platform.service';

@ApiTags('Tenant AI Platform')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/ai`)
export class AiPlatformController {
  constructor(private readonly ai: AiPlatformService) {}

  @Get('providers')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOperation({ summary: 'List provider adapters and their safe activation status' })
  @ApiOkResponse()
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.ai.read is required' })
  providers(): ReturnType<AiPlatformService['listProviders']> {
    return this.ai.listProviders();
  }

  @Get('tools')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOperation({ summary: 'List the tenant-safe AI tool registry' })
  tools(): ReturnType<AiPlatformService['listTools']> {
    return this.ai.listTools();
  }

  @Get('agents')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOkResponse({ type: AiAgentListDto })
  listAgents(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<AiPlatformService['listAgents']> {
    return this.ai.listAgents(context);
  }

  @Post('agents')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.ai.manage')
  @ApiBody({ type: AiAgentDto })
  @ApiCreatedResponse({ type: AiAgentDto })
  createAgent(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(createAiAgentSchema)) body: CreateAiAgentInput,
  ): ReturnType<AiPlatformService['createAgent']> {
    return this.ai.createAgent(context, body, actor.userId);
  }

  @Patch('agents/:agentId')
  @RequireTenantPermissions('tenant.ai.manage')
  @ApiBody({ type: AiAgentDto })
  @ApiOkResponse({ type: AiAgentDto })
  updateAgent(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('agentId', new ZodValidationPipe(aiAgentIdSchema)) agentId: string,
    @Body(new ZodValidationPipe(updateAiAgentSchema)) body: UpdateAiAgentInput,
  ): ReturnType<AiPlatformService['updateAgent']> {
    return this.ai.updateAgent(context, agentId, body, actor.userId);
  }

  @Get('knowledge')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOkResponse({ type: AiKnowledgeDto, isArray: true })
  listKnowledge(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<AiPlatformService['listKnowledge']> {
    return this.ai.listKnowledge(context);
  }

  @Post('knowledge')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.ai.knowledge.manage')
  @ApiBody({ type: AiKnowledgeDto })
  @ApiCreatedResponse({ type: AiKnowledgeDto })
  createKnowledge(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(createAiKnowledgeSchema)) body: CreateAiKnowledgeInput,
  ): ReturnType<AiPlatformService['createKnowledge']> {
    return this.ai.createKnowledge(context, body, actor.userId);
  }

  @Delete('knowledge/:knowledgeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantPermissions('tenant.ai.knowledge.manage')
  async deleteKnowledge(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('knowledgeId', new ZodValidationPipe(aiKnowledgeIdSchema)) knowledgeId: string,
  ): Promise<void> {
    await this.ai.deleteKnowledge(context, knowledgeId, actor.userId);
  }

  @Get('budget')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOkResponse({ type: AiBudgetDto })
  getBudget(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<AiPlatformService['getBudget']> {
    return this.ai.getBudget(context);
  }

  @Put('budget')
  @RequireTenantPermissions('tenant.ai.budget.manage')
  @ApiBody({ type: AiBudgetDto })
  @ApiOkResponse({ type: AiBudgetDto })
  saveBudget(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(saveAiBudgetSchema)) body: SaveAiBudgetInput,
  ): ReturnType<AiPlatformService['saveBudget']> {
    return this.ai.saveBudget(context, body, actor.userId);
  }

  @Get('usage')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOkResponse()
  getUsage(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<AiPlatformService['getUsage']> {
    return this.ai.getUsage(context);
  }

  @Get('audit')
  @RequireTenantPermissions('tenant.ai.read')
  @ApiOkResponse()
  listAudit(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<AiPlatformService['listAudit']> {
    return this.ai.listAudit(context);
  }

  @Post('agents/:agentId/run')
  @RequireTenantPermissions('tenant.ai.run')
  @ApiOperation({
    summary: 'Run an agent with a synthetic test prompt only',
    description:
      'Prompts and results are not stored or logged. Knowledge retrieval is tenant-scoped. External providers remain disabled unless explicitly configured.',
  })
  @ApiBody({
    schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } },
  })
  @ApiOkResponse()
  runAgent(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Param('agentId', new ZodValidationPipe(aiAgentIdSchema)) agentId: string,
    @Body(new ZodValidationPipe(runAiAgentSchema)) body: RunAiAgentInput,
  ): ReturnType<AiPlatformService['runAgent']> {
    return this.ai.runAgent(context, agentId, body, actor.userId);
  }
}
