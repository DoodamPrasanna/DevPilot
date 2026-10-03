import { GoogleGenAI } from '@google/genai';

import { EmbeddingProviderError, type EmbeddingProvider } from './embedding-provider.js';

export const GEMINI_EMBEDDING_DIMENSIONS = 768;
const MAX_EMBEDDING_BATCH_SIZE = 16;

interface GeminiEmbeddingClient {
  models: {
    embedContent(input: {
      model: string;
      contents: string[];
      config: { outputDimensionality: number };
    }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
  };
}

export function createGeminiEmbeddingProvider(
  apiKey: string | undefined,
  model: string,
  injectedClient?: GeminiEmbeddingClient,
): EmbeddingProvider | undefined {
  const key = apiKey?.trim();
  if (!key) return undefined;

  const client = injectedClient ?? new GoogleGenAI({ apiKey: key });

  return {
    dimensions: GEMINI_EMBEDDING_DIMENSIONS,
    async embedDocuments(texts) {
      const vectors: number[][] = [];
      try {
        for (let offset = 0; offset < texts.length; offset += MAX_EMBEDDING_BATCH_SIZE) {
          const batch = texts.slice(offset, offset + MAX_EMBEDDING_BATCH_SIZE);
          const response = await client.models.embedContent({
            model,
            contents: batch,
            config: { outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS },
          });
          if (!Array.isArray(response.embeddings) || response.embeddings.length !== batch.length) {
            throw new EmbeddingProviderError();
          }
          for (const embedding of response.embeddings) {
            const values = embedding.values;
            if (
              !Array.isArray(values) ||
              values.length !== GEMINI_EMBEDDING_DIMENSIONS ||
              values.some((value) => !Number.isFinite(value))
            ) {
              throw new EmbeddingProviderError();
            }
            vectors.push(values);
          }
        }
        return vectors;
      } catch {
        throw new EmbeddingProviderError();
      }
    },
  };
}
