import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Role } from '@marketpulse/contracts';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

export interface AccessUser { id: string; email: string; name: string; picture?: string; role: Role }
export interface AccessClaims extends JWTPayload { sub: string; role: Role }

export interface TokenService {
  signAccessToken(user: AccessUser): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessClaims>;
  newRefreshToken(): { value: string; hash: string; familyId: string };
  hashRefreshToken(value: string): string;
}

export function createTokenService(accessSecret: string, refreshPepper: string, accessTtl: string | number = '15m'): TokenService {
  const secret = new TextEncoder().encode(accessSecret);
  const hashRefreshToken = (value: string) => createHmac('sha256', refreshPepper).update(value).digest('hex');
  return {
    async signAccessToken(user) {
      return new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime(accessTtl)
        .sign(secret);
    },
    async verifyAccessToken(token) {
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      if (!payload.sub || !['viewer', 'operator', 'admin'].includes(String(payload.role))) throw new Error('Invalid access claims');
      return payload as AccessClaims;
    },
    newRefreshToken() {
      const value = randomBytes(32).toString('base64url');
      return { value, hash: hashRefreshToken(value), familyId: randomUUID() };
    },
    hashRefreshToken,
  };
}
