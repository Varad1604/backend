import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
// Brief §5.6: a breached-password check. The list is bundled offline — external calls are
// prohibited (brief §14), so this is a snapshot of the most common leaked passwords.
const BREACHED = new Set([
  '123456', 'password', '123456789', '12345678', '12345', 'qwerty', '1234567890', '1234567', '111111', '123123',
  'abc123', 'password1', '1234', 'qwerty123', '000000', 'iloveyou', '1q2w3e4r', 'qwertyuiop', 'monkey', 'dragon',
  '123321', '654321', '666666', '123qwe', 'myspace1', '121212', 'homelesspa', '123abc', 'sunshine', 'princess',
  'letmein', 'football', 'welcome', 'admin', 'login', 'passw0rd', 'master', 'hello', 'freedom', 'whatever',
  'qazwsx', 'trustno1', 'batman', 'pass123', 'test123', 'guest', 'welcome1', 'admin123', 'admin@123', 'root',
  'toor', 'p@ssw0rd', 'password123', 'password1234', 'password12', 'qwerty12345', 'letmein1234', 'admin12345',
  'kpmpl', 'kpmpl123', 'changeme', 'change-me', 'changeme123', 'india123', 'india@123', 'mumbai', 'punjab',
  'paper123', 'mill123', 'factory123', 'gate123', 'superuser', 'superadmin', 'system', 'user', 'user123',
  'abcd1234', 'a1b2c3d4', 'q1w2e3r4', '1qaz2wsx', 'zaq12wsx', 'asdfghjkl', 'asdfgh', 'zxcvbnm', 'poiuytrewq',
  'lkjhgfdsa', 'mnbvcxz', '0987654321', '987654321', '102030', '112233', '121314', '520520', '211314', '147258369',
  '147258', '159753', '13579', '246810', 'apple123', 'samsung', 'google123', 'facebook1', 'instagram',
  'november', 'summer2024', 'summer2026', 'winter2024', 'spring2024', 'january', 'monday', 'tuesday',
  'kaygaon', 'pravahax', 'prototype', 'demo1234', 'demo@123', 'demo12345', 'password!', 'p@ssword1', 'pass@word1',
]);
@Injectable()
export class PasswordService {
  private readonly dummy = this.hash(randomBytes(32).toString('hex'));
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }
  async verify(password: string, hash?: string): Promise<boolean> {
    try { return await argon2.verify(hash ?? await this.dummy, password); }
    catch { return false; }
  }
  assertAcceptable(password: string): void {
    if (password.length < 10 || password.length > 128) throw new Error('Password must be between 10 and 128 characters.');
    if (BREACHED.has(password.toLowerCase())) throw new Error('Choose a password that is not commonly breached.');
  }
}
