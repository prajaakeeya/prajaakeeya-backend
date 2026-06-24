import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PassportModule } from "@nestjs/passport";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import * as jwt from "jsonwebtoken";
import { JwtStrategy } from "../../src/auth/strategies/jwt.strategy";

/**
 * HTTP-level e2e harness (NO database).
 *
 * Boots a real Nest application around the controller(s) under test with:
 *  - the REAL JwtAuthGuard / JwtStrategy (so 401s, @Public, and req.user are
 *    exercised exactly as in production),
 *  - the same global ValidationPipe + `api` prefix as src/main.ts,
 *  - the controllers' service dependencies supplied as mocks (no DB / no
 *    network — the data layer never runs).
 *
 * This isolates routing, guards, auth, and request validation while keeping the
 * suite fast and infra-free.
 */

// JwtStrategy reads JWT_SECRET in its constructor (passport secretOrKey), so it
// must be set before the app compiles. Tokens below are signed with the same
// value so the real strategy accepts them.
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-test-secret";

export interface E2EOptions {
  controllers: any[];
  /** Extra providers (typically `{ provide: SomeService, useValue: mock }`). */
  providers?: any[];
}

export async function createE2EApp(
  opts: E2EOptions,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [PassportModule],
    controllers: opts.controllers,
    providers: [
      JwtStrategy,
      // The strategy reads a cached tokenVersion for revocation; undefined =>
      // "not revoked", which is what we want for valid test tokens.
      {
        provide: CACHE_MANAGER,
        useValue: { get: async () => undefined, set: async () => undefined },
      },
      ...(opts.providers ?? []),
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}

/**
 * Mint a JWT the real JwtStrategy will accept. Defaults to a voter with id 1;
 * pass overrides for sub/role/etc.
 */
export function signToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: 1, role: "voter", tokenVersion: 0, ...overrides },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" },
  );
}
