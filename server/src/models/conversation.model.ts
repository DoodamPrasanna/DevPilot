import mongoose, { type Model, type Types } from 'mongoose';

import { safeJsonTransform } from './model-options.js';

const { Schema } = mongoose;

export interface Conversation {
  userId: Types.ObjectId;
  repositoryId?: Types.ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<Conversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository' },
    title: { type: String, required: true, trim: true, maxlength: 200 },
  },
  {
    timestamps: true,
    toJSON: { transform: safeJsonTransform },
  },
);

conversationSchema.index({ userId: 1, repositoryId: 1 });

export const ConversationModel =
  (mongoose.models.Conversation as Model<Conversation> | undefined) ?? mongoose.model<Conversation>('Conversation', conversationSchema);
