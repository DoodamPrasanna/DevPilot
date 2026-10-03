import mongoose, { type Model, type Types } from 'mongoose';

import { safeJsonTransform } from './model-options.js';

const { Schema } = mongoose;

export interface Repository {
  userId: Types.ObjectId;
  githubOwner: string;
  githubRepo: string;
  githubFullName: string;
  defaultBranch: string;
  description: string;
  htmlUrl: string;
  indexingStatus: 'pending' | 'indexing' | 'ready' | 'failed';
  indexingError?: string;
  indexedAt?: Date;
  activeIndexVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const repositorySchema = new Schema<Repository>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    githubOwner: { type: String, required: true, trim: true },
    githubRepo: { type: String, required: true, trim: true },
    githubFullName: { type: String, required: true, trim: true },
    defaultBranch: { type: String, required: true, trim: true, default: 'main' },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    htmlUrl: { type: String, required: true, trim: true },
    indexingStatus: { type: String, enum: ['pending', 'indexing', 'ready', 'failed'], default: 'pending' },
    indexingError: { type: String, maxlength: 200, default: undefined },
    indexedAt: { type: Date, default: undefined },
    activeIndexVersion: { type: String, default: undefined },
  },
  {
    timestamps: true,
    toJSON: { transform: safeJsonTransform },
  },
);

repositorySchema.index({ userId: 1, githubFullName: 1 }, { unique: true });

export const RepositoryModel =
  (mongoose.models.Repository as Model<Repository> | undefined) ?? mongoose.model<Repository>('Repository', repositorySchema);
