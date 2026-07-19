# Clinician Evidence Card

## Goal

Draft one concise, inspectable review artifact from structured, protocol-valid
observation and comparison facts.

## Agentic behavior

- call required `gpt-5.6` through the server-side Responses API;
- require Structured Output containing only bounded narrative fields;
- deterministically validate each returned claim and its provenance;
- retry one grounding failure with explicit errors;
- preserve the exact deterministic outcomes when narrative synthesis is
  unavailable or invalid;
- expose model, refusal, schema, timeout, and grounding state to operator
  diagnostics;
- publish pending-review state; and
- record the human Accept or Reject decision.

The model cannot create measurements, change the comparison set, expand the
protocol claim, or write history. Only human review can approve a clinical
artifact.

## Hard boundary

The Evidence Agent cannot diagnose, classify progression, infer cause, propose
treatment, sign, order, prescribe, message a patient, or execute an action.
