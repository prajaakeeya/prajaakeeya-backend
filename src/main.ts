import "./instrument"; // MUST be first — initialises Sentry before anything else
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import { MulterExceptionFilter } from "./common/filters/multer-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers. In production we ship a strict CSP; locking script/object
  // sources and forbidding framing hardens any HTML this origin ever serves and
  // satisfies the production-CSP requirement. CSP stays off in non-prod so the
  // self-hosted Swagger UI assets keep working.
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
