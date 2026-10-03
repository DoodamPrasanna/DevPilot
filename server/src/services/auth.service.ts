import type { Types } from 'mongoose';

import { env, type AppEnv } from '../config/env.js';
import { UserModel, type User } from '../models/user.model.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { AppError } from '../utils/app-error.js';
import { signAuthToken } from '../utils/jwt.js';
import { comparePassword, hashPassword } from '../utils/password.js';

type UserRecord = Pick<User, 'email' | 'createdAt'> & { _id: Types.ObjectId };

function toSafeUser(user: UserRecord): AuthenticatedUser {
  return {
    id: String(user._id),
    email: user.email,
    createdAt: user.createdAt,
  };
}

export async function registerUser(email: string, password: string): Promise<AuthenticatedUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await UserModel.findOne({ email: normalizedEmail });

  if (existingUser) {
    throw new AppError('An account with this email already exists', {
      statusCode: 409,
      code: 'EMAIL_ALREADY_EXISTS',
    });
  }

  const user = await UserModel.create({
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
  });

  return toSafeUser(user);
}

export async function loginUser(
  email: string,
  password: string,
  configuration: AppEnv = env,
): Promise<{ user: AuthenticatedUser; token: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await UserModel.findOne({ email: normalizedEmail });

  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw new AppError('Invalid email or password', {
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  }

  return {
    user: toSafeUser(user),
    token: signAuthToken(String(user._id), configuration),
  };
}

export async function getCurrentUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await UserModel.findById(userId);
  return user ? toSafeUser(user) : null;
}