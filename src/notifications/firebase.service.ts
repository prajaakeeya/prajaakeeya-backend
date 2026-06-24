import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import * as fs from "fs";
import * as admin from "firebase-admin";
import { FcmToken } from "./fcm-token.entity";

export interface PushPayload {
  title: string;
  body: string;
  /** FCM data values must be strings. Used by the service worker for routing. */
  data?: Record<string, string>;
  /** In-app deep-link path for notification taps, e.g. "/user/chat/7221".
   *  Sent as a relative path in data.link; resolved client-side against the
   *  current origin (service worker / iOS bridge). */
  link?: string;
}

// FCM multicast accepts at most 500 tokens per call.
const FCM_MULTICAST_LIMIT = 500;
const PRUNE_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Sends web push notifications via Firebase Cloud Messaging (Admin SDK) and
 * owns FCM token storage.
 *
 * Initialisation is OPTIONAL: if FIREBASE_SERVICE_ACCOUNT is not set, the
 * service logs a warning and all sends become no-ops — in-app notifications and
 * token registration still work, so local dev and credential-less environments
 * are unaffected.
 *
 * Set FIREBASE_SERVICE_ACCOUNT to the service-account JSON (single line / minified).
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | null = null;

  constructor(
    @InjectRepository(FcmToken)
    private readonly tokenRepo: Repository<FcmToken>,
  ) {}

  onModuleInit(): void {
    const serviceAccount = this.loadServiceAccount();
    if (!serviceAccount) {
      this.logger.warn(
        "Firebase service account not configured (set FIREBASE_SERVICE_ACCOUNT " +
          "JSON or FIREBASE_SERVICE_ACCOUNT_PATH file) — push notifications are " +
          "DISABLED. In-app notifications and token registration still work.",
      );
      return;
    }
    try {
      this.app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
      this.logger.log(
        "Firebase Admin initialised — push notifications enabled.",
      );
    } catch (err) {
      this.logger.error(
        `Failed to initialise Firebase Admin: ${(err as Error).message}. ` +
          "Push notifications are disabled.",
      );
    }
  }

  /**
   * Load the service account from either an inline JSON env var
   * (FIREBASE_SERVICE_ACCOUNT) or a path to the JSON file on disk
   * (FIREBASE_SERVICE_ACCOUNT_PATH). The file path is the easiest option on a
   * server — no minifying/quoting of the embedded private key required.
   */
  private loadServiceAccount(): admin.ServiceAccount | null {
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    try {
      if (inline && inline.trim()) {
        return JSON.parse(inline) as admin.ServiceAccount;
      }
      if (path && path.trim()) {
        return JSON.parse(
          fs.readFileSync(path, "utf8"),
        ) as admin.ServiceAccount;
      }
    } catch (err) {
      this.logger.error(
        `Could not read/parse Firebase service account: ${(err as Error).message}`,
      );
    }
    return null;
  }

  get enabled(): boolean {
    return this.app !== null;
  }

  /** Register (or re-assign) an FCM token for a user. Idempotent. */
  async registerToken(
    userId: number,
    token: string,
    platform?: string,
  ): Promise<void> {
    if (!token) return;
    const existing = await this.tokenRepo.findOne({ where: { token } });
    if (existing) {
      if (
        existing.userId !== userId ||
        (platform && existing.platform !== platform)
      ) {
        existing.userId = userId;
        if (platform) existing.platform = platform;
        await this.tokenRepo.save(existing);
      }
      return;
    }
    await this.tokenRepo.save(
      this.tokenRepo.create({ userId, token, platform: platform ?? null }),
    );
  }

  /** Remove a token (call on logout / when the client reports it stale). */
  async removeToken(userId: number, token: string): Promise<void> {
    if (!token) return;
    // Scope deletion to the caller's own token — an FCM token is not a secret
    // (it leaks via logs/Sentry), so deleting by token alone would let anyone
    // suppress another user's push notifications.
    await this.tokenRepo.delete({ userId, token });
  }

  /**
   * Best-effort push to every device of the given users. Silently no-ops when
   * Firebase isn't configured or no tokens exist. Prunes tokens FCM reports as
   * invalid. Never throws — callers treat push as fire-and-forget.
   */
  async sendToUsers(userIds: number[], payload: PushPayload): Promise<void> {
    if (!this.app || !userIds.length) return;
    try {
      const tokens = await this.tokenRepo.find({
        where: { userId: In(userIds) },
        select: ["token"],
      });
      if (!tokens.length) return;
      const all = tokens.map((t) => t.token);
      const invalid: string[] = [];

      // Deep link for notification taps, as a RELATIVE path in `data.link`
      // (e.g. "/user/chat/7221"). The web service worker and the iOS native
      // bridge each resolve it against the current origin, so the same payload
      // works on staging, production and localhost with no absolute-URL config.
      // We intentionally do NOT set webpush.fcm_options.link: the service
      // worker's own notificationclick handler owns navigation, and a second
      // (FCM-built-in) handler would double-open / conflict.
      const data = {
        ...(payload.data ?? {}),
        ...(payload.link ? { link: payload.link } : {}),
      };

      for (let i = 0; i < all.length; i += FCM_MULTICAST_LIMIT) {
        const batch = all.slice(i, i + FCM_MULTICAST_LIMIT);
        const res = await admin.messaging().sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body: payload.body },
          data,
          apns: {
            headers: { "apns-priority": "10", "apns-push-type": "alert" },
            payload: {
              aps: {
                alert: { title: payload.title, body: payload.body },
                sound: "default",
              },
            },
          },
          webpush: {
            notification: { title: payload.title, body: payload.body },
          },
        });
        res.responses.forEach((r, idx) => {
          if (!r.success && r.error) {
            if (PRUNE_ERROR_CODES.has(r.error.code)) {
              // Routine churn — token belongs to an uninstalled app / rotated
              // device. Prune it quietly; the "Pruned N tokens" debug summary
              // below is enough. No need to WARN per dead token.
              invalid.push(batch[idx]);
            } else {
              // An unexpected delivery failure (e.g. third-party-auth-error =
              // APNs key misconfig, or message-rate-exceeded) — keep it visible.
              this.logger.warn(`FCM send failed: ${r.error.code}`);
            }
          }
        });
      }

      if (invalid.length) {
        await this.tokenRepo.delete({ token: In(invalid) });
        this.logger.debug(`Pruned ${invalid.length} invalid FCM token(s).`);
      }
    } catch (err) {
      this.logger.warn(`sendToUsers failed: ${(err as Error).message}`);
    }
  }
}
