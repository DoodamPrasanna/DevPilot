import type { Document } from 'mongoose';

export function safeJsonTransform(_document: Document, serialized: Record<string, unknown>) {
  if (serialized._id !== undefined) {
    serialized.id = String(serialized._id);
  }

  delete serialized._id;
  delete serialized.__v;

  return serialized;
}
