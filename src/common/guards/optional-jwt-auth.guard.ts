import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AuthUser } from "../decorators/current-user.decorator";

/**
 * Like {@link JwtAuthGuard} but NEVER blocks the request. When a valid Bearer
 * token is present, `req.user` is populated; otherwise the request proceeds
 * anonymously (`req.user` is undefined). Use on public routes that want to
 * *optionally* personalise the response for a signed-in caller — e.g. showing
 * an aspirant their own private contact details on the public profile route.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  // Overriding handleRequest so a missing/invalid token resolves to `undefined`
  // instead of throwing — the route still activates.
  handleRequest<TUser = AuthUser>(
    _err: Error | null,
    user: TUser | false | undefined,
  ): TUser | undefined {
    return user || undefined;
  }
}
