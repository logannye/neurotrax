import type { AmbientActorId, AmbientEventType, EventEnvelope } from "@neurotrax/contracts";

export interface EventFactory {
  next(
    actorId: AmbientActorId,
    type: AmbientEventType,
    summary: string,
    occurredAtMs: number,
    payload?: Record<string, unknown>,
    evidenceRefs?: string[]
  ): EventEnvelope;
}

export function createEventFactory(input: {
  visitId: string;
  participantId: string;
  baseTimeMs: number;
}): EventFactory {
  let sequence = 0;
  let lastOffsetMs = 0;

  return {
    next(actorId, type, summary, occurredAtMs, payload = {}, evidenceRefs = []) {
      sequence += 1;
      lastOffsetMs = Math.max(lastOffsetMs, occurredAtMs);
      return {
        schemaVersion: "neurotrax.ambient-event.v0.1",
        eventId: `${sequence}-${type}`,
        sequence,
        occurredAt: new Date(input.baseTimeMs + lastOffsetMs).toISOString(),
        visitId: input.visitId,
        participantId: input.participantId,
        actor: { kind: "agent", id: actorId, lane: actorId, version: "0.1.0" },
        type,
        stage: "ambient-capture",
        summary,
        payload,
        evidenceRefs
      };
    }
  };
}
