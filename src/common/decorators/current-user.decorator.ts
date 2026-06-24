import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * The authenticated identity attached to `req.user` by JwtStrategy / the SSE
 * guard. Mirror of the JWT payload the strategy returns — no DB entity.
 */
export interface AuthUser {
  id: number;
  role?: string;
  wardId?: number;
  tokenVersion?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
