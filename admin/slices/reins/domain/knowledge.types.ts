// Domain types for knowledge bases (reins).
//
// Pragmatic exception: `IQueryResult` / `IGraph` are the opaque, deeply-nested
// read structures the UI renders verbatim, so they alias the generated
// `#api` DTOs (as the original store did) rather than being re-derived here.
// The slice's own entities/inputs below are pure domain.
import type { GraphDto, KnowledgeQueryResultDto } from '#api/data';

export type IQueryResult = KnowledgeQueryResultDto;
export type IGraph = GraphDto;

export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'failed';
export type SourceType = 'file' | 'url' | 'text';
export type SourceIndexStatus = 'indexed' | 'pending' | 'failed';
export type KnowledgeQueryMode = 'hybrid' | 'local' | 'global' | 'naive';

export interface IKnowledge {
  id: string;
  name: string;
  description: string | null;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatus;
  indexError: string | null;
  indexedAt: string | null;
  indexStartedAt: string | null;
  /** Index progress over the attached sources, as counted by the API. */
  sourceCount: number;
  indexedCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
  sources?: ISource[];
}

export interface ISource {
  id: string;
  knowledgeId: string;
  type: SourceType;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexed: boolean;
  indexStatus: SourceIndexStatus;
  indexError: string | null;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ISourceFilter {
  page: number;
  perPage: number;
  search?: string;
  status?: SourceIndexStatus;
  type?: SourceType;
}

export interface ISourcePage {
  items: ISource[];
  total: number;
  page: number;
  perPage: number;
}

export type ImportJobStatus = 'running' | 'done' | 'failed';

/** Progress of one background bulk import (archive). */
export interface IImportJob {
  id: string;
  knowledgeId: string;
  kind: 'archive';
  status: ImportJobStatus;
  detected: number;
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}

export type SourceContentDisposition = 'inline' | 'attachment';

/** Bytes of a source as fetched for preview or download. */
export interface ISourceContent {
  blob: Blob;
  filename: string;
  contentType: string;
}

export interface ICreateKnowledgeInput {
  name: string;
  description?: string;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IUpdateKnowledgeInput {
  name?: string;
  description?: string | null;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IKnowledgeSetupStatus {
  hasChatCredential: boolean;
  hasEmbeddingCredential: boolean;
  hasUrl: boolean;
  hasBucket: boolean;
  hasCredentialsSelected: boolean;
  isHealthy: boolean;
}

/**
 * What LightRAG is actually running, read from its own /health. Its bindings
 * are resolved from container env at startup, so this is the effective config
 * regardless of what is selected in the admin.
 */
export interface IKnowledgeRuntimeConfig {
  llmBinding: string | null;
  llmModel: string | null;
  embeddingBinding: string | null;
  embeddingModel: string | null;
  embeddingBindingHost: string | null;
}

export interface IKnowledgeStatus {
  enabled: boolean;
  setup: IKnowledgeSetupStatus;
  runtime: IKnowledgeRuntimeConfig | null;
}

export interface ISourceArchiveResult {
  detected: number;
  started: boolean;
  /** Id of the background job to follow via listImports. */
  jobId: string;
}

export interface ISourceSitemapResult {
  added: number;
  discovered: number;
}

export interface ISourceFilesResult {
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
}
