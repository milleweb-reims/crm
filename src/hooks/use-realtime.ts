"use client";

import { useEffect, useEffectEvent } from "react";

export function useRealtime(onEvent: () => void) {
  const handleEvent = useEffectEvent(onEvent);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: NodeJS.Timeout;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("prospect:created", () => handleEvent());
      es.addEventListener("prospect:updated", () => handleEvent());
      es.addEventListener("prospect:deleted", () => handleEvent());
      es.addEventListener("prospect:imported", () => handleEvent());

      es.onerror = () => {
        es?.close();
        // Reconnect after 5 seconds
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      clearTimeout(retryTimeout);
      es?.close();
    };
  }, []);
}
