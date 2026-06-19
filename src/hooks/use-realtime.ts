"use client";

import { useEffect, useRef } from "react";

export function useRealtime(onEvent: () => void) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: NodeJS.Timeout;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("prospect:created", () => callbackRef.current());
      es.addEventListener("prospect:updated", () => callbackRef.current());
      es.addEventListener("prospect:deleted", () => callbackRef.current());
      es.addEventListener("prospect:imported", () => callbackRef.current());

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
