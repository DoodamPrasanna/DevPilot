import mongoose, { type Model, type Types } from 'mongoose';

import { safeJsonTransform } from './model-options.js';

const { Schema } = mongoose;

export interface RepositoryChunk {
  repositoryId: Types.ObjectId;
  userId: Types.ObjectId;
  indexVersion: string;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  embedding?: number[];
  updatedAt: Date;
}

const repositoryChunkSchema = new Schema<RepositoryChunk>(
  {
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    indexVersion: { type: String, required: true, maxlength: 64 },
    filePath: { type: String, required: true, maxlength: 1024 },
    chunkIndex: { type: Number, required: true, min: 0 },
    startLine: { type: Number, required: true, min: 1 },
    endLine: { type: Number, required: true, min: 1 },
    content: { type: String, required: true, maxlength: 8000 },
    contentHash: { type: String, required: true, minlength: 64, maxlength: 64 },
    embedding: { type: [Number], default: undefined },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    toJSON: { transform: safeJsonTransform },
  },
);

repositoryChunkSchema.index({ repositoryId: 1, userId: 1, indexVersion: 1, filePath: 1, chunkIndex: 1 }, { unique: true });
repositoryChunkSchema.index({ repositoryId: 1, userId: 1, indexVersion: 1 });

export const RepositoryChunkModel =
  (mongoose.models.RepositoryChunk as Model<RepositoryChunk> | undefined) ??
  mongoose.model<RepositoryChunk>('RepositoryChunk', repositoryChunkSchema);
