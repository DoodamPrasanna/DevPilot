export interface EmbeddingProvider {
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export class EmbeddingProviderError extends Error {
  constructor() {
    super('The embedding service is temporarily unavailable');
    this.name = 'EmbeddingProviderError';
  }
}
