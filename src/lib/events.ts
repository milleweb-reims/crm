import { EventEmitter } from "events";

export type CrmEvent = {
  type: "prospect:created" | "prospect:updated" | "prospect:deleted" | "prospect:imported";
  prospectId?: string;
  userId: string;
  timestamp: number;
};

declare global {
  // eslint-disable-next-line no-var
  var crmEventBus: EventEmitter | undefined;
}

export const eventBus = global.crmEventBus ?? new EventEmitter();
eventBus.setMaxListeners(100);

if (!global.crmEventBus) {
  global.crmEventBus = eventBus;
}

export function emitCrmEvent(event: CrmEvent) {
  eventBus.emit("crm", event);
}
