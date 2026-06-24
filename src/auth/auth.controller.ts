import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { AuthService, SessionResult } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { GoogleExchangeDto } from "./dto/google-exchange.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import {
  setSessionCookie,
  setRefreshCookie,
  clearSessionCookie,
  clearRefreshCookie,
  readCookie,
  REFRESH_COOKIE_NAME,
} from "./session-cookie";

// Tighter limits for auth endpoints to prevent brute-force / SMS-burn attacks.
const STRICT_AUTH_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

// Dev-only mock OAuth identity, persisted across relogins in this browser.
const MOCK_IDENTITY_COOKIE = "mock_identity";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Write both auth cookies from a freshly issued session: the short-lived
   * access token (path `/`) and the rotating refresh token (path-scoped to
   * `/auth/refresh`). Bearer/native clients also get the access token in the
   * JSON body.
   */
  private setSession(res: Response, session: SessionResult): void {
    setSessionCookie(res, session.accessToken);
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  }

  @Post("admin/login")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Admin login with password (sets session cookies)" })
  @ApiResponse({
    status: 201,
    description: "Login successful — session cookies set, access token in body",
  })
  @ApiResponse({ status: 404, description: "Admin not found" })
  async adminLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.adminLogin(dto);
    this.setSession(res, session);
    return { token: session.accessToken, user: session.user };
  }

  // POST /auth/admin/seed removed — admin creation must not be exposed over an
  // unauthenticated public endpoint. Seed admins via a one-off CLI/migration.

  @Get("google")
  @ApiOperation({
    summary: "Initiate Google OAuth 2.0 Authorization Code flow",
    description:
      "Redirects the browser to Google's consent screen. After consent, Google redirects back to /auth/google/callback.",
  })
  @ApiQuery({ name: "state", required: false })
  @ApiQuery({
    name: "fresh",
    required: false,
    description:
      "Dev-only mock OAuth: pass fresh=1 to force a brand-new fake identity " +
      "instead of reusing the one saved in this browser's mock_identity cookie.",
  })
  @ApiResponse({ status: 302, description: "Redirect to Google OAuth" })
  googleOAuthRedirect(
    @Query("state") clientState: string | undefined,
    @Query("fresh") fresh: string | undefined,
    @Res() res: Response,
  ) {
    // Embed the frontend's CSRF state inside an HMAC-signed, fresh-stamped
    // wrapper and round-trip it via Google. The callback verifies the
    // signature + freshness and echoes the client state back, which the
    // frontend compares against the value it stashed (double-submit CSRF).
    // Fall back to a server-minted nonce if the client omits one.
    const state = this.authService.issueOAuthState(
      clientState || randomBytes(16).toString("hex"),
    );
    const url = this.authService.getGoogleAuthUrl(state, fresh === "1");
    return res.redirect(url);
  }

  @Get("google/callback")
  @ApiOperation({
    summary: "Google OAuth 2.0 callback",
    description:
      "Google redirects here with an authorization code. Backend exchanges it for tokens, fetches the profile, creates/finds the user, and redirects to the frontend with a single-use code (never a JWT).",
  })
  @ApiResponse({
    status: 302,
    description: "Redirect to frontend with one-time code",
  })
  async googleOAuthCallback(
    @Query("code") code: string,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("fresh") fresh: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (error) {
      return res.status(400).send(`Google OAuth error: ${error}`);
    }
    const clientState = state ? this.authService.verifyOAuthState(state) : null;
    if (!clientState) {
      return res.status(400).send("Invalid OAuth state — possible CSRF");
    }
    const mockIdentityCookie = readCookie(req, MOCK_IDENTITY_COOKIE) ?? undefined;
    const { token, errorRedirectUrl, mockIdentityCookie: cookieToSet } =
      await this.authService.handleGoogleCallback(
        code,
        mockIdentityCookie,
        fresh === "1",
      );
    if (cookieToSet) {
      // Dev-only — lets a relogin after session expiry come back as the
      // same fake person instead of a brand-new random one. 180-day TTL is
      // plenty for local dev; harmless if it outlives that.
      res.cookie(MOCK_IDENTITY_COOKIE, cookieToSet, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 180 * 24 * 60 * 60 * 1000,
      });
    }
    if (errorRedirectUrl) {
      return res.redirect(errorRedirectUrl);
    }
    // Hand the frontend a single-use code (not a JWT) so no token ever appears
    // in the URL / history / referrer / logs. The frontend redeems it via
    // POST /auth/google/exchange, which sets the session + refresh cookies.
    const oneTimeCode = await this.authService.createOneTimeCode(
      token,
      clientState,
    );
    const frontendRedirect = this.authService.getFrontendRedirectUri();
    const sep = frontendRedirect.includes("?") ? "&" : "?";
    const redirectUrl = `${frontendRedirect}${sep}code=${encodeURIComponent(
      oneTimeCode,
    )}&state=${encodeURIComponent(clientState)}`;
    return res.redirect(redirectUrl);
  }

  @Post("google/exchange")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({
    summary: "Exchange a one-time OAuth code for a cookie session",
    description:
      "Validates the OAuth state, consumes the single-use code, sets the session + refresh cookies, and returns the authenticated user.",
  })
  @ApiResponse({ status: 201, description: "Session established" })
  @ApiResponse({ status: 401, description: "Invalid or expired code/state" })
  async googleExchange(
    @Body() dto: GoogleExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { profile, ...session } = await this.authService.exchangeOneTimeCode(
      dto.code,
      dto.state,
    );
    this.setSession(res, session);
    return { token: session.accessToken, user: profile };
  }

  @Post("refresh")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({
    summary: "Refresh the session using the refresh-token cookie",
    description:
      "Reads the rotating refresh-token cookie, issues a new access token + rotated refresh token (resetting both cookies). Call this on a 401, then retry the original request.",
  })
  @ApiResponse({ status: 201, description: "Session refreshed" })
  @ApiResponse({
    status: 401,
    description: "Missing / invalid / revoked refresh token",
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = readCookie(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      throw new UnauthorizedException("No refresh token");
    }
    const session = await this.authService.rotateRefresh(refreshToken);
    this.setSession(res, session);
    return {
      token: session.accessToken,
      user: { id: session.user.id, role: session.user.role },
    };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({ status: 200, description: "User profile returned" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.profile(user.id);
  }

  @Post("logout")
  @Throttle(STRICT_AUTH_THROTTLE)
  @HttpCode(200)
  @ApiOperation({
    summary: "Log out — revoke the refresh session and clear cookies",
  })
  @ApiResponse({ status: 200, description: "Logged out" })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Server-side revocation is gated on a *verified* refresh token: a forged /
    // unsigned cookie must not be able to drive a revocation (DB token bump +
    // cache write) for an arbitrary user id. An invalid/expired token simply
    // clears the cookies — logout still succeeds. Throttled to bound abuse.
    const refreshToken = readCookie(req, REFRESH_COOKIE_NAME);
    const userId = refreshToken
      ? await this.authService.verifyRefreshSub(refreshToken)
      : null;
    if (userId) {
      await this.authService.revokeSession(userId);
    }
    clearSessionCookie(res);
    clearRefreshCookie(res);
    return { success: true };
  }
}
