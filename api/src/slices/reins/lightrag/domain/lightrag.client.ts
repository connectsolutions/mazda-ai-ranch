import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResult,
  ILightragHealth,
  IGetGraphInput,
  ILightragGraph,
  ITrackStatus,
  DocumentProcessingStatusTypes,
} from './lightrag.types';

export abstract class ILightragClient {
  abstract health(): Promise<ILightragHealth>;
  abstract ingestText(input: IIngestTextInput): Promise<IIngestResult>;
  abstract ingestUrl(input: IIngestUrlInput): Promise<IIngestResult>;
  abstract ingestFile(input: IIngestFileInput): Promise<IIngestResult>;
  abstract query(input: IQueryInput): Promise<IQueryResult>;
  abstract getTrackStatus(trackId: string): Promise<ITrackStatus>;
  abstract listDocumentStatuses(): Promise<
    Map<string, DocumentProcessingStatusTypes>
  >;
  abstract deleteDocumentsByTrackIds(trackIds: string[]): Promise<void>;
  abstract getGraphLabels(): Promise<string[]>;
  abstract getGraph(input: IGetGraphInput): Promise<ILightragGraph>;
}
