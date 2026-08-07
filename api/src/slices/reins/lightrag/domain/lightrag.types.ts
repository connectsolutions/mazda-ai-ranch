export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

export interface IIngestTextInput {
  workspace: string;
  text: string;
  fileSource?: string;
}

export interface IIngestUrlInput {
  workspace: string;
  url: string;
}

export interface IIngestFileInput {
  workspace: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IIngestResult {
  docId: string;
}

export interface IQueryInput {
  workspace: string;
  query: string;
  mode?: QueryModeTypes;
  topK?: number;
}

// Ingest endpoints only enqueue: they return a track id and LightRAG builds
// chunks, embeddings and the graph in a background pipeline afterwards. A
// document is searchable only once it reaches 'processed'.
export type DocumentProcessingStatusTypes =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed';

export interface IDocumentProcessingStatus {
  id: string;
  status: DocumentProcessingStatusTypes;
  errorMessage: string | null;
}

export interface ITrackStatus {
  documents: IDocumentProcessingStatus[];
}

/**
 * A document as LightRAG stores it. `filePath` matters because LightRAG
 * refuses an upload whose filename it already holds, and that refusal names
 * only the file - resolving it back to a doc id needs this listing.
 */
export interface IDocumentRecord {
  id: string;
  status: DocumentProcessingStatusTypes;
  filePath: string | null;
}

export interface IQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IQueryResult {
  answer: string;
  references: IQueryReference[];
}

/**
 * What the LightRAG process is actually running, as reported by /health. Its
 * bindings come from the container env and are resolved once at startup, so
 * this is the only honest answer to "which embedding model is in use". Picking
 * a credential in the admin expresses intent; this is the effect.
 */
export interface ILightragRuntimeConfig {
  llmBinding: string | null;
  llmModel: string | null;
  embeddingBinding: string | null;
  embeddingModel: string | null;
  embeddingBindingHost: string | null;
}

export interface ILightragHealth {
  ok: boolean;
  configuration: ILightragRuntimeConfig | null;
}

export interface IGetGraphInput {
  label: string;
  maxDepth?: number;
  maxNodes?: number;
}

export interface ILightragGraphNode {
  id: string;
  label: string;
  entityType: string;
  description: string;
}

export interface ILightragGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string;
  description: string;
}

export interface ILightragGraph {
  nodes: ILightragGraphNode[];
  edges: ILightragGraphEdge[];
  isTruncated: boolean;
}

export class LightragClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'LightragClientError';
  }
}
