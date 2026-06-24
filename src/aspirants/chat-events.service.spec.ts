import "reflect-metadata";
import { ChatEventsService } from "./chat-events.service";

describe("ChatEventsService", () => {
  it("delivers events only to subscribers of the matching room", () => {
    const bus = new ChatEventsService();
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
    const bus = new ChatEventsService();
    bus.publish({ aspirantId: 7, type: "message.created", payload: { id: 1 } });

    const received: any[] = [];
    const sub = bus.forRoom(7).subscribe((e) => received.push(e));
    sub.unsubscribe();

    expect(received).toHaveLength(0); // Subject is hot — no buffering of prior events
  });
});
