import { Module } from "@nestjs/common";
import { APP_GUARD, APP_FILTER } from "@nestjs/core";
import { SentryModule, SentryGlobalFilter } from "@sentry/nestjs/setup";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { createKeyv } from "@keyv/redis";
import Redis from "ioredis";

import { ClsModule } from "nestjs-cls";
import * as fs from "fs";

import { validate } from "./config/env.validation";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { WardsModule } from "./wards/wards.module";
import { AspirantsModule } from "./aspirants/aspirants.module";
import { VotesModule } from "./votes/votes.module";
import { AdminModule } from "./admin/admin.module";
import { ForumModule } from "./forum/forum.module";
import { GeographyModule } from "./geography/geography.module";
import { AspirantChatModule } from "./aspirants/aspirant-chat.module";
import { MediaModule } from "./common/media.module";
import { HealthController } from "./health/health.controller";

import { User } from "./users/user.entity";
import { Ward } from "./wards/ward.entity";
import { Aspirant } from "./aspirants/aspirant.entity";
import { Vote } from "./votes/vote.entity";
import { VotingWindow } from "./votes/voting-window.entity";
import { Message } from "./forum/message.entity";
import { State } from "./geography/state.entity";
import { Parliamentary } from "./geography/parliamentary.entity";
import { Assembly } from "./geography/assembly.entity";
import { Municipality } from "./geography/municipality.entity";
import { Report } from "./users/report.entity";
import { WardMeeting } from "./wards/ward-meeting.entity";

import { AspirantMessage } from "./aspirants/aspirant-message.entity";
import { AspirantMeeting } from "./aspirants/aspirant-meeting.entity";
import { AspirantBooking } from "./aspirants/aspirant-booking.entity";
import { AspirantVisit } from "./aspirants/aspirant-visit.entity";
import { VisitResponse } from "./aspirants/visit-response.entity";
import { MeetingResponse } from "./aspirants/meeting-response.entity";
import { ActivityRating } from "./aspirants/activity-rating.entity";
import { PendingAspirantRegistration } from "./aspirants/pending-aspirant-registration.entity";
import { AspirantDiscussionModule } from "./aspirant-discussion/aspirant-discussion.module";
import { AspirantDiscussionMessage } from "./aspirant-discussion/aspirant-discussion-message.entity";
import { AdminDocument } from "./admin/admin-document.entity";
import { UserSignedDocument } from "./users/user-signed-document.entity";
import { UserAspirantInteraction } from "./users/user-aspirant-interaction.entity";
import { AspirantWardMeetingsModule } from "./aspirant-ward-meetings/aspirant-ward-meetings.module";
import { IssuesModule } from "./issues/issues.module";
import { Issue } from "./issues/issue.entity";
import { HandRaise } from "./issues/hand-raise.entity";

import { AuditModule } from "./audit/audit.module";
import { AuditLog } from "./audit/audit-log.entity";
import { ElectionsModule } from "./elections/elections.module";
import { Election } from "./elections/election.entity";
import { GramaPanchayatModule } from "./grama-panchayat/grama-panchayat.module";
import { GramaPanchayat } from "./grama-panchayat/grama-panchayat.entity";
import { NotificationsModule } from "./notifications/notifications.module";
import { Notification } from "./notifications/notification.entity";
import { FcmToken } from "./notifications/fcm-token.entity";
import { StatsModule } from "./stats/stats.module";
import { RemindersModule } from "./reminders/reminders.module";

// Build a Redis connection URL from REDIS_HOST + REDIS_PORT. Returns undefined
// when REDIS_HOST is not set, so callers fall back to in-memory storage.
function resolveRedisUrl(): string | undefined {
  const host = process.env.REDIS_HOST;
  if (!host) return undefined;
  const port = process.env.REDIS_PORT || "6379";
  return `redis://${host}:${port}`;
}

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    // Sentry instrumentation (no-op unless SENTRY_DSN is set).
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate }),

    // Enables @Cron schedulers (meeting/visit reminders).
    ScheduleModule.forRoot(),

    // Global rate limiting: configurable via env vars THROTTLE_TTL and THROTTLE_LIMIT.
    // Default: 200 requests per 60 seconds (bot protection).
    // When REDIS_HOST is set, throttle counters live in Redis so limits are
    // shared across EC2 instances. Otherwise falls back to in-memory storage.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const ttl = parseInt(process.env.THROTTLE_TTL || "60000");
        const limit = parseInt(process.env.THROTTLE_LIMIT || "200");
        const redisUrl = resolveRedisUrl();
        return {
          throttlers: [{ ttl, limit }],
          storage: redisUrl
            ? new ThrottlerStorageRedisService(new Redis(redisUrl))
            : undefined,
        };
      },
    }),

    // Global cache backed by Redis (Keyv adapter).
    // Falls back to in-memory if Redis is not configured.
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => {
        const ttl = parseInt(process.env.CACHE_TTL_MS || "60000");
        const redisUrl = resolveRedisUrl();
        return {
          ttl,
          stores: redisUrl ? [createKeyv(redisUrl)] : undefined,
        };
      },
    }),

    TypeOrmModule.forRoot({
      type: "postgres",
      url: process.env.DATABASE_URL,
      synchronize: process.env.TYPEORM_SYNCHRONIZE === "true",
      migrationsRun: process.env.NODE_ENV === "production",
      // Only pick up proper MigrationInterface files (timestamp-prefixed).
      // Legacy standalone scripts (`add-*`, `migrate-*`, `run-*`) have
      // self-executing top-level code and must NOT be loaded by TypeORM.
      migrations: ["dist/migrations/[0-9]*.js"],
      // SSL applies to every non-development environment. RDS has
      // `sslmode=require` in the URL, so we have to give pg an explicit ssl
      // object — passing `ssl: false` doesn't suppress the SSL negotiation
      // forced by the URL, it just leaves Node falling back to its default
      // CA trust store (which doesn't include AWS RDS internal CAs), which
      // is exactly the "self-signed certificate in certificate chain"
      // failure mode.
      //
      // Resolution order:
      //   1. RDS_SSL_INSECURE=true → encrypted but unverified (fine inside a VPC).
      //   2. CA bundle on disk     → encrypted AND verified (most secure).
      //   3. Neither               → throw loudly with instructions.
      ssl:
        process.env.NODE_ENV !== "development"
          ? (() => {
              if (process.env.RDS_SSL_INSECURE === "true") {
                return { rejectUnauthorized: false };
              }
              const caPath =
                process.env.RDS_CA_PATH || "/opt/rds/global-bundle.pem";
              try {
                return { ca: fs.readFileSync(caPath).toString() };
              } catch {
                throw new Error(
                  `Database SSL is not configured. Either install the AWS RDS ` +
                    `CA bundle at ${caPath} (download from ` +
                    `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) ` +
                    `or set RDS_SSL_INSECURE=true in your .env to use TLS ` +
                    `without cert verification.`,
                );
              }
            })()
          : false,
      extra: {
        max: parseInt(process.env.DB_POOL_MAX || "10"),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000,
        application_name: "prajaakeeya-api",
      },
      entities: [
        User,
        Ward,
        Aspirant,
        Vote,
        VotingWindow,
        Message,
        State,
        Parliamentary,
        Assembly,
        Municipality,
        Report,
        WardMeeting,
        AspirantMessage,
        AspirantMeeting,
        AspirantBooking,
        AspirantVisit,
        VisitResponse,
        MeetingResponse,
        ActivityRating,
        PendingAspirantRegistration,
        AspirantDiscussionMessage,
        AdminDocument,
        UserSignedDocument,
        UserAspirantInteraction,
        Issue,
        HandRaise,
        Election,
        GramaPanchayat,
        Notification,
        FcmToken,
        AuditLog,
      ],
    }),

    AuthModule,
    UsersModule,
    WardsModule,
    AspirantWardMeetingsModule,
    AspirantsModule,
    VotesModule,
    AdminModule,
    ForumModule,
    GeographyModule,
    AspirantChatModule,
    AspirantDiscussionModule,
    IssuesModule,
    ElectionsModule,
    GramaPanchayatModule,
    NotificationsModule,
    StatsModule,
    RemindersModule,
    MediaModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    // Enforce rate limiting globally across all endpoints
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Report unhandled exceptions to Sentry (no-op unless SENTRY_DSN is set).
    // MulterExceptionFilter (@Catch(MulterError), bound in main.ts) still takes
    // precedence for upload errors.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
