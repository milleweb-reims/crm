import { eventBus, type CrmEvent } from "@/lib/events";
import { getAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial ping
      controller.enqueue(encoder.encode("event: ping\ndata: connected\n\n"));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("event: ping\ndata: heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      function onEvent(event: CrmEvent) {
        // Don't send events back to the user who triggered them
        if (event.userId === session!.user.id) return;

        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        } catch {
          // Client disconnected
          cleanup();
        }
      }

      function cleanup() {
        clearInterval(heartbeat);
        eventBus.removeListener("crm", onEvent);
      }

      eventBus.on("crm", onEvent);

      // Cleanup when client disconnects
      // The controller.close() is called when the request is aborted
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
