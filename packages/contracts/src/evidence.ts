import type { TrajectoryDirection } from "./trajectory.js";

export interface EvidenceClaimFact {
  claimId: string;
  measurementCode: string;
  label: string;
  direction: TrajectoryDirection;
  statement: string;
  currentValue: number;
  unit: string;
  supportRefs: string[];
  eventIds: string[];
  allowedNumbers: string[];
}

export interface EvidenceCardClaim {
  claimId: string;
  statement: string;
}

export interface EvidenceCardDraft {
  headline: string;
  summary: string;
  claims: EvidenceCardClaim[];
  boundaryStatement: string;
}

export interface GroundingResult {
  status: "pass" | "fail";
  errors: string[];
  groundedClaimIds: string[];
}

export interface ReviewDecision {
  decision: "accepted" | "rejected";
  acceptedIntoSessionHistory: boolean;
  decidedAt: string;
}
