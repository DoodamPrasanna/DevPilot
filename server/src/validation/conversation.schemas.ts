import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID is invalid');

export const conversationIdSchema = z.object({ conversationId: objectId }).strict();

export const createConversationSchema = z
  .object({
    title: z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title is too long').optional(),
    repositoryId: objectId.optional(),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    content: z.string().trim().min(1, 'Message cannot be empty').max(20000, 'Message is too long'),
  })
  .strict();

export const analyzeRepositorySchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    analysisType: z.enum(['explain', 'bugs', 'smells', 'security', 'function', 'interactions', 'improvements']).default('explain'),
  })
  .strict();

export const generateRepositoryTestsSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
  })
  .strict();