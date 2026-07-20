import { eventBus, type CrmEvent } from "@/lib/events";
import { getAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const formatSseMessage = (eventType: string, data: string): string =>
  `event: ${eventType}\ndata: ${data}\n\n`;

const INITIAL_PING = "event: ping\ndata: connected\n\n";
const HEARTBEAT_MESSAGE = "event: ping\ndata: heartbeat\n\n";

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(INITIAL_PING));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(HEARTBEAT_MESSAGE));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      function onEvent(event: CrmEvent) {
        if (event.userId === session!.user.id) return;

        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(formatSseMessage(event.type, data)));
        } catch {
          cleanup();
        }
      }

      function cleanup() {
        clearInterval(heartbeat);
        eventBus.removeListener("crm", onEvent);
      }

      eventBus.on("crm", onEvent);

      const checkClosed = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(""));
        } catch {
          cleanup();
          clearInterval(checkClosed);
        }
      }, 10000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
