import {
  ISourceData,
  ICreateSourceData,
  ISourceContent,
  ISourceCounts,
  ISourceFilter,
  ISourcePage,
  IUploadSourceFileInput,
  IUploadSourceStreamInput,
  IUploadedSourceFile,
  ISourceIndexOutcome,
} from './source.types';

export abstract class ISourceGateway {
  abstract findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]>;
  abstract findPage(
    knowledgeId: string,
    filter: ISourceFilter,
  ): Promise<ISourcePage>;
  /**
   * Index progress per knowledge. Knowledges with no sources are absent from
   * the map; callers treat that as all zeros.
   */
  abstract countByKnowledgeIds(
    knowledgeIds: string[],
  ): Promise<Map<string, ISourceCounts>>;
  abstract findById(id: string): Promise<ISourceData | null>;
  abstract create(data: ICreateSourceData): Promise<ISourceData>;
  abstract createMany(data: ICreateSourceData[]): Promise<ISourceData[]>;
  abstract delete(id: string): Promise<void>;

  abstract uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile>;
  abstract uploadFileStream(
    input: IUploadSourceStreamInput,
  ): Promise<IUploadedSourceFile>;
  abstract deleteFile(url: string): Promise<void>;
  /** Bytes of a file or text source. Throws for url sources. */
  abstract readContent(source: ISourceData): Promise<ISourceContent>;

  abstract indexSources(sources: ISourceData[]): Promise<ISourceIndexOutcome[]>;
  /**
   * Sources handed to LightRAG that nothing has confirmed yet, across every
   * knowledge. These are what a reconcile pass has to look at.
   */
  abstract findUnconfirmed(): Promise<ISourceData[]>;
  /**
   * Ask LightRAG about each source's stored handle once and write down what it
   * says. Unlike `indexSources` this never uploads and never waits: a document
   * still in the pipeline is simply left for the next pass.
   */
  abstract confirmProcessed(
    sources: ISourceData[],
  ): Promise<ISourceIndexOutcome[]>;
  abstract removeFromIndex(source: ISourceData): Promise<void>;
  abstract removeAllByKnowledge(knowledgeId: string): Promise<void>;
}
