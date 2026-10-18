import type { ServerResponse } from "node:http";
export class EventBus {
  private next = 0;
  private clients = new Set<ServerResponse>();
  private replay: { id: number; type: string; data: unknown }[] = [];
  publish = (type: string, data: unknown) => {
    const event = { id: ++this.next, type, data };
    this.replay.push(event);
    if (this.replay.length > 300) this.replay.shift();
    const packet = this.packet(event);
    for (const client of this.clients) client.write(packet);
  };
  private packet(event: { id: number; type: string; data: unknown }) {
    return `id: ${event.id}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`;
  }
  subscribe(response: ServerResponse, lastId = 0) {
    this.clients.add(response);
    response.write(": connected\n\n");
    for (const e of this.replay)
      if (e.id > lastId) response.write(this.packet(e));
    const timer = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    response.on("close", () => {
      clearInterval(timer);
      this.clients.delete(response);
    });
  }
  close() {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
