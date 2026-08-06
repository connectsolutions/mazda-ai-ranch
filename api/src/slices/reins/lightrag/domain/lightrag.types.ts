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

export interface IQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IQueryResult {
  answer: string;
  references: IQueryReference[];
}

export interface ILightragHealth {
  ok: boolean;
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
