import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ILlmGateway, ILlmHealthGateway } from './domain';
import { providerSupportsEmbeddings } from './domain/llm.utils';
import {
  CreateLlmCredentialDto,
  UpdateLlmCredentialDto,
  LlmHealthCheckResultDto,
} from './dtos';

@ApiTags('llms')
@Controller('llms')
export class LlmController {
  constructor(
    private gateway: ILlmGateway,
    private health: ILlmHealthGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all LLM credentials' })
  findAll() {
    return this.gateway.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get LLM credential by ID' })
  async findById(@Param('id') id: string) {
    const record = await this.gateway.findById(id);
    if (!record) throw new NotFoundException('LLM credential not found');
    return record;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new LLM credential' })
  create(@Body() dto: CreateLlmCredentialDto) {
    this.assertEmbeddingClaimIsPossible(dto.provider, dto.supportsEmbedding);
    return this.gateway.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an LLM credential' })
  async update(@Param('id') id: string, @Body() dto: UpdateLlmCredentialDto) {
    const existing = await this.gateway.findById(id);
    if (!existing) throw new NotFoundException('LLM credential not found');
    this.assertEmbeddingClaimIsPossible(
      dto.provider ?? existing.provider,
      dto.supportsEmbedding,
    );
    return this.gateway.update(id, dto);
  }

  /**
   * A credential marked embedding-capable is offered wherever an embedding
   * model is needed. Letting a provider without an embeddings endpoint carry
   * that flag is how a knowledge base ends up reporting itself indexed while
   * LightRAG never produced a single vector.
   */
  private assertEmbeddingClaimIsPossible(
    provider: string,
    supportsEmbedding: boolean | undefined,
  ): void {
    if (supportsEmbedding !== true) return;
    if (providerSupportsEmbeddings(provider)) return;
    throw new BadRequestException(
      `Provider "${provider}" has no embeddings API, so this credential cannot be used for embeddings.`,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an LLM credential' })
  remove(@Param('id') id: string) {
    return this.gateway.delete(id);
  }

  @Post(':id/health-check')
  @ApiOperation({
    summary: 'Health-check an LLM credential',
    operationId: 'healthCheckLlmCredential',
  })
  @ApiOkResponse({ type: LlmHealthCheckResultDto })
  async healthCheck(@Param('id') id: string): Promise<LlmHealthCheckResultDto> {
    const credential = await this.gateway.findById(id);
    if (!credential) throw new NotFoundException('LLM credential not found');
    return this.health.check(credential);
  }
}
