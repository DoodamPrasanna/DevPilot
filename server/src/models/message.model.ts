import mongoose, { type Model, type Types } from 'mongoose';

import { safeJsonTransform } from './model-options.js';

const { Schema } = mongoose;

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  conversationId: Types.ObjectId;
  role: MessageRole;
  content: string;
  sources?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<Message>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true, maxlength: 100000 },
    sources: { type: [String], default: undefined },
  },
  {
    timestamps: true,
    toJSON: { transform: safeJsonTransform },
  },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

export const MessageModel = (mongoose.models.Message as Model<Message> | undefined) ?? mongoose.model<Message>('Message', messageSchema);
