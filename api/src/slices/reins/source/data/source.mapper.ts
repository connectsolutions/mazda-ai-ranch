import { Injectable } from '@nestjs/common';
import type { Source as PrismaSource, Prisma } from '@prisma/client';
import {
  ISourceData,
  ICreateSourceData,
  SourceIndexStatusTypes,
  SourceTypes,
} from '../domain/source.types';

const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

function isSourceType(value: string): value is SourceTypes {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function parseSourceType(value: string): SourceTypes {
  return isSourceType(value) ? value : 'text';
}

/**
 * A processed doc id wins over any leftover error: LightRAG confirmed the
 * content is searchable, whatever an earlier run said. Only a source with no
 * doc id and a recorded error is failed; no id and no error is pending.
 */
export function deriveIndexStatus(record: {
  lightragDocId: string | null;
  indexError: string | null;
}): SourceIndexStatusTypes {
  if (record.lightragDocId !== null) return 'indexed';
  if (record.indexError !== null) return 'failed';
  return 'pending';
}

@Injectable()
export class SourceMapper {
  toEntity(record: PrismaSource): ISourceData {
    const indexStatus = deriveIndexStatus(record);
    return {
      id: record.id,
      knowledgeId: record.knowledgeId,
      type: parseSourceType(record.type),
      name: record.name,
      url: record.url ?? null,
      mimeType: record.mimeType ?? null,
      content: record.content ?? null,
      sizeBytes: record.sizeBytes ?? null,
      indexed: indexStatus === 'indexed',
      indexStatus,
      indexError: record.indexError ?? null,
      indexedAt: record.indexedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateSourceData): Prisma.SourceUncheckedCreateInput {
    return {
      id: `source-${crypto.randomUUID()}`,
      knowledgeId: data.knowledgeId,
      type: data.type,
      name: data.name,
      url: data.url ?? null,
      mimeType: data.mimeType ?? null,
      content: data.content ?? null,
      sizeBytes: data.sizeBytes ?? null,
    };
  }
}
