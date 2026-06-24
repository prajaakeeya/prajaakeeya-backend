import { plainToInstance } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  validateSync,
} from "class-validator";

enum Environment {
  Development = "development",
  Staging = "staging",
  Production = "production",
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  // Optional. If unset, a distinct refresh-signing key is derived from
  // JWT_SECRET. Access token defaults to 15m, refresh to 7d.
  @IsString()
  @IsOptional()
  JWT_REFRESH_SECRET?: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty()
  AWS_S3_BUCKET_NAME!: string;

  @IsString()
  @IsNotEmpty()
  AWS_REGION!: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  GOOGLE_REDIRECT_URI?: string;

  @IsString()
  @IsOptional()
  GOOGLE_FRONTEND_REDIRECT_URI?: string;

  // Dev-only bypass for the real Google OAuth exchange — see AuthService.
  // Hard-gated to non-production regardless of this value.
  @IsString()
  @IsOptional()
  GOOGLE_OAUTH_MOCK?: string;

  // Dev-only: write uploads to local disk instead of S3 — see S3Service.
  // Hard-gated to non-production regardless of this value.
  @IsString()
  @IsOptional()
  USE_LOCAL_STORAGE?: string;

  // Session cookie SameSite policy: "lax" (default) or "none" (cross-site FE).
  @IsString()
  @IsOptional()
  COOKIE_SAMESITE?: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string;

  @IsString()
  @IsOptional()
  REDIS_PORT?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.toString()}`);
  }

  // CSRF guard: SameSite=None drops the browser's built-in cross-site cookie
  // protection, so it must not be used in production unless a dedicated CSRF
  // defence is added. Fail closed at boot rather than ship a CSRF-open config.
  if (
    validatedConfig.NODE_ENV === Environment.Production &&
    (validatedConfig.COOKIE_SAMESITE ?? "").toLowerCase() === "none"
  ) {
    throw new Error(
      "COOKIE_SAMESITE=none is not allowed when NODE_ENV=production (CSRF risk). " +
        "Use SameSite=Lax with a same-site frontend, or add CSRF tokens before enabling None.",
    );
  }

  return validatedConfig;
}
