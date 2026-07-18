export type AmbientActorId =
  | "capture-conductor"
  | "speech-acoustic"
  | "facial-expressivity";

export interface AmbientActor {
  kind: "agent";
  id: AmbientActorId;
  lane: AmbientActorId;
  version: string;
}

export type AmbientEventType =
  | "capture.window.detected"
  | "measurement.recorded"
  | "measurement.abstained"
  | "encounter-observation.created";

export interface EventEnvelope {
  schemaVersion: "neurotrax.ambient-event.v0.1";
  eventId: string;
  sequence: number;
  occurredAt: string;
  visitId: string;
  participantId: string;
  actor: AmbientActor;
  type: AmbientEventType;
  stage: "ambient-capture";
  summary: string;
  payload: Record<string, unknown>;
  evidenceRefs: string[];
}
