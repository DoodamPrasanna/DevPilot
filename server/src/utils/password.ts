import bcrypt from 'bcryptjs';

const bcryptRounds = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptRounds);
}

export function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}