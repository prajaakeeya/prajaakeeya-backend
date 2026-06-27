import "reflect-metadata";

// ── ioredis mock ─────────────────────────────────────────────────────────────
// Must be declared before the service import so Jest hoists it.
// Each `new Redis(url)` call gets a fresh mock instance tracked in `redisInstances`.
// The service creates pub first, then sub — so redisInstances[0]=pub, [1]=sub.
const redisInstances: any[] = [];

const RedisMock = jest.fn().mockImplementation(() => {
  const instance = {
    publish: jest.fn().mockResolvedValue(1),
    psubscribe: jest.fn((_pattern: string, cb?: (err: null) => void) => {
      if (cb) cb(null);
    }),
    on: jest.fn(),
    disconnect: jest.fn(),
  };
  redisInstances.push(instance);
  return instance;
});

jest.mock("ioredis", () => ({
  __esModule: true,
  default: RedisMock,
}));

import { ChatEventsService } from "./chat-events.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

function firePmessage(sub: any, channel: string, message: string) {
  const call = (sub.on.mock.calls as any[][]).find(([ev]) => ev === "pmessage");
  if (!call) throw new Error("pmessage handler was never registered on sub");
  const handler: Function = call[1];
  handler("chat:room:*", channel, message);
}

// ── In-memory fallback (no REDIS_HOST) ───────────────────────────────────────

describe("ChatEventsService (in-memory fallback)", () => {
  let bus: ChatEventsService;

  beforeEach(() => {
    bus = new ChatEventsService();
    // Do NOT call onModuleInit() — simulates the no-Redis local-dev path.
  });

  afterEach(() => {
    bus.onModuleDestroy();
  });

  it("delivers events only to subscribers of the matching room", () => {
    const room7: any[] = [];
    const room9: any[] = [];
    const s7 = bus.forRoom(7).subscribe((e) => room7.push(e));
    const s9 = bus.forRoom(9).subscribe((e) => room9.push(e));

    bus.publish({ aspirantId: 7, type: "message.created", payload: { id: 1 } });
    bus.publish({ aspirantId: 9, type: "message.created", payload: { id: 2 } });
    bus.publish({ aspirantId: 7, type: "message.deleted", payload: { id: 1 } });

    s7.unsubscribe();
    s9.unsubscribe();

    expect(room7).toHaveLength(2);
    expect(room7.map((e) => e.type)).toEqual([
      "message.created",
      "message.deleted",
    ]);
    expect(room9).toHaveLength(1);
    expect(room9[0].payload).toEqual({ id: 2 });
  });

  it("does not replay past events to late subscribers", () => {
    bus.publish({ aspirantId: 7, type: "message.created", payload: { id: 1 } });

    const received: any[] = [];
    const sub = bus.forRoom(7).subscribe((e) => received.push(e));
    sub.unsubscribe();

    expect(received).toHaveLength(0); // Subject is hot — no buffering
  });

  it("stops delivering events after onModuleDestroy", () => {
    const received: any[] = [];
    bus.forRoom(7).subscribe((e) => received.push(e));

    bus.publish({ aspirantId: 7, type: "message.created", payload: { id: 1 } });
    bus.onModuleDestroy();
    bus.publish({ aspirantId: 7, type: "message.created", payload: { id: 2 } });

    expect(received).toHaveLength(1);
  });
});

// ── Redis pub/sub path (REDIS_HOST set) ──────────────────────────────────────

describe("ChatEventsService (Redis pub/sub path)", () => {
  let bus: ChatEventsService;
  let pub: any;
  let sub: any;

  beforeEach(() => {
    redisInstances.length = 0; // reset per test
    process.env.REDIS_HOST = "localhost";
    bus = new ChatEventsService();
    bus.onModuleInit();
    // After onModuleInit: first instance = pub, second = sub.
    [pub, sub] = redisInstances;
  });

  afterEach(() => {
    bus.onModuleDestroy();
    delete process.env.REDIS_HOST;
    jest.clearAllMocks();
  });

  it("opens two Redis connections on init", () => {
    expect(redisInstances).toHaveLength(2);
  });

  it("subscribes to 'chat:room:*' pattern on the sub connection", () => {
    expect(sub.psubscribe).toHaveBeenCalledWith(
      "chat:room:*",
      expect.any(Function),
    );
  });

  it("publish() calls pub.publish with the correct channel and serialised payload", () => {
    const event = { aspirantId: 7, type: "message.created" as const, payload: { id: 1 } };
    bus.publish(event);

    expect(pub.publish).toHaveBeenCalledWith(
      "chat:room:7",
      JSON.stringify(event),
    );
  });

  it("an incoming Redis pmessage is delivered to forRoom() subscribers of the right room", () => {
    const received: any[] = [];
    const subscription = bus.forRoom(7).subscribe((e) => received.push(e));

    const event = { aspirantId: 7, type: "message.created" as const, payload: { id: 42 } };
    firePmessage(sub, "chat:room:7", JSON.stringify(event));

    subscription.unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it("forRoom() on one room ignores messages for a different room", () => {
    const room7: any[] = [];
    const room9: any[] = [];
    const s7 = bus.forRoom(7).subscribe((e) => room7.push(e));
    const s9 = bus.forRoom(9).subscribe((e) => room9.push(e));

    firePmessage(sub, "chat:room:7", JSON.stringify({
      aspirantId: 7, type: "message.created", payload: { id: 1 },
    }));
    firePmessage(sub, "chat:room:9", JSON.stringify({
      aspirantId: 9, type: "message.deleted", payload: { id: 2 },
    }));

    s7.unsubscribe();
    s9.unsubscribe();

    expect(room7).toHaveLength(1);
    expect(room9).toHaveLength(1);
    expect(room9[0].type).toBe("message.deleted");
  });

  it("silently drops a malformed (non-JSON) Redis message without throwing", () => {
    const received: any[] = [];
    const s = bus.forRoom(7).subscribe((e) => received.push(e));

    expect(() => {
      firePmessage(sub, "chat:room:7", "this is not json{{");
    }).not.toThrow();

    s.unsubscribe();
    expect(received).toHaveLength(0);
  });

  it("disconnects both Redis connections on destroy", () => {
    bus.onModuleDestroy();

    expect(pub.disconnect).toHaveBeenCalled();
    expect(sub.disconnect).toHaveBeenCalled();
  });
});
