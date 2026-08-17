import { Readable } from 'stream';

export type SourceTypes = 'file' | 'url' | 'text';

/**
 * Per-source view of the last index run. `indexed` = LightRAG confirmed the
 * document as processed; `failed` = the last run reported an error for it and
 * nothing has succeeded since; `pending` = never sent, or sent and still
 * waiting for a verdict.
 */
export type SourceIndexStatusTypes = 'indexed' | 'pending' | 'failed';

export interface ISourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  /** Kept for callers that only care about searchable-or-not. */
  indexed: boolean;
  indexStatus: SourceIndexStatusTypes;
  indexError: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISourceFilter {
  page: number;
  perPage: number;
  search?: string;
  status?: SourceIndexStatusTypes;
  type?: SourceTypes;
}

export interface ISourcePage {
  items: ISourceData[];
  total: number;
  page: number;
  perPage: number;
}

export interface ISourceCounts {
  total: number;
  indexed: number;
  failed: number;
}

/**
 * Bytes of a source ready to stream to an HTTP response. `body` is consumed
 * exactly once by the caller.
 */
export interface ISourceContent {
  filename: string;
  contentType: string;
  contentLength: number | null;
  body: Readable;
}

/**
 * Result of pushing one source through LightRAG's ingest-then-process
 * pipeline. `indexed` is true only once LightRAG reports the document as
 * processed, i.e. actually searchable.
 */
export interface ISourceIndexOutcome {
  sourceId: string;
  name: string;
  indexed: boolean;
  error: string | null;
}

export interface ICreateSourceData {
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url?: string;
  mimeType?: string;
  content?: string;
  sizeBytes?: number;
}

export interface IUploadSourceFileInput {
  knowledgeId: string;
  filename: string;
  body: Buffer;
  contentType: string;
}

export interface IUploadSourceStreamInput {
  knowledgeId: string;
  filename: string;
  body: Readable;
  contentType: string;
}

export interface IUploadedSourceFile {
  url: string;
}

export type ImportJobStatusTypes = 'running' | 'done' | 'failed';

/**
 * Progress of one background bulk import (archive today). Lives in memory
 * only: an import cannot outlive the process anyway, so there is nothing to
 * persist that would still be true after a restart.
 */
export interface IImportJob {
  id: string;
  knowledgeId: string;
  kind: 'archive';
  status: ImportJobStatusTypes;
  detected: number;
  added: number;
  skipped: number;
  failed: number;
  /** First N `"<name>: <reason>"` lines, capped by the registry. */
  errors: string[];
  startedAt: Date;
  finishedAt: Date | null;
}

export interface IArchiveImportResult {
  detected: number;
  started: boolean;
  jobId: string;
}

export interface IFilesImportResult {
  added: number;
  skipped: number;
  failed: number;
  /** One `"<filename>: <reason>"` line per failed upload. */
  errors: string[];
}
