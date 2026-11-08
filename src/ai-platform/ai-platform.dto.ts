import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/u;

export const aiProviderSchema = z.enum(['openai-compatible', 'ollama']);

export const createAiAgentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).default(''),
  instructions: z.string().trim().min(1).max(4000),
  provider: aiProviderSchema,
  model: z.string().trim().regex(modelPattern),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  allowedTools: z.array(z.literal('knowledge.search')).max(1).default(['knowledge.search']),
});

export const updateAiAgentSchema = createAiAgentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);

export const aiAgentIdSchema = z.string().regex(uuidPattern);
export const createAiKnowledgeSchema = z.object({
  title: z.string().trim().min(2).max(120),
  kind: z.enum(['FAQ', 'TEXT']),
  content: z.string().trim().min(5).max(12000),
});

export const aiKnowledgeIdSchema = z.string().regex(uuidPattern);
export const saveAiBudgetSchema = z.object({
  monthlyTokenLimit: z.number().int().min(1).max(100000000),
  maxInputTokens: z.number().int().min(1).max(100000),
  maxOutputTokens: z.number().int().min(1).max(100000),
});

export const runAiAgentSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(13)
    .max(8000)
    .refine((value) => value.startsWith('[SYNTHETIC]')),
});

export type CreateAiAgentInput = z.infer<typeof createAiAgentSchema>;
export type UpdateAiAgentInput = z.infer<typeof updateAiAgentSchema>;
export type CreateAiKnowledgeInput = z.infer<typeof createAiKnowledgeSchema>;
export type SaveAiBudgetInput = z.infer<typeof saveAiBudgetSchema>;
export type RunAiAgentInput = z.infer<typeof runAiAgentSchema>;

export class AiAgentDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  description!: string;
  @ApiProperty({ type: String })
  instructions!: string;
  @ApiProperty({ enum: ['openai-compatible', 'ollama'] })
  provider!: string;
  @ApiProperty({ type: String })
  model!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: string;
  @ApiProperty({ type: String, isArray: true })
  allowedTools!: string[];
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AiAgentListDto {
  @ApiProperty({ type: AiAgentDto, isArray: true })
  items!: AiAgentDto[];
}

export class AiKnowledgeDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ enum: ['FAQ', 'TEXT'] })
  kind!: string;
  @ApiProperty({ type: String })
  content!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AiBudgetDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  monthlyTokenLimit!: number | null;
  @ApiProperty({ type: Number })
  maxInputTokens!: number;
  @ApiProperty({ type: Number })
  maxOutputTokens!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
