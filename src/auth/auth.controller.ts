import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
import { AspirantSendOtpDto } from "./dto/aspirant-send-otp.dto";
import { AspirantVerifyOtpDto } from "./dto/aspirant-verify-otp.dto";
import { GoogleExchangeDto } from "./dto/google-exchange.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { setSessionCookie, clearSessionCookie } from "./session-cookie";

// Tighter limits for auth endpoints to prevent brute-force / SMS-burn attacks.
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 10 } };
const STRICT_AUTH_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Set the HttpOnly session cookie from a login result and return the result
   * unchanged. The token stays in the JSON body too, so legacy bearer clients
   * keep working during the cookie rollout.
   */
  private withSession<T extends { token?: string }>(
    res: Response,
    result: T,
  ): T {
    if (result?.token) setSessionCookie(res, result.token);
    return result;
  }

  @Post("login")
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: "Voter/aspirant login with EPIC ID (returns JWT)" })
  @ApiResponse({
    status: 201,
    description: "Login successful, JWT returned",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.withSession(res, await this.authService.login(dto));
  }

  @Post("admin/login")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Admin login with password (returns JWT)" })
  @ApiResponse({
    status: 201,
    description: "Login successful, JWT returned",
  })
  @ApiResponse({ status: 404, description: "Admin not found" })
  async adminLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withSession(res, await this.authService.adminLogin(dto));
  }

  @Post("verify-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Verify OTP and get JWT token for voter" })
  @ApiResponse({ status: 201, description: "OTP verified, JWT token returned" })
  @ApiResponse({ status: 401, description: "Invalid OTP" })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withSession(res, await this.authService.verifyOtp(dto));
  }

  @Post("admin/verify-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Verify OTP and get JWT token for admin" })
  @ApiResponse({ status: 201, description: "OTP verified, JWT token returned" })
  @ApiResponse({ status: 401, description: "Invalid OTP" })
  async adminVerifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withSession(res, await this.authService.adminVerifyOtp(dto));
  }

  // POST /auth/admin/seed removed — admin creation must not be exposed over an
  // unauthenticated public endpoint. Seed admins via a one-off CLI/migration.

  @Get("google")
  @ApiOperation({
    summary: "Initiate Google OAuth 2.0 Authorization Code flow",
    description:
      "Redirects the browser to Google's consent screen. After consent, Google redirects back to /auth/google/callback.",
  })
  @ApiResponse({ status: 302, description: "Redirect to Google OAuth" })
  @ApiQuery({ name: "state", required: false })
  googleOAuthRedirect(
    @Query("state") clientState: string | undefined,
    @Res() res: Response,
  ) {
    // Embed the frontend's CSRF state inside an HMAC-signed, fresh-stamped
    // wrapper and round-trip it via Google. The callback verifies the
    // signature + freshness and echoes the client state back — no cookie
    // required. Fall back to a server-minted nonce if the client omits one.
    const crypto = require("crypto") as typeof import("crypto");
    const state = this.authService.issueOAuthState(
      clientState || crypto.randomBytes(16).toString("hex"),
    );
    const url = this.authService.getGoogleAuthUrl(state);
    return res.redirect(url);
  }

  @Get("google/callback")
  @ApiOperation({
    summary: "Google OAuth 2.0 callback",
    description:
      "Google redirects here with an authorization code. Backend exchanges it for tokens, fetches the profile, creates/finds the user, issues a JWT, and redirects to the frontend app with the token.",
  })
  @ApiResponse({
    status: 302,
    description: "Redirect to frontend with one-time code",
  })
  async googleOAuthCallback(
    @Query("code") code: string,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      return res.status(400).send(`Google OAuth error: ${error}`);
    }
    const clientState = state ? this.authService.verifyOAuthState(state) : null;
    if (!clientState) {
      return res.status(400).send("Invalid OAuth state — possible CSRF");
    }
    const { token, errorRedirectUrl } =
      await this.authService.handleGoogleCallback(code);
    if (errorRedirectUrl) {
      return res.redirect(errorRedirectUrl);
    }

    // Hand the frontend a single-use code (not the JWT) so the token never
    // appears in the URL / browser history / referrer / logs. The frontend
    // redeems it via POST /auth/google/exchange.
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
      "Validates the OAuth state, consumes the single-use code, sets a secure HttpOnly session cookie, and returns the authenticated user.",
  })
  @ApiResponse({ status: 201, description: "Session established" })
  @ApiResponse({ status: 401, description: "Invalid or expired code/state" })
  async googleExchange(
    @Body() dto: GoogleExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.exchangeOneTimeCode(
      dto.code,
      dto.state,
    );
    setSessionCookie(res, token);
    return { token, user };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({ status: 200, description: "User profile returned" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  me(@CurrentUser() user: any) {
    return this.authService.profile(user.id);
  }

  @Post("logout")
  @HttpCode(200)
  @ApiOperation({ summary: "Clear the session cookie / log out" })
  @ApiResponse({ status: 200, description: "Logged out" })
  logout(@Res({ passthrough: true }) res: Response) {
    // Stateless JWT sessions: clearing the cookie is the server-side logout.
    // Returns success even when no session was present.
    clearSessionCookie(res);
    return { success: true };
  }

  @Post("aspirant/send-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Send OTP to aspirant mobile number for login" })
  @ApiResponse({
    status: 201,
    description: "OTP sent, verificationId returned",
  })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  aspirantSendLoginOtp(@Body() dto: AspirantSendOtpDto) {
    return this.authService.aspirantSendLoginOtp(dto);
  }

  @Post("aspirant/resend-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Resend OTP to aspirant mobile number for login" })
  @ApiResponse({
    status: 200,
    description: "OTP resent, verificationId returned",
  })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  aspirantResendLoginOtp(@Body() dto: AspirantSendOtpDto) {
    return this.authService.aspirantResendLoginOtp(dto);
  }

  @Post("aspirant/verify-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Verify aspirant OTP and get JWT token" })
  @ApiResponse({ status: 201, description: "OTP verified, JWT token returned" })
  @ApiResponse({ status: 401, description: "Invalid OTP" })
  async aspirantVerifyLoginOtp(
    @Body() dto: AspirantVerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withSession(
      res,
      await this.authService.aspirantVerifyLoginOtp(dto),
    );
  }
}
