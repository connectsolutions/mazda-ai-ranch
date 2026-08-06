import { Readable } from 'stream';

export type SourceTypes = 'file' | 'url' | 'text';

export interface ISourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexed: boolean;
  createdAt: Date;
  updatedAt: Date;
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

export interface IArchiveImportResult {
  detected: number;
  started: boolean;
}

export interface IFilesImportResult {
  added: number;
  skipped: number;
  failed: number;
  /** One `"<filename>: <reason>"` line per failed upload. */
  errors: string[];
}
