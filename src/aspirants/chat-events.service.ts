import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Observable, Subject, filter } from "rxjs";
import Redis from "ioredis";

export interface ChatEvent {
  aspirantId: number;
  type: "message.created" | "message.deleted";
  payload: unknown;
}

function resolveRedisUrl(): string | undefined {
  const host = process.env.REDIS_HOST;
  if (!host) return undefined;
  return `redis://${host}:${process.env.REDIS_PORT ?? "6379"}`;
}

/**
 * Cross-process SSE event bus for aspirant chat rooms.
 *
 * When REDIS_HOST is set (staging / production), publish() writes to a Redis
 * channel and a subscriber connection delivers it to every worker in the PM2
 * cluster — so an SSE client on worker B receives a message written by worker A.
 * Each worker subscribes to "chat:room:*" and filters by aspirantId in forRoom(),
 * keeping fan-out complete without per-room subscription management.
 *
 * When REDIS_HOST is unset (local dev), the service falls back to an
 * in-process Subject — same behaviour as before, single-process only.
 */
@Injectable()
export class ChatEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatEventsService.name);

  // Two dedicated Redis connections: pub for PUBLISH, sub for psubscribe.
  // A connection in subscriber mode cannot issue PUBLISH commands.
  // Both are null when Redis is not configured.
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  // Decoded events arriving from Redis — all forRoom() subscribers filter this.
  private readonly incoming$ = new Subject<ChatEvent>();

  // In-process fallback used when REDIS_HOST is not set.
  private readonly fallback$ = new Subject<ChatEvent>();

  onModuleInit(): void {
    const url = resolveRedisUrl();
    if (!url) {
      this.logger.warn(
        "REDIS_HOST is not set — chat SSE uses an in-memory bus (single-process only). " +
          "Set REDIS_HOST to enable cross-worker fan-out in PM2 cluster mode.",
      );
      return;
    }

    this.pub = new Redis(url);
    this.sub = new Redis(url);

    this.sub.psubscribe("chat:room:*", (err) => {
      if (err) this.logger.error("Redis psubscribe failed", err.message);
    });

    this.sub.on(
      "pmessage",
      (_pattern: string, _channel: string, message: string) => {
        try {
          this.incoming$.next(JSON.parse(message) as ChatEvent);
        } catch {
          this.logger.warn("Received unparseable chat event from Redis");
        }
      },
    );

    this.pub.on("error", (err: Error) =>
      this.logger.error("Chat pub Redis error", err.message),
    );
    this.sub.on("error", (err: Error) =>
      this.logger.error("Chat sub Redis error", err.message),
    );
  }

  onModuleDestroy(): void {
    this.pub?.disconnect();
    this.sub?.disconnect();
    this.incoming$.complete();
    this.fallback$.complete();
  }

  publish(event: ChatEvent): void {
    if (this.pub) {
      this.pub
        .publish(`chat:room:${event.aspirantId}`, JSON.stringify(event))
        .catch((err: Error) =>
          this.logger.error("Failed to publish chat event", err.message),
        );
    } else {
      this.fallback$.next(event);
    }
  }

  /** Returns an Observable of events for a single aspirant chat room. */
  forRoom(aspirantId: number): Observable<ChatEvent> {
    const source$ = this.pub ? this.incoming$ : this.fallback$;
    return source$.pipe(filter((e) => e.aspirantId === aspirantId));
  }
}
