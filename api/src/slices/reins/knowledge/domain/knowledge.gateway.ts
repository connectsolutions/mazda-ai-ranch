import {
  IKnowledgeRecord,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';

export abstract class IKnowledgeGateway {
  abstract findAll(): Promise<IKnowledgeRecord[]>;
  abstract findById(id: string): Promise<IKnowledgeRecord | null>;
  abstract findExistingByIds(ids: string[]): Promise<IKnowledgeRecord[]>;
  abstract create(data: ICreateKnowledgeData): Promise<IKnowledgeRecord>;
  abstract update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeRecord>;
  abstract updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeRecord>;
  abstract delete(id: string): Promise<void>;

  abstract searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult>;

  abstract getGraphLabels(): Promise<string[]>;
  abstract getGraph(params: IGetGraphParams): Promise<IGraphData>;
}
