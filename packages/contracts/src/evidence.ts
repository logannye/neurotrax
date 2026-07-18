import type { Modality } from "./measurement.js";

export interface EvidenceClaimFact {
  claimId: string;
  measurementCode: string;
  label: string;
  modality: Modality;
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

export interface EvidenceNarrativeDraft {
  headline: string;
  summary: string;
}

export interface EvidenceCardDraft {
  headline: string;
  summary: string;
  claims: EvidenceCardClaim[];
  boundaryStatement: string;
}

export interface EvidenceSynthesisTiming {
  totalMs: number;
  modelMs: number;
  validationMs: number;
}

export interface GroundingResult {
  status: "pass" | "fail";
  errors: string[];
  groundedClaimIds: string[];
}

export interface ReviewDecision {
  decision: "approved" | "dismissed";
  approvedForSession: boolean;
  decidedAt: string;
}
