import type {
  AmbientActorId,
  AmbientEventType,
  EventEnvelope,
  WorkflowStage
} from "@neurotrax/contracts";

export interface EventFactory {
  next(
    actorId: AmbientActorId,
    type: AmbientEventType,
    stage: WorkflowStage,
    summary: string,
    occurredAtMs: number,
    payload?: Record<string, unknown>,
    evidenceRefs?: string[],
    causedByEventId?: string
  ): EventEnvelope;
}

export function createEventFactory(input: {
  visitId: string;
  participantId: string;
  baseTimeMs: number;
  initialSequence?: number;
}): EventFactory {
  const actorVersions: Record<AmbientActorId, string> = {
    "capture-web": "0.2.0",
    "capture-conductor": "0.2.0",
    "speech-acoustic": "speech-acoustic-0.4",
    "facial-expressivity": "facial-expressivity-0.3",
    "personal-trajectory": "ambient-context-and-confounds.v0.1",
    "evidence-card": "evidence-card-grounded.v0.1",
    "clinician-review": "0.2.0"
  };
  let sequence = input.initialSequence ?? 0;
  let lastOffsetMs = 0;

  return {
    next(
      actorId,
      type,
      stage,
      summary,
      occurredAtMs,
      payload = {},
      evidenceRefs = [],
      causedByEventId
    ) {
      sequence += 1;
      lastOffsetMs = Math.max(lastOffsetMs, occurredAtMs);
      const kind =
        actorId === "capture-web"
          ? "application"
          : actorId === "clinician-review"
            ? "human-interface"
            : "agent";
      const event: EventEnvelope = {
        schemaVersion: "neurotrax.workflow-event.v0.2",
        eventId: `${sequence}-${type}`,
        sequence,
        occurredAt: new Date(input.baseTimeMs + lastOffsetMs).toISOString(),
        visitId: input.visitId,
        participantId: input.participantId,
        actor: {
          kind,
          id: actorId,
          lane: actorId,
          version: actorVersions[actorId]
        },
        type,
        stage,
        summary,
        payload,
        evidenceRefs
      };
      if (causedByEventId) event.causedByEventId = causedByEventId;
      return event;
    }
  };
}
