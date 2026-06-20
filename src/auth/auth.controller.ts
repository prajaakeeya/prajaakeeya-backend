import {
  Body,
  Controller,
  Get,
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
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

// Tighter limits for auth endpoints to prevent brute-force / SMS-burn attacks.
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 10 } };
const STRICT_AUTH_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: "Voter/aspirant login with EPIC ID (returns JWT)" })
  @ApiResponse({
    status: 201,
    description: "Login successful, JWT returned",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("admin/login")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Admin login with password (returns JWT)" })
  @ApiResponse({
    status: 201,
    description: "Login successful, JWT returned",
  })
  @ApiResponse({ status: 404, description: "Admin not found" })
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto);
  }

  @Post("verify-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Verify OTP and get JWT token for voter" })
  @ApiResponse({ status: 201, description: "OTP verified, JWT token returned" })
  @ApiResponse({ status: 401, description: "Invalid OTP" })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post("admin/verify-otp")
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: "Verify OTP and get JWT token for admin" })
  @ApiResponse({ status: 201, description: "OTP verified, JWT token returned" })
  @ApiResponse({ status: 401, description: "Invalid OTP" })
  adminVerifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.adminVerifyOtp(dto);
  }

  @Get("google")
  @ApiOperation({
    summary: "Initiate Google OAuth 2.0 Authorization Code flow",
    description:
      "Redirects the browser to Google's consent screen. After consent, Google redirects back to /auth/google/callback.",
  })
  @ApiResponse({ status: 302, description: "Redirect to Google OAuth" })
  googleOAuthRedirect(@Res() res: Response) {
    // Mint a stateless, HMAC-signed CSRF state and round-trip it via Google.
    // The callback verifies the signature + freshness — no cookie required.
    const state = this.authService.issueOAuthState();
    const url = this.authService.getGoogleAuthUrl(state);
    return res.redirect(url);
  }

  @Get("google/callback")
  @ApiOperation({
    summary: "Google OAuth 2.0 callback",
    description:
      "Google redirects here with an authorization code. Backend exchanges it for tokens, fetches the profile, creates/finds the user, issues a JWT, and redirects to the frontend app with the token.",
  })
  @ApiResponse({ status: 302, description: "Redirect to frontend with token" })
  async googleOAuthCallback(
    @Query("code") code: string,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      return res.status(400).send(`Google OAuth error: ${error}`);
    }
    if (!state || !this.authService.verifyOAuthState(state)) {
      return res.status(400).send("Invalid OAuth state — possible CSRF");
    }
    const { redirectUrl } = await this.authService.handleGoogleCallback(code);
    return res.redirect(redirectUrl);
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
  aspirantVerifyLoginOtp(@Body() dto: AspirantVerifyOtpDto) {
    return this.authService.aspirantVerifyLoginOtp(dto);
  }
}
