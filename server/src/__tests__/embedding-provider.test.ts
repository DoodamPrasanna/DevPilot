import { describe, expect, it, vi } from 'vitest';

import { EmbeddingProviderError } from '../ai/embedding-provider.js';
import { createGeminiEmbeddingProvider, GEMINI_EMBEDDING_DIMENSIONS } from '../ai/gemini-embedding.provider.js';

describe('independent embedding provider', () => {
  it('does not require Gemini credentials when embeddings are not configured', () => {
    expect(createGeminiEmbeddingProvider(undefined, 'embedding-model')).toBeUndefined();
  });

  it('embeds bounded batches and validates vector dimensions', async () => {
    const embedContent = vi.fn(async (input: { contents: string[] }) => ({
      embeddings: input.contents.map(() => ({ values: Array.from({ length: GEMINI_EMBEDDING_DIMENSIONS }, () => 0.25) })),
    }));
    const provider = createGeminiEmbeddingProvider('unit-test-key', 'embedding-model', { models: { embedContent } });

    const vectors = await provider?.embedDocuments(Array.from({ length: 18 }, (_, index) => `source-${index}`));

    expect(vectors).toHaveLength(18);
    expect(vectors?.every((vector) => vector.length === GEMINI_EMBEDDING_DIMENSIONS)).toBe(true);
    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(embedContent.mock.calls.map(([input]) => input.contents.length)).toEqual([16, 2]);
  });

  it('normalizes malformed provider vectors and upstream failures', async () => {
    const malformed = createGeminiEmbeddingProvider('unit-test-key', 'embedding-model', {
      models: { embedContent: async () => ({ embeddings: [{ values: [1, Number.NaN] }] }) },
    });
    const unavailable = createGeminiEmbeddingProvider('unit-test-key', 'embedding-model', {
      models: { embedContent: async () => { throw new Error('private provider response'); } },
    });

    await expect(malformed?.embedDocuments(['source'])).rejects.toBeInstanceOf(EmbeddingProviderError);
    await expect(unavailable?.embedDocuments(['source'])).rejects.toMatchObject({
      message: 'The embedding service is temporarily unavailable',
    });
  });
});
