import "./instrument"; // MUST be first — initialises Sentry before anything else
import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ClassSerializerInterceptor, ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import { MulterExceptionFilter } from "./common/filters/multer-exception.filter";
import { Logger } from "nestjs-pino";

async function bootstrap() {
  // bufferLogs: true holds early bootstrap logs until Pino is ready, then
  // replays them through the structured logger instead of the default console.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Security headers. In production we ship a strict CSP: locking script/object
  // sources and forbidding framing hardens any HTML this origin ever serves.
  // CSP stays off in non-prod so the self-hosted Swagger UI assets keep working
  // (Swagger is disabled entirely in production).
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production"
          ? {
              useDefaults: false,
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                frameAncestors: ["'none'"],
              },
            }
          : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  // Serialize responses through class-transformer so entity-level @Exclude
  // (e.g. User.passwordHash / passwordSalt / refreshTokenHash) is honoured on
  // every endpoint that returns an entity — credential material can never leak
  // by being returned or spread.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new MulterExceptionFilter());

  // CORS: restrict origins based on environment
  const corsEnv =
    process.env.NODE_ENV === "production"
      ? process.env.CORS_ALLOWED_ORIGINS_PROD
      : process.env.CORS_ALLOWED_ORIGINS_DEV;
  const allowedOrigins = (corsEnv ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  // Swagger: only enable in non-production environments
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Prajaakeeya API Documentation")
      .setDescription("API Documentation for Prajaakeeya can be found here.")
      .setVersion("2.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("bba6b5eb2fa88335dshb834jhb3chq36", app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
}

void bootstrap();
