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

  // Optional — defaults to "120d" in JwtModule config
  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN?: string;

  // AWS S3 — required for media upload features
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
  AWS_CLOUDFRONT_DOMAIN?: string;

  // Google OAuth — required for voter/aspirant login
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

  // CORS
  @IsString()
  @IsOptional()
  CORS_ALLOWED_ORIGINS_DEV?: string;

  @IsString()
  @IsOptional()
  CORS_ALLOWED_ORIGINS_PROD?: string;

  // Redis — optional; falls back to in-memory when omitted
  @IsString()
  @IsOptional()
  REDIS_HOST?: string;

  @IsString()
  @IsOptional()
  REDIS_PORT?: string;

  // Caching & rate limiting
  @IsString()
  @IsOptional()
  CACHE_TTL_MS?: string;

  @IsString()
  @IsOptional()
  THROTTLE_TTL?: string;

  @IsString()
  @IsOptional()
  THROTTLE_LIMIT?: string;

  @IsString()
  @IsOptional()
  VOTE_THROTTLE_LIMIT?: string;

  // Firebase Cloud Messaging — optional; push disabled if neither is set
  @IsString()
  @IsOptional()
  FIREBASE_SERVICE_ACCOUNT?: string;

  @IsString()
  @IsOptional()
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;

  // Sentry error tracking — optional; disabled if unset
  @IsString()
  @IsOptional()
  SENTRY_DSN?: string;

  @IsString()
  @IsOptional()
  SENTRY_TRACES_SAMPLE_RATE?: string;

  // DB options
  @IsString()
  @IsOptional()
  TYPEORM_SYNCHRONIZE?: string;

  @IsString()
  @IsOptional()
  DB_POOL_MAX?: string;

  @IsString()
  @IsOptional()
  RDS_SSL_INSECURE?: string;

  @IsString()
  @IsOptional()
  RDS_CA_PATH?: string;

  // Runtime
  @IsString()
  @IsOptional()
  PORT?: string;

  @IsString()
  @IsOptional()
  NODE_APP_INSTANCE?: string;
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
  return validatedConfig;
}
