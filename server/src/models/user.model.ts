import mongoose, { type Model } from 'mongoose';

import { safeJsonTransform } from './model-options.js';

const { Schema } = mongoose;

export interface User {
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, trim: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(document, serialized) {
        safeJsonTransform(document, serialized);
        Reflect.deleteProperty(serialized, 'passwordHash');
        return serialized;
      },
    },
  },
);

export const UserModel = (mongoose.models.User as Model<User> | undefined) ?? mongoose.model<User>('User', userSchema);
