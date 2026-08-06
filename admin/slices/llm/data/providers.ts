export interface IModelDef {
  id: string;
  label: string;
  capabilities: { chat: boolean; embedding: boolean };
}

export interface IProviderDef {
  id: string;
  label: string;
  models: IModelDef[];
}

export const PROVIDERS: IProviderDef[] = [
  {
    id: 'claude',
    label: 'Anthropic',
    models: [
      {
        id: 'claude-opus-4-7',
        label: 'Claude Opus 4.7',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        capabilities: { chat: true, embedding: false },
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'text-embedding-3-small',
        label: 'Embedding 3 small',
        capabilities: { chat: false, embedding: true },
      },
      {
        id: 'text-embedding-3-large',
        label: 'Embedding 3 large',
        capabilities: { chat: false, embedding: true },
      },
    ],
  },
];

// Providers with no embeddings endpoint at all. Kept in sync with the same
// guard on the api (llm.utils.ts), which is the authoritative check. Anthropic
// ships chat models only, so a credential flagged embedding-capable there can
// never produce a vector - it just leaves knowledge bases indexing into
// nothing. Unknown providers are allowed: we cannot rule them out.
const PROVIDERS_WITHOUT_EMBEDDINGS = new Set(['anthropic', 'claude']);

export function providerSupportsEmbeddings(providerId: string): boolean {
  return !PROVIDERS_WITHOUT_EMBEDDINGS.has(providerId.trim().toLowerCase());
}

export function getProvider(id: string): IProviderDef | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function getModel(
  providerId: string,
  modelId: string,
): IModelDef | null {
  const provider = getProvider(providerId);
  if (provider === null) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function isKnownProvider(value: string): boolean {
  return PROVIDERS.some((p) => p.id === value);
}

export function isKnownModel(providerId: string, modelId: string): boolean {
  return getModel(providerId, modelId) !== null;
}
