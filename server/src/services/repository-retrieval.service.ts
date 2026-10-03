import mongoose from 'mongoose';

import type { EmbeddingProvider } from '../ai/embedding-provider.js';
import { env } from '../config/env.js';
import { RepositoryChunkModel } from '../models/repository-chunk.model.js';
import type { RepositoryContext } from './repository-context.service.js';
import { logger } from '../utils/logger.js';

export interface RetrievedChunk {
  filePath: string;
  content: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  score: number;
}

export function limitRetrievedChunks(
  chunks: RetrievedChunk[],
  question: string,
  maxChunks = env.MAX_REPOSITORY_RETRIEVED_CHUNKS,
  maxCharacters = env.MAX_REPOSITORY_RETRIEVAL_CHARS,
): RepositoryContext {
  const ranked = [...chunks].sort((left, right) =>
    (right.score + deterministicBonus(right.filePath, question)) -
      (left.score + deterministicBonus(left.filePath, question)) ||
    left.filePath.localeCompare(right.filePath) ||
    left.chunkIndex - right.chunkIndex,
  );
  const files: RepositoryContext['files'] = [];
  const seen = new Set<string>();
  let totalCharacters = 0;
  for (const chunk of ranked) {
    if (files.length >= maxChunks || totalCharacters >= maxCharacters) break;
    const content = chunk.content.slice(0, maxCharacters - totalCharacters);
    if (!content) continue;
    const identity = `${chunk.filePath}:${chunk.chunkIndex}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    files.push({ path: `${chunk.filePath}#L${chunk.startLine}-L${chunk.endLine}`, content });
    totalCharacters += content.length;
  }
  return { files, totalCharacters };
}

export function buildRepositoryVectorSearchPipeline(
  repositoryObjectId: mongoose.Types.ObjectId,
  userObjectId: mongoose.Types.ObjectId,
  indexVersion: string,
  queryVector: number[],
): mongoose.PipelineStage[] {
  return [
    {
      $vectorSearch: {
        index: env.ATLAS_VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(50, env.MAX_REPOSITORY_RETRIEVED_CHUNKS * 10),
        limit: Math.max(env.MAX_REPOSITORY_RETRIEVED_CHUNKS * 4, 12),
        filter: {
          repositoryId: { $eq: repositoryObjectId },
          userId: { $eq: userObjectId },
          indexVersion: { $eq: indexVersion },
        },
      },
    },
    {
      $project: {
        filePath: 1,
        content: 1,
        chunkIndex: 1,
        startLine: 1,
        endLine: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];
}

function deterministicBonus(filePath: string, question: string): number {
  const filename = filePath.slice(filePath.lastIndexOf('/') + 1).toLowerCase();
  const query = question.toLowerCase();
  let score = 0;
  if (query.includes(filePath.toLowerCase())) score += 10;
  if (query.includes(filename)) score += 5;
  const symbols = query.match(/[a-z_$][\w$]{2,}/gi) ?? [];
  for (const symbol of symbols) {
    if (new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(filename)) score += 2;
  }
  return score;
}

export async function retrieveIndexedRepositoryContext(
  userId: string,
  repositoryId: string,
  indexVersion: string | undefined,
  question: string,
  embeddingProvider?: EmbeddingProvider,
): Promise<RepositoryContext | null> {
  if (!embeddingProvider || !indexVersion) return null;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const repositoryObjectId = new mongoose.Types.ObjectId(repositoryId);
  let queryVector: number[][];
  try {
    queryVector = await embeddingProvider.embedDocuments([question]);
  } catch {
    logger.warn('repository query embedding unavailable; using bounded GitHub retrieval', { repositoryId });
    return null;
  }
  const vector = queryVector[0];
  if (!vector || vector.length !== embeddingProvider.dimensions) return null;

  let chunks: RetrievedChunk[];
  try {
    chunks = await RepositoryChunkModel.aggregate<RetrievedChunk>(
      buildRepositoryVectorSearchPipeline(repositoryObjectId, userObjectId, indexVersion, vector),
    );
  } catch (error) {
    logger.warn('Atlas vector search unavailable; using bounded GitHub retrieval', {
      repositoryId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }

  if (chunks.length === 0) return null;
  const result = limitRetrievedChunks(chunks, question);
  return result.files.length > 0 ? result : null;
}
