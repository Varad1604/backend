import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
const claimsSchema = z.object({ sub: z.uuid(), sid: z.uuid(), type: z.literal('access') });
@Injectable()
export class TokenService {
  private readonly keys = this.loadKeys();
  private loadKeys() {
    if (env.JWT_PRIVATE_KEY_BASE64 && env.JWT_PUBLIC_KEY_BASE64) {
      const privateKey = createPrivateKey(Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64'));
      const publicKey = createPublicKey(Buffer.from(env.JWT_PUBLIC_KEY_BASE64, 'base64'));
      if (privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || !createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).equals(publicKey.export({ type: 'spki', format: 'der' }))) {
        throw new Error('JWT keys must be a matching P-256 key pair');
      }
      return { privateKey, publicKey };
    }
    if (env.NODE_ENV === 'production' || env.DEMO_MODE !== 'true') throw new Error('JWT signing keys are required');
    return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  }
  issue(userId: string, sessionId: string): string {
    return jwt.sign({ sid: sessionId, type: 'access' }, this.keys.privateKey, {
      algorithm: 'ES256', expiresIn: 900, issuer: 'kpmpl-api', audience: 'kpmpl-clients', subject: userId, jwtid: randomUUID(),
    });
  }
  verify(token: string) {
    try {
      return claimsSchema.parse(jwt.verify(token, this.keys.publicKey, { algorithms: ['ES256'], issuer: 'kpmpl-api', audience: 'kpmpl-clients', maxAge: '15m' }));
    } catch { throw new UnauthorizedException('Invalid or expired session.'); }
  }
}
