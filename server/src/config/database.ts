import mongoose from 'mongoose';

import { env } from './env.js';

let connectionPromise: Promise<typeof mongoose> | undefined;

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(uri)
    .then(() => mongoose)
    .catch(() => {
      throw new Error('MongoDB connection failed. Check MONGODB_URI and database availability.');
    })
    .finally(() => {
      connectionPromise = undefined;
    });

  return connectionPromise;
}

export async function disconnectDatabase(): Promise<void> {
  if (connectionPromise) {
    await connectionPromise.catch(() => undefined);
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
