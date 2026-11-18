import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { pool } from './db';

export type AuthUser = { id: string; timeZone: string };

const devSecret = process.env.AUTH_DEV_SECRET;
if (devSecret && process.env.NODE_ENV === 'production') throw new Error('AUTH_DEV_SECRET는 운영에서 쓸 수 없습니다');
const key: Uint8Array | JWTVerifyGetKey | undefined = devSecret
  ? new TextEncoder().encode(devSecret)
  : process.env.AUTH_JWKS_URL ? createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL)) : undefined;

// 관리형 인증(예: Supabase Auth)이 발급한 토큰을 검증하고, sub로 프로필을 찾거나 만든다.
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token || !key) throw new UnauthorizedException('로그인이 필요해요');
    let sub: string | undefined;
    try {
      const { payload } = await jwtVerify(token, key as any, {
        issuer: process.env.AUTH_ISSUER || undefined,
        audience: process.env.AUTH_AUDIENCE || undefined,
      });
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException('로그인이 만료됐어요');
    }
    if (!sub) throw new UnauthorizedException();
    const { rows } = await pool.query(
      `with ins as (insert into profiles(auth_sub) values ($1) on conflict (auth_sub) do nothing returning id, time_zone)
       select id, time_zone from ins union all select id, time_zone from profiles where auth_sub = $1 limit 1`,
      [sub],
    );
    req.user = { id: rows[0].id, timeZone: rows[0].time_zone } satisfies AuthUser;
    return true;
  }
}

export const User = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
