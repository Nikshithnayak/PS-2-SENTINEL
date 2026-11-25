import { EventEmitter } from 'node:events';

export interface SentinelStreamEvent {
  type: 'alert.created' | 'alert.acknowledged' | 'alert.escalated' | 'alert.resolved' | 'delivery.updated' | 'engine.evaluated';
  patientId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const globalHub = globalThis as typeof globalThis & {
  __sentinelEventHub?: EventEmitter;
};

function getHub(): EventEmitter {
  if (!globalHub.__sentinelEventHub) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalHub.__sentinelEventHub = emitter;
  }
  return globalHub.__sentinelEventHub;
}

export function publishPatientEvent(event: SentinelStreamEvent): void {
  getHub().emit(`patient:${event.patientId}`, event);
}

export function subscribePatientEvents(
  patientId: string,
  handler: (event: SentinelStreamEvent) => void,
): () => void {
  const hub = getHub();
  const key = `patient:${patientId}`;
  hub.on(key, handler);
  return () => {
    hub.off(key, handler);
  };
}
