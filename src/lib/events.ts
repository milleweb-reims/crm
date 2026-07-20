import { EventEmitter } from "events";

export type CrmEvent = {
  readonly type: "prospect:created" | "prospect:updated" | "prospect:deleted" | "prospect:imported";
  readonly prospectId?: string;
  readonly userId: string;
  readonly timestamp: number;
};

declare global {
   
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
