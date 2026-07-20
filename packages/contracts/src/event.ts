export type AmbientActorId =
  | "capture-web"
  | "capture-conductor"
  | "voice-analysis"
  | "speech-acoustic"
  | "facial-expressivity"
  | "personal-trajectory"
  | "evidence-card"
  | "clinician-review";

export interface AmbientActor {
  kind: "application" | "agent" | "human-interface";
  id: AmbientActorId;
  lane: AmbientActorId;
  version: string;
}

export type AmbientEventType =
  | "consent.recorded"
  | "analysis.started"
  | "analysis.stopped"
  | "device.preflight.passed"
  | "capture.quality.changed"
  | "capture.window.opened"
  | "capture.window.closed"
  | "capture.window.detected"
  | "extractor.routed"
  | "measurement.recorded"
  | "measurement.abstained"
  | "encounter-observation.created"
  | "demo.phase.started"
  | "demo.phase.completed"
  | "demo.phase.timed-out"
  | "coordinator.decision.recorded"
  | "modality.outcome.created"
  | "trajectory.compatibility.assessed"
  | "trajectory.comparison.completed"
  | "evidence-card.requested"
  | "evidence-card.drafted"
  | "evidence-claim.grounded"
  | "evidence-claim.rejected"
  | "evidence.grounding.completed"
  | "evidence.trace.opened"
  | "human-review.pending"
  | "human-review.accepted"
  | "human-review.rejected"
  | "baseline.established";

export type WorkflowStage =
  | "ambient-capture"
  | "personal-trajectory"
  | "evidence-card"
  | "human-review";

export interface EventEnvelope {
  schemaVersion: "phenometric.workflow-event.v0.2";
  eventId: string;
  sequence: number;
  occurredAt: string;
  visitId: string;
  participantId: string;
  actor: AmbientActor;
  type: AmbientEventType;
  stage: WorkflowStage;
  summary: string;
  payload: Record<string, unknown>;
  evidenceRefs: string[];
  causedByEventId?: string;
}
