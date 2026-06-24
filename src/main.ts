import "./instrument"; // MUST be first — initialises Sentry before anything else
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import * as express from "express";
import * as path from "path";
import { MulterExceptionFilter } from "./common/filters/multer-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers. CSP is disabled because this process serves only the
  // JSON API; Swagger UI (when enabled in non-prod) hosts its own assets and
  // would break under a default-strict CSP.
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production" ? undefined : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  // Dev-only local-storage fallback for file uploads (see S3Service /
  // USE_LOCAL_STORAGE) — serves whatever S3Service wrote to ./uploads.
  // Registered before setGlobalPrefix so files are at /uploads/*, not
  // /api/uploads/*. Hard-gated to non-production, mirroring S3Service.
  if (
    process.env.USE_LOCAL_STORAGE === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  }

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
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
